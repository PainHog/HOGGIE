/**
 * Skill learning / practising (systems-spec §2.6): a character's learned% starts at the base when a
 * skill is unlocked, rises when practised at a guildmaster (bounded by the adept cap), and gates
 * spell success — a barely-practised spell usually fizzles.
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
import { BASE_LEARNED, learnedPct, mergedGrants, practiceGain } from "./skills.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

const GUILD: MobPrototype = {
  vnum: 994000, area: "test", keywords: "guildmaster master", shortDesc: "the guildmaster", longDesc: "A stern guildmaster waits here.",
  description: "", level: 50, alignment: 0, actFlags: ["guildmaster"], affectFlags: [], thac0: 0, ac: 0, hpDice: "1d1",
  damDice: "1d1", gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
  resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
};

beforeAll(async () => {
  world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]);
  world.mobPrototypes.set(GUILD.vnum, GUILD);
});

function setup(level = 10) {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(5));
  const received: ServerMessage[] = [];
  const ch = createCharacter(world, {
    id: "00000000-0000-0000-0000-00000000skil", accountId: "acc", name: "Student", raceId: 0, classId: 3, startRoom: ROOM,
  });
  ch.level = level; // so a good spread of skills is unlocked
  const player: Player = { character: ch, send: (m) => received.push(m) };
  live.enter(player);
  const fighter = new PlayerFighter(ch, world, (m) => received.push(m));
  const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
  const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, db: null, quit: () => {} };
  return { live, combat, ch, fighter, received, ctx };
}

/** A skill the character has unlocked at their level, and one not yet unlocked. */
function pickSkills(ch: ReturnType<typeof setup>["ch"]) {
  const grants = [...mergedGrants(world, ch).values()];
  const known = grants.find((g) => g.level <= ch.level && g.adept > BASE_LEARNED + 20);
  const locked = grants.find((g) => g.level > ch.level);
  return { known, locked };
}

describe("learned%", () => {
  it("is the base for an unlocked skill and 0 for a locked one", () => {
    const s = setup();
    const { known, locked } = pickSkills(s.ch);
    expect(known).toBeTruthy();
    expect(learnedPct(world, s.ch, known!.name)).toBe(BASE_LEARNED);
    if (locked) expect(learnedPct(world, s.ch, locked!.name)).toBe(0);
  });
});

describe("practice", () => {
  it("refuses without a guildmaster present", () => {
    const s = setup();
    const { known } = pickSkills(s.ch);
    const before = s.ch.practices;
    dispatchCommand(s.ctx, `practice ${known!.name}`);
    expect(s.ch.practices).toBe(before); // no session spent
    expect(learnedPct(world, s.ch, known!.name)).toBe(BASE_LEARNED); // unchanged
  });

  it("raises learned% and spends a session at a guildmaster", () => {
    const s = setup();
    s.live.addMob(spawnMob(GUILD, ROOM));
    const { known } = pickSkills(s.ch);
    const before = s.ch.practices;
    dispatchCommand(s.ctx, `practice ${known!.name}`);
    expect(s.ch.practices).toBe(before - 1);
    expect(learnedPct(world, s.ch, known!.name)).toBe(Math.min(known!.adept, BASE_LEARNED + practiceGain(s.ch.stats.int)));
  });

  it("stops at the adept cap", () => {
    const s = setup();
    s.live.addMob(spawnMob(GUILD, ROOM));
    const { known } = pickSkills(s.ch);
    s.ch.practices = 999;
    s.ch.proficiencies[known!.name.toLowerCase()] = known!.adept; // already mastered
    const before = s.ch.practices;
    dispatchCommand(s.ctx, `practice ${known!.name}`);
    expect(s.ch.practices).toBe(before); // no session spent when already adept
    expect(learnedPct(world, s.ch, known!.name)).toBe(known!.adept);
  });
});

describe("learned% gates spell success", () => {
  it("a well-practised skill fails far less often than a barely-known one", () => {
    const s = setup();
    let lowFails = 0, highFails = 0;
    for (let i = 0; i < 200; i++) {
      if (s.combat.spellFails(2, 1)) lowFails++;
      if (s.combat.spellFails(2, 95)) highFails++;
    }
    expect(lowFails).toBeGreaterThan(highFails);
    expect(lowFails).toBeGreaterThan(150); // ~always fizzles at 1%
  });
});
