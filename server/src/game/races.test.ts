/**
 * Races (content-depth pass): every spec race is loaded with its real traits, and those traits
 * actually apply — stat mods + racial mana at creation, allowed/restricted classes, decoded RIS
 * in combat, and the exp multiplier. Also asserts the description/help text was captured.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import type { RaceDef, Stats } from "../world/model.ts";
import { LiveWorld } from "./liveWorld.ts";
import { createCharacter, raceAllowsClass } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { PlayerFighter } from "./fighter.ts";
import { Rng } from "./rng.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

const race = (name: string): RaceDef => {
  const r = [...world.races.values()].find((x) => x.name === name);
  if (!r) throw new Error(`no race ${name}`);
  return r;
};
const warriorId = () => [...world.classes.values()].find((c) => c.name === "Warrior")!.id;

function makeChar(raceName: string, id = "00000000-0000-0000-0000-000000000009") {
  return createCharacter(world, {
    id, accountId: "acc", name: "Tester", raceId: race(raceName).id, classId: warriorId(), startRoom: ROOM,
  });
}

describe("races: full roster + traits", () => {
  it("loads the full spec roster (24) with structured traits", () => {
    expect(world.races.size).toBe(24);
    for (const r of world.races.values()) {
      expect(typeof r.name).toBe("string");
      expect(Array.isArray(r.resistant)).toBe(true);
      expect(Array.isArray(r.susceptible)).toBe(true);
      expect(Array.isArray(r.allowedClasses)).toBe(true);
      expect(typeof r.description).toBe("string");
    }
  });

  it("decodes RIS bitvectors to the same damage classes the engine uses", () => {
    // Half-Troll: resists physical, weak to fire+acid (the classic troll weakness).
    expect(race("Half-Troll").resistant).toEqual(expect.arrayContaining(["blunt", "pierce", "slash"]));
    expect(race("Half-Troll").susceptible).toEqual(expect.arrayContaining(["fire", "acid"]));
    expect(race("Ghoul").resistant).toEqual(expect.arrayContaining(["fire", "cold"]));
    expect(race("Drow").resistant).toContain("poison"); // matches Drow help text
    expect(race("Human").resistant).toEqual([]);
  });

  it("captured the MUD's own help text for every race that has one (23/24; only Deep-Gnome absent at source)", () => {
    const withDesc = [...world.races.values()].filter((r) => r.description.trim().length > 0);
    expect(withDesc.length).toBe(23);
    expect(race("Ghoul").description.length).toBeGreaterThan(50);
    expect(race("Shuri").description.length).toBeGreaterThan(50); // came from help2.are
    expect(race("Deep-Gnome").description).toBe(""); // no help entry anywhere in the source
  });
});

describe("races: creation applies traits", () => {
  it("applies racial stat modifiers", () => {
    const elf = makeChar("Elf");
    expect(elf.stats.dex).toBe(13 + (race("Elf").statPlus.dex ?? 0)); // Elf dex +2 -> 15
    expect(elf.stats.str).toBe(13 + (race("Elf").statPlus.str ?? 0)); // Elf str -1 -> 12
  });

  it("folds the racial mana bonus into the starting pool", () => {
    const ghoul = makeChar("Ghoul"); // Ghoul mana +50
    const human = makeChar("Human"); // Human mana +0
    expect(ghoul.maxMana - human.maxMana).toBe((race("Ghoul").manaPlus ?? 0) - (race("Human").manaPlus ?? 0));
    expect(ghoul.maxMana).toBeGreaterThan(human.maxMana);
  });

  it("clamps starting alignment to the race's band", () => {
    for (const name of ["Human", "Ghoul", "Drow", "Deep-Gnome"]) {
      const ch = makeChar(name);
      expect(ch.alignment).toBeGreaterThanOrEqual(race(name).minAlign);
      expect(ch.alignment).toBeLessThanOrEqual(race(name).maxAlign);
    }
  });

  it("enforces allowed / restricted classes", () => {
    expect(raceAllowsClass(race("Elf"), "Warrior")).toBe(true);
    expect(raceAllowsClass(race("Elf"), "Diabolist")).toBe(false); // Elf restricts Diabolist
    expect(raceAllowsClass(race("Elf"), "Shaman")).toBe(false);
    expect(raceAllowsClass(race("Human"), "Warrior")).toBe(true);
  });

  it("carries the race exp multiplier (Ghoul 80%)", () => {
    expect(race("Ghoul").expMultPct).toBe(80);
    expect(race("Human").expMultPct).toBe(100);
  });
});

describe("races: RIS is live in combat", () => {
  // Fixed baseline stats so only race RIS differs between victims (identical to-hit + damage rolls).
  const FLAT: Stats = { str: 13, int: 13, wis: 13, dex: 13, con: 13, cha: 13, lck: 13 };

  function totalBluntTaken(victimRace: string, seed = 4242): number {
    const live = new LiveWorld(world);
    const attacker = new PlayerFighter(makeChar("Human", "00000000-0000-0000-0000-0000000000a1"), world, () => {});
    const vch = makeChar(victimRace, "00000000-0000-0000-0000-0000000000b2");
    vch.stats = { ...FLAT };
    vch.maxHp = 1_000_000;
    vch.hp = 1_000_000;
    const victim = new PlayerFighter(vch, world, () => {});
    const combat = new CombatManager(world, live, CONFIG, new Rng(seed));
    for (let i = 0; i < 80; i++) combat.oneHit(attacker, victim);
    return 1_000_000 - vch.hp;
  }

  it("a race resistant to blunt takes less; one susceptible takes more (barehand = blunt)", () => {
    const human = totalBluntTaken("Human"); // neutral
    const troll = totalBluntTaken("Half-Troll"); // resists blunt -> halved
    const pixie = totalBluntTaken("Pixie"); // susceptible to blunt -> amplified
    expect(human).toBeGreaterThan(0);
    expect(troll).toBeLessThan(human);
    expect(pixie).toBeGreaterThan(human);
  });
});
