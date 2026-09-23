/**
 * Classes (content-depth pass): the 12 base classes are real, selectable choices with their own
 * progression and learnable skill trees; the 4 tier classes are held out of creation for the tier
 * system. Also asserts class + skill/spell help text was captured.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import type { ClassDef } from "../world/model.ts";
import { createCharacter, expToReach } from "./character.ts";

let world: World;
const ROOM = 10300;

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

const cls = (name: string): ClassDef => {
  const c = [...world.classes.values()].find((x) => x.name === name);
  if (!c) throw new Error(`no class ${name}`);
  return c;
};
const humanId = () => [...world.races.values()].find((r) => r.name === "Human")!.id;
const makeChar = (className: string) =>
  createCharacter(world, { id: "00000000-0000-0000-0000-0000000000c1", accountId: "acc", name: "Tester", raceId: humanId(), classId: cls(className).id, startRoom: ROOM });

const BASE = ["Mage", "Cleric", "Thief", "Warrior", "Thug", "Druid", "Ranger", "Monk", "Diabolist", "Conjurer", "Jester", "Shaman"];
const TIER = ["Champion", "Bishop", "Rogue", "Archmagi"];

describe("classes: roster + tier classification", () => {
  it("loads all 16 classes: 12 base + 4 tier", () => {
    expect(world.classes.size).toBe(16);
    const base = [...world.classes.values()].filter((c) => !c.tiered).map((c) => c.name).sort();
    const tier = [...world.classes.values()].filter((c) => c.tiered).map((c) => c.name).sort();
    expect(base.sort()).toEqual([...BASE].sort());
    expect(tier).toEqual([...TIER].sort());
  });

  it("maps base <-> tier both ways (spec §2.4)", () => {
    expect(cls("Champion").tierOf).toEqual(["Warrior", "Ranger", "Monk"]);
    expect(cls("Archmagi").tierOf).toEqual(["Mage", "Druid", "Conjurer"]);
    expect(cls("Warrior").advancesTo).toBe("Champion");
    expect(cls("Mage").advancesTo).toBe("Archmagi");
    expect(cls("Warrior").tiered).toBe(false);
    expect(cls("Champion").tiered).toBe(true);
  });
});

describe("classes: help text captured", () => {
  it("every class carries its help prose", () => {
    for (const c of world.classes.values()) expect(c.description.length).toBeGreaterThan(30);
  });

  it("skills/spells carry help prose where the source has it", () => {
    const withDesc = [...world.skills.values()].filter((s) => s.description.trim().length > 0);
    expect(withDesc.length).toBeGreaterThan(150); // 219 captured from help_skill/help_spell.lua
    expect((world.getSkill("bless")?.description ?? "").length).toBeGreaterThan(20); // a spell
    expect((world.getSkill("backstab")?.description ?? "").length).toBeGreaterThan(20); // a skill
  });
});

describe("classes: progression is per-class", () => {
  it("a warrior is beefier; a mage has a real mana pool", () => {
    const warrior = makeChar("Warrior");
    const mage = makeChar("Mage");
    expect(warrior.maxHp).toBeGreaterThan(mage.maxHp); // warrior HP gain > caster
    expect(mage.maxMana).toBeGreaterThan(warrior.maxMana); // caster has mana; warrior ~none
    expect(cls("Warrior").manaGain).toBe(0);
    expect(cls("Mage").manaGain).toBeGreaterThan(0);
  });

  it("exp curve uses the class's own exp base", () => {
    const wBase = cls("Warrior").expBasePerLevel;
    expect(expToReach(world, cls("Warrior").id, 10)).toBe(Math.floor(10 ** 3 * 0.95 * wBase));
    // base-class exp bases sit in the 45–60 band (spec §2.1); tier classes are far higher.
    expect(wBase).toBeGreaterThanOrEqual(40);
    expect(cls("Archmagi").expBasePerLevel).toBeGreaterThan(cls("Mage").expBasePerLevel);
  });

  it("classes carry a learnable skill tree (mages learn spells)", () => {
    expect(cls("Warrior").skills.length).toBeGreaterThan(0);
    const mageSpells = cls("Mage").skills.filter((s) => world.getSkill(s.skill)?.type === "Spell");
    expect(mageSpells.length).toBeGreaterThan(0);
  });
});
