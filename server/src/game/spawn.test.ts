/**
 * Object resets (systems-spec §4.7): the world load lays findable objects on the floor (`O` resets)
 * and seeds chests/corpses with loot (`P` resets). Verified against real beehive.are content, which
 * places a "corpse of a halfling apprentice" (10914) holding a "vial of recall" (10916), plus loose
 * floor objects. Reset objects don't decay, and repop tops up mobs without duplicating them.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld } from "./liveWorld.ts";
import { populateWorld, repopWorld } from "./spawn.ts";

const CHEST = 10914, CHEST_ROOM = 10961, VIAL = 10916; // a container + its P-reset contents
const FLOOR_OBJ = 10907, FLOOR_ROOM = 10970; // a plain O-reset floor object

let world: World;
beforeAll(async () => { world = await loadWorld(DEFAULT_CONTENT_DIR, ["beehive.are"]); });

describe("object resets", () => {
  it("places a container on the floor and seeds it with its P-reset contents", () => {
    const live = new LiveWorld(world);
    populateWorld(live);
    const chest = live.roomGround(CHEST_ROOM).find((g) => g.item.vnum === CHEST);
    expect(chest).toBeDefined();
    expect(chest!.item.contents?.map((it) => it.vnum)).toContain(VIAL);
  });

  it("places plain floor objects too", () => {
    const live = new LiveWorld(world);
    populateWorld(live);
    expect(live.roomGround(FLOOR_ROOM).some((g) => g.item.vnum === FLOOR_OBJ)).toBe(true);
  });

  it("reset objects don't decay on the clutter timer", () => {
    const live = new LiveWorld(world);
    populateWorld(live);
    live.decayGround(Date.now() + 365 * 24 * 3600_000); // a year on — dropped loot would be long gone
    expect(live.roomGround(CHEST_ROOM).some((g) => g.item.vnum === CHEST)).toBe(true);
  });

  it("repop tops up mobs without re-placing or duplicating objects", () => {
    const live = new LiveWorld(world);
    populateWorld(live);
    const before = live.roomGround(CHEST_ROOM).length;
    repopWorld(live);
    expect(live.roomGround(CHEST_ROOM).length).toBe(before);
  });
});
