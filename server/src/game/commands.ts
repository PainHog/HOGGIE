/**
 * In-game command dispatch. Phase 2 covers movement, presence, and social/basics. Movement is
 * free here; sector move-cost, doors, and combat come in Phase 3. Widen by adding to the table.
 */
import { parseColorSpans } from "@hoggie/shared";
import type { World } from "../world/world.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { className, raceName } from "./character.ts";
import { esc, out, sendRoom, sendVitals } from "./view.ts";

export interface CommandContext {
  world: World;
  live: LiveWorld;
  player: Player;
  /** Ask the session to disconnect this player (used by `quit`). */
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

export function dispatchCommand(ctx: CommandContext, raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;

  const word = trimmed.split(/\s+/, 1)[0]!;
  const arg = trimmed.slice(word.length).trim();
  const cmd = word.toLowerCase();

  const dir = DIR_ALIAS[cmd] ?? (DIRECTIONS.includes(cmd) ? cmd : undefined);
  if (dir) {
    doMove(ctx, dir);
    return;
  }

  switch (cmd) {
    case "look":
    case "l":
      sendRoom(ctx.live, ctx.player);
      return;
    case "say":
    case "'":
      doSay(ctx, arg);
      return;
    case "who":
      doWho(ctx);
      return;
    case "score":
    case "sc":
      doScore(ctx);
      return;
    case "quit":
      out(ctx.player, "&YFarewell — the world remembers you.&D");
      ctx.quit();
      return;
    case "help":
      doHelp(ctx);
      return;
    default:
      out(ctx.player, "&RHuh?&D  (type &Whelp&D for commands)");
  }
}

function doMove(ctx: CommandContext, dir: string): void {
  const ch = ctx.player.character;
  const room = ctx.world.getRoom(ch.roomVnum);
  const exit = room?.exits.find((e) => e.dir === dir);
  if (!exit) {
    out(ctx.player, "&RYou can't go that way.&D");
    return;
  }
  const dest = ctx.world.getRoom(exit.toVnum);
  if (!dest) {
    out(ctx.player, "&RThe way leads out of the known world for now.&D");
    return;
  }
  const from = ch.roomVnum;
  ctx.live.broadcast(
    from,
    { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} leaves ${dir}.&D`)] },
    ctx.player,
  );
  ctx.live.moveTo(ctx.player, exit.toVnum);
  ctx.live.broadcast(
    exit.toVnum,
    { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} arrives.&D`)] },
    ctx.player,
  );
  sendRoom(ctx.live, ctx.player);
}

function doSay(ctx: CommandContext, text: string): void {
  if (!text) {
    out(ctx.player, "Say what?");
    return;
  }
  const ch = ctx.player.character;
  out(ctx.player, `&wYou say, '${esc(text)}'&D`);
  ctx.live.broadcast(
    ch.roomVnum,
    { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} says, '${esc(text)}'&D`)] },
    ctx.player,
  );
}

function doWho(ctx: CommandContext): void {
  const players = ctx.live.online();
  const lines = [`&Y--- Players online (${players.length}) ---&D`];
  for (const p of players) {
    const c = p.character;
    lines.push(
      `&w[${String(c.level).padStart(2)}] ${esc(c.name)} the ${raceName(ctx.world, c)} ${className(ctx.world, c)}&D`,
    );
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
    `&wGold &Y${c.gold}&D   Exp &G${c.exp}&D   Align ${c.alignment}   Pos ${c.position}&D`,
  );
  sendVitals(ctx.world, ctx.player);
}

function doHelp(ctx: CommandContext): void {
  out(
    ctx.player,
    "&Y--- Commands ---&D",
    "&Wlook&D (l)            look at the room",
    "&Wnorth south east west up down&D  (n s e w u d, plus ne nw se sw) — move",
    "&Wsay&D <text> (')      speak to the room",
    "&Wwho&D                 list players online",
    "&Wscore&D (sc)          your character sheet",
    "&Whelp&D                this help",
    "&Wquit&D                leave the world",
  );
}
