/**
 * Mob spellcasting (systems-spec §2.7/§6): a mob whose class uses mana casts real spells from that
 * class's tree — hurling offensive spells, and (when it's a cleric) mending itself. Non-casters have
 * no spell list, so plain-mob combat is unaffected.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { PlayerFighter } from "./fighter.ts";
import { spawnMob } from "./mobInstance.ts";
import { buffAffect } from "./spellbook.ts";
import { Rng } from "./rng.ts";

let world: World;
let mageId: number, clericId: number, warriorId: number;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const caster = (over: Partial<MobPrototype>): MobPrototype => ({
  vnum: 999100, area: "test", keywords: "adept", shortDesc: "a dark adept", longDesc: "", description: "",
  level: 30, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: 100, hpDice: "1d1+0", damDice: "1d1+0",
  gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [], ...over,
});

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  const byName = (n: string) => [...world.classes.values()].find((c) => c.name === n)!.id;
  mageId = byName("Mage"); clericId = byName("Cleric"); warriorId = byName("Warrior");
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-00000000mcst", accountId: "acc", name: "Victim", raceId: 0, classId: 3, startRoom: ROOM });
  ch.level = 30; ch.maxHp = ch.hp = 400;
  const player: Player = { character: ch, send: (m) => recv.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  return { live, combat, ch, fighter, recv };
}

function put(s: ReturnType<typeof setup>, proto: MobPrototype, hp = 300) {
  const mob = spawnMob(proto, ROOM);
  mob.hp = mob.maxHp = hp;
  s.live.addMob(mob);
  return { mob, mf: s.combat.fighterForMob(mob) };
}

describe("who can cast", () => {
  it("caster classes have a spell list, warriors don't", () => {
    const s = setup();
    expect(s.combat.mobCastable(put(s, caster({ classId: mageId })).mf).length).toBeGreaterThan(0);
    expect(s.combat.mobCastable(put(s, caster({ classId: clericId })).mf).length).toBeGreaterThan(0);
    expect(s.combat.mobCastable(put(s, caster({ classId: warriorId })).mf).length).toBe(0);
    expect(s.combat.mobCastable(put(s, caster({ classId: undefined })).mf).length).toBe(0);
  });
});

describe("casting", () => {
  it("an offensive spell damages the target", () => {
    const s = setup();
    const { mob, mf } = put(s, caster({ classId: mageId }));
    mob.affects.push(buffAffect("bless", 30)); // already buffed, so it goes straight to offense
    const before = s.ch.hp;
    s.combat.mobCast(mf, s.fighter, s.combat.mobCastable(mf));
    expect(s.ch.hp).toBeLessThan(before);
  });

  it("a hurt cleric mends itself", () => {
    const s = setup();
    const { mob, mf } = put(s, caster({ classId: clericId }), 200);
    mob.maxHp = 200; mob.hp = 20; // badly hurt
    s.combat.mobCast(mf, s.fighter, s.combat.mobCastable(mf));
    expect(mob.hp).toBeGreaterThan(20);
  });
});
