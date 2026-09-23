/**
 * Progression tuning (systems-spec §2.1/§2.2): kill xp scales with the mob's level so it keeps pace
 * with the level^3 exp curve — higher-level hunting is rewarding, fighting up beats fighting down,
 * and grossly-under-level farming gives scraps. Keeps kills-per-level bounded across the range.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.ts";
import type { MobPrototype } from "../world/model.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter, expToReach } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { PlayerFighter } from "./fighter.ts";
import { spawnMob } from "./mobInstance.ts";
import { Rng } from "./rng.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const foe = (level: number): MobPrototype => ({
  vnum: 999500, area: "test", keywords: "foe", shortDesc: "a foe", longDesc: "", description: "",
  level, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: -200, hpDice: "1d1+0", damDice: "1d1+0",
  gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
});

beforeAll(async () => { world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]); });

/** Exp gained by a level-`charLevel` warrior for killing a level-`mobLevel` mob. */
function killXp(charLevel: number, mobLevel: number): number {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(4));
  const ch = createCharacter(world, { id: "00000000-0000-0000-0000-00000000prog", accountId: "acc", name: "Grinder", raceId: 0, classId: 3, startRoom: ROOM });
  ch.level = charLevel; ch.exp = expToReach(world, ch.classId, charLevel); ch.maxHp = ch.hp = 9999;
  const player: Player = { character: ch, send: () => {} };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, () => {});
  const mob = spawnMob(foe(mobLevel), ROOM);
  mob.hp = mob.maxHp = 1;
  live.addMob(mob);
  const before = ch.exp;
  for (let i = 0; i < 30 && mob.hp > 0; i++) combat.oneHit(fighter, combat.fighterForMob(mob));
  return ch.exp - before;
}

describe("kill xp", () => {
  it("scales up with the mob's level", () => {
    const low = killXp(20, 5);
    const high = killXp(20, 40);
    expect(high).toBeGreaterThan(low * 3); // a L40 mob is worth far more than a L5 one
  });

  it("rewards fighting up over fighting down", () => {
    const up = killXp(20, 28); // +8 levels
    const down = killXp(20, 12); // -8 levels
    expect(up).toBeGreaterThan(down);
  });

  it("gives only scraps for grossly-under-level kills", () => {
    expect(killXp(40, 5)).toBeLessThan(100);
  });

  it("keeps kills-per-level bounded across the range", () => {
    for (const L of [10, 30, 50]) {
      const tnl = expToReach(world, 3, L) - expToReach(world, 3, L - 1); // warrior classId 3
      const perKill = killXp(L, L); // same-level grinding
      const kills = tnl / perKill;
      expect(kills).toBeLessThan(200); // never the old ~1360-kill slog
      expect(kills).toBeGreaterThan(10); // and still a real climb
    }
  });
});
