/**
 * Containers / bag management (systems-spec §4.6): put items into and take them out of a carried
 * container, and surface the container's contents + open/closed state to the client (bag manager).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { InventoryItem, ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { ObjPrototype } from "../world/model.ts";
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
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const BAG: ObjPrototype = {
  vnum: 999700, area: "test", keywords: "leather bag", shortDesc: "a leather bag", description: "", actionDesc: "",
  itemType: "container", extraFlags: [], wearFlags: [], values: [200, 0, 0], weight: 2, cost: 10,
};
const TORCH: ObjPrototype = {
  vnum: 999701, area: "test", keywords: "torch", shortDesc: "a pine torch", description: "", actionDesc: "",
  itemType: "light", extraFlags: [], wearFlags: [], values: [0], weight: 1, cost: 5,
};

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.objPrototypes.set(BAG.vnum, BAG);
  world.objPrototypes.set(TORCH.vnum, TORCH);
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const recv: ServerMessage[] = [];
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-00000000bag1", accountId: "acc", name: "Packrat", raceId: 0, classId: 3, startRoom: ROOM });
  ch.inventory = [{ vnum: BAG.vnum }, { vnum: TORCH.vnum }];
  const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
  const player: Player = { character: ch, fighter, send: (m) => recv.push(m) };
  live.enter(player);
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, ch, recv, ctx };
}

const lastInv = (m: ServerMessage[]): InventoryItem[] =>
  [...m].reverse().find((x): x is Extract<ServerMessage, { t: "inventory" }> => x.t === "inventory")?.items ?? [];

describe("bag manager (structured container contents)", () => {
  it("put stows an item and the inventory message shows it inside the bag's contents", () => {
    const s = setup();
    dispatchCommand(s.ctx, "put torch bag");
    expect(s.ch.inventory.some((it) => it.vnum === TORCH.vnum)).toBe(false); // no longer loose
    const bagInst = s.ch.inventory.find((it) => it.vnum === BAG.vnum)!;
    expect(bagInst.contents?.some((c) => c.vnum === TORCH.vnum)).toBe(true); // now inside the bag

    const inv = lastInv(s.recv);
    const bagRow = inv.find((it) => it.vnum === BAG.vnum)!;
    expect(bagRow.container).toBe(true);
    expect(bagRow.contents?.map((c) => c.name)).toContain("a pine torch"); // resolved for the client
    expect(inv.some((it) => it.vnum === TORCH.vnum)).toBe(false); // not a top-level row anymore
  });

  it("get takes an item back out of the bag", () => {
    const s = setup();
    dispatchCommand(s.ctx, "put torch bag");
    dispatchCommand(s.ctx, "get torch bag");
    expect(s.ch.inventory.some((it) => it.vnum === TORCH.vnum)).toBe(true); // back in the pack
    const bagInst = s.ch.inventory.find((it) => it.vnum === BAG.vnum)!;
    expect(bagInst.contents?.length ?? 0).toBe(0); // bag empty again
  });

  it("a closed container reports closed=true to the client", () => {
    const s = setup();
    s.ch.inventory = [{ vnum: BAG.vnum, closed: true, contents: [{ vnum: TORCH.vnum }] }];
    dispatchCommand(s.ctx, "inventory");
    const bagRow = lastInv(s.recv).find((it) => it.vnum === BAG.vnum)!;
    expect(bagRow.container).toBe(true);
    expect(bagRow.closed).toBe(true);
    expect(bagRow.contents?.length).toBe(1); // contents still resolved even while closed
  });
});
