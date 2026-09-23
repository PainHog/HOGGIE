/**
 * Carry capacity (systems-spec §4.6): STR sets a max carry weight and a max pack count; picking up,
 * looting, and buying all respect it — you can't haul more than you can carry.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { ObjPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter, carryLimits } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { makeGroundItem } from "./ground.ts";
import { Rng } from "./rng.ts";
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const obj = (over: Partial<ObjPrototype>): ObjPrototype => ({
  vnum: 0, area: "test", keywords: "", shortDesc: "", description: "", actionDesc: "",
  itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 1, cost: 1, affects: [], ...over,
});
const ANVIL = obj({ vnum: 971001, keywords: "anvil", shortDesc: "a heavy anvil", weight: 500 });
const FEATHER = obj({ vnum: 971002, keywords: "feather", shortDesc: "a feather", weight: 1 });

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  for (const o of [ANVIL, FEATHER]) world.objPrototypes.set(o.vnum, o);
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-000000carry1", accountId: "acc", name: "Mule", raceId: 0, classId: 3, startRoom: ROOM });
  const player: Player = { character: ch, send: (m) => recv.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, ch, recv, ctx };
}

const carrying = (ch: ReturnType<typeof setup>["ch"], vnum: number) => ch.inventory.some((it) => it.vnum === vnum);

describe("weight limit", () => {
  it("refuses a pickup that would exceed the carry weight", () => {
    const s = setup();
    expect(carryLimits(s.ch).maxWeight).toBeLessThan(ANVIL.weight); // one anvil is over the limit
    s.live.addGround(ROOM, makeGroundItem({ vnum: ANVIL.vnum }));
    dispatchCommand(s.ctx, "get anvil");
    expect(carrying(s.ch, ANVIL.vnum)).toBe(false); // too heavy — left on the ground
    expect(s.live.roomGround(ROOM)).toHaveLength(1);
  });

  it("allows a light pickup", () => {
    const s = setup();
    s.live.addGround(ROOM, makeGroundItem({ vnum: FEATHER.vnum }));
    dispatchCommand(s.ctx, "get feather");
    expect(carrying(s.ch, FEATHER.vnum)).toBe(true);
  });
});

describe("count limit", () => {
  it("refuses picking up more than the pack can hold", () => {
    const s = setup();
    const { maxItems } = carryLimits(s.ch);
    for (let i = 0; i < maxItems; i++) s.ch.inventory.push({ vnum: FEATHER.vnum }); // pack full of feathers
    s.live.addGround(ROOM, makeGroundItem({ vnum: FEATHER.vnum }));
    dispatchCommand(s.ctx, "get feather");
    expect(s.ch.inventory.length).toBe(maxItems); // no more room
    expect(s.live.roomGround(ROOM)).toHaveLength(1);
  });
});
