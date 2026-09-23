/**
 * Presentation layer (Step 5B): the extra data the visual client needs, proven to be
 * additive-only. The enriched room view, the combat `fx` stream, and click-to-engage
 * must carry the SAME numbers the text already reports and must not change combat outcomes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { CombatFx, ServerMessage } from "@hoggie/shared";
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
import { buildRoomView } from "./view.ts";
import { ClanStore } from "./clanStore.ts";
import { engageMobById, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
});

function makeMob(overrides: Partial<MobPrototype> = {}): MobPrototype {
  return {
    vnum: 999001, area: "test", keywords: "practice dummy", shortDesc: "a practice dummy",
    longDesc: "A practice dummy stands here.", description: "", level: 1, alignment: 500,
    actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d4+4", damDice: "1d3+0",
    gold: 12, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
    resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
    ...overrides,
  };
}

function setup(mobProto: MobPrototype, seed = 12345) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(seed));
  const received: ServerMessage[] = [];
  const character = createCharacter(world, {
    id: "00000000-0000-0000-0000-000000000001",
    accountId: "acc", name: "Fighter", raceId: 0, classId: 3, startRoom: ROOM,
  });
  const player: Player = { character, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(character, world, (m) => received.push(m));
  const mob = spawnMob(mobProto, ROOM);
  live.addMob(mob);
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, character, player, fighter, mob, received, ctx };
}

const fxOf = (received: ServerMessage[]): CombatFx[] =>
  received.filter((m): m is Extract<ServerMessage, { t: "fx" }> => m.t === "fx").map((m) => m.fx);

describe("presentation layer (Step 5B)", () => {
  it("enriched room view exposes mob id/level/hp and structured exits", () => {
    const s = setup(makeMob());
    const view = buildRoomView(s.live, s.player);
    expect(view.mobs).toHaveLength(1);
    const m = view.mobs[0]!;
    expect(m.id).toBe(s.mob.id);
    expect(m.name).toBe("a practice dummy");
    expect(m.level).toBe(1);
    expect(m.hpPct).toBeCloseTo(1); // full health at spawn
    expect(m.position).toBe("standing");
    expect(m.keywords).toEqual(["practice", "dummy"]);
    expect(m.effects).toEqual([]); // spell-ready, empty in v1
    // exits are {dir,toVnum}, not bare strings
    for (const e of view.exits) {
      expect(typeof e.dir).toBe("string");
      expect(typeof e.toVnum).toBe("number");
    }
  });

  it("click-to-engage starts the same fight as `kill`", () => {
    const s = setup(makeMob());
    engageMobById(s.ctx, s.mob.id);
    expect(s.fighter.fighting).toBe(s.combat.fighterForMob(s.mob));
    expect(s.combat.isEngaged(s.fighter)).toBe(true);
  });

  it("engaging an unknown mob id does not start a fight", () => {
    const s = setup(makeMob());
    engageMobById(s.ctx, "no-such-mob");
    expect(s.fighter.fighting).toBeNull();
  });

  it("combat emits fx whose damage matches the mob's actual hp loss", () => {
    const s = setup(makeMob({ hpDice: "1d1+30" }));
    s.combat.startFight(s.fighter, s.combat.fighterForMob(s.mob));
    const startHp = s.mob.hp;
    for (let i = 0; i < 6 && s.mob.hp > 0; i++) s.combat.tick();

    const fx = fxOf(s.received);
    expect(fx.length).toBeGreaterThan(0);
    // every fx names a real fighter and carries a valid 0..1 hp fraction
    for (const f of fx) {
      expect(["hit", "miss", "death"]).toContain(f.kind);
      expect(f.targetHpPct).toBeGreaterThanOrEqual(0);
      expect(f.targetHpPct).toBeLessThanOrEqual(1);
    }
    // the damage the player dealt to the mob, summed from fx, equals the hp it lost
    const dealtToMob = fx
      .filter((f) => f.kind === "hit" && f.sourceId === s.fighter.id && f.targetId === s.mob.id)
      .reduce((sum, f) => sum + f.amount, 0);
    expect(dealtToMob).toBe(startHp - Math.max(0, s.mob.hp));
  });

  it("a killing blow yields a fatal hit fx and a death fx", () => {
    const s = setup(makeMob());
    s.combat.startFight(s.fighter, s.combat.fighterForMob(s.mob));
    let rounds = 0;
    while (s.mob.hp > 0 && rounds < 100) { s.combat.tick(); rounds++; }
    const fx = fxOf(s.received);
    expect(fx.some((f) => f.kind === "hit" && f.fatal && f.targetId === s.mob.id)).toBe(true);
    const death = fx.find((f) => f.kind === "death" && f.targetId === s.mob.id);
    expect(death).toBeDefined();
    expect(death!.targetHpPct).toBe(0);
  });
});
