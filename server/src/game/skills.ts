/**
 * Skill learning / practising (systems-spec §2.6). A character's class(+dual) tree says WHICH
 * skills they can learn, at what level, and the adept cap (the ceiling practising can reach). Actual
 * competence is a per-character learned% held in `proficiencies` — it starts low when a skill is
 * first gained and is raised by practising at a guildmaster and, a little, through use.
 */
import type { World } from "../world/world.ts";
import type { Character } from "./character.ts";

export interface MergedSkill {
  name: string;
  level: number; // level it unlocks (lowest required across class + dual)
  adept: number; // practice cap % (highest across class + dual)
}

/** A freshly-gained skill starts here until practised (SMAUG: you must train it up). */
export const BASE_LEARNED = 1;

/**
 * Merge the class (and dual) grants for a character: a skill known to both is usable at the LOWER
 * required level with the HIGHER adept cap (faithful to the source's dual-class handling).
 */
export function mergedGrants(world: World, ch: Character): Map<string, MergedSkill> {
  const merged = new Map<string, MergedSkill>();
  const add = (grants: { skill: string; level: number; adept: number }[]) => {
    for (const g of grants) {
      const cur = merged.get(g.skill);
      merged.set(
        g.skill,
        cur
          ? { name: g.skill, level: Math.min(cur.level, g.level), adept: Math.max(cur.adept, g.adept) }
          : { name: g.skill, level: g.level, adept: g.adept },
      );
    }
  };
  const cls = world.classes.get(ch.classId);
  if (cls) add(cls.skills);
  if (ch.dualClassId != null && ch.dualClassId !== ch.classId) {
    const dual = world.classes.get(ch.dualClassId);
    if (dual) add(dual.skills);
  }
  return merged;
}

/** Is this skill on the character's tree AND unlocked at their level? */
export function isKnown(grant: MergedSkill | undefined, ch: Character): grant is MergedSkill {
  return !!grant && grant.level <= ch.level;
}

/**
 * The character's effective learned% for a skill: 0 if not yet known; otherwise the stored value,
 * or the base for a known-but-never-practised skill. Never exceeds the skill's adept cap.
 */
export function learnedPct(world: World, ch: Character, name: string): number {
  const grant = mergedGrants(world, ch).get(name);
  if (!isKnown(grant, ch)) return 0;
  const stored = ch.proficiencies?.[name.toLowerCase()];
  const pct = stored != null ? stored : BASE_LEARNED;
  return Math.max(0, Math.min(grant.adept, pct));
}

/** How much one practice session raises a skill: INT-driven, 3–15% (systems-spec §2.6). */
export function practiceGain(intValue: number): number {
  const mod = Math.floor((intValue - 13) / 2); // statMod
  return Math.max(3, Math.min(15, 5 + mod * 2));
}

/**
 * Raise a known skill toward its cap by `amount`, writing the new learned% into `proficiencies`.
 * Returns the new value (unchanged and capped if already at the ceiling).
 */
export function raiseSkill(ch: Character, name: string, cap: number, amount: number): number {
  const key = name.toLowerCase();
  const cur = ch.proficiencies?.[key] ?? BASE_LEARNED;
  const next = Math.max(0, Math.min(cap, cur + amount));
  ch.proficiencies[key] = next;
  return next;
}
