import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager, stanceMult } from "./combat.ts";
import { PlayerFighter } from "./fighter.ts";
import { spawnMob } from "./mobInstance.ts";
import { Rng } from "./rng.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, supabase: {} };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

function makeMob(overrides: Partial<MobPrototype> = {}): MobPrototype {
  return {
    vnum: 999001,
    area: "test",
    keywords: "practice dummy",
    shortDesc: "a practice dummy",
    longDesc: "A practice dummy stands here.",
    description: "",
    level: 1,
    alignment: 500,
    actFlags: [],
    affectFlags: [],
    thac0: 0,
    ac: 0,
    hpDice: "1d4+4",
    damDice: "1d3+0",
    gold: 12,
    exp: 0,
    position: "standing",
    defaultPosition: "standing",
    sex: "neutral",
    resistant: [],
    immune: [],
    susceptible: [],
    specialAttacks: [],
    specialDefenses: [],
    ...overrides,
  };
}

function setup(mobProto: MobPrototype, seed = 12345) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(seed));
  const received: ServerMessage[] = [];
  const character = createCharacter(world, {
    id: "00000000-0000-0000-0000-000000000001",
    accountId: "acc",
    name: "Fighter",
    raceId: 0, // Human
    classId: 3, // Warrior
    startRoom: ROOM,
  });
  const player: Player = { character, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(character, world, (m) => received.push(m));
  const mob = spawnMob(mobProto, ROOM);
  live.addMob(mob);
  return { live, combat, character, player, fighter, mob, received };
}

describe("combat identity (Phase 3)", () => {
  it("stance dial multiplies as specified", () => {
    expect(stanceMult("berserk")).toBeCloseTo(1.3);
    expect(stanceMult("aggressive")).toBeCloseTo(1.2);
    expect(stanceMult("standing")).toBeCloseTo(1.0);
    expect(stanceMult("defensive")).toBeCloseTo(0.75);
    expect(stanceMult("evasive")).toBeCloseTo(0.6);
  });

  it("a warrior kills a weak mob and gains exp", () => {
    const s = setup(makeMob());
    s.combat.startFight(s.fighter, s.combat.fighterForMob(s.mob));
    let rounds = 0;
    while (s.mob.hp > 0 && rounds < 100) {
      s.combat.tick();
      rounds++;
    }
    expect(s.mob.hp).toBeLessThanOrEqual(0);
    expect(s.live.roomMobs(ROOM)).toHaveLength(0); // corpse removed
    expect(s.character.exp).toBeGreaterThan(0);
    expect(s.character.gold).toBe(12); // looted the mob's gold
    expect(s.fighter.fighting).toBeNull(); // fight ended
  });

  it("RIS: a mob immune to blunt takes no damage from barehand", () => {
    const s = setup(makeMob({ immune: ["blunt"], hpDice: "5d5+20" }));
    s.combat.startFight(s.fighter, s.combat.fighterForMob(s.mob));
    const hp0 = s.mob.hp;
    for (let i = 0; i < 10; i++) s.combat.tick();
    expect(s.mob.hp).toBe(hp0); // immune -> unhittable-for-damage
  });

  it("RIS: a mob resistant to blunt outlasts a normal one", () => {
    const normal = setup(makeMob({ hpDice: "1d1+30" }), 777);
    const resist = setup(makeMob({ hpDice: "1d1+30", resistant: ["blunt"] }), 777);
    normal.combat.startFight(normal.fighter, normal.combat.fighterForMob(normal.mob));
    resist.combat.startFight(resist.fighter, resist.combat.fighterForMob(resist.mob));
    for (let i = 0; i < 6; i++) {
      normal.combat.tick();
      resist.combat.tick();
    }
    // same seed, same attacker: the resistant mob has taken less total damage
    expect(resist.mob.hp).toBeGreaterThan(normal.mob.hp);
  });

  it("a mob fights back and can down a player, who respawns at the start room", () => {
    // a strong mob vs a level-1 player: player should die and respawn resting
    const s = setup(makeMob({ level: 30, hpDice: "10d10+200", damDice: "3d6+10", ac: -100 }));
    s.combat.startFight(s.fighter, s.combat.fighterForMob(s.mob));
    let rounds = 0;
    while (s.character.hp > 1 && rounds < 200) {
      s.combat.tick();
      rounds++;
    }
    expect(s.character.position).toBe("resting");
    expect(s.character.roomVnum).toBe(ROOM);
    expect(s.fighter.fighting).toBeNull();
  });
});
