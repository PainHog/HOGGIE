/**
 * In-game command dispatch. Phase 2 gave movement/presence/social; Phase 3 adds the combat
 * verbs and the stance dial. Movement is free (sector cost is roadmap) but blocked while fighting.
 */
import { parseColorSpans } from "@hoggie/shared";
import type { World } from "../world/world.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { className, raceName } from "./character.ts";
import { mobMatches, mobShort, type MobInstance } from "./mobInstance.ts";
import type { CombatManager } from "./combat.ts";
import type { PlayerFighter } from "./fighter.ts";
import { can, canEditVnum, capsFor, ROLE_NAMES, type StaffAccount } from "./roles.ts";
import type { Db } from "../db/repos.ts";
import { esc, out, sendRoom, sendVitals } from "./view.ts";

export interface CommandContext {
  world: World;
  live: LiveWorld;
  player: Player;
  combat: CombatManager;
  fighter: PlayerFighter;
  account: StaffAccount;
  db: Db | null;
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
    case "slist": case "skills": case "spells": return doSkillList(ctx, arg);
    case "kill": case "k": case "attack": return doKill(ctx, arg);
    case "flee": return doFlee(ctx);
    case "consider": case "con": return doConsider(ctx, arg);
    case "rest": return doPosition(ctx, "resting", "You sit down and rest.");
    case "sleep": return doPosition(ctx, "sleeping", "You lie down and go to sleep.");
    case "sit": return doPosition(ctx, "sitting", "You sit down.");
    case "wake": case "stand": return doStand(ctx);
    case "roles": return doRoles(ctx);
    case "help": return doHelp(ctx);
    case "quit":
      out(ctx.player, "&YFarewell — the world remembers you.&D");
      return ctx.quit();

    // --- staff (capability-gated) ---
    case "goto": return staff(ctx, "world.goto", () => doGoto(ctx, arg));
    case "stat": return staff(ctx, "info.stat", () => doStat(ctx, arg));
    case "users": return staff(ctx, "info.users", () => doUsers(ctx));
    case "grant": return staff(ctx, "admin.grant", () => void doGrant(ctx, arg, true));
    case "revoke": return staff(ctx, "admin.grant", () => void doGrant(ctx, arg, false));
    case "setbuilder": return staff(ctx, "admin.grant", () => void doSetBuilder(ctx, arg));
    case "redit": return staff(ctx, "build.redit", () => doRedit(ctx, arg));

    default:
      out(ctx.player, "&RHuh?&D  (type &Whelp&D for commands)");
  }
}

/** Run `fn` if the actor has `capability`, else refuse. */
function staff(ctx: CommandContext, capability: string, fn: () => void): void {
  if (!can(ctx.account.roles, capability)) {
    out(ctx.player, "&RYou lack the authority for that.&D");
    return;
  }
  fn();
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
  beginAttack(ctx, mob);
}

/**
 * Presentation-only: engage a mob by its instance id — the visual client's click-to-engage.
 * Resolves to exactly the fight the `kill` command starts; adds no new combat behaviour.
 */
export function engageMobById(ctx: CommandContext, mobId: string): void {
  if (ctx.fighter.fighting) return out(ctx.player, "&RYou are already fighting!&D");
  const mob = ctx.live.roomMobs(ctx.fighter.roomVnum).find((m) => m.id === mobId);
  if (!mob) return out(ctx.player, "&RThey aren't here.&D");
  beginAttack(ctx, mob);
}

/** Shared attack start used by both `kill <name>` and click-to-engage. */
function beginAttack(ctx: CommandContext, mob: MobInstance): void {
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

/** The class's skill/spell tree: what it learns and at what level (data-driven per class). */
function doSkillList(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  const cls = ctx.world.classes.get(ch.classId);
  if (!cls) return out(ctx.player, "&RYour class has no skill list.&D");
  const all = arg.trim().toLowerCase() === "all";
  const rows = [...cls.skills].sort((a, b) => a.level - b.level || a.skill.localeCompare(b.skill));
  const shown = all ? rows : rows.filter((r) => r.level <= ch.level);
  const CAP = 120;
  const lines = [`&Y--- ${cls.name}: ${all ? "all learnable" : "available now"} (${shown.length}/${rows.length}) ---&D`];
  for (const r of shown.slice(0, CAP)) {
    const def = ctx.world.getSkill(r.skill);
    const kind = def ? def.type.toLowerCase() : "skill";
    const avail = r.level <= ch.level;
    lines.push(`${avail ? "&W" : "&z"}[L${String(r.level).padStart(2)}]&D ${esc(r.skill)} &d(adept ${r.adept}%)&D &c[${kind}]&D`);
  }
  if (shown.length > CAP) lines.push(`&z…and ${shown.length - CAP} more.&D`);
  if (!all && rows.length > shown.length) {
    lines.push(`&Y${rows.length - shown.length} more unlock at higher levels — type 'slist all'.&D`);
  }
  lines.push("&d(Learning/practicing and casting are roadmap — this is the class's skill tree.)&D");
  out(ctx.player, ...lines);
}

function doHelp(ctx: CommandContext): void {
  out(
    ctx.player,
    "&Y--- Commands ---&D",
    "&Wlook&D (l)   move: &Wn s e w u d ne nw se sw&D",
    "&Wkill&D <mob> (k)   &Wflee&D   &Wconsider&D <mob> (con)",
    "&YStances:&D &Wberserk aggressive normal defensive evasive&D  (offense<->defense)",
    "&Wrest sleep sit stand&D (regen when out of combat)",
    "&Wsay&D <text>   &Wwho&D   &Wscore&D (sc)   &Wslist&D [all] (class skills)   &Wroles&D   &Whelp&D   &Wquit&D",
  );
  if (can(ctx.account.roles, "info.stat") || can(ctx.account.roles, "world.goto")) {
    out(
      ctx.player,
      "&Y--- Staff ---&D",
      "&Wgoto&D <vnum>   &Wstat&D [room|mob|player]   &Wusers&D",
      "&Wredit&D <name>   (builder: rename current room, within your range)",
      "&Wgrant&D/&Wrevoke&D <email> <role>   &Wsetbuilder&D <email> <low> <high>   (admin)",
    );
  }
}

function doRoles(ctx: CommandContext): void {
  const roles = ctx.account.roles;
  const caps = roles.includes("admin") ? ["* (all)"] : [...capsFor(roles)];
  out(ctx.player, `&YRoles:&D ${roles.join(", ")}`, `&YCapabilities:&D ${caps.join(", ") || "none"}`);
  if (ctx.account.builderLowVnum != null) {
    out(ctx.player, `&YBuilder range:&D ${ctx.account.builderLowVnum}-${ctx.account.builderHighVnum}`);
  }
}

function doGoto(ctx: CommandContext, arg: string): void {
  const vnum = parseInt(arg, 10);
  if (!Number.isFinite(vnum)) return out(ctx.player, "goto <room vnum>");
  if (!ctx.world.getRoom(vnum)) return out(ctx.player, "&RNo such room is loaded.&D");
  const from = ctx.player.character.roomVnum;
  if (from === vnum) return sendRoom(ctx.live, ctx.player);
  ctx.live.broadcast(from, { t: "output", lines: [parseColorSpans(`&w${esc(ctx.player.character.name)} vanishes in a puff of smoke.&D`)] }, ctx.player);
  ctx.live.moveTo(ctx.player, vnum);
  ctx.live.broadcast(vnum, { t: "output", lines: [parseColorSpans(`&w${esc(ctx.player.character.name)} appears in a puff of smoke.&D`)] }, ctx.player);
  out(ctx.player, `&YYou teleport to room ${vnum}.&D`);
  sendRoom(ctx.live, ctx.player);
}

function doStat(ctx: CommandContext, arg: string): void {
  const vnum = ctx.player.character.roomVnum;
  if (!arg || arg.toLowerCase() === "room") {
    const room = ctx.world.getRoom(vnum);
    if (!room) return out(ctx.player, "&RYou are nowhere.&D");
    return out(
      ctx.player,
      `&Y[Room ${room.vnum}]&D ${esc(room.name)}  &D(&c${room.area}&D)`,
      `&wSector:&D ${room.sector}   &wFlags:&D ${room.roomFlags.join(" ") || "none"}`,
      `&wExits:&D ${room.exits.map((e) => `${e.dir}->${e.toVnum}`).join("  ") || "none"}`,
    );
  }
  const mob = ctx.live.roomMobs(vnum).find((m) => mobMatches(m, arg));
  if (mob) {
    const p = mob.proto;
    return out(
      ctx.player,
      `&Y[Mob ${p.vnum}]&D ${esc(mobShort(mob))}  L${p.level} align ${p.alignment}`,
      `&wHP&D ${mob.hp}/${mob.maxHp}  &wAC&D ${p.ac}  &wdam&D ${p.damDice}  &whitroll&D ${p.hitroll ?? 0}  &wattacks&D ${p.numAttacks ?? 1}`,
      `&wResist:&D ${p.resistant.join(" ") || "-"}  &wImmune:&D ${p.immune.join(" ") || "-"}  &wSuscept:&D ${p.susceptible.join(" ") || "-"}`,
    );
  }
  const target = ctx.live.online().find((pl) => pl.character.name.toLowerCase() === arg.toLowerCase());
  if (target) {
    const c = target.character;
    return out(
      ctx.player,
      `&Y[Player]&D ${esc(c.name)}  L${c.level} ${raceName(ctx.world, c)} ${className(ctx.world, c)}`,
      `&wHP&D ${c.hp}/${c.maxHp}  &wMana&D ${c.mana}/${c.maxMana}  &wroom&D ${c.roomVnum}  &wpos&D ${c.position}`,
      `&wroles:&D ${target.account?.roles.join(", ") ?? "player"}`,
    );
  }
  out(ctx.player, "&RNo such room target, mob here, or player online.&D");
}

function doUsers(ctx: CommandContext): void {
  const online = ctx.live.online();
  const lines = [`&Y--- Users online (${online.length}) ---&D`];
  for (const p of online) {
    lines.push(
      `&w${esc(p.character.name)}&D  L${p.character.level}  room ${p.character.roomVnum}  ` +
        `[${p.account?.roles.join(",") ?? "player"}]  &d${p.account?.email ?? ""}&D`,
    );
  }
  out(ctx.player, ...lines);
}

async function doGrant(ctx: CommandContext, arg: string, add: boolean): Promise<void> {
  if (!ctx.db) return out(ctx.player, "&RAccounts are not configured.&D");
  const [email, role] = arg.split(/\s+/);
  if (!email || !role || !(ROLE_NAMES as readonly string[]).includes(role)) {
    return out(ctx.player, `usage: ${add ? "grant" : "revoke"} <email> <${ROLE_NAMES.join("|")}>`);
  }
  const acct = await ctx.db.getAccountByEmail(email);
  if (!acct) return out(ctx.player, "&RNo such account.&D");
  const roles = new Set(acct.roles);
  if (add) roles.add(role);
  else roles.delete(role);
  if (!roles.has("player")) roles.add("player");
  await ctx.db.setAccountRoles(acct.id, [...roles]);
  out(ctx.player, `&Y${add ? "Granted" : "Revoked"} ${role} ${add ? "to" : "from"} ${email}.&D (takes effect on their next login)`);
}

async function doSetBuilder(ctx: CommandContext, arg: string): Promise<void> {
  if (!ctx.db) return out(ctx.player, "&RAccounts are not configured.&D");
  const [email, lowS, highS] = arg.split(/\s+/);
  const low = parseInt(lowS ?? "", 10);
  const high = parseInt(highS ?? "", 10);
  if (!email || !Number.isFinite(low) || !Number.isFinite(high)) {
    return out(ctx.player, "usage: setbuilder <email> <lowVnum> <highVnum>");
  }
  const acct = await ctx.db.getAccountByEmail(email);
  if (!acct) return out(ctx.player, "&RNo such account.&D");
  const roles = new Set(acct.roles);
  roles.add("builder");
  await ctx.db.setAccountRoles(acct.id, [...roles]);
  await ctx.db.setBuilderRange(acct.id, low, high);
  out(ctx.player, `&YAssigned ${email} the builder role, range ${low}-${high}.&D (takes effect on their next login)`);
}

/** Builder demo: rename the current room, enforcing the vnum sandbox. In-memory only in v1. */
function doRedit(ctx: CommandContext, arg: string): void {
  if (!arg) return out(ctx.player, "redit <new room name>");
  const vnum = ctx.player.character.roomVnum;
  if (!canEditVnum(ctx.account, vnum)) {
    return out(ctx.player, `&RRoom ${vnum} is outside your assigned build range.&D`);
  }
  const room = ctx.world.getRoom(vnum);
  if (!room) return out(ctx.player, "&RNo such room.&D");
  room.name = arg.slice(0, 60);
  out(ctx.player, `&YRoom ${vnum} renamed to "${esc(room.name)}".&D (in-memory; content persistence is roadmap)`);
  sendRoom(ctx.live, ctx.player);
}
