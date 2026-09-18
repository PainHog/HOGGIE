/** Parse and roll the "NdS+P" dice strings the content uses (hp_dice, dam_dice). */
import type { Rng } from "./rng.ts";

export interface Dice {
  n: number; // number of dice
  s: number; // sides
  p: number; // flat plus
}

const DICE_RE = /^\s*(\d+)d(\d+)\+(-?\d+)\s*$/i;

export function parseDice(spec: string): Dice {
  const m = DICE_RE.exec(spec);
  if (!m) return { n: 0, s: 0, p: 0 };
  return { n: Number(m[1]), s: Number(m[2]), p: Number(m[3]) };
}

export function rollDice(d: Dice, rng: Rng): number {
  return rng.dice(d.n, d.s) + d.p;
}

/** Average value of a dice spec (for hp when we want a stable value, e.g. mob spawn maxHp). */
export function averageDice(d: Dice): number {
  return Math.round(d.n * ((d.s + 1) / 2)) + d.p;
}
