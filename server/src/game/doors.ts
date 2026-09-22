/**
 * Doors on room exits (systems-spec §4.7). An exit flagged `isdoor` can be closed and locked; a
 * closed door blocks movement until opened. Runtime open/closed/locked state lives in the LiveWorld
 * (one instance per room), seeded at world load from the exit's flags and the `door_state` (`D`)
 * resets. Doors are two-sided: opening one side opens the matching exit back.
 */
import type { LiveWorld } from "./liveWorld.ts";

export interface DoorState {
  closed: boolean;
  locked: boolean;
}

/** SMAUG/Diku door direction indices (as used by `D` resets) → our exit direction strings. */
const DIR_INDEX: Record<number, string> = { 0: "north", 1: "east", 2: "south", 3: "west", 4: "up", 5: "down" };

/** The opposite direction, for syncing the far side of a two-sided door. */
export const REVERSE_DIR: Record<string, string> = {
  north: "south", south: "north", east: "west", west: "east", up: "down", down: "up",
  northeast: "southwest", southwest: "northeast", northwest: "southeast", southeast: "northwest",
};

/** Is this exit a door (can it be opened/closed)? */
export function isDoorExit(flags: string[] | undefined): boolean {
  return !!flags && (flags.includes("isdoor") || flags.includes("door"));
}

/** Set a door's state on both sides — the near exit and the neighbour's exit back. */
export function setDoorBothSides(live: LiveWorld, roomVnum: number, dir: string, state: DoorState): void {
  live.setDoorState(roomVnum, dir, { ...state });
  const exit = live.world.getRoom(roomVnum)?.exits.find((e) => e.dir === dir);
  if (!exit) return;
  // Prefer the true reverse-direction exit; only fall back to "any exit leading back" if there is none.
  const neighbour = live.world.getRoom(exit.toVnum);
  const back = neighbour?.exits.find((e) => e.dir === REVERSE_DIR[dir]) ?? neighbour?.exits.find((e) => e.toVnum === roomVnum);
  if (back) live.setDoorState(exit.toVnum, back.dir, { ...state });
}

/**
 * Seed runtime door state for every door exit from its flags, then apply `door_state` resets
 * (state 0 = open, 1 = closed, 2 = closed+locked) as the authoritative reset state. Returns the
 * number of door exits initialised. Call once at world load.
 */
export function initDoors(live: LiveWorld): number {
  let doors = 0;
  for (const room of live.world.rooms.values()) {
    for (const exit of room.exits) {
      if (!isDoorExit(exit.flags)) continue;
      const flags = exit.flags ?? [];
      live.setDoorState(room.vnum, exit.dir, { closed: flags.includes("closed"), locked: flags.includes("locked") });
      doors++;
    }
  }
  for (const reset of live.world.resets) {
    if (reset.kind !== "door_state" || reset.roomVnum === undefined || reset.door === undefined) continue;
    const dir = DIR_INDEX[reset.door];
    if (!dir) continue;
    const exit = live.world.getRoom(reset.roomVnum)?.exits.find((e) => e.dir === dir);
    if (!exit || !isDoorExit(exit.flags)) continue;
    const st = reset.state ?? 0;
    setDoorBothSides(live, reset.roomVnum, dir, { closed: st >= 1, locked: st >= 2 });
  }
  return doors;
}
