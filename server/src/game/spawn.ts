/**
 * Populate the live world from resets. Mob resets spawn mobs into rooms up to their max-in-world
 * count; repop tops that back up. Object resets (place_object `O`, put_in_container `P`) lay findable
 * objects on the floor and seed chests with loot — applied once at world load (SMAUG re-places objects
 * only on a full area reset), so repop keeps topping up mobs but never stacks duplicate objects.
 */
import { log } from "../log.ts";
import type { ObjPrototype } from "../world/model.ts";
import type { ItemInstance } from "./character.ts";
import type { LiveWorld } from "./liveWorld.ts";
import { makeFixedGroundItem } from "./ground.ts";
import { containerInfo, isContainer } from "./items.ts";
import { spawnMob } from "./mobInstance.ts";

/** A fresh reset instance of an object; containers pick up their default closed/locked state. */
function newInstance(proto: ObjPrototype): ItemInstance {
  const inst: ItemInstance = { vnum: proto.vnum };
  if (isContainer(proto)) {
    const info = containerInfo(proto);
    if (info.closedDefault) inst.closed = true;
    if (info.lockedDefault) inst.locked = true;
  }
  return inst;
}

/**
 * Run resets into the live world. Always spawns mobs; also places objects when `objects` is set
 * (the initial load). Returns the number of mobs spawned.
 */
export function populateWorld(live: LiveWorld, opts: { objects?: boolean } = {}): number {
  let spawned = 0;
  for (const reset of live.world.resets) {
    if (reset.kind !== "spawn_mob") continue;
    if (reset.mobVnum === undefined || reset.roomVnum === undefined) continue;
    const proto = live.world.getMobPrototype(reset.mobVnum);
    if (!proto || !live.world.getRoom(reset.roomVnum)) continue;
    const max = Math.max(1, reset.maxInWorld ?? 1);
    if (live.countMobProto(reset.mobVnum) >= max) continue;
    live.addMob(spawnMob(proto, reset.roomVnum));
    spawned++;
  }
  if (opts.objects ?? true) placeObjects(live);
  return spawned;
}

/**
 * Apply the object resets: `place_object` (lay an object on a room's floor) and `put_in_container`
 * (nest an object inside a placed container). The extracted resets are grouped by kind rather than
 * kept in file order, so P resets can precede their O — we key containers by vnum (from the reset's
 * `containerVnum`) instead of relying on order. Placed objects don't decay until taken.
 */
function placeObjects(live: LiveWorld): void {
  let placed = 0;
  // Pass 1: place floor objects, remembering each placed container instance by its vnum.
  const containers = new Map<number, ItemInstance>();
  for (const reset of live.world.resets) {
    if (reset.kind !== "place_object") continue;
    if (reset.objVnum === undefined || reset.roomVnum === undefined) continue;
    const proto = live.world.getObjPrototype(reset.objVnum);
    if (!proto || !live.world.getRoom(reset.roomVnum)) continue;
    // Idempotent across a repeat call: reuse a matching object already in the room.
    const existing = live.roomGround(reset.roomVnum).find((g) => g.item.vnum === reset.objVnum);
    const instance = existing?.item ?? newInstance(proto);
    if (!existing) { live.addGround(reset.roomVnum, makeFixedGroundItem(instance)); placed++; }
    if (isContainer(proto)) containers.set(reset.objVnum, instance);
  }
  // Pass 2: nest each P reset's object into its named container (by vnum).
  for (const reset of live.world.resets) {
    if (reset.kind !== "put_in_container") continue;
    if (reset.objVnum === undefined || reset.containerVnum === undefined) continue;
    const target = containers.get(reset.containerVnum);
    if (!target || !live.world.getObjPrototype(reset.objVnum)) continue;
    (target.contents ??= []).push({ vnum: reset.objVnum });
    placed++;
  }
  if (placed > 0) log.debug("placed reset objects", { placed });
}

/** Repop: top up mob spawns toward their max (objects are not re-placed). Called on the repop tick. */
export function repopWorld(live: LiveWorld): number {
  const before = live.allMobs().length;
  populateWorld(live, { objects: false });
  const added = live.allMobs().length - before;
  if (added > 0) log.debug("repop added mobs", { added });
  return added;
}
