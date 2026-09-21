/**
 * Tier / remort (systems-spec §2.4): `advancetier` at level 50, single-class, >=500k gold swaps
 * into the tier class, resets to level 2, banks exp, grants +20 practices, and keeps earned power.
 * Prereqs are enforced; a tiered character fights at effective level 50 + level/10 with tiny gains.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import type { StaffAccount } from "./roles.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter, effectiveLevel, expToReach, isTiered, type Character } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import { spawnMob } from "./mobInstance.ts";
import { Rng } from "./rng.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

const race = (name: string) => [...world.races.values()].find((r) => r.name === name)!;
const cls = (name: string) => [...world.classes.values()].find((c) => c.name === name)!;

/** A level-50 single-class Warrior with the given gold, plus a context wired to run commands. */
function setup(opts: { className?: string; level?: number; gold?: number; secondName?: string } = {}) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(7));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: randomUUID(), accountId: "acc", name: "Ascend", raceId: race("Human").id,
    classId: cls(opts.className ?? "Warrior").id, secondClassId: opts.secondName ? cls(opts.secondName).id : undefined, startRoom: ROOM,
  });
  ch.level = opts.level ?? 50;
  ch.gold = opts.gold ?? 500_000;
  ch.exp = expToReach(world, ch.classId, ch.level);
  // Give the "level 50" test character a realistic HP pool so it survives combat.
  ch.maxHp = ch.hp = 500;
  ch.maxMove = ch.move = 500;
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}
const text = (received: ServerMessage[]) =>
  received.filter((m): m is Extract<ServerMessage, { t: "output" }> => m.t === "output")
    .flatMap((m) => m.lines.map((l) => l.map((s) => s.text).join(""))).join("\n");

describe("tier: advancetier transition", () => {
  it("swaps to the tier class, resets to level 2, keeps power, +20 practices, spends 500k", () => {
    const s = setup();
    const maxHpBefore = s.ch.maxHp;
    const pracBefore = s.ch.practices;
    const oldExp = s.ch.exp;
    dispatchCommand(s.ctx, "advancetier");

    expect(s.ch.classId).toBe(cls("Champion").id); // Warrior -> Champion
    expect(s.ch.tier).toBe(1);
    expect(isTiered(s.ch)).toBe(true);
    expect(s.ch.level).toBe(2);
    expect(s.ch.gold).toBe(0); // 500k spent
    expect(s.ch.practices).toBe(pracBefore + 20);
    expect(s.ch.tierExp).toBe(oldExp); // old exp banked
    expect(s.ch.maxHp).toBe(maxHpBefore); // earned power kept
    expect(s.ch.dualClassId).toBeUndefined();
    expect(s.ch.exp).toBe(expToReach(world, cls("Champion").id, 2));
  });

  it("a tiered character fights at effective level 50 + level/10", () => {
    const s = setup();
    dispatchCommand(s.ctx, "advancetier"); // now level 2, tier 1
    expect(effectiveLevel(s.ch)).toBe(50); // 50 + floor(2/10)
    expect(s.fighter.level).toBe(50); // combat uses the effective level
    s.ch.level = 50;
    expect(effectiveLevel(s.ch)).toBe(55); // 50 + floor(50/10)
  });
});

describe("tier: prereqs enforced", () => {
  const rejected = (ch: Character, received: ServerMessage[], needle: RegExp) => {
    expect(ch.tier ?? 0).toBe(0); // unchanged
    expect(text(received)).toMatch(needle);
  };

  it("rejects below level 50", () => {
    const s = setup({ level: 49 });
    dispatchCommand(s.ctx, "advancetier");
    rejected(s.ch, s.received, /level 50/i);
  });
  it("rejects a dual-class character", () => {
    const s = setup({ secondName: "Mage" });
    dispatchCommand(s.ctx, "advancetier");
    rejected(s.ch, s.received, /dual-class/i);
  });
  it("rejects without 500k gold", () => {
    const s = setup({ gold: 499_999 });
    dispatchCommand(s.ctx, "advancetier");
    rejected(s.ch, s.received, /gold/i);
  });
});

describe("tier: re-level gains are tiny", () => {
  function makeMob(): MobPrototype {
    return {
      vnum: 999003, area: "test", keywords: "dummy", shortDesc: "a dummy", longDesc: "", description: "",
      level: 1, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1", damDice: "1d1",
      gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
      resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
    };
  }
  it("a tiered character gains only 1-4 HP per level", () => {
    const s = setup();
    dispatchCommand(s.ctx, "advancetier"); // Champion, level 2
    s.ch.exp = expToReach(world, s.ch.classId, 3) - 1; // one kill crosses to level 3
    const maxHpBefore = s.ch.maxHp;
    const mob = spawnMob(makeMob(), ROOM);
    mob.hp = mob.maxHp = 1; // dies in a single blow, so the kill lands before any risk
    s.live.addMob(mob);
    s.combat.startFight(s.fighter, s.combat.fighterForMob(mob));
    for (let i = 0; i < 20 && s.ch.level < 3; i++) s.combat.tick();
    expect(s.ch.level).toBe(3);
    const gain = s.ch.maxHp - maxHpBefore;
    expect(gain).toBeGreaterThanOrEqual(1);
    expect(gain).toBeLessThanOrEqual(4); // tiny tier-track gain
  });
});
