/**
 * Player-vs-player (systems-spec §5): attacking another player needs mutual opt-in ('pkill'), is
 * barred in sanctuaries and between clanmates, and is free in arenas. A PvP kill drops the loser's
 * corpse and rewards the victor glory.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import { DEFAULT_CONTENT_DIR } from "../paths.ts";
import { loadWorld } from "../world/loader.ts";
import { World } from "../world/world.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import { createCharacter } from "./character.ts";
import { CombatManager } from "./combat.ts";
import { Economy } from "./economy.ts";
import { PlayerFighter } from "./fighter.ts";
import { Rng } from "./rng.ts";
import { dispatchCommand, type CommandContext } from "./commands.ts";
import type { StaffAccount } from "./roles.ts";

let world: World;
const ROOM = 10300;
const CONFIG: AppConfig = { port: 0, contentDir: "", worldAreas: ["drazuni.are"], startRoom: ROOM, adminEmails: [], supabase: {} };

beforeAll(async () => { world = await loadWorld(DEFAULT_CONTENT_DIR, ["drazuni.are"]); });

function setFlags(flags: string[]) { world.getRoom(ROOM)!.roomFlags = flags; }

function setup() {
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, CONFIG, new Rng(1));
  const mk = (name: string, id: string) => {
    const recv: ServerMessage[] = [];
    const ch = createCharacter(world, { id, accountId: "acc", name, raceId: 0, classId: 3, startRoom: ROOM });
    ch.level = 15; ch.maxHp = ch.hp = 200;
    const fighter = new PlayerFighter(ch, world, (m) => recv.push(m));
    const player: Player = { character: ch, fighter, send: (m) => recv.push(m) };
    live.enter(player);
    const account: StaffAccount = { id: "acc", email: null, roles: ["player"], builderLowVnum: null, builderHighVnum: null };
    const ctx: CommandContext = { world, live, player, combat, economy: new Economy(), fighter, account, config: CONFIG, db: null, quit: () => {} };
    return { ch, fighter, player, recv, ctx };
  };
  return { live, combat, a: mk("Alpha", "00000000-0000-0000-0000-0000000000a1"), b: mk("Bravo", "00000000-0000-0000-0000-0000000000b2") };
}

describe("PvP rules", () => {
  it("refuses when the target hasn't opted in", () => {
    const s = setup(); setFlags([]);
    s.a.ch.pk = true; // only the attacker is flagged
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBeNull();
  });

  it("allows it when both have opted in", () => {
    const s = setup(); setFlags([]);
    s.a.ch.pk = true; s.b.ch.pk = true;
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBe(s.b.fighter);
  });

  it("bars it in a sanctuary even when both opted in", () => {
    const s = setup(); setFlags(["safe"]);
    s.a.ch.pk = true; s.b.ch.pk = true;
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBeNull();
  });

  it("allows it in an arena without opt-in", () => {
    const s = setup(); setFlags(["arena"]);
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBe(s.b.fighter);
  });

  it("never lets clanmates fight", () => {
    const s = setup(); setFlags(["arena"]);
    s.a.ch.clan = { name: "Wolves", rank: "leader" };
    s.b.ch.clan = { name: "Wolves", rank: "member" };
    dispatchCommand(s.a.ctx, "kill Bravo");
    expect(s.a.fighter.fighting).toBeNull();
  });
});

describe("a PvP kill", () => {
  it("drops the loser's corpse and rewards the winner glory", () => {
    const s = setup(); setFlags(["arena"]);
    s.b.ch.maxHp = s.b.ch.hp = 1; // fragile victim
    s.b.ch.inventory = [{ vnum: 5001 }]; s.b.ch.gold = 50;
    const gloryBefore = s.a.ch.glory;
    dispatchCommand(s.a.ctx, "kill Bravo");
    for (let i = 0; i < 60 && s.b.ch.position !== "resting"; i++) s.combat.tick();
    expect(s.b.ch.position).toBe("resting"); // died + respawned
    expect(s.a.ch.glory).toBe(gloryBefore + 2);
    expect(s.live.roomCorpses(ROOM).length).toBeGreaterThanOrEqual(1);
  });
});
