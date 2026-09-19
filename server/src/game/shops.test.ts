/**
 * Shops + area economy (systems-spec §4.1-4.2).
 * Covers the CHA haggle pricing math, the type-gated sell, and the buy/sell flow against the
 * finite shared area pool (buying pours gold in; selling pulls it out, capped at the pool).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { ObjPrototype, ShopDef } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { spawnMob } from "./mobInstance.ts";
import { Rng } from "./rng.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import { buyPrice, objMatches, profitMod, sellPrice } from "./shops.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = {
  port: 0, contentDir: "", worldAreas: ["drazuni.are", "drazpost.are"], startRoom: ROOM, adminEmails: [], supabase: {},
};

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are", "drazpost.are"]);
});

// --- synthetic fixtures for the pure pricing math (independent of extracted content) ---
function makeObj(overrides: Partial<ObjPrototype> = {}): ObjPrototype {
  return {
    vnum: 990001, area: "test", keywords: "widget test", shortDesc: "a test widget", description: "",
    actionDesc: "", itemType: "armor", extraFlags: [], wearFlags: [], values: [], weight: 1, cost: 1000,
    ...overrides,
  };
}
function makeShop(overrides: Partial<ShopDef> = {}): ShopDef {
  return { keeperVnum: 990100, tradeTypes: ["armor"], profitBuy: 120, profitSell: 90, openHour: 0, closeHour: 23, area: "test", ...overrides };
}

describe("shop pricing math (CHA haggle, systems-spec §4.2)", () => {
  it("profitmod = 13 - buyer CHA", () => {
    expect(profitMod(13)).toBe(0);
    expect(profitMod(25)).toBe(-12);
    expect(profitMod(3)).toBe(10);
  });

  it("BUY = cost * max(profit_sell+1, profit_buy+profitmod)/100", () => {
    const obj = makeObj({ cost: 1000 });
    const shop = makeShop({ profitBuy: 120, profitSell: 90 });
    // CHA 13 -> profitmod 0 -> max(91, 120) = 120 -> 1200
    expect(buyPrice(obj, shop, 13)).toBe(1200);
    // CHA 3  -> profitmod 10 -> max(91, 130) = 130 -> 1300
    expect(buyPrice(obj, shop, 3)).toBe(1300);
    // CHA 25 -> profitmod -12 -> max(91, 108) = 108 -> 1080
    expect(buyPrice(obj, shop, 25)).toBe(1080);
  });

  it("higher CHA lowers the buy price (haggle actually helps)", () => {
    const obj = makeObj();
    const shop = makeShop();
    expect(buyPrice(obj, shop, 25)).toBeLessThan(buyPrice(obj, shop, 3));
  });

  it("buy price never drops below 1", () => {
    const obj = makeObj({ cost: 1 });
    const shop = makeShop({ profitBuy: 0, profitSell: -100 });
    expect(buyPrice(obj, shop, 25)).toBeGreaterThanOrEqual(1);
  });

  it("SELL is 0 unless the shop trades that item_type", () => {
    const shop = makeShop({ tradeTypes: ["armor"] });
    expect(sellPrice(makeObj({ itemType: "armor", cost: 1000 }), shop, 13)).toBeGreaterThan(0);
    expect(sellPrice(makeObj({ itemType: "weapon", cost: 1000 }), shop, 13)).toBe(0);
  });

  it("SELL = cost * min(profit_sell+1, profit_buy+profitmod)/100 for a traded type", () => {
    const obj = makeObj({ itemType: "armor", cost: 1000 });
    const shop = makeShop({ profitBuy: 120, profitSell: 90 });
    // CHA 13 -> min(91, 120) = 91 -> 910
    expect(sellPrice(obj, shop, 13)).toBe(910);
  });

  it("objMatches matches on keyword prefix and short-desc substring", () => {
    const obj = makeObj({ keywords: "iron helm", shortDesc: "an iron helm" });
    expect(objMatches(obj, "hel")).toBe(true);
    expect(objMatches(obj, "iron")).toBe(true);
    expect(objMatches(obj, "helm")).toBe(true);
    expect(objMatches(obj, "sword")).toBe(false);
  });
});

describe("area economy pool (systems-spec §4.1)", () => {
  it("seeds a fresh area pool to ~250M", () => {
    const eco = new Economy();
    expect(eco.pool("somewhere.are")).toBe(250_000_000);
  });

  it("deposits pour gold in; withdrawals pull it out", () => {
    const eco = new Economy();
    const start = eco.pool("a.are");
    eco.deposit("a.are", 5000);
    expect(eco.pool("a.are")).toBe(start + 5000);
    const paid = eco.withdraw("a.are", 2000);
    expect(paid).toBe(2000);
    expect(eco.pool("a.are")).toBe(start + 3000);
  });

  it("a withdrawal is capped at the pool (can't over-draw)", () => {
    const eco = new Economy();
    eco.withdraw("b.are", 250_000_000); // drain it
    expect(eco.pool("b.are")).toBe(0);
    const paid = eco.withdraw("b.are", 5000);
    expect(paid).toBe(0);
    expect(eco.canCover("b.are", 1)).toBe(false);
  });
});

// --- integration: a real shopkeeper spawned in the room, buy/sell over the wire ---
function armorKeeper() {
  // 21007 is drazpost's armour shop; find its keeper mob prototype + a stocked armour item.
  const keeperVnum = 21007;
  const proto = world.mobPrototypes.get(keeperVnum);
  const stock = world.shopStock.get(keeperVnum) ?? [];
  const armorVnum = stock.find((v) => world.getObjPrototype(v)?.itemType === "armor");
  return { keeperVnum, proto, armorVnum };
}

function setup(cha = 13, gold = 100_000) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(7));
  const received: ServerMessage[] = [];
  const character = createCharacter(world, {
    id: "00000000-0000-0000-0000-000000000009", accountId: "acc", name: "Buyer", raceId: 0, classId: 3, startRoom: ROOM,
  });
  character.stats.cha = cha;
  character.gold = gold;
  const player: Player = { character, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(character, world, (m) => received.push(m));
  const { keeperVnum, proto } = armorKeeper();
  const mob = spawnMob(proto!, ROOM);
  live.addMob(mob);
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, db: null, quit: () => {} };
  return { live, combat, character, player, fighter, received, ctx, keeperVnum };
}

const text = (received: ServerMessage[]): string =>
  received.filter((m): m is Extract<ServerMessage, { t: "output" }> => m.t === "output")
    .flatMap((m) => m.lines.map((l) => l.map((s) => s.text).join("")))
    .join("\n");

describe("shop buy/sell flow (integration)", () => {
  it("the extracted drazpost armour shop loaded with real stock", () => {
    const { proto, armorVnum } = armorKeeper();
    expect(proto).toBeDefined();
    expect(armorVnum).toBeDefined();
    expect(world.shops.get(21007)?.tradeTypes).toContain("armor");
  });

  it("buying spends gold, adds the item, and pours gold into the area pool", () => {
    const s = setup();
    const { armorVnum } = armorKeeper();
    const p = world.getObjPrototype(armorVnum!)!;
    const price = buyPrice(p, world.shops.get(21007)!, s.character.stats.cha);
    const kw = p.keywords.split(/\s+/)[1] ?? p.keywords.split(/\s+/)[0]!; // e.g. "helm"
    const goldBefore = s.character.gold;
    const invBefore = s.character.inventory.length;
    const area = world.getRoom(ROOM)!.area;
    const poolBefore = s.ctx.economy.pool(area);

    dispatchCommand(s.ctx, `buy ${kw}`);

    expect(s.character.gold).toBe(goldBefore - price);
    expect(s.character.inventory.length).toBe(invBefore + 1);
    expect(s.character.inventory.some((it) => it.vnum === armorVnum)).toBe(true);
    expect(s.ctx.economy.pool(area)).toBe(poolBefore + price);
  });

  it("selling a traded item pays gold out of the pool and removes the item", () => {
    const s = setup();
    const { armorVnum } = armorKeeper();
    s.character.inventory.push({ vnum: armorVnum! });
    const p = world.getObjPrototype(armorVnum!)!;
    const payout = sellPrice(p, world.shops.get(21007)!, s.character.stats.cha);
    const goldBefore = s.character.gold;
    const area = world.getRoom(ROOM)!.area;
    const poolBefore = s.ctx.economy.pool(area);
    const kw = p.keywords.split(/\s+/)[1] ?? p.keywords.split(/\s+/)[0]!;

    dispatchCommand(s.ctx, `sell ${kw}`);

    expect(payout).toBeGreaterThan(0);
    expect(s.character.gold).toBe(goldBefore + payout);
    expect(s.character.inventory.some((it) => it.vnum === armorVnum)).toBe(false);
    expect(s.ctx.economy.pool(area)).toBe(poolBefore - payout);
  });

  it("refuses to sell an item_type the shop does not trade", () => {
    const s = setup();
    // find a weapon (armour shop won't buy it)
    const weaponVnum = [...world.objPrototypes.values()].find((o) => o.itemType === "weapon")?.vnum;
    expect(weaponVnum).toBeDefined();
    s.character.inventory.push({ vnum: weaponVnum! });
    const goldBefore = s.character.gold;
    const p = world.getObjPrototype(weaponVnum!)!;
    const kw = p.keywords.split(/\s+/)[0]!;

    dispatchCommand(s.ctx, `sell ${kw}`);

    expect(text(s.received).toLowerCase()).toContain("doesn't trade");
    expect(s.character.gold).toBe(goldBefore); // no payout
    expect(s.character.inventory.some((it) => it.vnum === weaponVnum)).toBe(true); // still carried
  });

  it("can't sell an item worth more than the area pool holds", () => {
    const s = setup();
    const { armorVnum } = armorKeeper();
    s.character.inventory.push({ vnum: armorVnum! });
    const area = world.getRoom(ROOM)!.area;
    s.ctx.economy.withdraw(area, s.ctx.economy.pool(area)); // drain the pool to 0
    const goldBefore = s.character.gold;
    const p = world.getObjPrototype(armorVnum!)!;
    const kw = p.keywords.split(/\s+/)[1] ?? p.keywords.split(/\s+/)[0]!;

    dispatchCommand(s.ctx, `sell ${kw}`);

    expect(text(s.received).toLowerCase()).toContain("drained");
    expect(s.character.gold).toBe(goldBefore); // no payout
    expect(s.character.inventory.some((it) => it.vnum === armorVnum)).toBe(true); // still carried
  });

  it("caps a bulk buy at MAX_BUY (20)", () => {
    const s = setup(13, 100_000_000);
    const { armorVnum } = armorKeeper();
    const p = world.getObjPrototype(armorVnum!)!;
    const kw = p.keywords.split(/\s+/)[1] ?? p.keywords.split(/\s+/)[0]!;
    dispatchCommand(s.ctx, `buy ${kw} 999`);
    expect(s.character.inventory.filter((it) => it.vnum === armorVnum).length).toBe(20);
  });
});
