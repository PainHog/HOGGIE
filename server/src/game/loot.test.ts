/**
 * Loot loop (systems-spec §4.7): a dying mob leaves a corpse holding its carried gear; players
 * loot the corpse into their pack, drop items to the floor and pick them back up, and everything on
 * the ground decays on a timer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { MobPrototype, ObjPrototype } from "../world/model.ts";
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
import { CORPSE_DECAY_MS, GROUND_DECAY_MS } from "./ground.ts";
import { ClanStore } from "./clanStore.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

// A weak mob that carries a dagger — so its corpse has loot to take.
const DAGGER: ObjPrototype = {
  vnum: 993001, area: "test", keywords: "iron dagger", shortDesc: "an iron dagger", description: "", actionDesc: "",
  itemType: "weapon", extraFlags: [], wearFlags: ["take", "wield"], values: [0, 2, 4, 3, 0], weight: 2, cost: 40, affects: [],
};
const RAT: MobPrototype = {
  vnum: 993000, area: "test", keywords: "giant rat", shortDesc: "a giant rat", longDesc: "A giant rat scurries here.",
  description: "", level: 1, alignment: 0, actFlags: [], affectFlags: [], thac0: 20, ac: 100, hpDice: "1d2", damDice: "1d1",
  gold: 7, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
};

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.objPrototypes.set(DAGGER.vnum, DAGGER);
  world.mobPrototypes.set(RAT.vnum, RAT);
  world.mobLoot.set(RAT.vnum, [DAGGER.vnum]); // the rat carries a dagger
});

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(3));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-00000000loot", accountId: "acc", name: "Looter", raceId: 0, classId: 3, startRoom: ROOM,
  });
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}

/** Kill the rat and return the live world afterwards. */
function killRat(s: ReturnType<typeof setup>) {
  const mob = spawnMob(RAT, ROOM);
  s.live.addMob(mob);
  s.combat.startFight(s.fighter, s.combat.fighterForMob(mob));
  for (let i = 0; i < 100 && mob.hp > 0; i++) s.combat.tick();
  expect(mob.hp).toBeLessThanOrEqual(0);
  return mob;
}

describe("a mob leaves a lootable corpse", () => {
  it("drops a corpse holding its gear; gold is auto-collected", () => {
    const s = setup();
    const goldBefore = s.ch.gold;
    killRat(s);
    const corpses = s.live.roomCorpses(ROOM);
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.name).toContain("giant rat");
    expect(corpses[0]!.contents.map((c) => c.vnum)).toEqual([DAGGER.vnum]);
    expect(s.ch.gold).toBe(goldBefore + RAT.gold); // gold picked up automatically
  });

  it("loot moves the gear into the pack and removes the emptied corpse", () => {
    const s = setup();
    killRat(s);
    dispatchCommand(s.ctx, "loot");
    expect(s.ch.inventory.some((it) => it.vnum === DAGGER.vnum)).toBe(true);
    expect(s.live.roomCorpses(ROOM)).toHaveLength(0); // emptied corpse is gone
  });

  it("`get dagger corpse` takes just that item", () => {
    const s = setup();
    killRat(s);
    dispatchCommand(s.ctx, "get dagger corpse");
    expect(s.ch.inventory.filter((it) => it.vnum === DAGGER.vnum)).toHaveLength(1);
  });
});

describe("drop / get on the floor", () => {
  it("drop puts an item on the ground; get picks it back up", () => {
    const s = setup();
    s.ch.inventory.push({ vnum: DAGGER.vnum });
    dispatchCommand(s.ctx, "drop dagger");
    expect(s.ch.inventory.some((it) => it.vnum === DAGGER.vnum)).toBe(false);
    expect(s.live.roomGround(ROOM)).toHaveLength(1);

    dispatchCommand(s.ctx, "get dagger");
    expect(s.ch.inventory.some((it) => it.vnum === DAGGER.vnum)).toBe(true);
    expect(s.live.roomGround(ROOM)).toHaveLength(0);
  });
});

describe("decay", () => {
  it("corpses and dropped items are swept once expired", () => {
    const s = setup();
    killRat(s);
    s.ch.inventory.push({ vnum: DAGGER.vnum });
    dispatchCommand(s.ctx, "drop dagger");
    expect(s.live.roomCorpses(ROOM)).toHaveLength(1);
    expect(s.live.roomGround(ROOM)).toHaveLength(1);

    const now = Date.now();
    // nothing gone yet
    expect(s.live.decayGround(now)).toHaveLength(0);
    // past both timers, everything rots
    const changed = s.live.decayGround(now + Math.max(CORPSE_DECAY_MS, GROUND_DECAY_MS) + 1);
    expect(changed).toHaveLength(1);
    expect(s.live.roomCorpses(ROOM)).toHaveLength(0);
    expect(s.live.roomGround(ROOM)).toHaveLength(0);
  });
});
