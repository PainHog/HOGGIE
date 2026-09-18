/**
 * In-game command dispatch. Phase 2 gave movement/presence/social; Phase 3 adds the combat
 * verbs and the stance dial. Movement is free (sector cost is roadmap) but blocked while fighting.
 */
import { parseColorSpans } from "@hoggie/shared";
import type { World } from "../world/world.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { className, raceName } from "./character.ts";
import { mobMatches, mobShort } from "./mobInstance.ts";
import type { CombatManager } from "./combat.ts";
import type { PlayerFighter } from "./fighter.ts";
import { esc, out, sendRoom, sendVitals } from "./view.ts";

export interface CommandContext {
  world: World;
  live: LiveWorld;
  player: Player;
  combat: CombatManager;
  fighter: PlayerFighter;
  quit: () => void;
}

const DIRECTIONS = [
  "north", "east", "south", "west", "up", "down",
  "northeast", "northwest", "southeast", "southwest",
];
const DIR_ALIAS: Record<string, string> = {
  n: "north", e: "east", s: "south", w: "west", u: "up", d: "down",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

const STANCE_CMDS: Record<string, string> = {
  berserk: "berserk", aggressive: "aggressive", defensive: "defensive",
  evasive: "evasive", normal: "standing", stance: "standing",
};

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function dispatchCommand(ctx: CommandContext, raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const word = trimmed.split(/\s+/, 1)[0]!;
  const arg = trimmed.slice(word.length).trim();
  const cmd = word.toLowerCase();

  const dir = DIR_ALIAS[cmd] ?? (DIRECTIONS.includes(cmd) ? cmd : undefined);
  if (dir) return doMove(ctx, dir);
  if (cmd in STANCE_CMDS) return doStance(ctx, cmd, STANCE_CMDS[cmd]!);

  switch (cmd) {
    case "look": case "l": return sendRoom(ctx.live, ctx.player);
    case "say": case "'": return doSay(ctx, arg);
    case "who": return doWho(ctx);
    case "score": case "sc": return doScore(ctx);
    case "kill": case "k": case "attack": return doKill(ctx, arg);
    case "flee": return doFlee(ctx);
    case "consider": case "con": return doConsider(ctx, arg);
    case "rest": return doPosition(ctx, "resting", "You sit down and rest.");
    case "sleep": return doPosition(ctx, "sleeping", "You lie down and go to sleep.");
    case "sit": return doPosition(ctx, "sitting", "You sit down.");
    case "wake": case "stand": return doStand(ctx);
    case "help": return doHelp(ctx);
    case "quit":
      out(ctx.player, "&YFarewell — the world remembers you.&D");
      return ctx.quit();
    default:
      out(ctx.player, "&RHuh?&D  (type &Whelp&D for commands)");
  }
}

function doMove(ctx: CommandContext, dir: string): void {
  if (ctx.fighter.fighting) {
    out(ctx.player, "&RNo way! You are still fighting! (try &Wflee&R)&D");
    return;
  }
  const ch = ctx.player.character;
  if (ch.position === "sleeping") return out(ctx.player, "&RYou can't do that while asleep.&D");
  const room = ctx.world.getRoom(ch.roomVnum);
  const exit = room?.exits.find((e) => e.dir === dir);
  if (!exit) return out(ctx.player, "&RYou can't go that way.&D");
  const dest = ctx.world.getRoom(exit.toVnum);
  if (!dest) return out(ctx.player, "&RThe way leads out of the known world for now.&D");

  if (ch.position !== "standing") ch.position = "standing";
  const from = ch.roomVnum;
  ctx.live.broadcast(from, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} leaves ${dir}.&D`)] }, ctx.player);
  ctx.live.moveTo(ctx.player, exit.toVnum);
  ctx.live.broadcast(exit.toVnum, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} arrives.&D`)] }, ctx.player);
  sendRoom(ctx.live, ctx.player);
}

function doSay(ctx: CommandContext, text: string): void {
  if (!text) return out(ctx.player, "Say what?");
  const ch = ctx.player.character;
  out(ctx.player, `&wYou say, '${esc(text)}'&D`);
  ctx.live.broadcast(ch.roomVnum, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} says, '${esc(text)}'&D`)] }, ctx.player);
}

function doKill(ctx: CommandContext, arg: string): void {
  if (!arg) return out(ctx.player, "Kill whom?");
  if (ctx.fighter.fighting) return out(ctx.player, "&RYou are already fighting!&D");
  const mob = ctx.live.roomMobs(ctx.fighter.roomVnum).find((m) => mobMatches(m, arg));
  if (!mob) return out(ctx.player, "&RThey aren't here.&D");
  const mobF = ctx.combat.fighterForMob(mob);
  ctx.combat.startFight(ctx.fighter, mobF);
  out(ctx.player, `&YYou scream and attack ${esc(mobShort(mob))}!&D`);
  ctx.live.broadcast(
    ctx.fighter.roomVnum,
    { t: "output", lines: [parseColorSpans(`&w${esc(ctx.fighter.name)} attacks ${esc(mobShort(mob))}!&D`)] },
    ctx.player,
  );
}

function doFlee(ctx: CommandContext): void {
  const f = ctx.fighter;
  if (!f.fighting) return out(ctx.player, "You aren't fighting anyone!");
  const room = ctx.world.getRoom(f.roomVnum);
  const exits = (room?.exits ?? []).filter((e) => ctx.world.getRoom(e.toVnum));
  if (exits.length === 0) return out(ctx.player, "&RPANIC! You couldn't escape!&D");
  const exit = exits[Math.floor(Math.random() * exits.length)]!;
  ctx.combat.disengage(f);
  out(ctx.player, "&YYou flee head over heels from the fight!&D");
  ctx.live.broadcast(f.roomVnum, { t: "output", lines: [parseColorSpans(`&w${esc(f.name)} flees ${exit.dir}.&D`)] }, ctx.player);
  ctx.live.moveTo(ctx.player, exit.toVnum);
  ctx.live.broadcast(exit.toVnum, { t: "output", lines: [parseColorSpans(`&w${esc(f.name)} arrives in a panic.&D`)] }, ctx.player);
  sendRoom(ctx.live, ctx.player);
}

function doConsider(ctx: CommandContext, arg: string): void {
  if (!arg) return out(ctx.player, "Consider whom?");
  const mob = ctx.live.roomMobs(ctx.fighter.roomVnum).find((m) => mobMatches(m, arg));
  if (!mob) return out(ctx.player, "&RThey aren't here.&D");
  const diff = mob.proto.level - ctx.fighter.level;
  let msg: string;
  if (diff <= -10) msg = "You could kill it with a harsh word.";
  else if (diff <= -5) msg = "No problem.";
  else if (diff <= -2) msg = "Easy.";
  else if (diff <= 1) msg = "A fair fight.";
  else if (diff <= 4) msg = "You would need some luck!";
  else if (diff <= 9) msg = "You would need a lot of luck and prayers!";
  else msg = "Death will thank you for your gift.";
  out(ctx.player, `&Y${cap(mobShort(mob))} (level ${mob.proto.level}): ${msg}&D`);
}

/** The stance dial (systems-spec §1.1) — settable any time, matters most in combat. */
function doStance(ctx: CommandContext, cmd: string, position: string): void {
  if (cmd === "stance") {
    return out(ctx.player, "&YStances: &Wberserk aggressive normal defensive evasive&D (offense vs defense)");
  }
  ctx.fighter.position = position;
  out(ctx.player, `&YYou shift into a ${cmd === "normal" ? "standing" : cmd} stance.&D`);
  sendVitals(ctx.world, ctx.player);
}

function doPosition(ctx: CommandContext, position: string, msg: string): void {
  if (ctx.fighter.fighting) return out(ctx.player, "&RNot while you're fighting!&D");
  ctx.player.character.position = position;
  out(ctx.player, `&w${msg}&D`);
  sendVitals(ctx.world, ctx.player);
}

function doStand(ctx: CommandContext): void {
  const ch = ctx.player.character;
  if (ch.position === "standing") return out(ctx.player, "You are already standing.");
  ch.position = "standing";
  out(ctx.player, "&wYou stand up.&D");
  sendVitals(ctx.world, ctx.player);
}

function doWho(ctx: CommandContext): void {
  const players = ctx.live.online();
  const lines = [`&Y--- Players online (${players.length}) ---&D`];
  for (const p of players) {
    const c = p.character;
    lines.push(`&w[${String(c.level).padStart(2)}] ${esc(c.name)} the ${raceName(ctx.world, c)} ${className(ctx.world, c)}&D`);
  }
  out(ctx.player, ...lines);
}

function doScore(ctx: CommandContext): void {
  const c = ctx.player.character;
  out(
    ctx.player,
    `&Y${esc(c.name)}&D, level &W${c.level}&D ${raceName(ctx.world, c)} ${className(ctx.world, c)}`,
    `&wHP &G${c.hp}&w/&G${c.maxHp}&D   Mana &C${c.mana}&w/&C${c.maxMana}&D   Move &Y${c.move}&w/&Y${c.maxMove}&D`,
    `&wSTR ${c.stats.str}  INT ${c.stats.int}  WIS ${c.stats.wis}  DEX ${c.stats.dex}  CON ${c.stats.con}  CHA ${c.stats.cha}  &YLCK ${c.stats.lck}&D`,
    `&wGold &Y${c.gold}&D   Exp &G${c.exp}&D   Align ${c.alignment}   Stance ${c.position}&D`,
  );
  sendVitals(ctx.world, ctx.player);
}

function doHelp(ctx: CommandContext): void {
  out(
    ctx.player,
    "&Y--- Commands ---&D",
    "&Wlook&D (l)   move: &Wn s e w u d ne nw se sw&D",
    "&Wkill&D <mob> (k)   &Wflee&D   &Wconsider&D <mob> (con)",
    "&YStances:&D &Wberserk aggressive normal defensive evasive&D  (offense<->defense)",
    "&Wrest sleep sit stand&D (regen when out of combat)",
    "&Wsay&D <text>   &Wwho&D   &Wscore&D (sc)   &Whelp&D   &Wquit&D",
  );
}
