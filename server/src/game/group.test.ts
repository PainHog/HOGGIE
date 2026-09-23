/**
 * Groups / party play (systems-spec §5): form a group with a co-located player, share kill xp,
 * chat with gtell, follow the leader between rooms, and leave/disband.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { spawnMob } from "./mobInstance.ts";
import { Rng } from "./rng.ts";
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
let exitDir: string, exitDest: number;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const foe: MobPrototype = {
  vnum: 999600, area: "test", keywords: "foe", shortDesc: "a foe", longDesc: "", description: "",
  level: 20, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: -200, hpDice: "1d1+0", damDice: "1d1+0",
  gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
};
// Same foe but carrying coins — for the gold-split tests (101 = an odd sum, so a remainder exists).
const richFoe: MobPrototype = { ...foe, vnum: 999601, keywords: "richfoe", shortDesc: "a rich foe", gold: 101 };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.mobPrototypes.set(foe.vnum, foe);
  world.mobPrototypes.set(richFoe.vnum, richFoe);
  const e = world.getRoom(ROOM)!.exits.find((x) => world.getRoom(x.toVnum))!;
  exitDir = e.dir; exitDest = e.toVnum;
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(2));
  const mk = (name: string, id: string) => {
    const recv: ServerMessage[] = [];
    const ch = createCharacter(world, { id, accountId: "acc", name, raceId: 0, classId: 3, startRoom: ROOM });
    ch.level = 20; ch.maxHp = ch.hp = 9999;
    const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
    const player: Player = { character: ch, fighter, send: (m) => recv.push(m) };
    live.enter(player);
    const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
    const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
    return { ch, fighter, player, recv, ctx };
  };
  return { live, combat, a: mk("Alpha", "00000000-0000-0000-0000-0000000grpa1"), b: mk("Bravo", "00000000-0000-0000-0000-0000000grpb2") };
}

const text = (m: ServerMessage[]) => m.flatMap((x) => (x.t === "output" ? x.lines.flat().map((s) => s.text) : [])).join("\n");
const lastParty = (m: ServerMessage[]) => [...m].reverse().find((x): x is Extract<ServerMessage, { t: "party" }> => x.t === "party")?.party ?? null;
function killFoe(s: ReturnType<typeof setup>) {
  const mob = spawnMob(foe, ROOM);
  mob.hp = mob.maxHp = 1;
  s.live.addMob(mob);
  for (let i = 0; i < 20 && mob.hp > 0; i++) s.combat.oneHit(s.a.fighter, s.combat.fighterForMob(mob));
}

describe("forming a group", () => {
  it("group <player> ties both to the leader; gtell reaches members", () => {
    const s = setup();
    dispatchCommand(s.a.ctx, "group Bravo");
    expect(s.a.ch.groupLeaderId).toBe(s.a.ch.id);
    expect(s.b.ch.groupLeaderId).toBe(s.a.ch.id);
    s.b.recv.length = 0;
    dispatchCommand(s.a.ctx, "gtell onward");
    expect(text(s.b.recv)).toContain("onward");
  });
});

describe("shared xp", () => {
  it("splits a kill's xp across the group (each less than a solo kill)", () => {
    const grouped = setup();
    dispatchCommand(grouped.a.ctx, "group Bravo");
    const a0 = grouped.a.ch.exp, b0 = grouped.b.ch.exp;
    killFoe(grouped);
    const aGain = grouped.a.ch.exp - a0, bGain = grouped.b.ch.exp - b0;
    expect(aGain).toBeGreaterThan(0);
    expect(bGain).toBeGreaterThan(0); // the groupmate got a share too

    const solo = setup();
    const s0 = solo.a.ch.exp;
    killFoe(solo);
    expect(aGain).toBeLessThan(solo.a.ch.exp - s0); // grouped share < full solo xp
  });
});

describe("shared gold", () => {
  function killRich(s: ReturnType<typeof setup>) {
    const mob = spawnMob(richFoe, ROOM);
    mob.hp = mob.maxHp = 1;
    s.live.addMob(mob);
    for (let i = 0; i < 20 && mob.hp > 0; i++) s.combat.oneHit(s.a.fighter, s.combat.fighterForMob(mob));
  }

  it("splits a mob's gold across the group; the killer keeps the remainder", () => {
    const s = setup();
    dispatchCommand(s.a.ctx, "group Bravo");
    killRich(s);
    // 101 gold, 2 members: 50 each + a 1-coin remainder to the killer (Alpha)
    expect(s.a.ch.gold).toBe(51);
    expect(s.b.ch.gold).toBe(50);
    expect(s.a.ch.gold + s.b.ch.gold).toBe(101);
  });

  it("a solo killer keeps all the gold", () => {
    const s = setup();
    killRich(s);
    expect(s.a.ch.gold).toBe(101);
    expect(s.b.ch.gold).toBe(0);
  });
});

describe("following", () => {
  it("a follower trails the leader between rooms", () => {
    const s = setup();
    dispatchCommand(s.a.ctx, "group Bravo");
    dispatchCommand(s.a.ctx, exitDir);
    expect(s.a.ch.roomVnum).toBe(exitDest);
    expect(s.b.ch.roomVnum).toBe(exitDest); // Bravo followed
  });
});

describe("party panel messages", () => {
  it("group sends both members a roster with leader / self / here flags", () => {
    const s = setup();
    dispatchCommand(s.a.ctx, "group Bravo");
    const pa = lastParty(s.a.recv), pb = lastParty(s.b.recv);
    expect(pa?.members.length).toBe(2);
    expect(pb?.members.length).toBe(2);
    const aSelf = pa!.members.find((x) => x.self);
    expect(aSelf?.name).toBe("Alpha");
    expect(aSelf?.leader).toBe(true); // Alpha leads
    expect(pa!.members.every((x) => x.here)).toBe(true); // both in the start room
    const bSelf = pb!.members.find((x) => x.self);
    expect(bSelf?.name).toBe("Bravo");
    expect(bSelf?.leader).toBe(false); // Bravo is a follower
    expect(aSelf?.hpPct).toBeGreaterThan(0);
  });

  it("ungroup clears the leaver's roster (empty members)", () => {
    const s = setup();
    dispatchCommand(s.a.ctx, "group Bravo");
    s.b.recv.length = 0;
    dispatchCommand(s.b.ctx, "ungroup");
    expect(lastParty(s.b.recv)?.members.length).toBe(0);
  });
});

describe("leaving", () => {
  it("a member can leave; the leader can disband the whole group", () => {
    const s = setup();
    dispatchCommand(s.a.ctx, "group Bravo");
    dispatchCommand(s.b.ctx, "ungroup");
    expect(s.b.ch.groupLeaderId).toBeUndefined();
    expect(s.a.ch.groupLeaderId).toBe(s.a.ch.id); // Alpha still leads

    dispatchCommand(s.a.ctx, "group Bravo"); // re-add
    dispatchCommand(s.a.ctx, "ungroup"); // leader disbands
    expect(s.a.ch.groupLeaderId).toBeUndefined();
    expect(s.b.ch.groupLeaderId).toBeUndefined();
  });
});
