/**
 * Consumables (systems-spec §4.6): potions/scrolls/pills carry embedded spells + a level, wands/
 * staves carry charges. Quaffing/reciting/eating casts the item's spells through the same effect
 * engine as `cast` (no mana, no failure roll); a device spends a charge per use. Deterministic RNG.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype, ObjPrototype } from "../world/model.ts";
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
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = {
  port: 0, contentDir: "", worldAreas: ["drazuni.are", "drazpost.are"], startRoom: ROOM, adminEmails: [], supabase: {},
};
let mageId: number;

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are", "drazpost.are"]);
  mageId = [...world.classes.values()].find((c) => c.name === "Mage")!.id;
});

function makeMob(overrides: Partial<MobPrototype> = {}): MobPrototype {
  return {
    vnum: 990600, area: "test", keywords: "training dummy", shortDesc: "a training dummy",
    longDesc: "A dummy stands here.", description: "", level: 1, alignment: 0,
    actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1", damDice: "1d1",
    gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
    resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
    ...overrides,
  };
}

function setup(seed = 5) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(seed));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-0000000000cc", accountId: "acc", name: "Tippler", raceId: 0, classId: mageId, startRoom: ROOM,
  });
  ch.level = 30;
  ch.maxMana = ch.mana = 500;
  ch.maxHp = 400; ch.hp = 400;
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const mob = spawnMob(makeMob(), ROOM);
  mob.hp = mob.maxHp = 500; // survives a spell hit so we can measure damage
  live.addMob(mob);
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, ch, fighter, mob, received, ctx };
}

const text = (r: ServerMessage[]): string =>
  r.filter((m): m is Extract<ServerMessage, { t: "output" }> => m.t === "output")
    .flatMap((m) => m.lines.map((l) => l.map((s) => s.text).join(""))).join("\n");

/** Its first embedded spell's classified category, or undefined when unclassified. */
const firstCat = (p: ObjPrototype) => world.getSkill((p.spells ?? [])[0] ?? "")?.category;

/** Scan the loaded world for an object of `type` whose first embedded spell has `category`. */
function findItem(type: string, category: string): ObjPrototype | undefined {
  for (const p of world.objPrototypes.values()) {
    if (p.itemType === type && (p.spells?.length ?? 0) > 0 && firstCat(p) === category) return p;
  }
  return undefined;
}

describe("quaff", () => {
  it("drinks a healing potion, restoring hp and consuming the vial", () => {
    const potion = findItem("potion", "heal");
    expect(potion, "a heal potion in the test areas").toBeTruthy();
    const s = setup();
    s.ch.hp = 100; // wounded
    s.ch.inventory.push({ vnum: potion!.vnum });
    dispatchCommand(s.ctx, `quaff ${potion!.shortDesc}`);
    expect(s.ch.hp).toBeGreaterThan(100); // healed
    expect(s.ch.inventory.length).toBe(0); // single-use: gone
    expect(text(s.received).toLowerCase()).toContain("quaff");
  });

  it("refuses to quaff something that isn't a potion", () => {
    const s = setup();
    const armor = [...world.objPrototypes.values()].find((p) => p.itemType === "armor")!;
    s.ch.inventory.push({ vnum: armor.vnum });
    dispatchCommand(s.ctx, `quaff ${armor.shortDesc}`);
    expect(text(s.received).toLowerCase()).toContain("can't quaff");
    expect(s.ch.inventory.length).toBe(1); // not consumed
  });
});

describe("recite", () => {
  it("reads a damage scroll at an explicit foe, wounding it and consuming the scroll", () => {
    const scroll = findItem("scroll", "damage");
    expect(scroll, "a damage scroll in the test areas").toBeTruthy();
    const s = setup();
    s.ch.inventory.push({ vnum: scroll!.vnum });
    const scrollKw = scroll!.keywords.split(/\s+/)[0]!;
    dispatchCommand(s.ctx, `recite ${scrollKw} dummy`);
    expect(s.mob.hp).toBeLessThan(500); // the foe took damage
    expect(s.ch.inventory.length).toBe(0); // crumbled to dust
  });

  it("reads a healing scroll on yourself with no target", () => {
    const scroll = findItem("scroll", "heal");
    expect(scroll, "a heal scroll in the test areas").toBeTruthy();
    const s = setup();
    s.ch.hp = 100;
    s.ch.inventory.push({ vnum: scroll!.vnum });
    dispatchCommand(s.ctx, `recite ${scroll!.shortDesc}`);
    expect(s.ch.hp).toBeGreaterThan(100);
    expect(s.ch.inventory.length).toBe(0);
  });
});

describe("zap / brandish (charged devices)", () => {
  it("spends one charge per zap and drains to empty", () => {
    // Any wand/staff with a resolvable spell; give it a known charge count for a deterministic drain.
    let device: ObjPrototype | undefined;
    for (const p of world.objPrototypes.values()) {
      if ((p.itemType === "wand" || p.itemType === "staff") && firstCat(p)) { device = p; break; }
    }
    expect(device, "a charged device with a classified spell").toBeTruthy();
    const s = setup();
    const inst = { vnum: device!.vnum, charges: 2 };
    s.ch.inventory.push(inst);
    const verb = device!.itemType === "wand" ? "zap" : "brandish";
    dispatchCommand(s.ctx, `${verb} ${device!.shortDesc}`);
    expect(inst.charges).toBe(1); // one charge spent, device retained
    expect(s.ch.inventory.length).toBe(1);
    dispatchCommand(s.ctx, `${verb} ${device!.shortDesc}`);
    expect(inst.charges).toBe(0);
    dispatchCommand(s.ctx, `${verb} ${device!.shortDesc}`); // now empty
    expect(text(s.received).toLowerCase()).toContain("no charges left");
  });
});
