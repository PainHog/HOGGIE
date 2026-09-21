/**
 * In-game command dispatch. Phase 2 gave movement/presence/social; Phase 3 adds the combat
 * verbs and the stance dial. Movement is free (sector cost is roadmap) but blocked while fighting.
 */
import { parseColorSpans } from "@hoggie/shared";
import type { AppConfig } from "../config.ts";
import type { World } from "../world/world.ts";
import type { SkillDef } from "../world/model.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { className, dualClassName, effectiveLevel, expToReach, isTiered, raceName, type ItemInstance } from "./character.ts";
import { mobMatches, mobShort, type MobInstance } from "./mobInstance.ts";
import { corpseMatches, makeGroundItem, type Corpse } from "./ground.ts";
import { learnedPct, mergedGrants, practiceGain, raiseSkill } from "./skills.ts";
import { assignQuest, GLORY_PER_PRACTICE, isQuestGiver } from "./quest.ts";
import { RECALL_ROOM, type CombatManager } from "./combat.ts";
import type { Economy } from "./economy.ts";
import { buyPrice, objMatches, sellPrice, shopkeeperIn } from "./shops.ts";
import { applyAffect } from "./affects.ts";
import { buffAffect, spellHeal } from "./spellbook.ts";
import { equipStats } from "./items.ts";
import type { Fighter, PlayerFighter } from "./fighter.ts";
import { can, canEditVnum, capsFor, ROLE_NAMES, type StaffAccount } from "./roles.ts";
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
    case "drop": return doDrop(ctx, arg);
    case "loot": return doLoot(ctx, arg);
    case "kill": case "k": case "attack": return doKill(ctx, arg);
    case "recall": case "hearth": return doRecall(ctx);
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
    `&wGold &Y${c.gold}&D   Exp &G${c.exp}&D   &YGlory ${c.glory}&D   Practices ${c.practices}   Align ${c.alignment}   Stance ${c.position}&D`,
    c.quest
      ? `&wQuest: &Y${c.quest.killed}/${c.quest.count} ${esc(c.quest.mobName)}${c.quest.killed >= c.quest.count ? " (done — turn in)" : ""}&D`
      : "&wQuest: &dnone (ask a questmaster)&D",
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

  // `get <x> <corpse>` — take from a named corpse
  if (containerKw) {
    const corpse = ctx.live.roomCorpses(ch.roomVnum).find((c) => corpseMatches(c, containerKw));
    if (!corpse) return out(ctx.player, "&RYou don't see that here.&D");
    return takeFromCorpse(ctx, corpse, whatKw);
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
  const targets = wantAll ? [...ground] : ground.filter((g) => matchInv(ctx, g.vnum, whatKw)).slice(0, 1);
  if (targets.length === 0) return out(ctx.player, "&RYou don't see that here.&D");
  let got = 0;
  for (const g of targets) {
    const taken = ctx.live.takeGround(ch.roomVnum, g.id);
    if (!taken) continue;
    ch.inventory.push({ vnum: taken.vnum });
    out(ctx.player, `&YYou pick up ${esc(short(ctx, taken.vnum))}.&D`);
    got++;
  }
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
  const taken: number[] = [];
  const keep: ItemInstance[] = [];
  for (const it of corpse.contents) {
    const match = wantAll || matchInv(ctx, it.vnum, whatKw);
    if (match && (wantAll || taken.length === 0)) taken.push(it.vnum);
    else keep.push(it);
  }
  // Looting the whole corpse also scoops up any coins inside it.
  let gotGold = 0;
  if (wantAll && corpse.gold > 0) { gotGold = corpse.gold; ch.gold += corpse.gold; corpse.gold = 0; }
  if (taken.length === 0 && gotGold === 0) return out(ctx.player, `&RThere's nothing like that in ${esc(corpse.name)}.&D`);
  corpse.contents = keep;
  for (const vnum of taken) {
    ch.inventory.push({ vnum });
    out(ctx.player, `&YYou get ${esc(short(ctx, vnum))} from ${esc(corpse.name)}.&D`);
  }
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
  const dropped: number[] = [];
  for (const i of idxs.sort((a, b) => b - a)) { // splice back-to-front so indices stay valid
    const [it] = ch.inventory.splice(i, 1);
    if (it) dropped.push(it.vnum);
  }
  for (const vnum of dropped.reverse()) {
    ctx.live.addGround(ch.roomVnum, makeGroundItem(vnum));
    out(ctx.player, `&YYou drop ${esc(short(ctx, vnum))}.&D`);
  }
  afterGround(ctx);
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
    const done = q.killed >= q.count;
    lines.push(done
      ? `&GHunt: ${q.count}/${q.count} ${esc(q.mobName)} — DONE. Return to a questmaster and 'quest complete'.&D`
      : `&YHunt: ${q.killed}/${q.count} ${esc(q.mobName)} (seek it in ${esc(q.areaName)}).&D`);
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

  if (sub === "request" || sub === "list" || sub === "new") {
    const giver = questGiverHere(ctx);
    if (!giver) return out(ctx.player, "&RThere's no questmaster here to ask.&D");
    if (ch.quest && ch.quest.killed < ch.quest.count) {
      return out(ctx.player, `&YYou're already on a hunt: ${ch.quest.killed}/${ch.quest.count} ${esc(ch.quest.mobName)}.&D`);
    }
    const q = assignQuest(ctx.world, ch, giver.proto.area);
    if (!q) return out(ctx.player, "&RThe questmaster has nothing for you right now.&D");
    ch.quest = q;
    out(ctx.player,
      `&Y${cap(mobShort(giver))} charges you with a hunt:&D`,
      `&W  Slay ${q.count} x ${esc(q.mobName)}&D &d(seek them in ${esc(q.areaName)})&D`,
      `&YReward: &W${q.rewardGold}&Y gold + &W${q.rewardGlory}&Y glory. 'quest complete' back here when it's done.&D`);
    if (ctx.db) await ctx.db.saveCharacter(ch).catch(() => {});
    return;
  }

  if (sub === "complete" || sub === "turn" || sub === "claim") {
    const giver = questGiverHere(ctx);
    if (!giver) return out(ctx.player, "&RFind a questmaster to claim a quest.&D");
    if (!ch.quest) return out(ctx.player, "&RYou have no quest to complete.&D");
    if (ch.quest.killed < ch.quest.count) {
      return out(ctx.player, `&RYour hunt isn't done: ${ch.quest.killed}/${ch.quest.count} ${esc(ch.quest.mobName)}.&D`);
    }
    const q = ch.quest;
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
      doUtility(ctx, def);
      break;
    }
  }
  sendVitals(ctx.world, ctx.player);
}

/** Minimal utility spells for now: recall/teleport move you; the rest report honestly. */
function doUtility(ctx: CommandContext, def: SkillDef): void {
  const n = def.name.toLowerCase();
  const player = ctx.live.roomPlayers(ctx.fighter.roomVnum).find((p) => p.character.id === ctx.player.character.id) ?? ctx.player;
  if (/recall/.test(n)) {
    if (ctx.fighter.fighting) return out(ctx.player, "&RYou can't recall while fighting!&D");
    const dest = recallTarget(ctx);
    ctx.live.moveTo(player, dest);
    out(ctx.player, "&YYou pray for transport... the world blurs and you reappear at the temple.&D");
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
    "&Wrest sleep sit stand&D (regen when out of combat)   &Wrecall&D (return to your hearth)   &Wheal&D (at a healer)",
    "&Wsay&D <text>   &Wwho&D   &Wscore&D (sc)   &Wslist&D [all]   &Wpractice&D <skill> (at a guildmaster)   &Wroles&D   &Whelp&D",
    "&Winventory&D (i)   &Wequipment&D (eq)   &Wwear&D/&Wwield&D <item>   &Wremove&D <item>",
    "&Wget&D <item> [corpse]   &Wloot&D [corpse]   &Wdrop&D <item>   (&Wget all&D / &Wdrop all&D)",
    "&Wquest&D (status)   &Wquest request&D / &Wcomplete&D (at a questmaster)   &Wquest buy practice&D (glory)",
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
