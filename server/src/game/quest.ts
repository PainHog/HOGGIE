/**
 * Quests + glory (systems-spec §3.6). A quest-giver (a questmaster, or a guildmaster — the
 * University's guild hall doubles as the quest board) sends the player to hunt a level-appropriate
 * mob. Completing it awards gold and GLORY (quest points), a currency spent back on practice
 * sessions. One active quest at a time.
 */
import type { World } from "../world/world.ts";
import type { MobPrototype } from "../world/model.ts";
import type { Character } from "./character.ts";

/** An active quest carried on a character. `hunt` = slay N of a mob; `fetch` = retrieve an item. */
export interface QuestTarget {
  type?: "hunt" | "fetch"; // undefined = hunt (back-compat with older saved quests)
  mobVnum: number;
  mobName: string;
  areaName: string; // a hint for where to seek the target
  count: number; // hunt: how many to slay
  killed: number; // hunt progress
  itemVnum?: number; // fetch: the item to bring back
  itemName?: string;
  expiresAt?: number; // timed quests (fetch): epoch-ms deadline
  rewardGold: number;
  rewardGlory: number;
}

/** How long a timed (fetch) quest allows before it lapses. */
export const FETCH_DEADLINE_MS = 15 * 60_000;

/** A timed quest that has run out of time. */
export function questExpired(q: QuestTarget, now: number = Date.now()): boolean {
  return q.expiresAt != null && now > q.expiresAt;
}

/** Is the quest's objective met? (fetch: the item is in the pack; hunt: enough kills.) */
export function questFulfilled(q: QuestTarget, ch: Character): boolean {
  if ((q.type ?? "hunt") === "fetch") return q.itemVnum != null && ch.inventory.some((it) => it.vnum === q.itemVnum);
  return q.killed >= q.count;
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
  const mobName = target.shortDesc || target.keywords || `creature ${target.vnum}`;
  const areaName = world.areas.get(target.area)?.name ?? target.area;
  const rewardGlory = Math.max(1, Math.min(20, 2 + Math.floor(target.level / 4)));
  const rewardGold = target.level * 10 + 20;

  // If the target carries gear, make it a timed FETCH quest for one of its items; else a hunt.
  const loot = (world.mobLoot.get(target.vnum) ?? []).filter((v) => world.getObjPrototype(v));
  if (loot.length > 0) {
    const itemVnum = loot[0]!;
    return {
      type: "fetch", mobVnum: target.vnum, mobName, areaName, count: 1, killed: 0,
      itemVnum, itemName: world.getObjPrototype(itemVnum)!.shortDesc || `item ${itemVnum}`,
      expiresAt: Date.now() + FETCH_DEADLINE_MS, rewardGold: rewardGold + 20, rewardGlory: rewardGlory + 1,
    };
  }

  const count = 1 + Math.min(2, Math.floor(target.level / 10));
  return {
    type: "hunt", mobVnum: target.vnum, mobName, areaName, count, killed: 0,
    rewardGold: rewardGold * count, rewardGlory: rewardGlory + (count - 1),
  };
}
