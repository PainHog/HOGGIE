import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { dispatchCommand } from "./commands.ts";

let world: World;
const START = 10300; // University of Alden entrance

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

interface Mock extends Player {
  received: ServerMessage[];
  outText(): string;
}

let nameSeq = 0;
function mockPlayer(cls = 3, race = 0): Mock {
  const received: ServerMessage[] = [];
  const character = createCharacter(world, {
    id: `00000000-0000-0000-0000-${String(++nameSeq).padStart(12, "0")}`,
    accountId: "acc",
    name: `Tester${nameSeq}`,
    raceId: race,
    classId: cls,
    startRoom: START,
  });
  return {
    character,
    received,
    send: (m) => received.push(m),
    outText() {
      return received
        .filter((m): m is Extract<ServerMessage, { t: "output" }> => m.t === "output")
        .flatMap((m) => m.lines.map((l) => l.map((s) => s.text).join("")))
        .join("\n");
    },
  };
}

function ctx(live: LiveWorld, player: Player) {
  return { world, live, player, quit: () => {} };
}

describe("world load + movement + presence (Phase 2)", () => {
  it("loads the University slice with rooms and a start room", () => {
    expect(world.rooms.size).toBeGreaterThan(50);
    expect(world.getRoom(START)).toBeDefined();
    expect(world.getRoom(START)!.exits.length).toBeGreaterThan(0);
  });

  it("two players in the same room see each other on look", () => {
    const live = new LiveWorld(world);
    const a = mockPlayer();
    const b = mockPlayer();
    live.enter(a);
    live.enter(b);
    dispatchCommand(ctx(live, a), "look");
    expect(a.outText()).toContain(b.character.name);
  });

  it("moving broadcasts leave/arrive and relocates the mover", () => {
    const live = new LiveWorld(world);
    const a = mockPlayer();
    const b = mockPlayer();
    live.enter(a);
    live.enter(b);

    // pick a real exit from the start room whose destination is loaded
    const exit = world
      .getRoom(START)!
      .exits.find((e) => world.getRoom(e.toVnum));
    expect(exit).toBeDefined();

    dispatchCommand(ctx(live, a), exit!.dir);

    expect(a.character.roomVnum).toBe(exit!.toVnum);
    // b stayed behind and saw a leave
    expect(b.outText()).toContain(`${a.character.name} leaves ${exit!.dir}`);
    // a is no longer in the start room's occupant set
    expect(live.roomPlayers(START).map((p) => p.character.name)).not.toContain(a.character.name);
    expect(live.roomPlayers(exit!.toVnum).map((p) => p.character.name)).toContain(a.character.name);
  });

  it("say is heard by others in the room but not echoed to them as self", () => {
    const live = new LiveWorld(world);
    const a = mockPlayer();
    const b = mockPlayer();
    live.enter(a);
    live.enter(b);
    dispatchCommand(ctx(live, a), "say hello ghouls");
    expect(b.outText()).toContain(`${a.character.name} says, 'hello ghouls'`);
    expect(a.outText()).toContain("You say, 'hello ghouls'");
  });

  it("blocks movement with no exit", () => {
    const live = new LiveWorld(world);
    const a = mockPlayer();
    live.enter(a);
    // find a direction with no exit
    const dirs = ["north", "east", "south", "west", "up", "down"];
    const have = new Set(world.getRoom(START)!.exits.map((e) => e.dir));
    const missing = dirs.find((d) => !have.has(d))!;
    dispatchCommand(ctx(live, a), missing);
    expect(a.outText()).toContain("can't go that way");
  });
});
