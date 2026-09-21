/**
 * Mob offense + defense (systems-spec §1.5/§1.6): sanctuary halves incoming damage, damage shields
 * sear attackers, and mobs unleash special attacks (harm/drain/bash/curse). All gated on mob data,
 * so plain mobs are unaffected.
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
import { Rng } from "./rng.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const brute = (over: Partial<MobPrototype>): MobPrototype => ({
  vnum: 997000, area: "test", keywords: "brute", shortDesc: "a brute", longDesc: "", description: "",
  level: 20, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: 100, hpDice: "1d1+0", damDice: "3d4+0",
  gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [], ...over,
});

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

function player(seed = 1) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(seed));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-00000000mcmb", accountId: "acc", name: "Hero", raceId: 0, classId: 3, startRoom: ROOM,
  });
  ch.level = 15; ch.maxHp = ch.hp = 500;
  const p: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(p);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  return { live, combat, ch, fighter, received };
}

/** Put a mob in the room and return its fighter. */
function mobFighter(s: ReturnType<typeof player>, proto: MobPrototype, hp = 9999) {
  const mob = spawnMob(proto, ROOM);
  mob.hp = mob.maxHp = hp;
  s.live.addMob(mob);
  return { mob, mf: s.combat.fighterForMob(mob) };
}

describe("sanctuary", () => {
  it("halves the damage a mob takes from identical blows", () => {
    const measure = (flags: string[]) => {
      const s = player(1);
      const { mob } = mobFighter(s, brute({ affectFlags: flags }));
      const mf = s.combat.fighterForMob(mob);
      for (let i = 0; i < 20; i++) s.combat.oneHit(s.fighter, mf);
      return mob.maxHp - mob.hp;
    };
    const plain = measure([]);
    const holy = measure(["sanctuary"]);
    expect(holy).toBeLessThan(plain);
    expect(holy).toBeGreaterThan(0);
  });
});

describe("damage shields", () => {
  it("sear the attacker when a shielded mob is struck", () => {
    const s = player(1);
    const { mf } = mobFighter(s, brute({ affectFlags: ["fireshield"] }));
    const before = s.ch.hp;
    for (let i = 0; i < 20; i++) s.combat.oneHit(s.fighter, mf);
    expect(s.ch.hp).toBeLessThan(before); // took shield retaliation
  });

  it("a plain mob does not retaliate", () => {
    const s = player(1);
    const { mf } = mobFighter(s, brute({}));
    const before = s.ch.hp;
    for (let i = 0; i < 20; i++) s.combat.oneHit(s.fighter, mf);
    expect(s.ch.hp).toBe(before);
  });
});

describe("special attacks", () => {
  it("harm burns the target", () => {
    const s = player(1);
    const { mf } = mobFighter(s, brute({ specialAttacks: ["harm"] }));
    const before = s.ch.hp;
    s.combat.mobSpecial(mf, s.fighter, "harm");
    expect(s.ch.hp).toBeLessThan(before);
  });

  it("drain damages the victim and heals the mob", () => {
    const s = player(1);
    const { mob, mf } = mobFighter(s, brute({ specialAttacks: ["drain"] }), 50);
    mob.maxHp = 500; // room to heal
    const hpBefore = s.ch.hp, mobBefore = mob.hp;
    s.combat.mobSpecial(mf, s.fighter, "drain");
    expect(s.ch.hp).toBeLessThan(hpBefore);
    expect(mob.hp).toBeGreaterThan(mobBefore);
  });

  it("bash knocks a player down", () => {
    const s = player(1);
    const { mf } = mobFighter(s, brute({ specialAttacks: ["bash"] }));
    expect(s.ch.position).toBe("standing");
    s.combat.mobSpecial(mf, s.fighter, "bash");
    expect(s.ch.position).toBe("resting"); // knocked to the ground
  });

  it("curse afflicts a player with a debuff", () => {
    const s = player(1);
    const { mf } = mobFighter(s, brute({ specialAttacks: ["curse"] }));
    s.combat.mobSpecial(mf, s.fighter, "curse");
    expect(s.ch.affects.some((a) => a.name === "curse")).toBe(true);
  });
});
