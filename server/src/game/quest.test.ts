/**
 * Quests + glory (systems-spec §3.6): a questmaster assigns a hunt for a level-appropriate mob;
 * kills count toward it; turning it in awards gold + glory; glory buys practice sessions. A much
 * tougher kill also earns a point of glory.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype, Reset } from "../world/model.ts";
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
import { GLORY_PER_PRACTICE } from "./quest.ts";
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const base = {
  area: "test", longDesc: "", description: "", alignment: 0, affectFlags: [] as string[], thac0: 20, ac: 100,
  gold: 3, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [] as string[], immune: [] as string[], susceptible: [] as string[], specialAttacks: [] as string[], specialDefenses: [] as string[],
};
const QMASTER: MobPrototype = { ...base, vnum: 995000, keywords: "questmaster sage", shortDesc: "the questmaster", level: 50, actFlags: ["questmaster"], hpDice: "1d1+0", damDice: "1d1+0" };
const TARGET: MobPrototype = { ...base, vnum: 995001, keywords: "goblin", shortDesc: "a goblin raider", level: 5, actFlags: [], hpDice: "1d1+0", damDice: "1d1+0" };
const BOSS: MobPrototype = { ...base, vnum: 995002, keywords: "ogre", shortDesc: "a hulking ogre", level: 20, actFlags: [], hpDice: "1d1+0", damDice: "1d1+0" };
const SPAWN: Reset = { area: "test", kind: "spawn_mob", mobVnum: TARGET.vnum, roomVnum: ROOM, maxInWorld: 20 };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  for (const m of [QMASTER, TARGET, BOSS]) world.mobPrototypes.set(m.vnum, m);
  world.resets.push(SPAWN); // so assignQuest has a killable candidate to pick
});

function setup(level = 8) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(7));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-0000000quest", accountId: "acc", name: "Seeker", raceId: 0, classId: 3, startRoom: ROOM,
  });
  ch.level = level;
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}

function text(msgs: ServerMessage[]): string {
  return msgs.flatMap((m) => (m.t === "output" ? m.lines.flat().map((s) => s.text) : [])).join("\n");
}

/** Fight `proto` to the death in ROOM. */
function kill(s: ReturnType<typeof setup>, proto: MobPrototype) {
  const mob = spawnMob(proto, ROOM);
  s.live.addMob(mob);
  s.combat.startFight(s.fighter, s.combat.fighterForMob(mob));
  for (let i = 0; i < 100 && mob.hp > 0; i++) s.combat.tick();
  expect(mob.hp).toBeLessThanOrEqual(0);
}

describe("quest assignment", () => {
  it("a questmaster assigns a hunt for a nearby-level mob", () => {
    const s = setup();
    s.live.addMob(spawnMob(QMASTER, ROOM));
    dispatchCommand(s.ctx, "quest request");
    expect(s.ch.quest).toBeTruthy();
    expect(s.ch.quest!.mobVnum).toBe(TARGET.vnum); // closest-level killable candidate
    expect(s.ch.quest!.count).toBeGreaterThanOrEqual(1);
    expect(s.ch.quest!.rewardGlory).toBeGreaterThan(0);
  });

  it("refuses to assign when no questmaster is present", () => {
    const s = setup();
    dispatchCommand(s.ctx, "quest request");
    expect(s.ch.quest).toBeUndefined();
    expect(text(s.received).toLowerCase()).toContain("no questmaster");
  });
});

describe("quest progress + completion", () => {
  it("kills count, and turning it in awards gold + glory and clears the quest", () => {
    const s = setup();
    s.live.addMob(spawnMob(QMASTER, ROOM));
    dispatchCommand(s.ctx, "quest request");
    const q = s.ch.quest!;
    const goldBefore = s.ch.gold, gloryBefore = s.ch.glory;

    for (let i = 0; i < q.count; i++) kill(s, TARGET);
    expect(s.ch.quest!.killed).toBe(q.count);

    dispatchCommand(s.ctx, "quest complete");
    expect(s.ch.quest).toBeUndefined();
    expect(s.ch.gold).toBe(goldBefore + q.count * TARGET.gold + q.rewardGold); // kills' gold + reward
    expect(s.ch.glory).toBe(gloryBefore + q.rewardGlory);
  });

  it("won't complete before the hunt is done", () => {
    const s = setup();
    s.live.addMob(spawnMob(QMASTER, ROOM));
    dispatchCommand(s.ctx, "quest request");
    dispatchCommand(s.ctx, "quest complete");
    expect(s.ch.quest).toBeTruthy(); // still active
    expect(text(s.received).toLowerCase()).toContain("isn't done");
  });
});

describe("glory", () => {
  it("a much tougher kill earns a point of glory", () => {
    const s = setup(8);
    const before = s.ch.glory;
    kill(s, BOSS); // level 20 vs 8 -> glorious
    expect(s.ch.glory).toBe(before + 1);
  });

  it("glory buys practice sessions at a questmaster", () => {
    const s = setup();
    s.live.addMob(spawnMob(QMASTER, ROOM));
    s.ch.glory = GLORY_PER_PRACTICE;
    const practicesBefore = s.ch.practices;
    dispatchCommand(s.ctx, "quest buy practice");
    expect(s.ch.glory).toBe(0);
    expect(s.ch.practices).toBe(practicesBefore + 1);
  });
});
