/**
 * Movement cost (systems-spec §3.1): each step spends `move` by the room's sector cost, scaled by
 * encumbrance; out of `move` you're too exhausted to go.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const ROOM = 10300, HEAVY = 970900, BOAT = 970901;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

let world: World, exitDir: string, destVnum: number, sector0: string, destArea0: string, destFlags0: string[], destSector0: string;
beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  const e = world.getRoom(ROOM)!.exits.find((x) => world.getRoom(x.toVnum))!;
  exitDir = e.dir; destVnum = e.toVnum;
  sector0 = world.getRoom(ROOM)!.sector;
  destArea0 = world.getRoom(destVnum)!.area;
  destFlags0 = [...world.getRoom(destVnum)!.roomFlags];
  destSector0 = world.getRoom(destVnum)!.sector;
  const heavy: ObjPrototype = { vnum: HEAVY, area: "t", keywords: "anvil", shortDesc: "an anvil", description: "", actionDesc: "", itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 180, cost: 1, affects: [] };
  const boat: ObjPrototype = { vnum: BOAT, area: "t", keywords: "canoe", shortDesc: "a canoe", description: "", actionDesc: "", itemType: "boat", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 20, cost: 1, affects: [] };
  world.objPrototypes.set(HEAVY, heavy);
  world.objPrototypes.set(BOAT, boat);
});
beforeEach(() => {
  world.getRoom(ROOM)!.sector = "field"; // field = cost 2
  const d = world.getRoom(destVnum)!; d.area = destArea0; d.roomFlags = [...destFlags0]; d.sector = destSector0; // reset dest between tests
  world.getRoom(ROOM)!.exits.find((e) => e.dir === exitDir)!.flags = []; // reset the exit's flags
});
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

describe("entry blocks", () => {
  let n = 0;
  const bystander = (s: ReturnType<typeof setup>, vnum: number) => {
    const ch = createCharacter(world, { id: `00000000-0000-0000-0000-0000000byst${n++}`, accountId: "acc", name: `Bystander${n}`, raceId: 0, classId: 3, startRoom: vnum });
    s.live.enter({ character: ch, send: () => {} });
  };

  it("a solitary room admits only one", () => {
    const s = setup();
    world.getRoom(destVnum)!.roomFlags = ["solitary"];
    bystander(s, destVnum); // someone is already in there
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // couldn't enter the occupied solitary room
  });

  it("a private room admits two, not three", () => {
    const s = setup();
    world.getRoom(destVnum)!.roomFlags = ["private"];
    bystander(s, destVnum); bystander(s, destVnum); // already two inside
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // the third is turned away
  });

  it("a cross-area level gate bars the unready", () => {
    const s = setup();
    world.getRoom(destVnum)!.area = "GATED.are"; // pretend the next room is a different, high-level area
    world.areas.set("GATED.are", { file: "GATED.are", name: "Gated", author: "", version: 1, levelRange: { softLow: 40, softHigh: 50, hardLow: 40, hardHigh: 50 } });
    expect(s.ch.level).toBeLessThan(40);
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // too low-level to enter that area
  });
});

describe("flight and deep water", () => {
  const flyAffect = () => ({ name: "fly", kind: "buff" as const, mods: {}, expiresAt: Date.now() + 60000, wearOff: "" });

  it("air can't be entered without flying", () => {
    const s = setup();
    world.getRoom(destVnum)!.sector = "air";
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // grounded

    s.ch.affects.push(flyAffect());
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(destVnum); // now airborne
  });

  it("deep water needs floating or a boat", () => {
    const s = setup();
    world.getRoom(destVnum)!.sector = "water_noswim";
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // would sink

    s.ch.inventory.push({ vnum: BOAT });
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(destVnum); // rowed across
  });
});

describe("climb exits", () => {
  const makeClimb = () => { world.getRoom(ROOM)!.exits.find((e) => e.dir === exitDir)!.flags = ["climb"]; };
  afterEach(() => vi.restoreAllMocks());

  it("a skilled climber makes it across", () => {
    const s = setup();
    makeClimb();
    s.ch.proficiencies["climb"] = 100; // trained
    vi.spyOn(Math, "random").mockReturnValue(0); // roll 0 always clears any positive climb%
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(destVnum);
  });

  it("an unskilled climber slips, takes damage, and stays put", () => {
    const s = setup();
    makeClimb();
    s.ch.proficiencies["climb"] = 0; // always slips
    const hp0 = s.ch.hp;
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM); // didn't make it
    expect(s.ch.hp).toBeLessThan(hp0); // took a fall
    expect(s.ch.hp).toBeGreaterThan(0); // but a fall doesn't kill outright
  });

  it("too exhausted to climb is blocked without a fall (exhaustion gate first)", () => {
    const s = setup();
    makeClimb();
    s.ch.proficiencies["climb"] = 0; // would slip if it tried
    s.ch.move = 0; // but has no move to attempt it
    const hp0 = s.ch.hp;
    dispatchCommand(s.ctx, exitDir);
    expect(s.ch.roomVnum).toBe(ROOM);
    expect(s.ch.hp).toBe(hp0); // no fall damage — you can't be whittled down by re-trying
    expect(text(s.recv)).toContain("too exhausted");
  });
});
