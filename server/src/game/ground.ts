/**
 * Ground state (systems-spec §4.7 loot loop): loose objects lying in a room and the corpses that
 * mobs leave when they die. Both are live-only (never persisted) and decay on a timer so the world
 * doesn't fill with clutter. A corpse is just a decaying container holding the dead mob's gear.
 */
import { randomUUID } from "node:crypto";
import type { ItemInstance } from "./character.ts";

/** A loose object lying on the floor (dropped by a player, or spilled from a decayed corpse). */
export interface GroundItem {
  id: string;
  vnum: number;
  decayAt: number; // epoch ms
}

/** A corpse: a decaying container holding a dead mob's carried/worn gear. */
export interface Corpse {
  id: string;
  name: string; // e.g. "the corpse of a goblin"
  keyword: string; // the dead thing's primary keyword, for `get sword corpse`
  contents: ItemInstance[];
  decayAt: number; // epoch ms
}

export const GROUND_DECAY_MS = 5 * 60_000; // loose items linger 5 minutes
export const CORPSE_DECAY_MS = 3 * 60_000; // mob corpses rot in 3 minutes

export function makeGroundItem(vnum: number, now: number = Date.now()): GroundItem {
  return { id: randomUUID(), vnum, decayAt: now + GROUND_DECAY_MS };
}

export function makeCorpse(who: string, keyword: string, contents: ItemInstance[], now: number = Date.now()): Corpse {
  return { id: randomUUID(), name: `the corpse of ${who}`, keyword, contents, decayAt: now + CORPSE_DECAY_MS };
}

/** Does `keyword` match this corpse? ("corpse" matches any; else its dead thing's keyword.) */
export function corpseMatches(c: Corpse, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  return kw === "corpse" || c.keyword.toLowerCase().split(/\s+/).some((k) => k.startsWith(kw));
}
