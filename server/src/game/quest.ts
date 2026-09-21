/**
 * Quests + glory (systems-spec §3.6). A quest-giver (a questmaster, or a guildmaster — the
 * University's guild hall doubles as the quest board) sends the player to hunt a level-appropriate
 * mob. Completing it awards gold and GLORY (quest points), a currency spent back on practice
 * sessions. One active quest at a time.
 */
import type { World } from "../world/world.ts";
import type { MobPrototype } from "../world/model.ts";
import type { Character } from "./character.ts";

/** An active hunt quest carried on a character. */
export interface QuestTarget {
  mobVnum: number;
  mobName: string;
  areaName: string; // a hint for where to seek the target
  count: number; // how many to slay
  killed: number; // progress
  rewardGold: number;
  rewardGlory: number;
}

/** Which act-flags mark a mob as a quest-giver (guildmasters double as quest boards). */
export const QUEST_GIVER_FLAGS = ["questmaster", "guildmaster"];

export function isQuestGiver(proto: MobPrototype): boolean {
  return proto.actFlags.some((f) => QUEST_GIVER_FLAGS.includes(f));
}

/** Glory a quest is worth = 3 glory per practice session (the spend price). */
export const GLORY_PER_PRACTICE = 3;

// Service NPCs a player should never be sent to kill.
const PROTECTED = new Set([
  "guildmaster", "questmaster", "healer", "banker", "trainer", "pet", "mountable",
  "noattack", "undertaker", "innkeeper", "scholar", "secretive", "pacifist",
]);

/** Distinct killable mob prototypes that spawn in an area (or anywhere when area is ""). */
function candidates(world: World, area: string): MobPrototype[] {
  const seen = new Set<number>();
  const list: MobPrototype[] = [];
  for (const r of world.resets) {
    if (r.kind !== "spawn_mob" || r.mobVnum == null || seen.has(r.mobVnum)) continue;
    const p = world.getMobPrototype(r.mobVnum);
    if (!p || p.level < 1) continue;
    if (area && p.area !== area) continue;
    if (world.shops.has(p.vnum)) continue;
    if (p.actFlags.some((f) => PROTECTED.has(f))) continue;
    seen.add(r.mobVnum);
    list.push(p);
  }
  return list;
}

/**
 * Assign a hunt quest for `ch`: a killable mob near their level, preferring the giver's own area,
 * widening if none fits. Returns null when the world has nothing suitable.
 */
export function assignQuest(world: World, ch: Character, giverArea: string): QuestTarget | null {
  const band = 6;
  const near = (p: MobPrototype) => Math.abs(p.level - ch.level) <= band;
  let pool = candidates(world, giverArea).filter(near);
  if (pool.length === 0) pool = candidates(world, "").filter(near);
  if (pool.length === 0) pool = candidates(world, "");
  if (pool.length === 0) return null;

  // closest level wins, ties broken by vnum — stable/deterministic
  pool.sort((a, b) => Math.abs(a.level - ch.level) - Math.abs(b.level - ch.level) || a.vnum - b.vnum);
  const target = pool[0]!;
  const count = 1 + Math.min(2, Math.floor(target.level / 10));
  const rewardGlory = Math.max(1, Math.min(20, 1 + Math.floor(target.level / 4) + (count - 1)));
  const rewardGold = target.level * count * 8 + 20;
  const areaName = world.areas.get(target.area)?.name ?? target.area;
  return {
    mobVnum: target.vnum,
    mobName: target.shortDesc || target.keywords || `creature ${target.vnum}`,
    areaName,
    count,
    killed: 0,
    rewardGold,
    rewardGlory,
  };
}
