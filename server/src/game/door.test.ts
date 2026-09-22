/**
 * Doors on room exits (systems-spec §4.7): a closed door blocks movement; open/close/lock/unlock act
 * on a direction, need the key to (un)lock, and sync both sides. Verified against real ancient.are
 * content — room 10026 has a locked `up` door (key 9961) to room 10027.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { Rng } from "./rng.ts";
import { ClanStore } from "./clanStore.ts";
import { initDoors } from "./doors.ts";
import { repopWorld } from "./spawn.ts";
import { buildRoomView } from "./view.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

const ROOM = 10026, UPPER = 10027, KEY = 9961;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["ancient.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

let world: World;
beforeAll(async () => { world = await loadWorld(DEFAULT_CONTENT_DIR, ["ancient.are"]); });

function setup() {
  const live = new LiveWorld(world);
  initDoors(live);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-00000000door", accountId: "acc", name: "Rogue", raceId: 0, classId: 3, startRoom: ROOM });
  const player: Player = { character: ch, send: (m) => recv.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, ch, recv, ctx };
}

describe("doors", () => {
  it("seeds a locked closed door from the content", () => {
    const s = setup();
    expect(s.live.doorAt(ROOM, "up")).toEqual({ closed: true, locked: true });
  });

  it("a closed door blocks movement", () => {
    const s = setup();
    dispatchCommand(s.ctx, "up");
    expect(s.ch.roomVnum).toBe(ROOM); // couldn't pass the closed door
  });

  it("needs the key to unlock, then opens and lets you through", () => {
    const s = setup();
    dispatchCommand(s.ctx, "unlock up");
    expect(s.live.doorAt(ROOM, "up")!.locked).toBe(true); // no key — still locked

    s.ch.inventory.push({ vnum: KEY });
    dispatchCommand(s.ctx, "unlock up");
    expect(s.live.doorAt(ROOM, "up")!.locked).toBe(false);
    dispatchCommand(s.ctx, "open up");
    expect(s.live.doorAt(ROOM, "up")!.closed).toBe(false);

    dispatchCommand(s.ctx, "up");
    expect(s.ch.roomVnum).toBe(UPPER); // through the now-open door
  });

  it("closing from the far side shuts the door on both sides", () => {
    const s = setup();
    s.ch.inventory.push({ vnum: KEY });
    dispatchCommand(s.ctx, "unlock up");
    dispatchCommand(s.ctx, "open up");
    dispatchCommand(s.ctx, "up"); // now in the upper room
    expect(s.ch.roomVnum).toBe(UPPER);

    dispatchCommand(s.ctx, "close down"); // close the same door from the other side
    expect(s.live.doorAt(ROOM, "up")!.closed).toBe(true); // shut on the original side too
  });

  it("a closed door shows in the room view exits", () => {
    const s = setup();
    const rv = buildRoomView(s.live, s.ctx.player);
    expect(rv.exits.find((e) => e.dir === "up")?.closed).toBe(true);
  });

  it("repop re-closes a door a player left open", () => {
    const s = setup();
    s.ch.inventory.push({ vnum: KEY });
    dispatchCommand(s.ctx, "unlock up");
    dispatchCommand(s.ctx, "open up");
    expect(s.live.doorAt(ROOM, "up")!.closed).toBe(false);
    repopWorld(s.live); // the periodic area reset
    expect(s.live.doorAt(ROOM, "up")!.closed).toBe(true);
  });
});
