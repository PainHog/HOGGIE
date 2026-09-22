/**
 * Gate magic (systems-spec §3.3): the gate/portal spell steps you to another player; summon pulls a
 * player to you. Both are utility spells cast through the normal casting path (mana + learned%).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
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
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
let clericId: number, elsewhere: number;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  clericId = [...world.classes.values()].find((c) => c.name === "Cleric")!.id;
  // Make gate/summon reliably castable in-test: grant them to Cleric and drop their difficulty to 0.
  const cls = world.classes.get(clericId)!;
  for (const name of ["gate", "summon"]) {
    if (!cls.skills.some((g) => g.skill === name)) cls.skills.push({ skill: name, level: 1, adept: 100 });
    const def = world.getSkill(name);
    if (def) def.difficulty = 0;
  }
  elsewhere = world.getRoom(ROOM)!.exits.find((e) => world.getRoom(e.toVnum))!.toVnum;
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const mk = (name: string, id: string, classId: number) => {
    const recv: ServerMessage[] = [];
    const ch = createCharacter(world, { id, accountId: "acc", name, raceId: 0, classId, startRoom: ROOM });
    ch.level = 50; ch.maxMana = ch.mana = 500;
    ch.proficiencies["gate"] = 100; ch.proficiencies["summon"] = 100;
    const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
    const player: Player = { character: ch, fighter, send: (m) => recv.push(m) };
    live.enter(player);
    const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
    const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
    return { ch, player, fighter, recv, ctx };
  };
  return { live, a: mk("Alpha", "00000000-0000-0000-0000-00000gatea1", clericId), b: mk("Bravo", "00000000-0000-0000-0000-00000gateb2", 3) };
}

/** Move a live player to another room by id. */
function relocate(s: ReturnType<typeof setup>, who: "a" | "b", vnum: number) {
  const p = s.live.roomPlayers(s[who].ch.roomVnum).find((x) => x.character.id === s[who].ch.id)!;
  s.live.moveTo(p, vnum);
}

describe("gate", () => {
  it("steps the caster to the target player's room", () => {
    const s = setup();
    relocate(s, "b", elsewhere); // Bravo is elsewhere
    expect(s.a.ch.roomVnum).toBe(ROOM);
    dispatchCommand(s.a.ctx, "cast gate Bravo");
    expect(s.a.ch.roomVnum).toBe(elsewhere); // Alpha gated to Bravo
    expect(s.a.ch.mana).toBeLessThan(500); // mana was spent
  });
});

describe("summon", () => {
  // The start room is a safe/nosummon sanctuary; clear both rooms so a summons is allowed.
  const openRooms = () => { world.getRoom(ROOM)!.roomFlags = []; world.getRoom(elsewhere)!.roomFlags = []; };

  it("pulls the target player to the caster's room", () => {
    const s = setup();
    openRooms();
    relocate(s, "b", elsewhere);
    dispatchCommand(s.a.ctx, "cast summon Bravo");
    expect(s.b.ch.roomVnum).toBe(ROOM); // Bravo summoned to Alpha
  });

  it("won't summon a player who is fighting", () => {
    const s = setup();
    openRooms();
    relocate(s, "b", elsewhere);
    s.b.fighter.fighting = s.a.fighter; // Bravo is locked in a fight
    dispatchCommand(s.a.ctx, "cast summon Bravo");
    expect(s.b.ch.roomVnum).toBe(elsewhere); // stayed put
  });
});
