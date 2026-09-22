/**
 * Containers (systems-spec §4.6): stow items in a carried bag/chest and take them back out, with
 * open/close and key-locked state. Contents persist as part of the character's inventory.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { ObjPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { Rng } from "./rng.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const obj = (over: Partial<ObjPrototype>): ObjPrototype => ({
  vnum: 0, area: "test", keywords: "", shortDesc: "", description: "", actionDesc: "",
  itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 1, cost: 1, affects: [], ...over,
});
const BAG = obj({ vnum: 970001, keywords: "bag sack", shortDesc: "a leather bag", itemType: "container", values: [50, 1, 970002, 0, 0] }); // closeable, key 970002
const KEY = obj({ vnum: 970002, keywords: "key brass", shortDesc: "a brass key", itemType: "key" });
const GEM = obj({ vnum: 970003, keywords: "gem ruby", shortDesc: "a ruby gem", itemType: "treasure" });

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  for (const o of [BAG, KEY, GEM]) world.objPrototypes.set(o.vnum, o);
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-000000cont01", accountId: "acc", name: "Packrat", raceId: 0, classId: 3, startRoom: ROOM });
  ch.inventory = [{ vnum: BAG.vnum }, { vnum: GEM.vnum }, { vnum: KEY.vnum }];
  const player: Player = { character: ch, send: (m) => recv.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, db: null, quit: () => {} };
  return { ch, recv, ctx };
}

const bag = (ch: ReturnType<typeof setup>["ch"]) => ch.inventory.find((it) => it.vnum === BAG.vnum)!;
const carrying = (ch: ReturnType<typeof setup>["ch"], vnum: number) => ch.inventory.some((it) => it.vnum === vnum);
const text = (msgs: ServerMessage[]) => msgs.flatMap((m) => (m.t === "output" ? m.lines.flat().map((s) => s.text) : [])).join("\n");

describe("put / get", () => {
  it("stows an item in a bag and takes it back out", () => {
    const s = setup();
    dispatchCommand(s.ctx, "put gem bag");
    expect(carrying(s.ch, GEM.vnum)).toBe(false);
    expect(bag(s.ch).contents?.map((it) => it.vnum)).toEqual([GEM.vnum]);

    dispatchCommand(s.ctx, "get gem bag");
    expect(carrying(s.ch, GEM.vnum)).toBe(true);
    expect(bag(s.ch).contents).toHaveLength(0);
  });

  it("look lists the bag's contents", () => {
    const s = setup();
    dispatchCommand(s.ctx, "put gem bag");
    s.recv.length = 0;
    dispatchCommand(s.ctx, "look bag");
    expect(text(s.recv)).toContain("ruby gem");
  });
});

describe("open / close", () => {
  it("a closed bag refuses put and get", () => {
    const s = setup();
    dispatchCommand(s.ctx, "close bag");
    expect(bag(s.ch).closed).toBe(true);
    dispatchCommand(s.ctx, "put gem bag");
    expect(carrying(s.ch, GEM.vnum)).toBe(true); // not stowed
    dispatchCommand(s.ctx, "open bag");
    expect(bag(s.ch).closed).toBe(false);
    dispatchCommand(s.ctx, "put gem bag");
    expect(carrying(s.ch, GEM.vnum)).toBe(false); // now stowed
  });
});

describe("lock / unlock", () => {
  it("needs the key, and a locked bag won't open", () => {
    const s = setup();
    dispatchCommand(s.ctx, "close bag");
    dispatchCommand(s.ctx, "lock bag");
    expect(bag(s.ch).locked).toBe(true);
    dispatchCommand(s.ctx, "open bag");
    expect(bag(s.ch).closed).toBe(true); // stayed shut — it's locked
    dispatchCommand(s.ctx, "unlock bag");
    expect(bag(s.ch).locked).toBe(false);
    dispatchCommand(s.ctx, "open bag");
    expect(bag(s.ch).closed).toBe(false);
  });

  it("can't lock without the key", () => {
    const s = setup();
    s.ch.inventory = s.ch.inventory.filter((it) => it.vnum !== KEY.vnum); // drop the key
    dispatchCommand(s.ctx, "close bag");
    dispatchCommand(s.ctx, "lock bag");
    expect(bag(s.ch).locked).toBeFalsy();
  });
});
