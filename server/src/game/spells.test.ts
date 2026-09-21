/**
 * Spellcasting (systems-spec §2.7): classified spells become castable — mana cost, the failure
 * roll, saving throws, and the four effect kinds (damage / heal / buff / debuff) folded into the
 * existing combat math. Deterministic via a seeded combat RNG.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype, SkillDef } from "../world/model.ts";
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
import { dispatchCommand, type CommandContext } from "./commands.ts";
import { buffAffect, debuffAffect } from "./spellbook.ts";
import { expireAffects, sumMods } from "./affects.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = {
  port: 0, contentDir: "", worldAreas: ["drazuni.are", "drazpost.are"], startRoom: ROOM, adminEmails: [], supabase: {},
};
let mageId: number;

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are", "drazpost.are"]);
  mageId = [...world.classes.values()].find((c) => c.name === "Mage")!.id;
});

function makeMob(overrides: Partial<MobPrototype> = {}): MobPrototype {
  return {
    vnum: 990500, area: "test", keywords: "training dummy", shortDesc: "a training dummy",
    longDesc: "A dummy stands here.", description: "", level: 1, alignment: 0,
    actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1", damDice: "1d1",
    gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
    resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
    ...overrides,
  };
}

function setup(seed = 5, mobProto = makeMob()) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(seed));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-0000000000aa", accountId: "acc", name: "Wizard", raceId: 0, classId: mageId, startRoom: ROOM,
  });
  ch.level = 30;
  ch.maxMana = ch.mana = 500;
  ch.maxHp = 400; ch.hp = 400;
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const mob = spawnMob(mobProto, ROOM);
  live.addMob(mob);
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, db: null, quit: () => {} };
  return { live, combat, ch, fighter, mob, received, ctx };
}

const text = (r: ServerMessage[]): string =>
  r.filter((m): m is Extract<ServerMessage, { t: "output" }> => m.t === "output")
    .flatMap((m) => m.lines.map((l) => l.map((s) => s.text).join(""))).join("\n");

/** A castable damage spell the Mage knows at level 30 (discovered from the class tree). */
function knownDamageSpell(): { name: string; def: SkillDef } {
  const cls = world.classes.get(mageId)!;
  for (const g of cls.skills) {
    const def = world.getSkill(g.skill);
    if (def?.type === "Spell" && def.category === "damage" && g.level <= 30) return { name: g.skill, def };
  }
  throw new Error("no damage spell found for Mage");
}

describe("spell classification (content/spells.json)", () => {
  it("merges category/damageType/mana onto the skill defs", () => {
    expect(world.getSkill("magic missile")?.category).toBe("damage");
    expect(world.getSkill("bless")?.category).toBe("buff");
    expect(world.getSkill("cure light")?.category).toBe("heal");
    const blind = world.getSkill("blindness");
    if (blind) expect(blind.category).toBe("debuff");
    expect((world.getSkill("magic missile")?.mana ?? 0)).toBeGreaterThan(0);
  });
});

describe("cast command", () => {
  it("with no argument lists the spells you know", () => {
    const s = setup();
    dispatchCommand(s.ctx, "cast");
    expect(text(s.received).toLowerCase()).toContain("cast what");
  });

  it("blocks a cast you can't pay for", () => {
    const s = setup();
    const { name } = knownDamageSpell();
    s.ch.mana = 0;
    dispatchCommand(s.ctx, `cast ${name}`);
    expect(text(s.received).toLowerCase()).toContain("enough mana");
    expect(s.ch.mana).toBe(0);
  });

  it("refuses an unknown spell", () => {
    const s = setup();
    dispatchCommand(s.ctx, "cast supercalifragilistic");
    expect(text(s.received).toLowerCase()).toContain("don't know");
  });

  it("a successful damage cast spends mana and hurts the foe", () => {
    const s = setup();
    const { name, def } = knownDamageSpell();
    s.ch.proficiencies[name.toLowerCase()] = 100; // fully practised so it reliably lands (§2.6)
    const startMana = s.ch.mana = s.ch.maxMana = 500; // plenty of mana for a few attempts
    const startHp = s.mob.hp = s.mob.maxHp = 500; // give the dummy a big pool so it survives
    // cast until one lands (each attempt spends mana; a practised spell lands most of the time)
    for (let i = 0; i < 12 && s.mob.hp >= startHp; i++) dispatchCommand(s.ctx, `cast ${name}`);
    expect(s.mob.hp).toBeLessThan(startHp); // a cast connected
    expect(s.ch.mana).toBeLessThan(startMana); // mana was spent
    expect(def.category).toBe("damage");
  });
});

describe("spell effects (via the combat engine)", () => {
  it("a damage spell can kill and award xp", () => {
    const s = setup(3);
    const { def } = knownDamageSpell();
    s.mob.hp = s.mob.maxHp = 1; // one hit ends it
    const startExp = s.ch.exp;
    s.combat.castOffensive(s.fighter, s.combat.fighterForMob(s.mob), def);
    expect(s.live.roomMobs(ROOM).length).toBe(0); // dummy died
    expect(s.ch.exp).toBeGreaterThan(startExp); // xp awarded
  });

  it("a debuff lands on a low-level foe and is folded into its combat stats", () => {
    const s = setup();
    const weaken = world.getSkill("weaken");
    if (!weaken) return; // spell not in this content — skip
    const debuffDef: SkillDef = { ...weaken, category: "debuff", damageType: "none" };
    s.combat.castOffensive(s.fighter, s.combat.fighterForMob(s.mob), debuffDef);
    expect(s.mob.affects.some((a) => a.name === "weaken")).toBe(true);
    // weaken lowers str/damroll → the mob fighter's damroll drops below its base
    const mobF = s.combat.fighterForMob(s.mob);
    expect(sumMods(mobF.affects).damroll).toBeLessThan(0);
  });

  it("a buff raises the caster's combat numbers and then expires", () => {
    const s = setup();
    const baseHit = s.fighter.hitroll;
    s.ch.affects.push(buffAffect("bless", 30));
    expect(s.fighter.hitroll).toBeGreaterThan(baseHit); // bless adds hitroll
    // force expiry
    s.ch.affects[0]!.expiresAt = Date.now() - 1000;
    const gone = expireAffects(s.ch.affects, Date.now());
    expect(gone.map((a) => a.name)).toContain("bless");
    expect(s.fighter.hitroll).toBe(baseHit); // back to baseline
  });

  it("poison is a damage-over-time affect", () => {
    const p = debuffAffect("poison", 20);
    expect(p.dot?.type).toBe("poison");
    expect(p.dot?.amount ?? 0).toBeGreaterThan(0);
  });
});
