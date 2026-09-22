/**
 * Player death (systems-spec §3.5): dying drops everything you carried into a corpse at the death
 * room and you respawn weak at the temple (the start room when the temple isn't loaded). A newbie
 * (level < 5) keeps their gear. The corpse can be looted to recover gear + gold.
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
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const DAGGER = 5001, HELM = 5002;
const KILLER: MobPrototype = {
  vnum: 998000, area: "test", keywords: "reaper", shortDesc: "the reaper", longDesc: "", description: "",
  level: 40, alignment: 0, actFlags: [], affectFlags: [], thac0: -10, ac: -100, hpDice: "10d10+500", damDice: "5d8+30",
  gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral", hitroll: 50,
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
};

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.mobPrototypes.set(KILLER.vnum, KILLER);
});

function setup(level: number) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(2));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-00000000dead", accountId: "acc", name: "Doomed", raceId: 0, classId: 3, startRoom: ROOM,
  });
  ch.level = level; ch.maxHp = ch.hp = 24;
  ch.inventory = [{ vnum: DAGGER }];
  ch.equipment = { head: { vnum: HELM } };
  ch.gold = 100;
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, clanStore: new ClanStore(null), db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}

/** Let a lethal mob beat the player to death. */
function die(s: ReturnType<typeof setup>) {
  const reaper = spawnMob(KILLER, ROOM);
  s.live.addMob(reaper);
  s.combat.startFight(s.combat.fighterForMob(reaper), s.fighter);
  for (let i = 0; i < 200 && s.ch.position !== "resting"; i++) s.combat.tick();
}

describe("a mortal's death", () => {
  it("drops a corpse with gear + gold and respawns you weak", () => {
    const s = setup(20);
    die(s);
    const corpses = s.live.roomCorpses(ROOM);
    expect(corpses).toHaveLength(1);
    const c = corpses[0]!;
    expect(c.contents.map((it) => it.vnum).sort()).toEqual([DAGGER, HELM]);
    expect(c.gold).toBe(100);
    expect(s.ch.inventory).toHaveLength(0);
    expect(s.ch.equipment).toEqual({});
    expect(s.ch.gold).toBe(0);
    expect(s.ch.position).toBe("resting");
    expect(s.ch.hp).toBe(1);
  });

  it("can be looted to recover everything", () => {
    const s = setup(20);
    die(s);
    dispatchCommand(s.ctx, "loot");
    expect(s.ch.inventory.map((it) => it.vnum).sort()).toEqual([DAGGER, HELM]);
    expect(s.ch.gold).toBe(100);
    expect(s.live.roomCorpses(ROOM)).toHaveLength(0);
  });
});

describe("a newbie's death", () => {
  it("keeps their gear (no corpse) below level 5", () => {
    const s = setup(3);
    die(s);
    expect(s.live.roomCorpses(ROOM)).toHaveLength(0);
    expect(s.ch.inventory).toHaveLength(1); // kept the dagger
    expect(s.ch.equipment.head?.vnum).toBe(HELM); // kept the helm
    expect(s.ch.gold).toBe(100);
    expect(s.ch.position).toBe("resting"); // still respawns
  });
});
