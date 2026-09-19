/**
 * Affects — timed buffs/debuffs on a combatant (from spells now; from worn gear later). Each folds
 * a set of modifiers into the combat getters (hitroll/damroll/AC/saves/stats), and can add damage
 * resistance, blind, or a poison-style damage-over-time. Durations are wall-clock (ms), so they
 * expire the same way in and out of combat. Fresh code — no SMAUG affect tables.
 */
export interface AffectMods {
  hitroll?: number;
  damroll?: number;
  ac?: number; // higher = better defense in this engine
  saveSpell?: number; // bonus to saving throws vs. spells
  str?: number; int?: number; wis?: number; dex?: number; con?: number; cha?: number; lck?: number;
}

export interface Affect {
  name: string; // spell/effect name, e.g. "bless", "poison"
  kind: "buff" | "debuff";
  mods: AffectMods;
  resist?: string[]; // damage types this affect makes you resist
  blind?: boolean; // a large to-hit penalty while active
  dot?: { type: string; amount: number }; // damage applied each poison tick
  expiresAt: number; // Date.now() ms
  wearOff: string; // message shown to the owner when it ends
}

const STAT_KEYS = ["str", "int", "wis", "dex", "con", "cha", "lck"] as const;

/** Drop expired affects in place; returns the ones that just wore off (for messaging). */
export function expireAffects(list: Affect[], now = Date.now()): Affect[] {
  const expired: Affect[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.expiresAt <= now) {
      expired.push(list[i]!);
      list.splice(i, 1);
    }
  }
  return expired;
}

/** Sum every active affect's modifiers into one object. */
export function sumMods(affects: Affect[]): Required<AffectMods> {
  const out: Required<AffectMods> = { hitroll: 0, damroll: 0, ac: 0, saveSpell: 0, str: 0, int: 0, wis: 0, dex: 0, con: 0, cha: 0, lck: 0 };
  for (const af of affects) {
    const m = af.mods;
    out.hitroll += m.hitroll ?? 0;
    out.damroll += m.damroll ?? 0;
    out.ac += m.ac ?? 0;
    out.saveSpell += m.saveSpell ?? 0;
    for (const k of STAT_KEYS) out[k] += m[k] ?? 0;
  }
  return out;
}

/** True if any active affect blinds. */
export function isBlinded(affects: Affect[]): boolean {
  return affects.some((af) => af.blind);
}

/** Damage types added to resistance by active affects. */
export function resistAdds(affects: Affect[]): string[] {
  const out: string[] = [];
  for (const af of affects) if (af.resist) out.push(...af.resist);
  return out;
}

/** Add an affect in place; re-casting the same-named affect refreshes rather than stacks. */
export function applyAffect(list: Affect[], affect: Affect): void {
  const i = list.findIndex((af) => af.name === affect.name);
  if (i >= 0) list.splice(i, 1);
  list.push(affect);
}

/** The names of active affects, for the client's status strips. */
export function affectNames(affects: Affect[]): string[] {
  return affects.map((af) => af.name);
}
