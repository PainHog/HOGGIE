/**
 * Populate the live world from resets. Spawn resets place mobs into rooms up to their
 * max-in-world count; repop tops that back up. Object/equipment resets are deferred (players
 * fight barehanded in v1); only mob spawns matter for the combat slice.
 */
import { log } from "../log.ts";
import type { LiveWorld } from "./liveWorld.ts";
import { spawnMob } from "./mobInstance.ts";

/** Run all spawn_mob resets, respecting each mob's max-in-world. Returns how many spawned. */
export function populateWorld(live: LiveWorld): number {
  let spawned = 0;
  for (const reset of live.world.resets) {
    if (reset.kind !== "spawn_mob") continue;
    if (reset.mobVnum === undefined || reset.roomVnum === undefined) continue;
    const proto = live.world.getMobPrototype(reset.mobVnum);
    const room = live.world.getRoom(reset.roomVnum);
    if (!proto || !room) continue;

    const max = Math.max(1, reset.maxInWorld ?? 1);
    if (live.countMobProto(reset.mobVnum) >= max) continue;

    live.addMob(spawnMob(proto, reset.roomVnum));
    spawned++;
  }
  return spawned;
}

/** Repop: top up spawns toward their max. Called on the area-repop tick. */
export function repopWorld(live: LiveWorld): number {
  const before = live.allMobs().length;
  populateWorld(live);
  const added = live.allMobs().length - before;
  if (added > 0) log.debug("repop added mobs", { added });
  return added;
}
