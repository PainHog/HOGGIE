/**
 * Immortal toolset (systems-spec §7): staff commands to move players, spawn mobs/objects, wipe a
 * room, and heal — each gated on a role capability. A plain player holds none of these.
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

const ROOM = 10300;
const MOB = 999700, OBJ = 999701;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const testMob: MobPrototype = {
  vnum: MOB, area: "test", keywords: "gremlin", shortDesc: "a gremlin", longDesc: "", description: "",
  level: 5, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1+9", damDice: "1d1+0",
  gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
};
const testObj: ObjPrototype = {
  vnum: OBJ, area: "test", keywords: "trinket", shortDesc: "a shiny trinket", description: "", actionDesc: "",
  itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 1, cost: 1, affects: [],
};

let world: World;
let elsewhere: number;
beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.mobPrototypes.set(testMob.vnum, testMob);
  world.objPrototypes.set(testObj.vnum, testObj);
  elsewhere = world.getRoom(ROOM)!.exits.find((e) => world.getRoom(e.toVnum))!.toVnum;
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const mk = (name: string, id: string, roles: string[]) => {
    const recv: ServerMessage[] = [];
    const ch = createCharacter(world, { id, accountId: "acc", name, raceId: 0, classId: 3, startRoom: ROOM });
    const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
    const player: Player = { character: ch, fighter, send: (m) => recv.push(m) };
    live.enter(player);
    const account: StaffAccount = { id, email: null, roles, builderLowVnum: null, builderHighVnum: null };
    const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
    return { ch, player, fighter, recv, ctx };
  };
  return {
    live, combat,
    imm: mk("Odin", "00000000-0000-0000-0000-00000000imm1", ["player", "admin"]),
    pc: mk("Mortal", "00000000-0000-0000-0000-000000000pc2", ["player"]),
  };
}

/** Move a live player to another room by id. */
function relocate(s: ReturnType<typeof setup>, who: "imm" | "pc", vnum: number) {
  const p = s.live.roomPlayers(s[who].ch.roomVnum).find((x) => x.character.id === s[who].ch.id)!;
  s.live.moveTo(p, vnum);
}

describe("transfer", () => {
  it("pulls an online player to the immortal's room", () => {
    const s = setup();
    relocate(s, "pc", elsewhere);
    expect(s.pc.ch.roomVnum).toBe(elsewhere);
    dispatchCommand(s.imm.ctx, "transfer Mortal");
    expect(s.pc.ch.roomVnum).toBe(ROOM); // yanked to Odin's room
  });
});

describe("load", () => {
  it("spawns a mob into the room", () => {
    const s = setup();
    dispatchCommand(s.imm.ctx, `load mob ${MOB}`);
    expect(s.live.roomMobs(ROOM).some((m) => m.proto.vnum === MOB)).toBe(true);
  });
  it("spawns an object onto the floor", () => {
    const s = setup();
    dispatchCommand(s.imm.ctx, `load obj ${OBJ}`);
    expect(s.live.roomGround(ROOM).some((g) => g.item.vnum === OBJ)).toBe(true);
  });
});

describe("purge", () => {
  it("clears mobs, items, and corpses from the room", () => {
    const s = setup();
    s.live.addMob(spawnMob(testMob, ROOM));
    dispatchCommand(s.imm.ctx, `load obj ${OBJ}`);
    expect(s.live.roomMobs(ROOM).length).toBeGreaterThan(0);
    dispatchCommand(s.imm.ctx, "purge");
    expect(s.live.roomMobs(ROOM)).toHaveLength(0);
    expect(s.live.roomGround(ROOM)).toHaveLength(0);
  });
});

describe("restore", () => {
  it("fully heals a named player", () => {
    const s = setup();
    s.pc.ch.hp = 1; s.pc.ch.mana = 0; s.pc.ch.move = 0;
    dispatchCommand(s.imm.ctx, "restore Mortal");
    expect(s.pc.ch.hp).toBe(s.pc.ch.maxHp);
    expect(s.pc.ch.mana).toBe(s.pc.ch.maxMana);
    expect(s.pc.ch.move).toBe(s.pc.ch.maxMove);
  });
});

describe("capability gate", () => {
  it("a plain player can't purge", () => {
    const s = setup();
    s.live.addMob(spawnMob(testMob, ROOM));
    dispatchCommand(s.pc.ctx, "purge");
    expect(s.live.roomMobs(ROOM).length).toBeGreaterThan(0); // nothing happened
  });
});
