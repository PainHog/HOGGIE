/**
 * OLC (systems-spec §7): staff edit room/mob/object prototype fields; edits mutate the world and are
 * written through to world_overrides so they survive a restart (applyOverride replays them at boot).
 * Edits are vnum-range gated for builders.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { Rng } from "./rng.ts";
import { ClanStore } from "./clanStore.ts";
import { applyOverride, createProto } from "./olc.ts";
import type { Db } from "../db/repos.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

const ROOM = 10300, MOB = 999800, OBJ = 999801;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const baseMob = (): MobPrototype => ({
  vnum: MOB, area: "test", keywords: "wretch", shortDesc: "a wretch", longDesc: "", description: "",
  level: 5, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1+9", damDice: "1d1+0",
  gold: 10, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
});
const baseObj = (): ObjPrototype => ({
  vnum: OBJ, area: "test", keywords: "bauble", shortDesc: "a bauble", description: "", actionDesc: "",
  itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 2, cost: 5, affects: [],
});

let world: World;
let roomName0: string, roomSector0: string;
beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  roomName0 = world.getRoom(ROOM)!.name;
  roomSector0 = world.getRoom(ROOM)!.sector;
});
beforeEach(() => {
  // Reset the fields these tests mutate so shared-world edits don't bleed across cases.
  world.mobPrototypes.set(MOB, baseMob());
  world.objPrototypes.set(OBJ, baseObj());
  const r = world.getRoom(ROOM)!;
  r.name = roomName0; r.sector = roomSector0;
});

function setup(roles: string[], low: number | null = null, high: number | null = null) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const saved: string[] = [];
  const created: string[] = [];
  const fakeDb = {
    saveOverride: async (k: string, v: number, f: string, val: string) => { saved.push(`${k}:${v}:${f}=${val}`); },
    saveCreated: async (k: string, v: number, kw: string) => { created.push(`${k}:${v}:${kw}`); },
  } as unknown as Db;
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-0000000olc01", accountId: "acc", name: "Builder", raceId: 0, classId: 3, startRoom: ROOM });
  const player: Player = { character: ch, send: (m) => recv.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles, builderLowVnum: low, builderHighVnum: high };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: fakeDb, quit: () => {} };
  return { live, ch, recv, ctx, saved, created };
}

describe("applyOverride", () => {
  it("edits room, mob, and object fields; parses numbers", () => {
    expect(applyOverride(world, "room", ROOM, "name", "The Void")).toBeNull();
    expect(world.getRoom(ROOM)!.name).toBe("The Void");
    expect(applyOverride(world, "mob", MOB, "level", "42")).toBeNull();
    expect(world.getMobPrototype(MOB)!.level).toBe(42);
    expect(applyOverride(world, "obj", OBJ, "cost", "999")).toBeNull();
    expect(world.getObjPrototype(OBJ)!.cost).toBe(999);
  });

  it("rejects unknown fields, bad numbers, and missing vnums", () => {
    expect(applyOverride(world, "mob", MOB, "wingspan", "3")).toMatch(/Unknown mob field/);
    expect(applyOverride(world, "mob", MOB, "level", "abc")).toMatch(/isn't a number/);
    expect(applyOverride(world, "obj", 123456, "cost", "5")).toMatch(/No object 123456/);
  });

  it("replaying overrides at boot reproduces the edits", () => {
    // This is exactly what the server does on startup for each world_overrides row.
    for (const [k, v, f, val] of [["room", ROOM, "sector", "inside"], ["mob", MOB, "gold", "500"]] as const) {
      expect(applyOverride(world, k, v, f, String(val))).toBeNull();
    }
    expect(world.getRoom(ROOM)!.sector).toBe("inside");
    expect(world.getMobPrototype(MOB)!.gold).toBe(500);
  });
});

describe("edit commands", () => {
  it("an admin edits and the change persists (write-through)", () => {
    const s = setup(["player", "admin"]);
    dispatchCommand(s.ctx, "medit " + MOB + " level 30");
    expect(world.getMobPrototype(MOB)!.level).toBe(30);
    expect(s.saved).toContain(`mob:${MOB}:level=30`);

    dispatchCommand(s.ctx, "oedit " + OBJ + " cost 250");
    expect(world.getObjPrototype(OBJ)!.cost).toBe(250);

    dispatchCommand(s.ctx, "redit name Sanctum");
    expect(world.getRoom(ROOM)!.name).toBe("Sanctum");
    expect(s.saved).toContain(`room:${ROOM}:name=Sanctum`);
  });

  it("a builder is confined to their vnum range", () => {
    const s = setup(["player", "builder"], 10000, 20000); // covers the room, not the 999xxx test vnums
    dispatchCommand(s.ctx, "redit name Workshop"); // room 10300 — in range
    expect(world.getRoom(ROOM)!.name).toBe("Workshop");

    dispatchCommand(s.ctx, "medit " + MOB + " level 30"); // mob 999800 — out of range
    expect(world.getMobPrototype(MOB)!.level).toBe(5); // unchanged
  });
});

describe("create commands", () => {
  it("mcreate makes an editable mob prototype and persists it", () => {
    const s = setup(["player", "admin"]);
    dispatchCommand(s.ctx, "mcreate 995000 goblin scout");
    expect(world.getMobPrototype(995000)?.keywords).toBe("goblin scout");
    expect(s.created).toContain("mob:995000:goblin scout");
    dispatchCommand(s.ctx, "medit 995000 level 12"); // the new proto is immediately editable
    expect(world.getMobPrototype(995000)?.level).toBe(12);
  });

  it("ocreate makes an editable object prototype", () => {
    const s = setup(["player", "admin"]);
    dispatchCommand(s.ctx, "ocreate 995001 rusty dagger");
    expect(world.getObjPrototype(995001)?.shortDesc).toBe("rusty dagger");
    dispatchCommand(s.ctx, "oedit 995001 cost 40");
    expect(world.getObjPrototype(995001)?.cost).toBe(40);
  });

  it("refuses to create over an existing vnum", () => {
    const s = setup(["player", "admin"]);
    dispatchCommand(s.ctx, `mcreate ${MOB} imposter`); // MOB already exists
    expect(world.getMobPrototype(MOB)?.keywords).toBe("wretch"); // untouched
  });

  it("a builder can't create outside their range", () => {
    const s = setup(["player", "builder"], 10000, 20000);
    dispatchCommand(s.ctx, "mcreate 995002 orc");
    expect(world.getMobPrototype(995002)).toBeUndefined();
  });

  it("createProto registers a default prototype (the boot-replay path)", () => {
    expect(createProto(world, "mob", 995003, "kobold", "custom")).toBeNull();
    expect(world.getMobPrototype(995003)?.keywords).toBe("kobold");
    expect(createProto(world, "mob", 995003, "again", "custom")).toMatch(/already exists/);
  });
});
