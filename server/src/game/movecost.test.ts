/**
 * Movement cost (systems-spec §3.1): each step spends `move` by the room's sector cost, scaled by
 * encumbrance; out of `move` you're too exhausted to go.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { Rng } from "./rng.ts";
import { ClanStore } from "./clanStore.ts";
import { encumbranceMult, moveCost, sectorMoveCost } from "./movement.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

const ROOM = 10300, HEAVY = 970900;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

let world: World, exitDir: string, sector0: string;
beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  exitDir = world.getRoom(ROOM)!.exits.find((e) => world.getRoom(e.toVnum))!.dir;
  sector0 = world.getRoom(ROOM)!.sector;
  const heavy: ObjPrototype = { vnum: HEAVY, area: "t", keywords: "anvil", shortDesc: "an anvil", description: "", actionDesc: "", itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 180, cost: 1, affects: [] };
  world.objPrototypes.set(HEAVY, heavy);
});
beforeEach(() => { world.getRoom(ROOM)!.sector = "field"; }); // field = cost 2
function reset() { world.getRoom(ROOM)!.sector = sector0; }

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-00000000move", accountId: "acc", name: "Walker", raceId: 0, classId: 3, startRoom: ROOM });
  const player: Player = { character: ch, send: (m) => recv.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, ch, recv, ctx };
}
const text = (m: ServerMessage[]) => m.flatMap((x) => (x.t === "output" ? x.lines.flat().map((s) => s.text) : [])).join("\n");

describe("cost formulas", () => {
  it("sector costs and the encumbrance ladder match the spec", () => {
    reset();
    expect(sectorMoveCost("inside")).toBe(1);
    expect(sectorMoveCost("air")).toBe(10);
    expect(encumbranceMult(0, 200)).toBe(1);
    expect(encumbranceMult(150, 200)).toBe(1.5); // 75%
    expect(encumbranceMult(160, 200)).toBe(2); // 80%
    expect(encumbranceMult(200, 200)).toBe(4); // full
    expect(moveCost("field", 0, 200)).toBe(2);
    expect(moveCost("field", 160, 200)).toBe(4); // 2 * 2
  });
});

describe("moving spends move", () => {
  it("a step deducts the sector cost", () => {
    const s = setup();
    const before = s.ch.move;
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).not.toBe(ROOM); // moved
    expect(before - s.ch.move).toBe(2); // field costs 2
  });

  it("a heavy load costs more (encumbrance)", () => {
    const s = setup();
    expect(carryLimits(s.ch).maxWeight).toBeLessThan(180 * 2); // one anvil pushes past 75% of the limit
    s.ch.inventory.push({ vnum: HEAVY });
    const before = s.ch.move;
    dispatchCommand(s.ctx, exitDir);
    expect(before - s.ch.move).toBeGreaterThan(2); // encumbrance multiplied the cost
  });

  it("too exhausted to move blocks the step", () => {
    const s = setup();
    s.ch.move = 1; // less than the field cost of 2
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // stayed put
    expect(text(s.recv)).toContain("too exhausted");
  });
});
