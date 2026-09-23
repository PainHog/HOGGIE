/**
 * Spell effects — the engine's own formulas for what a spell does once it lands, keyed off the
 * spell's category (from content/spells.json) and its name/level. Fresh math derived from the
 * spec (level-scaled), not SMAUG's per-spell tables. Damage/heal are amounts; buffs/debuffs build
 * a timed Affect (see affects.ts).
 */
import type { Affect } from "./affects.ts";
import type { Rng } from "./rng.ts";

/** Direct-damage magnitude before saving throws / RIS (applied by the combat manager). */
export function spellDamage(level: number, rng: Rng): number {
  const n = Math.max(1, Math.floor(level / 2) + 1);
  return rng.dice(n, 6) + level;
}

/** HP restored by a healing spell, scaled by the spell's tier in its name. */
export function spellHeal(name: string, level: number, rng: Rng): number {
  const n = name.toLowerCase();
  if (/\bheal\b|restore/.test(n)) return 100 + level * 3;
  if (/critical/.test(n)) return rng.dice(4, 10) + level * 2;
  if (/serious/.test(n)) return rng.dice(3, 8) + level * 2;
  if (/light|minor/.test(n)) return rng.dice(2, 8) + level;
  return rng.dice(2, 8) + level;
}

const dur = (level: number, floor: number) => Math.max(floor, level * 6) * 1000;

/** Build the timed buff a defensive spell grants the caster (self/ally). */
export function buffAffect(name: string, level: number, now = Date.now()): Affect {
  const n = name.toLowerCase();
  let mods: Affect["mods"] = {};
  let resist: string[] | undefined;
  if (/giant strength|strength|\bmight\b/.test(n)) mods = { str: 2, damroll: 1 };
  else if (/frenzy|heroism|\baid\b|rage/.test(n)) mods = { hitroll: 3, damroll: 3 };
  else if (/bless/.test(n)) mods = { hitroll: Math.floor(level / 8) + 2, saveSpell: Math.floor(level / 8) + 1 };
  else if (/stone ?skin|bark ?skin|\bshield\b|sanctuar/.test(n)) mods = { ac: 40 };
  else if (/armor|protection|\bguard\b|\bward\b|\baura\b/.test(n)) mods = { ac: 20 };
  else if (/haste|speed/.test(n)) mods = { hitroll: 2, dex: 1 };
  else mods = { ac: 10 }; // detect/fly/infra/invis etc. — a real affect, minor combat effect
  if (/fire ?shield|resist fire|fireproof/.test(n)) resist = ["fire"];
  else if (/frost|cold shield|resist cold/.test(n)) resist = ["cold"];
  return { name, kind: "buff", mods, resist, expiresAt: now + dur(level, 30), wearOff: `&cYour ${name} fades away.&D` };
}

/** Build the timed debuff an offensive non-damage spell inflicts on the target. */
export function debuffAffect(name: string, level: number, now = Date.now()): Affect {
  const n = name.toLowerCase();
  let mods: Affect["mods"] = {};
  let blind = false;
  let dot: Affect["dot"];
  if (/blind/.test(n)) { blind = true; mods = { hitroll: -30 }; }
  else if (/weaken/.test(n)) mods = { str: -2, damroll: -2 };
  else if (/curse/.test(n)) mods = { hitroll: -3, saveSpell: -3 };
  else if (/poison|venom|plague|disease/.test(n)) { dot = { type: "poison", amount: level + 2 }; mods = { str: -1 }; }
  else if (/feeble/.test(n)) mods = { int: -3 };
  else if (/slow/.test(n)) mods = { hitroll: -2, dex: -1 };
  else mods = { hitroll: -2 };
  return { name, kind: "debuff", mods, blind, dot, expiresAt: now + dur(level, 20), wearOff: `&cThe ${name} afflicting you fades.&D` };
}
