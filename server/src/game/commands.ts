/**
 * In-game command dispatch. Phase 2 gave movement/presence/social; Phase 3 adds the combat
 * verbs and the stance dial. Moving spends `move` by sector cost (scaled by encumbrance) and is
 * blocked while fighting or when too exhausted.
 */
import { parseColorSpans } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { World } from "../world/world.ts";
import type { SkillDef } from "../world/model.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { carryLimits, className, dualClassName, effectiveLevel, expToReach, isTiered, raceName, type ItemInstance } from "./character.ts";
import { mobMatches, mobShort, spawnMob, type MobInstance } from "./mobInstance.ts";
import { corpseMatches, makeCorpse, makeFixedGroundItem, makeGroundItem, type Corpse } from "./ground.ts";
import { setDoorBothSides } from "./doors.ts";
import { moveCost } from "./movement.ts";
import { applyOverride, OLC_FIELDS, type OlcKind } from "./olc.ts";
import { learnedPct, mergedGrants, practiceGain, raiseSkill } from "./skills.ts";
import { assignQuest, FETCH_DEADLINE_MS, GLORY_PER_PRACTICE, isQuestGiver, questExpired, questFulfilled } from "./quest.ts";
import {
  atWar, canManage, CLAN_COST_GLORY, clanNameTaken, clanOnline, clearInvite, declareWar, endWar,
  inviteToClan, pendingInvite, sameClan, validClanName, type ClanRank,
} from "./clans.ts";
import { groupInRoom, groupMembers, isGrouped, isLeader, leaveGroup, sameGroup } from "./groups.ts";
import type { ClanStore } from "./clanStore.ts";
import { RECALL_ROOM, type CombatManager } from "./combat.ts";
import type { Economy } from "./economy.ts";
import { buyPrice, objMatches, sellPrice, shopkeeperIn } from "./shops.ts";
import { applyAffect } from "./affects.ts";
import { buffAffect, spellHeal } from "./spellbook.ts";
import { containerInfo, equipStats, isContainer, totalWeight } from "./items.ts";
import type { Fighter, PlayerFighter } from "./fighter.ts";
import { can, canEditVnum, capsFor, isStaff, ROLE_NAMES, type StaffAccount } from "./roles.ts";
import type { Db } from "../db/repos.ts";
import { esc, out, sendEquipment, sendInventory, sendRoom, sendRoomView, sendSkills, sendVitals } from "./view.ts";

export interface CommandContext {
  world: World;
  live: LiveWorld;
  player: Player;
  combat: CombatManager;
  economy: Economy;
  fighter: PlayerFighter;
  account: StaffAccount;
  config: AppConfig;
  clanStore: ClanStore;
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
    case "look": case "l": case "examine": case "exa": return doLook(ctx, arg);
    case "say": case "'": return doSay(ctx, arg);
    case "who": return doWho(ctx);
    case "score": case "sc": return doScore(ctx);
    case "slist": case "skills": case "spells": return doSkillList(ctx, arg);
    case "practice": case "prac": return void doPractice(ctx, arg);
    case "quest": case "quests": case "glory": return void doQuest(ctx, arg);
    case "cast": case "c": return doCast(ctx, arg);
    case "advancetier": case "remort": return void doAdvanceTier(ctx);
    case "list": return doShopList(ctx);
    case "value": case "appraise": return doValue(ctx, arg);
    case "buy": return void doBuy(ctx, arg);
    case "sell": return void doSell(ctx, arg);
    case "inventory": case "inv": case "i": return sendInventory(ctx.world, ctx.player);
    case "wear": case "wield": case "hold": return doWear(ctx, arg);
    case "remove": case "rem": return doRemove(ctx, arg);
    case "equipment": case "eq": case "equi": return doEquipmentList(ctx);
    case "get": case "take": return doGet(ctx, arg);
    case "put": return doPut(ctx, arg);
    case "drop": return doDrop(ctx, arg);
    case "loot": return doLoot(ctx, arg);
    case "open": return doOpenable(ctx, arg, "open");
    case "close": return doOpenable(ctx, arg, "close");
    case "unlock": return doOpenable(ctx, arg, "unlock");
    case "lock": return doOpenable(ctx, arg, "lock");
    case "kill": case "k": case "attack": return doKill(ctx, arg);
    case "clan": case "clans": return void doClan(ctx, arg);
    case "ctalk": case "clantalk": return doClanTalk(ctx, arg);
    case "pkill": case "pk": return void doPk(ctx);
    case "group": case "follow": return doGroup(ctx, arg);
    case "ungroup": return doUngroup(ctx, arg);
    case "gtell": case "gsay": case "gt": return doGroupTell(ctx, arg);
    case "recall": case "hearth": return doRecall(ctx);
    case "consent": return doConsent(ctx, arg);
    case "heal": return void doHeal(ctx, arg);
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
    case "medit": return staff(ctx, "build.medit", () => doEdit(ctx, "mob", arg));
    case "oedit": return staff(ctx, "build.oedit", () => doEdit(ctx, "obj", arg));
    case "transfer": return staff(ctx, "world.transfer", () => doTransfer(ctx, arg));
    case "load": return staff(ctx, "world.load", () => doLoad(ctx, arg));
    case "purge": return staff(ctx, "world.purge", () => doPurge(ctx));
    case "restore": return staff(ctx, "world.restore", () => doRestore(ctx, arg));
    case "slay": return staff(ctx, "world.slay", () => doSlay(ctx, arg));
    case "echo": return staff(ctx, "world.echo", () => doEcho(ctx, arg));
    case "at": return staff(ctx, "world.at", () => doAt(ctx, arg));
    case "wizinvis": case "invis": return staff(ctx, "world.wizinvis", () => doWizinvis(ctx));

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
  const door = ctx.live.doorAt(ch.roomVnum, dir);
  if (door?.closed) return out(ctx.player, `&RThe ${doorName(exit)} is closed.&D`);
  const dest = ctx.world.getRoom(exit.toVnum);
  if (!dest) return out(ctx.player, "&RThe way leads out of the known world for now.&D");

  // Entry blocks (§3.1): private/solitary rooms have a capacity, and crossing into an area whose
  // hard level range excludes you is barred. Staff walk anywhere. Returns a reason, or null.
  const entryBlock = (character: typeof ch, staff: boolean): string | null => {
    if (staff) return null;
    const occ = ctx.live.roomPlayers(dest.vnum).length;
    if (dest.roomFlags.includes("solitary") && occ >= 1) return "That room is occupied — it holds only one.";
    if (dest.roomFlags.includes("private") && occ >= 2) return "That room is private right now.";
    if (dest.area !== room?.area) {
      const lr = ctx.world.areas.get(dest.area)?.levelRange;
      if (lr) {
        const lvl = effectiveLevel(character);
        if (lvl < lr.hardLow) return "You aren't ready to walk that path yet.";
        if (lvl > lr.hardHigh) return "That path holds nothing more for one of your power.";
      }
    }
    return null;
  };
  const blocked = entryBlock(ch, isStaff(ctx.account.roles));
  if (blocked) return out(ctx.player, `&R${blocked}&D`);

  // Climb exits (§3.1): a failed climb roll means you slip and fall for damage instead of moving.
  const climbExit = (exit.flags ?? []).some((f) => f === "climb" || f === "can_climb");
  const climbFall = (who: Player): boolean => {
    if (isStaff(who.account?.roles ?? [])) return false;
    if (Math.random() * 100 < learnedPct(ctx.world, who.character, "climb")) return false; // made it
    const c = who.character;
    const dam = 2 + Math.floor(Math.random() * (c.level + 1));
    c.hp = Math.max(1, c.hp - dam); // a fall hurts but won't kill outright
    out(who, `&RYou lose your grip and fall, taking ${dam} damage!&D`);
    sendVitals(ctx.world, who);
    return true;
  };
  if (climbExit && climbFall(ctx.player)) return;

  // Each step spends `move` by the room's sector cost, scaled by how loaded you are (§3.1).
  const from = ch.roomVnum;
  const cost = moveCost(room?.sector ?? "inside", currentWeight(ctx), carryLimits(ch).maxWeight);
  if (ch.move < cost) return out(ctx.player, "&RYou are too exhausted to move.&D");
  ch.move -= cost;

  if (ch.position !== "standing") ch.position = "standing";
  ctx.live.broadcast(from, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} leaves ${dir}.&D`)] }, ctx.player);
  ctx.live.moveTo(ctx.player, exit.toVnum);
  ctx.live.broadcast(exit.toVnum, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} arrives.&D`)] }, ctx.player);
  sendRoom(ctx.live, ctx.player);
  sendVitals(ctx.world, ctx.player);

  // A group leader's followers come along — each paying their own move (too-tired ones stay behind).
  if (isLeader(ch)) {
    for (const p of groupInRoom(ctx.live, ch, from)) {
      if (p === ctx.player || p.character.groupLeaderId !== ch.id || p.fighter?.fighting) continue;
      const pc = p.character;
      const pBlock = entryBlock(pc, isStaff(p.account?.roles ?? []));
      if (pBlock) { out(p, `&R${pBlock}&D`); continue; }
      if (climbExit && climbFall(p)) continue; // a follower who slips falls behind
      const pCost = moveCost(room?.sector ?? "inside", currentWeight(ctx, pc), carryLimits(pc).maxWeight);
      if (pc.move < pCost) { out(p, `&RYou are too exhausted to follow ${esc(ch.name)}.&D`); continue; }
      pc.move -= pCost;
      ctx.live.broadcast(from, { t: "output", lines: [parseColorSpans(`&w${esc(pc.name)} leaves ${dir}.&D`)] }, p);
      ctx.live.moveTo(p, exit.toVnum);
      out(p, `&CYou follow ${esc(ch.name)} ${dir}.&D`);
      ctx.live.broadcast(exit.toVnum, { t: "output", lines: [parseColorSpans(`&w${esc(pc.name)} arrives.&D`)] }, p);
      sendRoom(ctx.live, p);
      sendVitals(ctx.world, p);
    }
  }
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
  if (mob) return beginAttack(ctx, mob);
  // No mob by that name — maybe it's another player (PvP).
  const kw = arg.toLowerCase();
  const target = ctx.live.roomPlayers(ctx.fighter.roomVnum)
    .find((p) => p !== ctx.player && p.character.name.toLowerCase().startsWith(kw));
  if (target) return beginPvp(ctx, target);
  out(ctx.player, "&RThey aren't here.&D");
}

/** Why this PvP attack is not allowed (a message), or null if it is (systems-spec §5). */
function pvpBlock(ctx: CommandContext, target: Player): string | null {
  const room = ctx.world.getRoom(ctx.fighter.roomVnum);
  const flags = room?.roomFlags ?? [];
  if (flags.includes("safe")) return "This is a sanctuary — no fighting here.";
  if (sameGroup(ctx.player.character, target.character)) return "You can't attack a groupmate.";
  if (sameClan(ctx.player.character, target.character)) return "You can't raise a hand against a clanmate.";
  if (flags.includes("arena")) return null; // arenas are free-for-all — no opt-in, no level gate
  const myClan = ctx.player.character.clan?.name, theirClan = target.character.clan?.name;
  const atClanWar = !!(myClan && theirClan && atWar(myClan, theirClan));
  // Clan war means enemy clans are fair game without opting in — but everything else still applies.
  if (!atClanWar && (!ctx.player.character.pk || !target.character.pk)) {
    return `${cap(target.character.name)} isn't open to player-combat — both of you need 'pkill' on, or fight in an arena.`;
  }
  // Level-gap protection holds even in war: no ganking fresh recruits.
  if (Math.abs(effectiveLevel(ctx.player.character) - effectiveLevel(target.character)) > 10) {
    return "The gap in power is too great for an honourable duel.";
  }
  return null;
}

/** Start a player-vs-player fight, once the rules allow it. */
function beginPvp(ctx: CommandContext, target: Player): void {
  const block = pvpBlock(ctx, target);
  if (block) return out(ctx.player, `&R${block}&D`);
  if (!target.fighter) return out(ctx.player, "&RYou can't reach them.&D");
  ctx.combat.startFight(ctx.fighter, target.fighter);
  out(ctx.player, `&RYou hurl yourself at ${esc(target.character.name)}!&D`);
  out(target, `&R${cap(ctx.fighter.name)} attacks you!&D`);
  const room = ctx.fighter.roomVnum;
  for (const p of ctx.live.roomPlayers(room)) {
    if (p === ctx.player || p === target) continue;
    out(p, `&w${esc(ctx.fighter.name)} attacks ${esc(target.character.name)}!&D`);
  }
}

/** `pkill` — toggle your opt-in for player-vs-player combat. */
async function doPk(ctx: CommandContext): Promise<void> {
  const ch = ctx.player.character;
  if (ctx.fighter.fighting) return out(ctx.player, "&RNot in the middle of a fight!&D");
  ch.pk = !ch.pk;
  out(ctx.player, ch.pk
    ? "&RYou steel yourself for player-combat. Others who are flagged may now challenge you.&D"
    : "&YYou lower your guard — you can no longer be drawn into player-combat.&D");
  sendVitals(ctx.world, ctx.player);
  if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
}

/** `group` — status; `group <player>` — form/extend a group with a co-located player. */
function doGroup(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  if (!arg.trim()) {
    if (!isGrouped(ch)) return out(ctx.player, "&YYou are not in a group. 'group <player>' (in the same room) to form one.&D");
    const members = groupMembers(ctx.live, ch);
    const lines = ["&C--- Your group ---&D"];
    for (const p of members) {
      const c = p.character;
      const tag = c.groupLeaderId === c.id ? " &Y(leader)&D" : "";
      lines.push(`&C  ${esc(c.name)}${tag} — L${c.level} ${c.hp}/${c.maxHp}hp&D`);
    }
    return out(ctx.player, ...lines);
  }
  const target = ctx.live.roomPlayers(ch.roomVnum).find((p) => p !== ctx.player && p.character.name.toLowerCase().startsWith(arg.trim().toLowerCase()));
  if (!target) return out(ctx.player, "&RThey aren't here.&D");
  const tc = target.character;
  if (isGrouped(ch) && !isLeader(ch)) return out(ctx.player, "&ROnly your group's leader can add members.&D");
  if (tc.groupLeaderId != null) return out(ctx.player, "&RThey're already in a group.&D");
  if (!isGrouped(ch)) ch.groupLeaderId = ch.id; // you become the leader of a new group
  tc.groupLeaderId = ch.id;
  out(ctx.player, `&CYou add ${esc(tc.name)} to your group.&D`);
  out(target, `&C${esc(ch.name)} adds you to their group.&D`);
}

/** `ungroup [player]` — leave your group, or (as leader) remove a member. */
function doUngroup(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  if (!isGrouped(ch)) return out(ctx.player, "&RYou aren't in a group.&D");
  if (!arg.trim()) {
    leaveGroup(ctx.live, ch);
    return out(ctx.player, isLeader(ch) ? "&YYou disband the group.&D" : "&YYou leave the group.&D");
  }
  if (!isLeader(ch)) return out(ctx.player, "&ROnly the leader can remove members.&D");
  const target = groupMembers(ctx.live, ch).find((p) => p !== ctx.player && p.character.name.toLowerCase().startsWith(arg.trim().toLowerCase()));
  if (!target) return out(ctx.player, "&RThey aren't in your group.&D");
  target.character.groupLeaderId = undefined;
  out(ctx.player, `&YYou remove ${esc(target.character.name)} from the group.&D`);
  out(target, "&YYou have been removed from the group.&D");
}

/** `gtell <msg>` — speak to every online group member. */
function doGroupTell(ctx: CommandContext, msg: string): void {
  const ch = ctx.player.character;
  if (!isGrouped(ch)) return out(ctx.player, "&RYou aren't in a group.&D");
  if (!msg.trim()) return out(ctx.player, "Tell the group what?");
  for (const p of groupMembers(ctx.live, ch)) out(p, `&C[group] ${esc(ch.name)}: ${esc(msg)}&D`);
}

/** `ctalk <msg>` — speak to every online member of your clan. */
function doClanTalk(ctx: CommandContext, msg: string): void {
  const ch = ctx.player.character;
  if (!ch.clan) return out(ctx.player, "&RYou aren't in a clan.&D");
  if (!msg.trim()) return out(ctx.player, "Say what to your clan?");
  for (const p of clanOnline(ctx.live, ch.clan.name)) {
    out(p, `&m[${esc(ch.clan.name)}] ${esc(ch.name)}: ${esc(msg)}&D`);
  }
}

/**
 * `clan` — status; `clan create <name>` (costs glory); `clan invite <player>` / `clan accept`;
 * `clan leave`; `clan who` (online members) (systems-spec §5).
 */
async function doClan(ctx: CommandContext, arg: string): Promise<void> {
  const ch = ctx.player.character;
  const parts = arg.trim().split(/\s+/);
  const sub = (parts[0] ?? "").toLowerCase();
  const rest = arg.trim().slice(parts[0]?.length ?? 0).trim();
  const save = () => { if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {}); };

  if (!sub || sub === "status" || sub === "info" || sub === "who") {
    if (!ch.clan) return out(ctx.player, "&YYou are not in a clan. 'clan create <name>' to found one, or wait for an invite.&D");
    const members = clanOnline(ctx.live, ch.clan.name);
    const rankTag = (r?: string) => (r && r !== "member" ? ` &Y(${r})&D` : "");
    const lines = [`&m--- ${esc(ch.clan.name)} ---&D`, `&mYou are its ${ch.clan.rank}. Online members (${members.length}):&D`];
    for (const p of members) lines.push(`&m  ${esc(p.character.name)}${rankTag(p.character.clan?.rank)} — level ${p.character.level}&D`);
    const rec = await ctx.clanStore.get(ch.clan.name);
    const hallName = rec.hallVnum != null ? (ctx.world.getRoom(rec.hallVnum)?.name ?? `room ${rec.hallVnum}`) : "not set";
    lines.push(`&mHall: &W${esc(hallName)}&m   Bank: &W${rec.bank}&m gold&D`);
    lines.push("&d(clan hall / home / deposit <n> / withdraw <n> / roster / invite / kick / promote / war <clan>)&D");
    return out(ctx.player, ...lines);
  }

  if (sub === "roster") {
    if (!ch.clan) return out(ctx.player, "&RYou aren't in a clan.&D");
    if (!ctx.db) { // no DB in this context — fall back to the online roster
      const members = clanOnline(ctx.live, ch.clan.name);
      return out(ctx.player, `&m${esc(ch.clan.name)} online: ${members.map((p) => esc(p.character.name)).join(", ") || "(none)"}&D`);
    }
    const all = await ctx.db.charactersInClan(ch.clan.name).catch(() => []);
    const lines = [`&m--- ${esc(ch.clan.name)} full roster (${all.length}) ---&D`];
    for (const m of all) lines.push(`&m  ${esc(m.name)}${m.rank !== "member" ? ` &Y(${m.rank})&D&m` : ""} — level ${m.level}&D`);
    return out(ctx.player, ...lines);
  }

  if (sub === "create") {
    if (ch.clan) return out(ctx.player, "&RYou're already in a clan — leave it first.&D");
    if (!validClanName(rest)) return out(ctx.player, "&RClan names are 3-20 letters (spaces allowed inside).&D");
    if (clanNameTaken(ctx.live, rest)) return out(ctx.player, "&RA clan by that name already walks the world.&D");
    if (ctx.db && await ctx.db.clanNameExists(rest)) return out(ctx.player, "&RA clan by that name already walks the world.&D"); // catches offline founders too
    if (ch.glory < CLAN_COST_GLORY) return out(ctx.player, `&RFounding a clan costs ${CLAN_COST_GLORY} glory — you have ${ch.glory}.&D`);
    ch.glory -= CLAN_COST_GLORY;
    ch.clan = { name: rest, rank: "leader" };
    out(ctx.player, `&mYou found the clan &W${esc(rest)}&m and take up its banner as leader!&D`);
    sendVitals(ctx.world, ctx.player);
    save();
    return;
  }

  if (sub === "invite") {
    if (!ch.clan || (ch.clan.rank !== "leader" && ch.clan.rank !== "officer")) return out(ctx.player, "&ROnly a clan leader or officer can invite.&D");
    const target = ctx.live.roomPlayers(ch.roomVnum).find((p) => p !== ctx.player && p.character.name.toLowerCase().startsWith(rest.toLowerCase()));
    if (!target) return out(ctx.player, "&RThey aren't here.&D");
    if (target.character.clan) return out(ctx.player, "&RThey already belong to a clan.&D");
    inviteToClan(target.character.id, ch.clan.name);
    out(ctx.player, `&mYou invite ${esc(target.character.name)} to join ${esc(ch.clan.name)}.&D`);
    out(target, `&m${esc(ch.name)} invites you to join the clan &W${esc(ch.clan.name)}&m. Type 'clan accept'.&D`);
    return;
  }

  if (sub === "accept") {
    if (ch.clan) return out(ctx.player, "&RYou're already in a clan.&D");
    const clan = pendingInvite(ch.id);
    if (!clan) return out(ctx.player, "&RYou have no pending clan invite.&D");
    clearInvite(ch.id);
    ch.clan = { name: clan, rank: "member" };
    out(ctx.player, `&mYou join the clan &W${esc(clan)}&m!&D`);
    for (const p of clanOnline(ctx.live, clan)) if (p !== ctx.player) out(p, `&m${esc(ch.name)} has joined the clan.&D`);
    sendVitals(ctx.world, ctx.player);
    save();
    return;
  }

  if (sub === "leave") {
    if (!ch.clan) return out(ctx.player, "&RYou aren't in a clan.&D");
    const name = ch.clan.name;
    ch.clan = undefined;
    out(ctx.player, `&YYou leave the clan ${esc(name)}.&D`);
    for (const p of clanOnline(ctx.live, name)) out(p, `&m${esc(ch.name)} has left the clan.&D`);
    sendVitals(ctx.world, ctx.player);
    save();
    return;
  }

  // --- clan hall + shared bank (persisted clan record) ---
  if (sub === "hall") {
    if (ch.clan?.rank !== "leader") return out(ctx.player, "&ROnly the leader can set the clan hall.&D");
    const rec = await ctx.clanStore.get(ch.clan.name);
    rec.hallVnum = ch.roomVnum;
    await ctx.clanStore.save(rec);
    out(ctx.player, `&mYou consecrate this place as the hall of ${esc(ch.clan.name)}.&D`);
    for (const p of clanOnline(ctx.live, ch.clan.name)) if (p !== ctx.player) out(p, `&mYour clan hall is now ${esc(ctx.world.getRoom(ch.roomVnum)?.name ?? "here")}.&D`);
    return;
  }

  if (sub === "home" || sub === "recall") {
    if (!ch.clan) return out(ctx.player, "&RYou aren't in a clan.&D");
    if (ctx.fighter.fighting) return out(ctx.player, "&RYou can't recall while fighting!&D");
    const rec = await ctx.clanStore.get(ch.clan.name);
    if (rec.hallVnum == null || !ctx.world.getRoom(rec.hallVnum)) return out(ctx.player, "&RYour clan has no hall set (a leader can 'clan hall').&D");
    if (ch.roomVnum === rec.hallVnum) return out(ctx.player, "&YYou are already at the clan hall.&D");
    ctx.live.broadcast(ch.roomVnum, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} vanishes toward their clan hall.&D`)] }, ctx.player);
    ctx.live.moveTo(ctx.player, rec.hallVnum);
    out(ctx.player, "&mThe banner of your clan pulls you home.&D");
    sendRoom(ctx.live, ctx.player);
    return;
  }

  if (sub === "deposit" || sub === "withdraw") {
    if (!ch.clan) return out(ctx.player, "&RYou aren't in a clan.&D");
    const amt = Math.floor(Number(rest));
    if (!Number.isFinite(amt) || amt <= 0) return out(ctx.player, `&R${cap(sub)} how much gold?&D`);
    // Bank moves go through clanStore.mutate so the read-check-write is atomic per clan — two
    // members depositing/withdrawing at once can't lose or duplicate the shared gold.
    let bank = 0;
    if (sub === "deposit") {
      if (ch.gold < amt) return out(ctx.player, `&RYou only have ${ch.gold} gold.&D`);
      ch.gold -= amt; // debit the player before the awaited write; a deposit never fails bank-side
      await ctx.clanStore.mutate(ch.clan.name, (rec) => { rec.bank += amt; bank = rec.bank; });
      out(ctx.player, `&mYou deposit ${amt} gold into the clan bank (balance: ${bank}).&D`);
    } else {
      if (ch.clan.rank === "member") return out(ctx.player, "&ROnly a leader or officer can withdraw from the clan bank.&D");
      let ok = false;
      const err = await ctx.clanStore.mutate(ch.clan.name, (rec) => {
        if (rec.bank < amt) return `The clan bank holds only ${rec.bank} gold.`;
        rec.bank -= amt; bank = rec.bank; ok = true;
      });
      if (err) return out(ctx.player, `&R${err}&D`);
      if (ok) ch.gold += amt;
      out(ctx.player, `&mYou withdraw ${amt} gold from the clan bank (balance: ${bank}).&D`);
    }
    sendVitals(ctx.world, ctx.player);
    if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }

  // The remaining subcommands act on a named clanmate (present online).
  const clanmate = (kw: string) => clanOnline(ctx.live, ch.clan?.name ?? "").find((p) => p !== ctx.player && p.character.name.toLowerCase().startsWith(kw.toLowerCase()));

  if (sub === "kick") {
    if (!ch.clan || (ch.clan.rank !== "leader" && ch.clan.rank !== "officer")) return out(ctx.player, "&ROnly a leader or officer can kick.&D");
    const target = clanmate(rest);
    if (!target) return out(ctx.player, "&RNo clanmate by that name is online.&D");
    if (!canManage(ch.clan.rank, target.character.clan!.rank)) return out(ctx.player, "&RYou can't kick someone of that rank.&D");
    target.character.clan = undefined;
    out(ctx.player, `&YYou expel ${esc(target.character.name)} from ${esc(ch.clan.name)}.&D`);
    out(target, `&RYou have been expelled from the clan.&D`);
    sendVitals(ctx.world, target); if (ctx.db) void ctx.db.saveCharacter(target.character).catch(() => {});
    return;
  }

  if (sub === "promote" || sub === "demote") {
    if (ch.clan?.rank !== "leader") return out(ctx.player, "&ROnly the leader can change ranks.&D");
    const target = clanmate(rest);
    if (!target || !target.character.clan) return out(ctx.player, "&RNo clanmate by that name is online.&D");
    const cur = target.character.clan.rank;
    let next: ClanRank | null = null;
    if (sub === "promote") next = cur === "member" ? "officer" : cur === "officer" ? "leader" : null;
    else next = cur === "leader" ? "officer" : cur === "officer" ? "member" : null;
    if (!next) return out(ctx.player, `&R${esc(target.character.name)} can't be ${sub}d any further.&D`);
    target.character.clan = { name: ch.clan.name, rank: next };
    // Promoting someone to leader hands over the banner — the old leader steps down to officer.
    if (next === "leader") ch.clan = { name: ch.clan.name, rank: "officer" };
    out(ctx.player, `&mYou ${sub} ${esc(target.character.name)} to ${next}.&D`);
    out(target, `&mYou are now a ${next} of ${esc(ch.clan.name)}.&D`);
    if (ctx.db) { void ctx.db.saveCharacter(ch).catch(() => {}); void ctx.db.saveCharacter(target.character).catch(() => {}); }
    return;
  }

  if (sub === "war" || sub === "peace") {
    if (ch.clan?.rank !== "leader") return out(ctx.player, "&ROnly the leader can declare war or peace.&D");
    if (!rest) return out(ctx.player, `${cap(sub)} on which clan?`);
    if (rest.toLowerCase() === ch.clan.name.toLowerCase()) return out(ctx.player, "&RYou can't war your own clan.&D");
    if (sub === "war") { declareWar(ch.clan.name, rest); if (ctx.db) void ctx.db.addClanWar(ch.clan.name, rest).catch(() => {}); out(ctx.player, `&R${esc(ch.clan.name)} is now at WAR with ${esc(rest)}! Their members are fair game anywhere but sanctuaries.&D`); }
    else { endWar(ch.clan.name, rest); if (ctx.db) void ctx.db.removeClanWar(ch.clan.name, rest).catch(() => {}); out(ctx.player, `&Y${esc(ch.clan.name)} makes peace with ${esc(rest)}.&D`); }
    for (const p of clanOnline(ctx.live, ch.clan.name)) if (p !== ctx.player) out(p, sub === "war" ? `&RYour clan is now at war with ${esc(rest)}.&D` : `&YYour clan is at peace with ${esc(rest)}.&D`);
    return;
  }

  out(ctx.player, "&YClan: status · create · invite/accept · leave · roster · kick · promote/demote · war/peace · hall · home · deposit/withdraw <n> · ctalk.&D");
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

/** The recall hub: the temple if it's loaded, else the world's start room (always valid). */
function recallTarget(ctx: CommandContext): number {
  return ctx.world.getRoom(RECALL_ROOM) ? RECALL_ROOM : ctx.config.startRoom;
}

/** `recall` — return to the recall hub from anywhere (not while fighting). Costs a slice of move. */
function doRecall(ctx: CommandContext): void {
  const ch = ctx.player.character;
  if (ctx.fighter.fighting) return out(ctx.player, "&RYou can't recall while fighting!&D");
  const dest = recallTarget(ctx);
  if (ch.roomVnum === dest) return out(ctx.player, "&YYou are already at your hearth.&D");
  if (ch.move < 10) return out(ctx.player, "&RYou're too exhausted to recall — rest first.&D");
  ch.move = Math.max(0, ch.move - 10);
  ctx.live.broadcast(ch.roomVnum, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} disappears in a flash of light.&D`)] }, ctx.player);
  ctx.live.moveTo(ctx.player, dest);
  ch.position = ch.position === "sleeping" ? "resting" : ch.position;
  out(ctx.player, "&YYou pray for transport... the world blurs and you reappear at your hearth.&D");
  ctx.live.broadcast(dest, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} appears in a flash of light.&D`)] }, ctx.player);
  sendRoom(ctx.live, ctx.player);
  sendVitals(ctx.world, ctx.player);
  if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {});
}

/** The healer standing in this room, if any (they mend wounds and cure afflictions for gold). */
function healerHere(ctx: CommandContext): MobInstance | undefined {
  return ctx.live.roomMobs(ctx.player.character.roomVnum).find((m) => m.proto.actFlags.includes("healer"));
}

/** `heal` — at a healer, pay gold to fully restore vitals or cure poison/blindness (§3.4). */
async function doHeal(ctx: CommandContext, arg: string): Promise<void> {
  const ch = ctx.player.character;
  const healer = healerHere(ctx);
  if (!healer) return out(ctx.player, "&RThere's no healer here.&D");
  if (ctx.fighter.fighting) return out(ctx.player, "&RNot in the middle of a fight!&D");
  const fullPrice = Math.max(20, ch.level * 8);
  const curePrice = Math.max(30, ch.level * 12);
  const what = arg.trim().toLowerCase().split(/\s+/)[0] ?? "";

  if (!what || what === "list") {
    return out(ctx.player,
      `&Y--- ${cap(mobShort(healer))}'s services ---&D`,
      `&W  heal full&D  &d(${fullPrice} gold)&D — restore all HP, mana and move`,
      `&W  heal cure&D  &d(${curePrice} gold)&D — lift poison, blindness and curses`,
      `&d(you have ${ch.gold} gold)&D`);
  }

  if (what === "full" || what === "vitals") {
    if (ch.gold < fullPrice) return out(ctx.player, `&RThat costs ${fullPrice} gold — you have ${ch.gold}.&D`);
    ch.gold -= fullPrice;
    ch.hp = ch.maxHp; ch.mana = ch.maxMana; ch.move = ch.maxMove;
    out(ctx.player, `&G${cap(mobShort(healer))} lays hands on you — you are whole again.&D`);
    sendVitals(ctx.world, ctx.player);
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }
  if (what === "cure" || what === "uncurse") {
    if (ch.gold < curePrice) return out(ctx.player, `&RThat costs ${curePrice} gold — you have ${ch.gold}.&D`);
    const before = ch.affects.length;
    ch.affects = ch.affects.filter((a) => a.kind !== "debuff" && !a.dot && !a.blind);
    ch.gold -= curePrice;
    out(ctx.player, before > ch.affects.length
      ? `&G${cap(mobShort(healer))} cleanses the afflictions from your body.&D`
      : `&Y${cap(mobShort(healer))} finds nothing to cure, but takes the fee anyway.&D`);
    sendVitals(ctx.world, ctx.player);
    sendRoom(ctx.live, ctx.player);
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }
  out(ctx.player, "&YHeal what? Try 'heal full' or 'heal cure'.&D");
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
    `&Y${esc(c.name)}&D, level &W${c.level}&D ${raceName(ctx.world, c)} ${className(ctx.world, c)}${dualClassName(ctx.world, c) ? `/${dualClassName(ctx.world, c)}` : ""}${isTiered(c) ? ` &Y[Tier ${c.tier}, eff L${effectiveLevel(c)}]&D` : ""}`,
    `&wHP &G${c.hp}&w/&G${c.maxHp}&D   Mana &C${c.mana}&w/&C${c.maxMana}&D   Move &Y${c.move}&w/&Y${c.maxMove}&D`,
    `&wSTR ${c.stats.str}  INT ${c.stats.int}  WIS ${c.stats.wis}  DEX ${c.stats.dex}  CON ${c.stats.con}  CHA ${c.stats.cha}  &YLCK ${c.stats.lck}&D`,
    `&wGold &Y${c.gold}&D   Exp &G${c.exp}&D   &YGlory ${c.glory}&D   Practices ${c.practices}   Carry &W${currentWeight(ctx)}&w/${carryLimits(c).maxWeight}&D`,
    `&wAlign ${c.alignment}   Stance ${c.position}&D`,
    c.quest
      ? `&wQuest: &Y${(c.quest.type ?? "hunt") === "fetch" ? `fetch ${esc(c.quest.itemName ?? "an item")}` : `${c.quest.killed}/${c.quest.count} ${esc(c.quest.mobName)}`}${questFulfilled(c.quest, c) ? " (done — turn in)" : ""}&D`
      : "&wQuest: &dnone (ask a questmaster)&D",
    `&wClan: ${c.clan ? `&m${esc(c.clan.name)} (${c.clan.rank})` : "&dnone"}&D   PvP: ${c.pk ? "&Ron" : "&doff"}&D`,
  );
  sendVitals(ctx.world, ctx.player);
}

const MAX_BUY = 20;

/** `list`: the shopkeeper's wares with CHA-adjusted buy prices. */
function doShopList(ctx: CommandContext): void {
  const ch = ctx.player.character;
  const keeper = shopkeeperIn(ctx.world, ctx.live, ch.roomVnum);
  if (!keeper) return out(ctx.player, "&RThere is no shopkeeper here.&D");
  const stock = ctx.world.shopStock.get(keeper.shop.keeperVnum) ?? [];
  if (stock.length === 0) return out(ctx.player, `&Y${cap(mobShort(keeper.mob))} has nothing for sale.&D`);
  const lines = [`&Y--- ${cap(mobShort(keeper.mob))}'s wares ---&D`, "&d  price  item&D"];
  for (const vnum of stock) {
    const p = ctx.world.getObjPrototype(vnum);
    if (!p) continue;
    lines.push(`&W${String(buyPrice(p, keeper.shop, ch.stats.cha)).padStart(7)}&D  ${esc(p.shortDesc)} &d[${p.itemType}]&D`);
  }
  lines.push("&d(buy <item> [n], sell <item>, value <item> — haggle with CHA)&D");
  out(ctx.player, ...lines);
}

/** `value <item>`: what a carried item sells for, or what a stocked item costs. */
function doValue(ctx: CommandContext, arg: string): void {
  if (!arg) return out(ctx.player, "Value what?");
  const ch = ctx.player.character;
  const keeper = shopkeeperIn(ctx.world, ctx.live, ch.roomVnum);
  if (!keeper) return out(ctx.player, "&RThere is no shopkeeper here.&D");
  const owned = ch.inventory.find((it) => matchInv(ctx, it.vnum, arg));
  if (owned) {
    const p = ctx.world.getObjPrototype(owned.vnum)!;
    const sp = sellPrice(p, keeper.shop, ch.stats.cha);
    return out(ctx.player, sp > 0
      ? `&YYou could sell ${esc(p.shortDesc)} for &W${sp}&Y gold.&D`
      : `&R${cap(mobShort(keeper.mob))} doesn't trade ${p.itemType}.&D`);
  }
  const stockVnum = (ctx.world.shopStock.get(keeper.shop.keeperVnum) ?? []).find((v) => matchInv(ctx, v, arg));
  if (stockVnum != null) {
    const p = ctx.world.getObjPrototype(stockVnum)!;
    return out(ctx.player, `&YIt costs &W${buyPrice(p, keeper.shop, ch.stats.cha)}&Y gold to buy ${esc(p.shortDesc)}.&D`);
  }
  out(ctx.player, "&RThere's nothing like that here or in your pack.&D");
}

/** `buy <item> [n]`: pay gold (into the area pool) and take the item(s). */
async function doBuy(ctx: CommandContext, arg: string): Promise<void> {
  const ch = ctx.player.character;
  const keeper = shopkeeperIn(ctx.world, ctx.live, ch.roomVnum);
  if (!keeper) return out(ctx.player, "&RThere is no shopkeeper here.&D");
  const [kw, nStr] = arg.split(/\s+/);
  if (!kw) return out(ctx.player, "Buy what?");
  const qty = Math.max(1, Math.min(MAX_BUY, parseInt(nStr ?? "1", 10) || 1));
  const vnum = (ctx.world.shopStock.get(keeper.shop.keeperVnum) ?? []).find((v) => matchInv(ctx, v, kw));
  if (vnum == null) return out(ctx.player, `&R${cap(mobShort(keeper.mob))} doesn't sell that.&D`);
  const p = ctx.world.getObjPrototype(vnum)!;
  const total = buyPrice(p, keeper.shop, ch.stats.cha) * qty;
  if (ch.gold < total) return out(ctx.player, `&RYou can't afford that — ${total} gold for ${qty} (you have ${ch.gold}).&D`);
  const { maxWeight, maxItems } = carryLimits(ch);
  if (ch.inventory.length + qty > maxItems || currentWeight(ctx) + Math.max(0, p.weight) * qty > maxWeight) {
    return out(ctx.player, "&RYou couldn't carry that — too heavy or too full.&D");
  }
  ch.gold -= total;
  for (let i = 0; i < qty; i++) ch.inventory.push({ vnum });
  const area = ctx.world.getRoom(ch.roomVnum)?.area;
  if (area) ctx.economy.deposit(area, total); // buying pours gold into the area pool
  out(ctx.player, `&YYou buy ${qty > 1 ? `${qty} x ` : ""}${esc(p.shortDesc)} for &W${total}&Y gold.&D`);
  sendVitals(ctx.world, ctx.player);
  sendInventory(ctx.world, ctx.player);
  if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
}

/** `sell <item>`: give a carried item, get gold from the area pool (capped at the pool). */
async function doSell(ctx: CommandContext, arg: string): Promise<void> {
  const ch = ctx.player.character;
  if (!arg) return out(ctx.player, "Sell what?");
  const keeper = shopkeeperIn(ctx.world, ctx.live, ch.roomVnum);
  if (!keeper) return out(ctx.player, "&RThere is no shopkeeper here.&D");
  const idx = ch.inventory.findIndex((it) => matchInv(ctx, it.vnum, arg));
  if (idx < 0) return out(ctx.player, "&RYou aren't carrying that.&D");
  const p = ctx.world.getObjPrototype(ch.inventory[idx]!.vnum)!;
  const price = sellPrice(p, keeper.shop, ch.stats.cha);
  if (price <= 0) return out(ctx.player, `&R${cap(mobShort(keeper.mob))} doesn't trade ${p.itemType}.&D`);
  const area = ctx.world.getRoom(ch.roomVnum)?.area;
  if (area && !ctx.economy.canCover(area, price)) {
    return out(ctx.player, "&RThe local economy is too drained to cover that sale.&D");
  }
  const paid = area ? ctx.economy.withdraw(area, price) : price; // selling pulls gold out of the pool
  ch.inventory.splice(idx, 1);
  ch.gold += paid;
  out(ctx.player, `&YYou sell ${esc(p.shortDesc)} for &W${paid}&Y gold.&D`);
  sendVitals(ctx.world, ctx.player);
  sendInventory(ctx.world, ctx.player);
  if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
}

/** Match a keyword against an object prototype by vnum. */
function matchInv(ctx: CommandContext, vnum: number, kw: string): boolean {
  const p = ctx.world.getObjPrototype(vnum);
  return !!p && objMatches(p, kw);
}

const SLOT_LABEL: Record<string, string> = {
  wield: "wielded", dual_wield: "dual-wielded", hold: "held", light: "as a light",
};
const short = (ctx: CommandContext, vnum: number) => ctx.world.getObjPrototype(vnum)?.shortDesc ?? `item ${vnum}`;

/** Current weight a character carries (pack + worn gear + any container contents). */
function currentWeight(ctx: CommandContext, ch: { inventory: ItemInstance[]; equipment: Record<string, ItemInstance> } = ctx.player.character): number {
  const getP = (v: number) => ctx.world.getObjPrototype(v);
  return totalWeight(ch.inventory, getP) + totalWeight(Object.values(ch.equipment), getP);
}

/** Can the character pick up one more item without overloading? Weighs the full instance so a
 *  stuffed bag counts its contents, not just the container (systems-spec §4.6). */
function canCarryMore(ctx: CommandContext, item: ItemInstance): boolean {
  const ch = ctx.player.character;
  const { maxWeight, maxItems } = carryLimits(ch);
  if (ch.inventory.length >= maxItems) return false;
  const w = totalWeight([item], (v) => ctx.world.getObjPrototype(v));
  return currentWeight(ctx) + w <= maxWeight;
}

function pushGear(ctx: CommandContext): void {
  sendEquipment(ctx.world, ctx.player);
  sendInventory(ctx.world, ctx.player);
  sendVitals(ctx.world, ctx.player);
  if (ctx.db) void ctx.db.saveCharacter(ctx.player.character).catch(() => {});
}

/** `wear/wield <item>` — equip a carried item into its slot (auto-swapping whatever is there). */
function doWear(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  if (!arg) return out(ctx.player, "Wear what?");
  const idx = ch.inventory.findIndex((it) => matchInv(ctx, it.vnum, arg));
  if (idx < 0) return out(ctx.player, "&RYou aren't carrying that.&D");
  const it = ch.inventory[idx]!;
  const proto = ctx.world.getObjPrototype(it.vnum)!;
  const st = equipStats(proto);
  if (!st.slot) return out(ctx.player, `&RYou can't wear ${esc(proto.shortDesc)}.&D`);
  // free the slot if occupied
  const current = ch.equipment[st.slot];
  if (current) { ch.inventory.push(current); delete ch.equipment[st.slot]; }
  ch.inventory.splice(idx, 1);
  ch.equipment[st.slot] = it;
  const how = SLOT_LABEL[st.slot] ?? `on your ${st.slot}`;
  out(ctx.player, `&YYou ${st.wieldable ? "wield" : "wear"} ${esc(proto.shortDesc)} ${how}.&D`);
  pushGear(ctx);
}

/** `remove <item>` — take off equipped gear back into your pack. */
function doRemove(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  if (!arg) return out(ctx.player, "Remove what?");
  const slot = Object.keys(ch.equipment).find((s) => {
    const ref = ch.equipment[s]!;
    return matchInv(ctx, ref.vnum, arg);
  });
  if (!slot) return out(ctx.player, "&RYou aren't using that.&D");
  const ref = ch.equipment[slot]!;
  delete ch.equipment[slot];
  ch.inventory.push(ref);
  out(ctx.player, `&YYou stop using ${esc(short(ctx, ref.vnum))}.&D`);
  pushGear(ctx);
}

/** `equipment` — list what you have worn/wielded. */
function doEquipmentList(ctx: CommandContext): void {
  const eq = ctx.player.character.equipment;
  const slots = Object.keys(eq);
  if (!slots.length) return out(ctx.player, "&YYou are wielding and wearing nothing.&D");
  const lines = ["&Y--- Equipment ---&D"];
  for (const slot of slots) lines.push(`&d<${slot.padEnd(10)}>&D ${esc(short(ctx, eq[slot]!.vnum))}`);
  out(ctx.player, ...lines);
}

/** After a ground change: refresh the pack + the (silent) room scene and persist. */
function afterGround(ctx: CommandContext): void {
  sendInventory(ctx.world, ctx.player);
  sendRoomView(ctx.live, ctx.player);
  if (ctx.db) void ctx.db.saveCharacter(ctx.player.character).catch(() => {});
}

/** `get <item>` / `get <item> <corpse>` / `get all [corpse]` — pick up loose items or loot a corpse. */
function doGet(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  if (!arg) return out(ctx.player, "Get what?");
  const parts = arg.split(/\s+/);
  const whatKw = parts[0]!.toLowerCase();
  const containerKw = parts.slice(1).join(" ").trim();

  // `get <x> <corpse|container>` — take from a named corpse or a carried container
  if (containerKw) {
    const corpse = ctx.live.roomCorpses(ch.roomVnum).find((c) => corpseMatches(c, containerKw));
    if (corpse) return takeFromCorpse(ctx, corpse, whatKw);
    const cont = findCarriedContainer(ctx, containerKw);
    if (cont) return getFromContainer(ctx, cont, whatKw);
    return out(ctx.player, "&RYou don't see that here.&D");
  }
  // `get corpse` — loot the nearest corpse whole
  if (whatKw === "corpse") {
    const corpse = ctx.live.roomCorpses(ch.roomVnum)[0];
    if (!corpse) return out(ctx.player, "&RThere's no corpse here.&D");
    return takeFromCorpse(ctx, corpse, "all");
  }

  // otherwise pick up loose items off the floor
  const ground = ctx.live.roomGround(ch.roomVnum);
  if (ground.length === 0) return out(ctx.player, "&RThere's nothing here to get.&D");
  const wantAll = whatKw === "all";
  const targets = wantAll ? [...ground] : ground.filter((g) => matchInv(ctx, g.item.vnum, whatKw)).slice(0, 1);
  if (targets.length === 0) return out(ctx.player, "&RYou don't see that here.&D");
  let got = 0, blocked = false;
  for (const g of targets) {
    if (!canCarryMore(ctx, g.item)) { blocked = true; break; }
    const taken = ctx.live.takeGround(ch.roomVnum, g.id);
    if (!taken) continue;
    ch.inventory.push(taken.item); // keep the full instance — nested contents survive the round-trip
    out(ctx.player, `&YYou pick up ${esc(short(ctx, taken.item.vnum))}.&D`);
    got++;
  }
  if (blocked) out(ctx.player, "&RYou can't carry any more — too heavy or too full.&D");
  if (got > 0) afterGround(ctx);
}

/** `loot [corpse]` — take everything from a corpse (the loot-loop shortcut). */
function doLoot(ctx: CommandContext, arg: string): void {
  const corpses = ctx.live.roomCorpses(ctx.player.character.roomVnum);
  if (corpses.length === 0) return out(ctx.player, "&RThere's no corpse here to loot.&D");
  const corpse = arg ? corpses.find((c) => corpseMatches(c, arg)) : corpses[0];
  if (!corpse) return out(ctx.player, "&RYou don't see that corpse here.&D");
  takeFromCorpse(ctx, corpse, "all");
}

/** Move matching items (or all) out of a corpse into the pack; the corpse is dropped once emptied. */
function takeFromCorpse(ctx: CommandContext, corpse: Corpse, whatKw: string): void {
  const ch = ctx.player.character;
  const wantAll = !whatKw || whatKw === "all";
  const keep: ItemInstance[] = [];
  let took = 0, blocked = false;
  for (const it of corpse.contents) {
    const want = (wantAll || matchInv(ctx, it.vnum, whatKw)) && (wantAll || took === 0);
    if (!want) { keep.push(it); continue; }
    if (!canCarryMore(ctx, it)) { keep.push(it); blocked = true; continue; }
    ch.inventory.push(it); // push as we go so the carry check sees the growing load
    out(ctx.player, `&YYou get ${esc(short(ctx, it.vnum))} from ${esc(corpse.name)}.&D`);
    took++;
  }
  // Looting the whole corpse also scoops up any coins inside it (gold has no weight).
  let gotGold = 0;
  if (wantAll && corpse.gold > 0) { gotGold = corpse.gold; ch.gold += corpse.gold; corpse.gold = 0; }
  if (took === 0 && gotGold === 0) return out(ctx.player, blocked ? "&RYou can't carry any more — too heavy or too full.&D" : `&RThere's nothing like that in ${esc(corpse.name)}.&D`);
  corpse.contents = keep;
  if (blocked) out(ctx.player, "&RYou can't carry any more — the rest stays behind.&D");
  if (gotGold > 0) out(ctx.player, `&YYou get ${gotGold} gold coins from ${esc(corpse.name)}.&D`);
  if (corpse.contents.length === 0 && corpse.gold === 0) ctx.live.removeCorpse(ch.roomVnum, corpse.id);
  afterGround(ctx);
  if (gotGold > 0) sendVitals(ctx.world, ctx.player);
}

/** `drop <item>` / `drop all` — put carried items on the floor (they decay after a while). */
function doDrop(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  if (!arg) return out(ctx.player, "Drop what?");
  const kw = arg.toLowerCase();
  const wantAll = kw === "all";
  const idxs = wantAll
    ? ch.inventory.map((_, i) => i)
    : (() => { const i = ch.inventory.findIndex((it) => matchInv(ctx, it.vnum, kw)); return i >= 0 ? [i] : []; })();
  if (idxs.length === 0) return out(ctx.player, "&RYou aren't carrying that.&D");
  const dropped: ItemInstance[] = [];
  for (const i of idxs.sort((a, b) => b - a)) { // splice back-to-front so indices stay valid
    const [it] = ch.inventory.splice(i, 1);
    if (it) dropped.push(it);
  }
  for (const it of dropped.reverse()) {
    ctx.live.addGround(ch.roomVnum, makeGroundItem(it)); // full instance — a dropped bag keeps its contents
    out(ctx.player, `&YYou drop ${esc(short(ctx, it.vnum))}.&D`);
  }
  afterGround(ctx);
}

// --- containers (bags/chests) -------------------------------------------------

/** Find a carried container item matching a keyword. */
function findCarriedContainer(ctx: CommandContext, kw: string): ItemInstance | undefined {
  return ctx.player.character.inventory.find((it) => {
    const p = ctx.world.getObjPrototype(it.vnum);
    return !!p && isContainer(p) && objMatches(p, kw);
  });
}

/** Take matching item(s) out of a carried container into the pack. */
function getFromContainer(ctx: CommandContext, container: ItemInstance, whatKw: string): void {
  const ch = ctx.player.character;
  if (container.closed) return out(ctx.player, `&R${cap(short(ctx, container.vnum))} is closed.&D`);
  const inside = container.contents ?? [];
  if (inside.length === 0) return out(ctx.player, `&R${cap(short(ctx, container.vnum))} is empty.&D`);
  const wantAll = !whatKw || whatKw === "all";
  const taken: ItemInstance[] = [];
  const keep: ItemInstance[] = [];
  for (const it of inside) {
    const match = wantAll || matchInv(ctx, it.vnum, whatKw);
    if (match && (wantAll || taken.length === 0)) taken.push(it);
    else keep.push(it);
  }
  if (taken.length === 0) return out(ctx.player, `&RThere's nothing like that in ${esc(short(ctx, container.vnum))}.&D`);
  container.contents = keep;
  for (const it of taken) {
    ch.inventory.push(it);
    out(ctx.player, `&YYou get ${esc(short(ctx, it.vnum))} from ${esc(short(ctx, container.vnum))}.&D`);
  }
  sendInventory(ctx.world, ctx.player);
  if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {});
}

/** `put <item> <container>` — stow a carried item inside a carried container. */
function doPut(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  const parts = arg.trim().split(/\s+/);
  const whatKw = (parts[0] ?? "").toLowerCase();
  const containerKw = parts.slice(1).join(" ").trim();
  if (!whatKw || !containerKw) return out(ctx.player, "Put what in what? (put <item> <container>)");
  const container = findCarriedContainer(ctx, containerKw);
  if (!container) return out(ctx.player, "&RYou aren't carrying a container like that.&D");
  if (container.closed) return out(ctx.player, `&R${cap(short(ctx, container.vnum))} is closed.&D`);
  const info = containerInfo(ctx.world.getObjPrototype(container.vnum)!);
  const room = info.maxItems - (container.contents?.length ?? 0);
  if (room <= 0) return out(ctx.player, `&R${cap(short(ctx, container.vnum))} is full.&D`);
  const wantAll = whatKw === "all";
  // `put all <bag>` stows every non-container item that fits; `put <item> <bag>` stows one.
  const matches = ch.inventory
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it !== container &&
      (wantAll ? !isContainer(ctx.world.getObjPrototype(it.vnum)!) : matchInv(ctx, it.vnum, whatKw)));
  const toStow = matches.slice(0, wantAll ? room : 1);
  if (toStow.length === 0) return out(ctx.player, "&RYou aren't carrying that.&D");
  for (const { i } of [...toStow].sort((a, b) => b.i - a.i)) ch.inventory.splice(i, 1); // back-to-front
  container.contents ??= [];
  for (const { it } of toStow) {
    container.contents.push(it);
    out(ctx.player, `&YYou put ${esc(short(ctx, it.vnum))} in ${esc(short(ctx, container.vnum))}.&D`);
  }
  if (wantAll && matches.length > room) out(ctx.player, `&R${cap(short(ctx, container.vnum))} is now full — the rest won't fit.&D`);
  sendInventory(ctx.world, ctx.player);
  if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {});
}

/** `open`/`close`/`lock`/`unlock` <container> — manage a closeable/lockable carried container. */
/** A door exit's short name, for messages ("the gate is closed"). */
function doorName(exit: { keyword?: string }): string {
  return exit.keyword?.split(/\s+/)[0] ?? "door";
}

/** Route open/close/lock/unlock: a direction with a door there → the door; otherwise a carried container. */
function doOpenable(ctx: CommandContext, arg: string, action: "open" | "close" | "lock" | "unlock"): void {
  const kw = arg.trim().toLowerCase();
  const dir = DIR_ALIAS[kw] ?? (DIRECTIONS.includes(kw) ? kw : undefined);
  if (dir && ctx.live.doorAt(ctx.player.character.roomVnum, dir)) return doDoor(ctx, dir, action);
  return doContainerState(ctx, arg, action);
}

/** Open/close/lock/unlock a door on a room exit (two-sided; lock/unlock need the key in the pack). */
function doDoor(ctx: CommandContext, dir: string, action: "open" | "close" | "lock" | "unlock"): void {
  const ch = ctx.player.character;
  const exit = ctx.world.getRoom(ch.roomVnum)?.exits.find((e) => e.dir === dir);
  const state = exit && ctx.live.doorAt(ch.roomVnum, dir);
  if (!exit || !state) return out(ctx.player, "&RThere's no door that way.&D");
  const name = doorName(exit);
  const announce = (verb: string) =>
    ctx.live.broadcast(ch.roomVnum, { t: "output", lines: [parseColorSpans(`&w${esc(ch.name)} ${verb} the ${esc(name)} ${dir}.&D`)] }, ctx.player);

  if (action === "open") {
    if (state.locked) return out(ctx.player, `&RThe ${name} is locked.&D`);
    if (!state.closed) return out(ctx.player, `&YThe ${name} is already open.&D`);
    setDoorBothSides(ctx.live, ch.roomVnum, dir, { closed: false, locked: false });
    out(ctx.player, `&YYou open the ${name}.&D`); announce("opens");
  } else if (action === "close") {
    if (state.closed) return out(ctx.player, `&YThe ${name} is already closed.&D`);
    setDoorBothSides(ctx.live, ch.roomVnum, dir, { closed: true, locked: state.locked });
    out(ctx.player, `&YYou close the ${name}.&D`); announce("closes");
  } else { // lock / unlock — needs the matching key in the pack
    const keyVnum = exit.keyVnum ?? 0;
    if (keyVnum <= 0) return out(ctx.player, `&RThe ${name} has no lock.&D`);
    if (!state.closed) return out(ctx.player, `&RClose the ${name} first.&D`);
    if (!ch.inventory.some((it) => it.vnum === keyVnum)) return out(ctx.player, "&RYou don't have the key.&D");
    if (action === "lock") { setDoorBothSides(ctx.live, ch.roomVnum, dir, { closed: true, locked: true }); out(ctx.player, `&YYou lock the ${name}.&D`); announce("locks"); }
    else { setDoorBothSides(ctx.live, ch.roomVnum, dir, { closed: true, locked: false }); out(ctx.player, `&YYou unlock the ${name}.&D`); announce("unlocks"); }
  }
}

function doContainerState(ctx: CommandContext, arg: string, action: "open" | "close" | "lock" | "unlock"): void {
  const ch = ctx.player.character;
  if (!arg) return out(ctx.player, `${cap(action)} what?`);
  const container = findCarriedContainer(ctx, arg.trim());
  if (!container) return out(ctx.player, "&RYou aren't carrying a container like that.&D");
  const proto = ctx.world.getObjPrototype(container.vnum)!;
  const info = containerInfo(proto);
  const name = esc(short(ctx, container.vnum));
  if (!info.closeable) return out(ctx.player, `&R${cap(name)} can't be opened or closed.&D`);

  if (action === "open") {
    if (container.locked) return out(ctx.player, `&R${cap(name)} is locked.&D`);
    if (!container.closed) return out(ctx.player, `&Y${cap(name)} is already open.&D`);
    container.closed = false;
    out(ctx.player, `&YYou open ${name}.&D`);
  } else if (action === "close") {
    if (container.closed) return out(ctx.player, `&Y${cap(name)} is already closed.&D`);
    container.closed = true;
    out(ctx.player, `&YYou close ${name}.&D`);
  } else { // lock / unlock — needs the matching key in the pack
    if (info.keyVnum <= 0) return out(ctx.player, `&R${cap(name)} has no lock.&D`);
    if (!container.closed) return out(ctx.player, `&RClose ${name} first.&D`);
    const hasKey = ch.inventory.some((it) => it.vnum === info.keyVnum);
    if (!hasKey) return out(ctx.player, "&RYou don't have the key.&D");
    if (action === "lock") { container.locked = true; out(ctx.player, `&YYou lock ${name}.&D`); }
    else { container.locked = false; out(ctx.player, `&YYou unlock ${name}.&D`); }
  }
  if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {});
}

/** `look`/`examine [target]` — the room, or a carried container's contents. */
function doLook(ctx: CommandContext, arg: string): void {
  if (!arg.trim()) return sendRoom(ctx.live, ctx.player);
  const container = findCarriedContainer(ctx, arg.trim());
  if (container) {
    const name = esc(short(ctx, container.vnum));
    if (container.closed) return out(ctx.player, `&Y${cap(name)} is closed.&D`);
    const inside = container.contents ?? [];
    if (inside.length === 0) return out(ctx.player, `&Y${cap(name)} is empty.&D`);
    const lines = [`&Y${cap(name)} holds:&D`];
    for (const it of inside) lines.push(`  &w${esc(short(ctx, it.vnum))}&D`);
    return out(ctx.player, ...lines);
  }
  // a carried/equipped item's description, else just re-show the room
  const owned = ctx.player.character.inventory.find((it) => matchInv(ctx, it.vnum, arg.trim()));
  if (owned) {
    const p = ctx.world.getObjPrototype(owned.vnum)!;
    return out(ctx.player, `&Y${esc(p.shortDesc)}&D`, (p.description || "You see nothing special.").trim());
  }
  sendRoom(ctx.live, ctx.player);
}

const TIER_COST = 500_000;

/**
 * Remort: at level 50, single-class, with >=500k gold, swap into the tier class, reset to level 2,
 * bank exp, gain +20 practices, and keep earned power (systems-spec §2.4).
 */
async function doAdvanceTier(ctx: CommandContext): Promise<void> {
  const ch = ctx.player.character;
  if (ctx.fighter.fighting) return out(ctx.player, "&RNot while you're fighting!&D");
  const cls = ctx.world.classes.get(ch.classId);
  if (ch.level < 50) return out(ctx.player, "&RYou must be level 50 to advance a tier.&D");
  if (ch.dualClassId != null && ch.dualClassId !== ch.classId) {
    return out(ctx.player, "&RDual-class characters cannot tier.&D");
  }
  if (!cls?.advancesTo) return out(ctx.player, "&RYour class cannot advance a tier.&D");
  if (ch.gold < TIER_COST) {
    return out(ctx.player, `&RYou need ${TIER_COST} gold to tier — you have ${ch.gold}.&D`);
  }
  const tierClass = [...ctx.world.classes.values()].find((c) => c.name === cls.advancesTo);
  if (!tierClass) return out(ctx.player, "&RThe tier class is not available.&D");

  ch.gold -= TIER_COST;
  ch.tierExp = (ch.tierExp ?? 0) + ch.exp;
  ch.tier = (ch.tier ?? 0) + 1;
  ch.classId = tierClass.id;
  ch.dualClassId = undefined; // tier overrides dual
  ch.level = 2;
  ch.exp = expToReach(ctx.world, tierClass.id, 2);
  ch.practices += 20;
  // Earned power endures: HP/mana/move maxes are kept, current pools refilled.
  ch.hp = ch.maxHp;
  ch.mana = ch.maxMana;
  ch.move = ch.maxMove;
  ch.position = "standing";

  out(
    ctx.player,
    "&YYou ascend beyond mortal limits!&D",
    `&YYou are reborn a &W${tierClass.name}&Y (tier ${ch.tier}) — re-leveling from 2, but your power endures.&D`,
    `&d(effective level ${50 + Math.floor(ch.level / 10)}; +20 practices; ${TIER_COST} gold spent)&D`,
  );
  ctx.live.broadcast(
    ch.roomVnum,
    { t: "output", lines: [parseColorSpans(`&Y${esc(ch.name)} ascends to a ${tierClass.name}!&D`)] },
    ctx.player,
  );
  sendVitals(ctx.world, ctx.player);
  sendSkills(ctx.world, ctx.player); // the tier class has its own skill tree
  if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => out(ctx.player, "&r(warning: tier not yet saved)&D"));
}

/** The guildmaster or trainer standing in this room, if any (they teach/practise skills). */
function trainerHere(ctx: CommandContext): MobInstance | undefined {
  return ctx.live.roomMobs(ctx.player.character.roomVnum).find((m) =>
    m.proto.actFlags.includes("guildmaster") || m.proto.actFlags.includes("trainer"));
}

/** A successful use of a skill teaches you a little (§2.6): a small chance to gain 1% toward cap. */
function improveOnUse(ctx: CommandContext, name: string, cap: number): void {
  const ch = ctx.player.character;
  const cur = learnedPct(ctx.world, ch, name);
  if (cur >= cap) return;
  if (Math.random() < 0.12) {
    raiseSkill(ch, name, cap, 1);
    out(ctx.player, `&dYou feel more competent with ${esc(name)}. (${cur + 1}%)&D`);
    if (ctx.db) void ctx.db.saveCharacter(ch).catch(() => {});
  }
}

/**
 * `practice` — list your learnable skills + learned%; `practice <skill>` — spend a session at a
 * guildmaster to raise it toward its adept cap (INT-driven gain, §2.6).
 */
async function doPractice(ctx: CommandContext, arg: string): Promise<void> {
  const ch = ctx.player.character;
  const grants = mergedGrants(ctx.world, ch);
  const known = [...grants.values()].filter((g) => g.level <= ch.level).sort((a, b) => a.name.localeCompare(b.name));

  if (!arg.trim()) {
    const here = trainerHere(ctx);
    const lines = [`&Y--- Practice (${ch.practices} session${ch.practices === 1 ? "" : "s"} left) ---&D`];
    if (known.length === 0) lines.push("&dYou have no skills to practise yet.&D");
    for (const g of known.slice(0, 60)) {
      const pct = learnedPct(ctx.world, ch, g.name);
      const mark = pct >= g.adept ? "&G(adept)" : `&W${pct}%&d/${g.adept}%`;
      lines.push(`  ${esc(g.name)} ${mark}&D`);
    }
    lines.push(here
      ? `&Y${cap(mobShort(here))} can train you — type 'practice <skill>'.&D`
      : "&d(Find a guildmaster or trainer, then 'practice <skill>'.)&D");
    return out(ctx.player, ...lines);
  }

  const here = trainerHere(ctx);
  if (!here) return out(ctx.player, "&RYou can't practise here — find a guildmaster or trainer.&D");
  if (ch.practices <= 0) return out(ctx.player, "&RYou have no practice sessions left. Gain more by leveling.&D");

  const lower = arg.trim().toLowerCase();
  const target = known.find((g) => g.name.toLowerCase() === lower)
    ?? known.find((g) => g.name.toLowerCase().startsWith(lower));
  if (!target) return out(ctx.player, "&RYou can't practise that — it's not on your skill list yet.&D");

  const cur = learnedPct(ctx.world, ch, target.name);
  if (cur >= target.adept) return out(ctx.player, `&YYou are already an adept at ${esc(target.name)} (${target.adept}%).&D`);

  ch.practices -= 1;
  const next = raiseSkill(ch, target.name, target.adept, practiceGain(ch.stats.int));
  out(ctx.player,
    `&G${cap(mobShort(here))} drills you in ${esc(target.name)}.&D`,
    next >= target.adept
      ? `&YYou master ${esc(target.name)} — ${next}% (adept)! (${ch.practices} sessions left)&D`
      : `&YYour ${esc(target.name)} rises to ${next}%. (${ch.practices} sessions left)&D`);
  sendSkills(ctx.world, ctx.player);
  sendVitals(ctx.world, ctx.player);
  if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
}

/** The questmaster or guildmaster standing in this room (the quest board), if any. */
function questGiverHere(ctx: CommandContext): MobInstance | undefined {
  return ctx.live.roomMobs(ctx.player.character.roomVnum).find((m) => isQuestGiver(m.proto));
}

/** Show the active quest's line (progress) or that there is none. */
function questStatusLines(ch: CommandContext["player"]["character"]): string[] {
  const lines = [`&Y--- Quest & Glory ---&D`, `&YGlory: &W${ch.glory}&D  &d(spend at a questmaster: 'quest buy practice')&D`];
  if (ch.quest) {
    const q = ch.quest;
    const done = questFulfilled(q, ch);
    const mins = q.expiresAt != null ? Math.max(0, Math.ceil((q.expiresAt - Date.now()) / 60_000)) : null;
    const timer = mins != null ? ` &d[${questExpired(q) ? "LAPSED" : `${mins} min left`}]&D` : "";
    if ((q.type ?? "hunt") === "fetch") {
      lines.push(done
        ? `&GFetch: you hold ${esc(q.itemName ?? "the item")} — return to a questmaster and 'quest complete'.${timer}`
        : `&YFetch: recover ${esc(q.itemName ?? "an item")} from ${esc(q.mobName)} (seek it in ${esc(q.areaName)}).${timer}`);
    } else {
      lines.push(done
        ? `&GHunt: ${q.count}/${q.count} ${esc(q.mobName)} — DONE. Return to a questmaster and 'quest complete'.&D`
        : `&YHunt: ${q.killed}/${q.count} ${esc(q.mobName)} (seek it in ${esc(q.areaName)}).&D`);
    }
  } else {
    lines.push("&dNo active quest. Ask a questmaster: 'quest request'.&D");
  }
  return lines;
}

/**
 * `quest` — status; `quest request` — take a hunt from a questmaster; `quest complete` — claim it;
 * `quest abandon` — drop it; `quest buy practice` — spend glory on a practice session (§3.6).
 */
async function doQuest(ctx: CommandContext, arg: string): Promise<void> {
  const ch = ctx.player.character;
  const sub = arg.trim().toLowerCase().split(/\s+/)[0] ?? "";

  if (!sub || sub === "status" || sub === "info") return out(ctx.player, ...questStatusLines(ch));

  // A lapsed timed quest is cleared before anything else, so a new one can be taken.
  if (ch.quest && questExpired(ch.quest)) {
    out(ctx.player, `&rYour quest for ${esc(ch.quest.itemName ?? ch.quest.mobName)} has run out of time.&D`);
    ch.quest = undefined;
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
  }

  if (sub === "request" || sub === "list" || sub === "new") {
    const giver = questGiverHere(ctx);
    if (!giver) return out(ctx.player, "&RThere's no questmaster here to ask.&D");
    if (ch.quest) return out(ctx.player, `&YYou're already on a quest — finish or 'quest abandon' it first.&D`);
    const q = assignQuest(ctx.world, ch, giver.proto.area);
    if (!q) return out(ctx.player, "&RThe questmaster has nothing for you right now.&D");
    ch.quest = q;
    if ((q.type ?? "hunt") === "fetch") {
      out(ctx.player,
        `&Y${cap(mobShort(giver))} sends you on a retrieval:&D`,
        `&W  Recover ${esc(q.itemName!)}&D &dfrom ${esc(q.mobName)} (seek it in ${esc(q.areaName)}) within ${Math.round(FETCH_DEADLINE_MS / 60_000)} minutes&D`,
        `&YReward: &W${q.rewardGold}&Y gold + &W${q.rewardGlory}&Y glory. Bring the item back and 'quest complete'.&D`);
    } else {
      out(ctx.player,
        `&Y${cap(mobShort(giver))} charges you with a hunt:&D`,
        `&W  Slay ${q.count} x ${esc(q.mobName)}&D &d(seek them in ${esc(q.areaName)})&D`,
        `&YReward: &W${q.rewardGold}&Y gold + &W${q.rewardGlory}&Y glory. 'quest complete' back here when it's done.&D`);
    }
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }

  if (sub === "complete" || sub === "turn" || sub === "claim") {
    const giver = questGiverHere(ctx);
    if (!giver) return out(ctx.player, "&RFind a questmaster to claim a quest.&D");
    if (!ch.quest) return out(ctx.player, "&RYou have no quest to complete.&D");
    if (!questFulfilled(ch.quest, ch)) {
      return out(ctx.player, (ch.quest.type ?? "hunt") === "fetch"
        ? `&RYou don't have ${esc(ch.quest.itemName ?? "the item")} yet.&D`
        : `&RYour hunt isn't done: ${ch.quest.killed}/${ch.quest.count} ${esc(ch.quest.mobName)}.&D`);
    }
    const q = ch.quest;
    if ((q.type ?? "hunt") === "fetch" && q.itemVnum != null) {
      const idx = ch.inventory.findIndex((it) => it.vnum === q.itemVnum);
      if (idx >= 0) ch.inventory.splice(idx, 1); // hand the item over
      sendInventory(ctx.world, ctx.player);
    }
    ch.gold += q.rewardGold;
    ch.glory += q.rewardGlory;
    ch.quest = undefined;
    out(ctx.player,
      `&Y${cap(mobShort(giver))} nods with respect.&D`,
      `&YQuest complete! +${q.rewardGold} gold, +${q.rewardGlory} glory. (Glory: ${ch.glory})&D`);
    sendVitals(ctx.world, ctx.player);
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }

  if (sub === "abandon" || sub === "drop") {
    if (!ch.quest) return out(ctx.player, "&RYou have no quest to abandon.&D");
    const name = ch.quest.mobName;
    ch.quest = undefined;
    out(ctx.player, `&YYou abandon the hunt for ${esc(name)}.&D`);
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }

  if (sub === "buy") {
    const what = arg.trim().toLowerCase().split(/\s+/)[1] ?? "";
    const giver = questGiverHere(ctx);
    if (!giver) return out(ctx.player, "&RFind a questmaster to spend glory.&D");
    if (what !== "practice" && what !== "prac") {
      return out(ctx.player, `&YSpend glory on: &Wpractice&D (${GLORY_PER_PRACTICE} glory -> 1 session). Type 'quest buy practice'.&D`);
    }
    if (ch.glory < GLORY_PER_PRACTICE) {
      return out(ctx.player, `&RYou need ${GLORY_PER_PRACTICE} glory — you have ${ch.glory}.&D`);
    }
    ch.glory -= GLORY_PER_PRACTICE;
    ch.practices += 1;
    out(ctx.player, `&YYou trade ${GLORY_PER_PRACTICE} glory for a practice session. (Glory: ${ch.glory}, practices: ${ch.practices})&D`);
    sendVitals(ctx.world, ctx.player);
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }

  out(ctx.player, "&YQuest: 'quest' (status), 'quest request', 'quest complete', 'quest abandon', 'quest buy practice'.&D");
}

/** The class's skill/spell tree: what it learns and at what level (data-driven per class).
 *  For a dual-class character this is the UNION of both classes — usable at the lower required
 *  level, adept cap = the higher of the two (faithful to the source). */
function doSkillList(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  const cls = ctx.world.classes.get(ch.classId);
  if (!cls) return out(ctx.player, "&RYour class has no skill list.&D");
  const dual = ch.dualClassId != null && ch.dualClassId !== ch.classId ? ctx.world.classes.get(ch.dualClassId) : undefined;
  const merged = new Map<string, { skill: string; level: number; adept: number }>();
  const addGrants = (grants: { skill: string; level: number; adept: number }[]) => {
    for (const g of grants) {
      const cur = merged.get(g.skill);
      merged.set(g.skill, cur
        ? { skill: g.skill, level: Math.min(cur.level, g.level), adept: Math.max(cur.adept, g.adept) }
        : { ...g });
    }
  };
  addGrants(cls.skills);
  if (dual) addGrants(dual.skills);
  const label = dual ? `${cls.name}/${dual.name}` : cls.name;
  const all = arg.trim().toLowerCase() === "all";
  const rows = [...merged.values()].sort((a, b) => a.level - b.level || a.skill.localeCompare(b.skill));
  const shown = all ? rows : rows.filter((r) => r.level <= ch.level);
  const CAP = 120;
  const lines = [`&Y--- ${label}: ${all ? "all learnable" : "available now"} (${shown.length}/${rows.length}) ---&D`];
  for (const r of shown.slice(0, CAP)) {
    const def = ctx.world.getSkill(r.skill);
    const kind = def ? def.type.toLowerCase() : "skill";
    const avail = r.level <= ch.level;
    const prof = avail
      ? `&W${learnedPct(ctx.world, ch, r.skill)}%&d/${r.adept}%`
      : `&d(adept ${r.adept}%)`;
    lines.push(`${avail ? "&W" : "&z"}[L${String(r.level).padStart(2)}]&D ${esc(r.skill)} ${prof}&D &c[${kind}]&D`);
  }
  if (shown.length > CAP) lines.push(`&z…and ${shown.length - CAP} more.&D`);
  if (!all && rows.length > shown.length) {
    lines.push(`&Y${rows.length - shown.length} more unlock at higher levels — type 'slist all'.&D`);
  }
  lines.push("&d(cast <spell> to cast · practice <skill> at a guildmaster to raise your learned%.)&D");
  out(ctx.player, ...lines);
}


/** The spells this character can cast now: class(+dual) tree spells at/under their level. */
function castableSpells(ctx: CommandContext): { name: string; level: number; adept: number; def: SkillDef }[] {
  const ch = ctx.player.character;
  const cls = ctx.world.classes.get(ch.classId);
  const dual = ch.dualClassId != null && ch.dualClassId !== ch.classId ? ctx.world.classes.get(ch.dualClassId) : undefined;
  const merged = new Map<string, { skill: string; level: number; adept: number }>();
  const add = (grants: { skill: string; level: number; adept: number }[]) => {
    for (const g of grants) {
      const cur = merged.get(g.skill);
      merged.set(g.skill, cur ? { skill: g.skill, level: Math.min(cur.level, g.level), adept: Math.max(cur.adept, g.adept) } : { ...g });
    }
  };
  if (cls) add(cls.skills);
  if (dual) add(dual.skills);
  const out: { name: string; level: number; adept: number; def: SkillDef }[] = [];
  for (const g of merged.values()) {
    const def = ctx.world.getSkill(g.skill);
    if (def && def.type === "Spell" && def.category && g.level <= ch.level) {
      out.push({ name: g.skill, level: g.level, adept: g.adept, def });
    }
  }
  return out;
}

/** Pick the offensive-spell target: an explicit keyword, else the current foe, else a mob here. */
function spellTarget(ctx: CommandContext, kw: string): Fighter | null {
  if (kw) {
    const mob = ctx.live.roomMobs(ctx.fighter.roomVnum).find((m) => mobMatches(m, kw));
    return mob ? ctx.combat.fighterForMob(mob) : null;
  }
  if (ctx.fighter.fighting && !ctx.fighter.fighting.isPlayer) return ctx.fighter.fighting;
  const mob = ctx.live.roomMobs(ctx.fighter.roomVnum)[0];
  return mob ? ctx.combat.fighterForMob(mob) : null;
}

/** `cast <spell> [target]` — spend mana, roll for success (§2.7), then apply the spell's effect. */
function doCast(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  const list = castableSpells(ctx);
  if (!arg) {
    if (!list.length) return out(ctx.player, "&RYou don't have any spells to cast.&D");
    const names = list.sort((a, b) => a.name.localeCompare(b.name)).map((s) => `${esc(s.name)}&d(${s.def.mana ?? 0})&D`);
    return out(ctx.player, "&YCast what?&D  You know:", "&w" + names.join("&D, &w") + "&D");
  }
  const lower = arg.toLowerCase();
  // longest spell name that is a prefix of the argument; the remainder is the target keyword
  let match: (typeof list)[number] | null = null;
  let targetKw = "";
  for (const s of [...list].sort((a, b) => b.name.length - a.name.length)) {
    if (lower === s.name || lower.startsWith(s.name + " ")) { match = s; targetKw = arg.slice(s.name.length).trim(); break; }
  }
  if (!match) {
    const partials = list.filter((s) => s.name.startsWith(lower));
    if (partials.length === 1) match = partials[0]!;
    else if (partials.length > 1) return out(ctx.player, "&YWhich spell?&D " + partials.map((s) => s.name).join(", "));
  }
  if (!match) return out(ctx.player, "&RYou don't know a spell like that.&D");

  const def = match.def;
  const cost = def.mana ?? 0;
  if (ch.mana < cost) return out(ctx.player, "&RYou don't have enough mana.&D");

  // Failure roll uses the character's own learned% for this spell (§2.7 + §2.6): a spell you've
  // barely practised usually fizzles. Practise it up at a guildmaster to cast it reliably.
  const learned = learnedPct(ctx.world, ch, def.name);
  if (ctx.combat.spellFails(def.difficulty ?? 1, learned)) {
    ch.mana = Math.max(0, ch.mana - Math.floor(cost / 2));
    out(ctx.player, learned <= 5
      ? "&RYou fumble the incantation — you've barely practised this spell.&D"
      : "&RYou lost your concentration.&D");
    return sendVitals(ctx.world, ctx.player);
  }
  ch.mana -= cost;
  improveOnUse(ctx, def.name, match.adept); // a successful cast teaches you a little (§2.6)
  const level = effectiveLevel(ch);

  switch (def.category) {
    case "damage":
    case "debuff": {
      const target = spellTarget(ctx, targetKw);
      if (!target) { out(ctx.player, "&RCast it at what?&D"); ch.mana += cost; return; }
      ctx.combat.castOffensive(ctx.fighter, target, def);
      sendRoom(ctx.live, ctx.player); // refresh hp bars + effect strips
      break;
    }
    case "heal": {
      const amt = ctx.combat.rollHeal(def.name, level);
      ch.hp = Math.min(ch.maxHp, ch.hp + amt);
      out(ctx.player, `&GYou invoke ${esc(def.name)} and knit your wounds (+${amt} hp).&D`);
      break;
    }
    case "buff": {
      if (/refresh/.test(def.name)) ch.move = ch.maxMove;
      applyAffect(ch.affects, buffAffect(def.name, level));
      out(ctx.player, `&cYou are wreathed in ${esc(def.name)}.&D`);
      sendRoom(ctx.live, ctx.player);
      break;
    }
    default: { // utility
      doUtility(ctx, def, targetKw);
      break;
    }
  }
  sendVitals(ctx.world, ctx.player);
}

/** An online player anywhere in the world, matched by name prefix. */
function findOnline(ctx: CommandContext, kw: string): Player | undefined {
  const lc = kw.toLowerCase();
  return ctx.live.online().find((p) => p.character.name.toLowerCase().startsWith(lc));
}

/** `consent <player>` / `consent none` — allow (or withdraw allowing) that player to summon you (§3.3). */
function doConsent(ctx: CommandContext, arg: string): void {
  const ch = ctx.player.character;
  const kw = arg.trim().toLowerCase();
  if (!kw || kw === "none" || kw === "off") {
    ch.consent = undefined;
    return out(ctx.player, "&YYou withdraw your consent to be summoned.&D");
  }
  const target = findOnline(ctx, kw);
  if (!target || target.character.id === ch.id) return out(ctx.player, "&RNo one by that name is online.&D");
  ch.consent = target.character.id;
  out(ctx.player, `&YYou consent to ${esc(target.character.name)} — they may summon you.&D`);
  out(target, `&Y${cap(ch.name)} consents to your summons.&D`);
}

/** Utility spells: recall/teleport move you; gate/portal step to a player; summon pulls one to you. */
function doUtility(ctx: CommandContext, def: SkillDef, targetKw: string): void {
  const n = def.name.toLowerCase();
  const player = ctx.live.roomPlayers(ctx.fighter.roomVnum).find((p) => p.character.id === ctx.player.character.id) ?? ctx.player;
  const isSafe = (vnum: number) => (ctx.world.getRoom(vnum)?.roomFlags ?? []).includes("safe");

  if (/recall/.test(n)) {
    if (ctx.fighter.fighting) return out(ctx.player, "&RYou can't recall while fighting!&D");
    const dest = recallTarget(ctx);
    ctx.live.moveTo(player, dest);
    out(ctx.player, "&YYou pray for transport... the world blurs and you reappear at the temple.&D");
    return sendRoom(ctx.live, ctx.player);
  }
  // gate / portal — open a gate to another player and step through.
  if (/gate|portal/.test(n)) {
    if (ctx.fighter.fighting) return out(ctx.player, "&RYou can't gate while fighting!&D");
    if (!targetKw) return out(ctx.player, "&RGate to whom?&D");
    const target = findOnline(ctx, targetKw);
    if (!target || target.character.id === ctx.player.character.id) return out(ctx.player, "&RYou can't sense anyone by that name.&D");
    if (isSafe(target.character.roomVnum)) return out(ctx.player, "&RA sanctuary repels your gate.&D");
    ctx.live.broadcast(player.character.roomVnum, { t: "output", lines: [parseColorSpans(`&m${esc(player.character.name)} steps through a shimmering gate and is gone.&D`)] }, player);
    ctx.live.moveTo(player, target.character.roomVnum);
    out(ctx.player, `&mYou open a gate and step through to ${esc(target.character.name)}.&D`);
    ctx.live.broadcast(target.character.roomVnum, { t: "output", lines: [parseColorSpans(`&m${esc(player.character.name)} arrives through a shimmering gate.&D`)] }, player);
    return sendRoom(ctx.live, ctx.player);
  }
  // summon — pull a player to you.
  if (/summon/.test(n)) {
    if (!targetKw) return out(ctx.player, "&RSummon whom?&D");
    const noSummon = (vnum: number) => { const f = ctx.world.getRoom(vnum)?.roomFlags ?? []; return f.includes("safe") || f.includes("nosummon"); };
    const target = findOnline(ctx, targetKw);
    if (!target || target.character.id === ctx.player.character.id) return out(ctx.player, "&RYou can't reach anyone by that name.&D");
    if (target.fighter?.fighting) return out(ctx.player, "&RThey are too busy fighting to be summoned.&D");
    if (noSummon(ctx.fighter.roomVnum)) return out(ctx.player, "&RYou can't summon here.&D");
    if (noSummon(target.character.roomVnum)) return out(ctx.player, "&RThey are somewhere a summons can't reach.&D");
    // A summons needs the target's consent (staff bypass it) — no yanking players against their will.
    if (!isStaff(ctx.account.roles) && target.character.consent !== ctx.player.character.id) {
      return out(ctx.player, `&R${cap(target.character.name)} hasn't consented to your summons (they must 'consent ${esc(ctx.fighter.name)}').&D`);
    }
    ctx.live.broadcast(target.character.roomVnum, { t: "output", lines: [parseColorSpans(`&m${esc(target.character.name)} is whisked away by a summoning.&D`)] }, target);
    ctx.live.moveTo(target, ctx.fighter.roomVnum);
    out(target, `&m${cap(ctx.fighter.name)} summons you!&D`);
    out(ctx.player, `&mYou summon ${esc(target.character.name)} to your side.&D`);
    ctx.live.broadcast(ctx.fighter.roomVnum, { t: "output", lines: [parseColorSpans(`&m${esc(target.character.name)} appears, summoned.&D`)] }, ctx.player);
    sendRoom(ctx.live, target);
    return sendRoom(ctx.live, ctx.player);
  }
  if (/teleport/.test(n)) {
    if (ctx.fighter.fighting) return out(ctx.player, "&RYou can't teleport while fighting!&D");
    const rooms = [...ctx.world.rooms.keys()];
    const dest = rooms[Math.floor(Math.random() * rooms.length)] ?? ctx.player.character.roomVnum;
    ctx.live.moveTo(player, dest);
    out(ctx.player, "&YReality folds — you are somewhere else entirely.&D");
    return sendRoom(ctx.live, ctx.player);
  }
  out(ctx.player, `&cYou invoke ${esc(def.name)}. Its full effect is not implemented yet.&D`);
}

function doHelp(ctx: CommandContext): void {
  out(
    ctx.player,
    "&Y--- Commands ---&D",
    "&Wlook&D (l)   move: &Wn s e w u d ne nw se sw&D",
    "&Wkill&D <mob> (k)   &Wflee&D   &Wconsider&D <mob> (con)",
    "&YStances:&D &Wberserk aggressive normal defensive evasive&D  (offense<->defense)",
    "&Wrest sleep sit stand&D   &Wrecall&D (hearth)   &Wheal&D (at a healer)   &Wcast gate&D/&Wsummon&D <player> (travel magic)",
    "&Wsay&D <text>   &Wwho&D   &Wscore&D (sc)   &Wslist&D [all]   &Wpractice&D <skill> (at a guildmaster)   &Wroles&D   &Whelp&D",
    "&Winventory&D (i)   &Wequipment&D (eq)   &Wwear&D/&Wwield&D <item>   &Wremove&D <item>",
    "&Wget&D <item> [corpse/bag]   &Wput&D <item> <bag>   &Wloot&D [corpse]   &Wdrop&D <item>   (&Wget/put/drop all&D)",
    "&Wopen&D/&Wclose&D/&Wlock&D/&Wunlock&D <container>   &Wlook&D <item/bag> (examine)",
    "&Wquest&D (status)   &Wquest request&D / &Wcomplete&D (at a questmaster)   &Wquest buy practice&D (glory)",
    "&Wclan&D (status)   &Wclan create&D <name> / &Winvite&D / &Waccept&D / &Wkick&D / &Wpromote&D / &Wwar&D   &Wctalk&D <msg>   &Wpkill&D",
    "&Wgroup&D [player]   &Wungroup&D [player]   &Wgtell&D <msg>   (share xp; followers trail their leader)",
    "&Wat a shop:&D &Wlist&D  &Wbuy&D <item> [n]  &Wsell&D <item>  &Wvalue&D <item>",
    "&Wadvancetier&D — remort at L50 (single-class, 500k gold) into your tier class",
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

/** Persist an OLC edit through to the world_overrides table so it survives a restart. */
function persistOverride(ctx: CommandContext, kind: OlcKind, vnum: number, field: string, value: string): void {
  if (ctx.db) void ctx.db.saveOverride(kind, vnum, field, value).catch(() => {});
}

/** `redit <field> <value>` — edit a field of the current room (name/desc/sector), vnum-range gated. */
function doRedit(ctx: CommandContext, arg: string): void {
  const vnum = ctx.player.character.roomVnum;
  const sp = arg.indexOf(" ");
  const field = (sp < 0 ? arg : arg.slice(0, sp)).trim().toLowerCase();
  const value = sp < 0 ? "" : arg.slice(sp + 1);
  if (!field) return out(ctx.player, `redit <${OLC_FIELDS.room.join("|")}> <value>`);
  if (!canEditVnum(ctx.account, vnum)) return out(ctx.player, `&RRoom ${vnum} is outside your assigned build range.&D`);
  const err = applyOverride(ctx.world, "room", vnum, field, value);
  if (err) return out(ctx.player, `&R${esc(err)}&D`);
  persistOverride(ctx, "room", vnum, field, value);
  out(ctx.player, `&YRoom ${vnum} ${field} updated.&D`);
  sendRoom(ctx.live, ctx.player);
}

/** `medit <vnum> <field> <value>` / `oedit <vnum> <field> <value>` — edit a mob/object prototype. */
function doEdit(ctx: CommandContext, kind: "mob" | "obj", arg: string): void {
  const parts = arg.trim().split(/\s+/);
  const vnum = parseInt(parts[0] ?? "", 10);
  const field = (parts[1] ?? "").toLowerCase();
  const value = parts.slice(2).join(" ");
  const cmd = kind === "mob" ? "medit" : "oedit";
  if (!Number.isFinite(vnum) || !field) return out(ctx.player, `${cmd} <vnum> <${OLC_FIELDS[kind].join("|")}> <value>`);
  if (!canEditVnum(ctx.account, vnum)) return out(ctx.player, `&RVnum ${vnum} is outside your assigned build range.&D`);
  const err = applyOverride(ctx.world, kind, vnum, field, value);
  if (err) return out(ctx.player, `&R${esc(err)}&D`);
  persistOverride(ctx, kind, vnum, field, value);
  out(ctx.player, `&Y${cap(kind)} ${vnum} ${field} updated.&D`);
}

/** `transfer <player> [room vnum]` — pull an online player to your room (or a named room). */
function doTransfer(ctx: CommandContext, arg: string): void {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const who = parts[0];
  if (!who) return out(ctx.player, "transfer <player> [room vnum]");
  const target = ctx.live.online().find((p) => p.character.name.toLowerCase() === who.toLowerCase());
  if (!target) return out(ctx.player, "&RNo such player is online.&D");
  const dest = parts[1] != null ? parseInt(parts[1], 10) : ctx.player.character.roomVnum;
  if (!Number.isFinite(dest) || !ctx.world.getRoom(dest)) return out(ctx.player, "&RNo such room is loaded.&D");
  if (target.character.roomVnum === dest) return out(ctx.player, `&Y${cap(target.character.name)} is already there.&D`);
  if (target.fighter) ctx.combat.disengage(target.fighter); // pull them cleanly out of any fight
  const from = target.character.roomVnum;
  ctx.live.broadcast(from, { t: "output", lines: [parseColorSpans(`&w${esc(target.character.name)} vanishes in a swirl of light.&D`)] }, target);
  ctx.live.moveTo(target, dest);
  ctx.live.broadcast(dest, { t: "output", lines: [parseColorSpans(`&w${esc(target.character.name)} arrives in a swirl of light.&D`)] }, target);
  out(target, "&YYou have been transferred by the hand of a god.&D");
  sendRoom(ctx.live, target);
  out(ctx.player, `&YTransferred ${esc(target.character.name)} to room ${dest}.&D`);
}

/** `load <mob|obj> <vnum>` — spawn a mob or object into the room (builder-scoped to the vnum range). */
function doLoad(ctx: CommandContext, arg: string): void {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const kind = (parts[0] ?? "").toLowerCase();
  const vnum = parseInt(parts[1] ?? "", 10);
  if ((kind !== "mob" && kind !== "obj") || !Number.isFinite(vnum)) return out(ctx.player, "load <mob|obj> <vnum>");
  if (!canEditVnum(ctx.account, vnum)) return out(ctx.player, `&RVnum ${vnum} is outside your assigned range.&D`);
  const room = ctx.player.character.roomVnum;
  if (kind === "mob") {
    const proto = ctx.world.getMobPrototype(vnum);
    if (!proto) return out(ctx.player, "&RNo such mob prototype.&D");
    const mob = spawnMob(proto, room);
    ctx.live.addMob(mob);
    out(ctx.player, `&YLoaded mob ${vnum} — ${esc(mobShort(mob))}.&D`);
    for (const p of ctx.live.roomPlayers(room)) sendRoomView(ctx.live, p);
  } else {
    const proto = ctx.world.getObjPrototype(vnum);
    if (!proto) return out(ctx.player, "&RNo such object prototype.&D");
    ctx.live.addGround(room, makeFixedGroundItem({ vnum }));
    out(ctx.player, `&YLoaded object ${vnum} — ${esc(proto.shortDesc)}.&D`);
    for (const p of ctx.live.roomPlayers(room)) sendRoomView(ctx.live, p);
  }
}

/** `purge` — clear the current room of all mobs, loose items, and corpses. */
function doPurge(ctx: CommandContext): void {
  const room = ctx.player.character.roomVnum;
  if (!canEditVnum(ctx.account, room)) return out(ctx.player, `&RRoom ${room} is outside your assigned range.&D`);
  const mobs = [...ctx.live.roomMobs(room)];
  for (const m of mobs) { ctx.combat.disengage(ctx.combat.fighterForMob(m)); ctx.live.removeMob(m); }
  const ground = [...ctx.live.roomGround(room)];
  for (const g of ground) ctx.live.takeGround(room, g.id);
  const corpses = [...ctx.live.roomCorpses(room)];
  for (const c of corpses) ctx.live.removeCorpse(room, c.id);
  out(ctx.player, `&YPurged ${mobs.length} mob(s), ${ground.length} item(s), ${corpses.length} corpse(s).&D`);
  for (const p of ctx.live.roomPlayers(room)) sendRoomView(ctx.live, p);
}

/** `restore [player]` — fully heal yourself or a named online player (hp/mana/move to max). */
function doRestore(ctx: CommandContext, arg: string): void {
  const target = arg.trim()
    ? ctx.live.online().find((p) => p.character.name.toLowerCase() === arg.trim().toLowerCase())
    : ctx.player;
  if (!target) return out(ctx.player, "&RNo such player is online.&D");
  const c = target.character;
  c.hp = c.maxHp; c.mana = c.maxMana; c.move = c.maxMove;
  sendVitals(ctx.world, target);
  out(target, "&YA warm light fills you — you are fully restored.&D");
  if (target !== ctx.player) out(ctx.player, `&YRestored ${esc(c.name)}.&D`);
}

/** `slay <mob>` — instantly kill a mob in the room, leaving its corpse (and loot) behind. */
function doSlay(ctx: CommandContext, arg: string): void {
  const room = ctx.player.character.roomVnum;
  const mob = arg.trim() ? ctx.live.roomMobs(room).find((m) => mobMatches(m, arg.trim())) : undefined;
  if (!mob) return out(ctx.player, "&RSlay whom? (name a mob in this room)&D");
  ctx.combat.disengage(ctx.combat.fighterForMob(mob)); // stop any fight it's in first
  const loot = (ctx.world.mobLoot.get(mob.proto.vnum) ?? []).filter((v) => ctx.world.getObjPrototype(v));
  const kw = mob.proto.keywords.split(/\s+/).find(Boolean) ?? "corpse";
  ctx.live.addCorpse(room, makeCorpse(mobShort(mob), kw, loot.map((v) => ({ vnum: v })), Date.now(), mob.proto.gold));
  ctx.live.removeMob(mob);
  ctx.live.broadcast(room, { t: "output", lines: [parseColorSpans(`&R${esc(mobShort(mob))} is blasted to ash by a bolt from on high.&D`)] }, ctx.player);
  out(ctx.player, `&YYou slay ${esc(mobShort(mob))}.&D`);
  for (const p of ctx.live.roomPlayers(room)) sendRoomView(ctx.live, p);
}

/** `echo <message>` — send a raw line to every online player (immortal announce). */
function doEcho(ctx: CommandContext, arg: string): void {
  if (!arg.trim()) return out(ctx.player, "echo <message>");
  for (const p of ctx.live.online()) out(p, `&Y${esc(arg)}&D`);
}

/** `at <room vnum> <command>` — run a command as if standing in that room, then return. */
function doAt(ctx: CommandContext, arg: string): void {
  const sp = arg.indexOf(" ");
  const vnum = parseInt(sp < 0 ? arg : arg.slice(0, sp), 10);
  const cmd = sp < 0 ? "" : arg.slice(sp + 1).trim();
  if (!Number.isFinite(vnum) || !cmd) return out(ctx.player, "at <room vnum> <command>");
  if (!ctx.world.getRoom(vnum)) return out(ctx.player, "&RNo such room is loaded.&D");
  const back = ctx.player.character.roomVnum;
  if (vnum === back) return dispatchCommand(ctx, cmd);
  ctx.live.moveTo(ctx.player, vnum); // silent relocate (no arrive/leave broadcast)
  try {
    dispatchCommand(ctx, cmd);
  } finally {
    ctx.live.moveTo(ctx.player, back);
    sendRoom(ctx.live, ctx.player); // put the caller's view back where they really are
  }
}

/** `wizinvis` — toggle staff invisibility to mortals in room/look listings. */
function doWizinvis(ctx: CommandContext): void {
  const ch = ctx.player.character;
  ch.wizinvis = !ch.wizinvis;
  out(ctx.player, ch.wizinvis ? "&YYou fade from mortal sight.&D" : "&YYou shimmer back into view.&D");
  for (const p of ctx.live.roomPlayers(ch.roomVnum)) if (p !== ctx.player) sendRoomView(ctx.live, p);
}
