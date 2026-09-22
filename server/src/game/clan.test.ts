/**
 * Clans (systems-spec §5): found a clan (costs glory), invite + accept members, clan chat reaches
 * online members, and leaving clears membership.
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
import { CLAN_COST_GLORY } from "./clans.ts";
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => { world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]); });

function text(msgs: ServerMessage[]): string {
  return msgs.flatMap((m) => (m.t === "output" ? m.lines.flat().map((s) => s.text) : [])).join("\n");
}

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const clanStore = new ClanStore(null); // shared across the group so hall/bank are consistent
  const mk = (name: string, id: string) => {
    const recv: ServerMessage[] = [];
    const ch = createCharacter(world, { id, accountId: "acc", name, raceId: 0, classId: 3, startRoom: ROOM });
    ch.level = 15;
    const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
    const player: Player = { character: ch, fighter, send: (m) => recv.push(m) };
    live.enter(player);
    const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
    const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore, db: null, quit: () => {} };
    return { ch, player, fighter, recv, ctx };
  };
  return { live, a: mk("Alpha", "00000000-0000-0000-0000-0000000c1aa1"), b: mk("Bravo", "00000000-0000-0000-0000-0000000c1bb2") };
}

describe("founding a clan", () => {
  it("costs glory and makes you leader", () => {
    const s = setup();
    s.a.ch.glory = CLAN_COST_GLORY;
    dispatchCommand(s.a.ctx, "clan create Wolves");
    expect(s.a.ch.clan).toEqual({ name: "Wolves", rank: "leader" });
    expect(s.a.ch.glory).toBe(0);
  });

  it("refuses without enough glory", () => {
    const s = setup();
    s.a.ch.glory = CLAN_COST_GLORY - 1;
    dispatchCommand(s.a.ctx, "clan create Wolves");
    expect(s.a.ch.clan).toBeUndefined();
  });
});

describe("membership", () => {
  it("invite + accept adds a member", () => {
    const s = setup();
    s.a.ch.glory = CLAN_COST_GLORY;
    dispatchCommand(s.a.ctx, "clan create Wolves");
    dispatchCommand(s.a.ctx, "clan invite Bravo");
    dispatchCommand(s.b.ctx, "clan accept");
    expect(s.b.ch.clan).toEqual({ name: "Wolves", rank: "member" });
  });

  it("clan chat reaches online members", () => {
    const s = setup();
    s.a.ch.clan = { name: "Wolves", rank: "leader" };
    s.b.ch.clan = { name: "Wolves", rank: "member" };
    dispatchCommand(s.a.ctx, "ctalk to arms");
    expect(text(s.b.recv)).toContain("to arms");
    expect(text(s.b.recv)).toContain("Wolves");
  });

  it("leaving clears membership", () => {
    const s = setup();
    s.a.ch.clan = { name: "Wolves", rank: "leader" };
    dispatchCommand(s.a.ctx, "clan leave");
    expect(s.a.ch.clan).toBeUndefined();
  });
});

describe("ranks", () => {
  function foundWith(s: ReturnType<typeof setup>) {
    s.a.ch.glory = CLAN_COST_GLORY;
    dispatchCommand(s.a.ctx, "clan create Wolves");
    dispatchCommand(s.a.ctx, "clan invite Bravo");
    dispatchCommand(s.b.ctx, "clan accept");
  }

  it("promote raises rank, and promoting to leader hands over the banner", () => {
    const s = setup();
    foundWith(s);
    dispatchCommand(s.a.ctx, "clan promote Bravo"); // member -> officer
    expect(s.b.ch.clan?.rank).toBe("officer");
    dispatchCommand(s.a.ctx, "clan promote Bravo"); // officer -> leader (transfer)
    expect(s.b.ch.clan?.rank).toBe("leader");
    expect(s.a.ch.clan?.rank).toBe("officer"); // the old leader steps down
  });

  it("a leader kicks a member out", () => {
    const s = setup();
    foundWith(s);
    dispatchCommand(s.a.ctx, "clan kick Bravo");
    expect(s.b.ch.clan).toBeUndefined();
  });
});

describe("clan war", () => {
  it("lets rival clans fight without the PvP opt-in", () => {
    const s = setup();
    world.getRoom(ROOM)!.roomFlags = []; // not a sanctuary/arena
    s.a.ch.clan = { name: "Reds", rank: "leader" };
    s.b.ch.clan = { name: "Blues", rank: "leader" };
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBeNull(); // neither flagged, not at war -> refused

    dispatchCommand(s.a.ctx, "clan war Blues");
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBe(s.b.fighter); // war = fair game
    dispatchCommand(s.a.ctx, "clan peace Blues"); // clean up the module-global war registry
  });
});

describe("clan hall + bank", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0)); // let the async clan-store paths settle

  async function found(s: ReturnType<typeof setup>) {
    s.a.ch.glory = CLAN_COST_GLORY;
    dispatchCommand(s.a.ctx, "clan create Wolves");
    dispatchCommand(s.a.ctx, "clan invite Bravo");
    dispatchCommand(s.b.ctx, "clan accept");
    await tick();
  }

  it("a shared bank: members deposit, leaders/officers withdraw", async () => {
    const s = setup();
    await found(s);
    s.a.ch.gold = 1000;
    dispatchCommand(s.a.ctx, "clan deposit 400"); await tick();
    expect(s.a.ch.gold).toBe(600);
    dispatchCommand(s.b.ctx, "clan withdraw 100"); await tick();
    expect(s.b.ch.gold).toBe(0); // a plain member can't withdraw
    dispatchCommand(s.a.ctx, "clan withdraw 400"); await tick();
    expect(s.a.ch.gold).toBe(1000); // the leader can
  });

  it("sets a hall and recalls to it", async () => {
    const s = setup();
    await found(s);
    dispatchCommand(s.a.ctx, "clan hall"); await tick(); // hall = ROOM
    const dest = world.getRoom(ROOM)!.exits.find((e) => world.getRoom(e.toVnum))!.toVnum;
    const liveA = s.live.roomPlayers(ROOM).find((p) => p.character.id === s.a.ch.id)!;
    s.live.moveTo(liveA, dest);
    expect(s.a.ch.roomVnum).toBe(dest);
    dispatchCommand(s.a.ctx, "clan home"); await tick();
    expect(s.a.ch.roomVnum).toBe(ROOM); // back at the hall
  });
});
