/**
 * Equipment (systems-spec §4.6 & §1.3): interpreting item stats, wearing/wielding gear, and gear
 * affecting combat — worn armour absorbs damage, a wielded weapon sets the damage dice, and apply
 * modifiers fold into hitroll/damroll/stats.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
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
import { equipStats } from "./items.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

// synthetic gear injected into the world's prototype table
const HELM: ObjPrototype = {
  vnum: 991001, area: "test", keywords: "iron helm", shortDesc: "an iron helm", description: "", actionDesc: "",
  itemType: "armor", extraFlags: [], wearFlags: ["take", "head"], values: [15, 0, 0, 0, 0], weight: 5, cost: 100,
  affects: [{ apply: "damroll", modifier: 3 }, { apply: "str", modifier: 1 }],
};
const SWORD: ObjPrototype = {
  vnum: 991002, area: "test", keywords: "iron sword", shortDesc: "an iron sword", description: "", actionDesc: "",
  itemType: "weapon", extraFlags: [], wearFlags: ["take", "wield"], values: [0, 4, 8, 3, 0], weight: 8, cost: 200,
  affects: [{ apply: "hitroll", modifier: 2 }],
};

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.objPrototypes.set(HELM.vnum, HELM);
  world.objPrototypes.set(SWORD.vnum, SWORD);
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(9));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-0000000000eq", accountId: "acc", name: "Knight", raceId: 0, classId: 3, startRoom: ROOM,
  });
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}

describe("item interpretation", () => {
  it("reads armour AC + applies, weighted by slot", () => {
    const st = equipStats(HELM);
    expect(st.slot).toBe("head");
    expect(st.acBonus).toBe(15 * 2); // head slot ×2
    expect(st.mods.damroll).toBe(3);
    expect(st.mods.str).toBe(1);
  });
  it("reads weapon dice + applies", () => {
    const st = equipStats(SWORD);
    expect(st.slot).toBe("wield");
    expect(st.wieldable).toBe(true);
    expect(st.weapon).toEqual({ numDice: 4, sizeDice: 8, damageType: "slash" });
    expect(st.mods.hitroll).toBe(2);
  });
});

describe("wearing gear", () => {
  it("wear moves an item to its slot and folds its stats into combat", () => {
    const s = setup();
    const baseDam = s.fighter.damroll;
    s.ch.inventory.push({ vnum: HELM.vnum });
    dispatchCommand(s.ctx, "wear helm");
    expect(s.ch.equipment.head?.vnum).toBe(HELM.vnum);
    expect(s.ch.inventory.some((it) => it.vnum === HELM.vnum)).toBe(false);
    expect(s.fighter.wornArmor).toBe(30); // AC from the helm
    expect(s.fighter.damroll).toBe(baseDam + 3); // +damroll apply
  });

  it("wield sets the weapon damage dice and type", () => {
    const s = setup();
    s.ch.inventory.push({ vnum: SWORD.vnum });
    dispatchCommand(s.ctx, "wield sword");
    expect(s.ch.equipment.wield?.vnum).toBe(SWORD.vnum);
    expect(s.fighter.damageType).toBe("slash");
    // rollBaseDamage now uses 4d8 (min 4, max 32) — far above the barehand 1d4-ish
    let min = 99, max = 0;
    for (let i = 0; i < 40; i++) { const d = s.fighter.rollBaseDamage(new Rng(i)); min = Math.min(min, d); max = Math.max(max, d); }
    expect(min).toBeGreaterThanOrEqual(4);
    expect(max).toBeGreaterThan(8);
  });

  it("remove returns gear to the pack", () => {
    const s = setup();
    s.ch.inventory.push({ vnum: HELM.vnum });
    dispatchCommand(s.ctx, "wear helm");
    dispatchCommand(s.ctx, "remove helm");
    expect(s.ch.equipment.head).toBeUndefined();
    expect(s.ch.inventory.some((it) => it.vnum === HELM.vnum)).toBe(true);
    expect(s.fighter.wornArmor).toBe(0);
  });
});

describe("armour absorbs damage", () => {
  it("an armoured player takes less than a naked one from the same blows", () => {
    // naked
    const a = setup();
    // armoured with a very protective item
    const b = setup();
    const PLATE: ObjPrototype = { ...HELM, vnum: 991003, keywords: "plate", shortDesc: "heavy plate", wearFlags: ["take", "body"], values: [40, 0, 0, 0, 0], affects: [] };
    world.objPrototypes.set(PLATE.vnum, PLATE);
    b.ch.inventory.push({ vnum: PLATE.vnum });
    dispatchCommand(b.ctx, "wear plate");
    expect(b.fighter.wornArmor).toBe(120); // 40 × body ×3

    // same mob hits each, same seeds → identical rolls; armour absorbs a slice
    const mobProto = { vnum: 992000, area: "t", keywords: "brute", shortDesc: "a brute", longDesc: "", description: "", level: 20, alignment: 0, actFlags: [], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1", damDice: "6d6", gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral", resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [] };
    const nakedStart = a.ch.hp, armStart = b.ch.hp;
    for (const s of [a, b]) {
      const combat = new CombatManager(world, s.live, CONFIG, new Rng(1));
      const mob = { id: "m", proto: mobProto, roomVnum: ROOM, hp: 999, maxHp: 999, position: "standing", spawnRoom: ROOM, affects: [] };
      const mf = combat.fighterForMob(mob as never);
      for (let i = 0; i < 15; i++) combat.oneHit(mf, s.fighter);
    }
    const nakedLost = nakedStart - a.ch.hp;
    const armLost = armStart - b.ch.hp;
    expect(armLost).toBeLessThan(nakedLost); // armour reduced the damage taken
  });
});
