/**
 * Dual-class (content-depth pass): a second class chosen at creation, with prereqs enforced,
 * that blends combat (thac0), grants an extra practice per level, and unions both skill trees.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.ts";
import type { MobPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter, dualClassName, expToReach, resolveDualClass, statMod } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { PlayerFighter } from "./fighter.ts";
import { spawnMob } from "./mobInstance.ts";
import { Rng } from "./rng.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

const race = (name: string) => [...world.races.values()].find((r) => r.name === name)!;
const cls = (name: string) => [...world.classes.values()].find((c) => c.name === name)!;
const make = (className: string, secondName?: string) =>
  createCharacter(world, {
    id: randomUUID(), accountId: "acc", name: "Tester", raceId: race("Human").id,
    classId: cls(className).id, secondClassId: secondName ? cls(secondName).id : undefined, startRoom: ROOM,
  });

describe("dual-class: creation + prereqs", () => {
  it("a valid second class becomes the dual class", () => {
    const dual = make("Warrior", "Mage");
    expect(dual.dualClassId).toBe(cls("Mage").id);
    expect(dualClassName(world, dual)).toBe("Mage");
    const single = make("Warrior");
    expect(single.dualClassId).toBeUndefined();
    expect(dualClassName(world, single)).toBeUndefined();
  });

  it("enforces the prereqs (same / tiered / race-forbidden are rejected)", () => {
    const H = race("Human");
    expect(resolveDualClass(world, H, cls("Warrior").id, cls("Warrior").id)).toBeUndefined(); // same as primary
    expect(resolveDualClass(world, H, cls("Warrior").id, cls("Champion").id)).toBeUndefined(); // tier class
    expect(resolveDualClass(world, race("Elf"), cls("Warrior").id, cls("Diabolist").id)).toBeUndefined(); // Elf forbids Diabolist
    expect(resolveDualClass(world, H, cls("Warrior").id, cls("Mage").id)).toBe(cls("Mage").id); // valid
  });
});

describe("dual-class: combat blend", () => {
  it("thac0 blends the two classes (higher + 0.7x lower); single is unchanged", () => {
    const single = new PlayerFighter(make("Warrior"), world, () => {});
    expect(single.thac0Mod).toBe(cls("Warrior").thac0Mod);

    const dual = new PlayerFighter(make("Warrior", "Mage"), world, () => {});
    const w = cls("Warrior").thac0Mod, m = cls("Mage").thac0Mod;
    expect(dual.thac0Mod).toBe(Math.floor(Math.max(w, m) + 0.7 * Math.min(w, m)));
    // the blend adds 0.7x the weaker base on top of the stronger, so a dual out-hits either alone
    expect(dual.thac0Mod).toBeGreaterThanOrEqual(Math.max(w, m));
  });
});

describe("dual-class: level-up grants an extra practice", () => {
  function makeMob(): MobPrototype {
    return {
      vnum: 999002, area: "test", keywords: "training dummy", shortDesc: "a training dummy",
      longDesc: "", description: "", level: 1, alignment: 0, actFlags: [], affectFlags: [], thac0: 0,
      ac: 0, hpDice: "1d1", damDice: "1d1", gold: 0, exp: 0, position: "standing",
      defaultPosition: "standing", sex: "neutral", resistant: [], immune: [], susceptible: [],
      specialAttacks: [], specialDefenses: [],
    };
  }
  // Level a character exactly once by killing a trivial mob, and return practices gained.
  function practicesGainedOnLevel(className: string, secondName?: string): number {
    const live = new LiveWorld(world);
    const combat = new CombatManager(world, live, CONFIG, new Rng(99));
    const ch = make(className, secondName);
    ch.exp = expToReach(world, ch.classId, 2) - 1; // one kill crosses exactly one level (2)
    const before = ch.practices;
    const player: Player = { character: ch, send: () => {} };
    live.enter(player);
    const fighter = new PlayerFighter(ch, world, () => {});
    const mob = spawnMob(makeMob(), ROOM);
    live.addMob(mob);
    combat.startFight(fighter, combat.fighterForMob(mob));
    for (let i = 0; i < 20 && mob.hp > 0; i++) combat.tick();
    expect(ch.level).toBeGreaterThanOrEqual(2); // it leveled
    return ch.practices - before;
  }

  it("a dual character gains one more practice per level than a single (Human wis)", () => {
    // base gain = max(1, wisMod+1); dual adds +1. Human wis 13 -> wisMod 0 -> single +1, dual +2.
    const single = practicesGainedOnLevel("Warrior");
    const dual = practicesGainedOnLevel("Warrior", "Mage");
    expect(single).toBe(Math.max(1, statMod(13) + 1)); // +1
    expect(dual).toBe(single + 1); // +2
  });
});
