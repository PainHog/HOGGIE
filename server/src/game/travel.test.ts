/**
 * Travel + recovery (systems-spec §3.3/§3.4): `recall` returns you to the hearth (the start room
 * when the temple isn't loaded) but not mid-fight; a `healer` restores vitals and cures afflictions
 * for gold.
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
import { debuffAffect } from "./spellbook.ts";
import { Rng } from "./rng.ts";
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const START = 10300;
// a couple of connected rooms in drazuni to move away from before recalling
let ELSEWHERE: number;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: START, adminEmails: [], supabase: {} };

const HEALER: MobPrototype = {
  vnum: 996000, area: "test", keywords: "healer priest", shortDesc: "a kindly healer", longDesc: "A healer tends the wounded here.",
  description: "", level: 50, alignment: 0, actFlags: ["healer"], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1+0",
  damDice: "1d1+0", gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
};
const FOE: MobPrototype = { ...HEALER, vnum: 996001, keywords: "thug", shortDesc: "a thug", actFlags: [], level: 5 };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.mobPrototypes.set(HEALER.vnum, HEALER);
  world.mobPrototypes.set(FOE.vnum, FOE);
  ELSEWHERE = world.getRoom(START)!.exits.find((e) => world.getRoom(e.toVnum))!.toVnum;
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(4));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-000000travel", accountId: "acc", name: "Wanderer", raceId: 0, classId: 3, startRoom: START,
  });
  ch.level = 10;
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}

describe("recall", () => {
  it("returns you to the hearth (start room when the temple isn't loaded)", () => {
    const s = setup();
    const live = s.live.roomPlayers(START).find((p) => p.character.id === s.ch.id)!;
    s.live.moveTo(live, ELSEWHERE);
    expect(s.ch.roomVnum).toBe(ELSEWHERE);

    dispatchCommand(s.ctx, "recall");
    expect(s.ch.roomVnum).toBe(START); // back at the hearth
  });

  it("refuses while fighting", () => {
    const s = setup();
    const foe = spawnMob(FOE, s.ch.roomVnum);
    s.live.addMob(foe);
    s.combat.startFight(s.fighter, s.combat.fighterForMob(foe));
    const where = s.ch.roomVnum;
    dispatchCommand(s.ctx, "recall");
    expect(s.ch.roomVnum).toBe(where); // didn't move
  });
});

describe("healer", () => {
  it("restores vitals for gold", () => {
    const s = setup();
    s.live.addMob(spawnMob(HEALER, s.ch.roomVnum));
    s.ch.hp = 1; s.ch.mana = 1; s.ch.move = 1; s.ch.gold = 1000;
    dispatchCommand(s.ctx, "heal full");
    expect(s.ch.hp).toBe(s.ch.maxHp);
    expect(s.ch.mana).toBe(s.ch.maxMana);
    expect(s.ch.gold).toBeLessThan(1000); // paid
  });

  it("cures poison for gold", () => {
    const s = setup();
    s.live.addMob(spawnMob(HEALER, s.ch.roomVnum));
    s.ch.gold = 1000;
    s.ch.affects.push(debuffAffect("poison", 20));
    expect(s.ch.affects.some((a) => a.dot)).toBe(true);
    dispatchCommand(s.ctx, "heal cure");
    expect(s.ch.affects.some((a) => a.dot)).toBe(false); // affliction lifted
  });

  it("refuses when no healer is present", () => {
    const s = setup();
    s.ch.gold = 1000;
    const goldBefore = s.ch.gold;
    dispatchCommand(s.ctx, "heal full");
    expect(s.ch.gold).toBe(goldBefore); // nothing charged
  });
});
