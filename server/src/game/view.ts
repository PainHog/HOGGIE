/** Building the client-facing views: room snapshots, look narrative, vitals, output lines. */
import { parseColorSpans, toLines, type Line, type RoomView, type Vitals } from "@hoggie/shared";
import type { World } from "../world/world.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { className, dualClassName, expToNextLevel, raceName, type Character } from "./character.ts";
import { mobShort } from "./mobInstance.ts";
import { affectNames } from "./affects.ts";
import { learnedPct, mergedGrants } from "./skills.ts";
import { isStaff } from "./roles.ts";

/** Escape user-supplied text so it can't inject `&`-color codes. */
export function esc(s: string): string {
  return s.replace(/&/g, "&&");
}

/** Structured room data for the client's room/exits panel and visual scene. */
export function buildRoomView(live: LiveWorld, viewer: Player): RoomView {
  const ch = viewer.character;
  const room = live.world.getRoom(ch.roomVnum);
  const viewerStaff = isStaff(viewer.account?.roles ?? []);
  const others = live
    .roomPlayers(ch.roomVnum)
    .filter((p) => p !== viewer && (viewerStaff || !p.character.wizinvis)) // mortals don't see wizinvis staff
    .map((p) => ({ id: p.character.id, name: p.character.name, level: p.character.level, effects: affectNames(p.character.affects) }));
  const mobs = live.roomMobs(ch.roomVnum).map((m) => ({
    id: m.id,
    name: mobShort(m),
    level: m.proto.level,
    hpPct: m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0,
    position: m.position,
    keywords: m.proto.keywords.split(/\s+/).filter(Boolean),
    effects: affectNames(m.affects),
    shopkeeper: live.world.shops.has(m.proto.vnum),
  }));
  const items = [
    ...live.roomCorpses(ch.roomVnum).map((c) => c.name),
    ...live.roomGround(ch.roomVnum).map((g) => live.world.getObjPrototype(g.item.vnum)?.shortDesc ?? `item ${g.item.vnum}`),
  ];
  return {
    vnum: ch.roomVnum,
    name: room?.name ?? "The Void",
    sector: room?.sector ?? "inside",
    exits: room ? room.exits.map((e) => {
      const closed = live.doorAt(ch.roomVnum, e.dir)?.closed;
      return closed ? { dir: e.dir, toVnum: e.toVnum, closed: true } : { dir: e.dir, toVnum: e.toVnum };
    }) : [],
    players: others,
    mobs,
    items,
  };
}

/** The classic "look": room title, description, exits line, who/what is present. */
export function lookLines(live: LiveWorld, viewer: Player): Line[] {
  const ch = viewer.character;
  const room = live.world.getRoom(ch.roomVnum);
  const lines: Line[] = [];
  if (!room) {
    lines.push(parseColorSpans("&RYou float in an empty void.&D"));
    return lines;
  }
  lines.push(parseColorSpans("&Y" + esc(room.name) + "&D"));
  for (const l of toLines(room.description)) lines.push(l);
  // Closed doors show in parentheses so a player sees them without walking into them.
  const exits = room.exits.map((e) => (live.doorAt(ch.roomVnum, e.dir)?.closed ? `(${e.dir})` : e.dir));
  lines.push(parseColorSpans("&c[Exits: " + (exits.length ? exits.join(" ") : "none") + "]&D"));
  const viewerStaff = isStaff(viewer.account?.roles ?? []);
  for (const p of live.roomPlayers(ch.roomVnum)) {
    if (p === viewer) continue;
    if (p.character.wizinvis && !viewerStaff) continue; // hidden from mortals
    lines.push(parseColorSpans("&w" + esc(p.character.name) + " is here.&D"));
  }
  for (const mob of live.roomMobs(ch.roomVnum)) {
    const line = mob.proto.longDesc || mobShort(mob) + " is here.";
    lines.push(parseColorSpans("&g" + esc(line) + "&D"));
  }
  for (const c of live.roomCorpses(ch.roomVnum)) {
    lines.push(parseColorSpans("&r" + esc(c.name) + " lies here.&D"));
  }
  for (const g of live.roomGround(ch.roomVnum)) {
    const p = live.world.getObjPrototype(g.item.vnum);
    lines.push(parseColorSpans("&w" + esc(p?.shortDesc ?? "something") + " lies here.&D"));
  }
  return lines;
}

export function vitalsOf(world: World, ch: Character): Vitals {
  return {
    name: ch.name,
    level: ch.level,
    race: raceName(world, ch),
    className: className(world, ch),
    dualClassName: dualClassName(world, ch),
    tier: (ch.tier ?? 0) > 0 ? ch.tier : undefined,
    hp: ch.hp,
    maxHp: ch.maxHp,
    mana: ch.mana,
    maxMana: ch.maxMana,
    move: ch.move,
    maxMove: ch.maxMove,
    exp: ch.exp,
    tnl: expToNextLevel(world, ch),
    gold: ch.gold,
    glory: ch.glory ?? 0,
    clan: ch.clan?.name,
    pk: ch.pk ?? false,
    position: ch.position,
    alignment: ch.alignment,
    stats: {
      str: ch.stats.str, int: ch.stats.int, wis: ch.stats.wis, dex: ch.stats.dex,
      con: ch.stats.con, cha: ch.stats.cha, lck: ch.stats.lck,
    },
  };
}

/** Send the full room presentation (panel + narrative) to a player. */
export function sendRoom(live: LiveWorld, viewer: Player): void {
  viewer.send({ t: "room", room: buildRoomView(live, viewer) });
  viewer.send({ t: "output", lines: lookLines(live, viewer) });
}

/** Send only the structured room snapshot (no narrative) — for silent scene refreshes. */
export function sendRoomView(live: LiveWorld, viewer: Player): void {
  viewer.send({ t: "room", room: buildRoomView(live, viewer) });
}

export function sendVitals(world: World, viewer: Player): void {
  viewer.send({ t: "vitals", vitals: vitalsOf(world, viewer.character) });
}

/** Send the player's carried items, resolved to name/type/cost/description for the inventory panel. */
export function sendInventory(world: World, viewer: Player): void {
  const items = viewer.character.inventory.map((it) => {
    const p = world.getObjPrototype(it.vnum);
    const isBag = p?.itemType === "container";
    const held = it.contents?.length ?? 0;
    const bagNote = isBag ? `${it.closed ? "(closed) " : ""}Holds ${held} item${held === 1 ? "" : "s"}.` : "";
    return {
      vnum: it.vnum,
      name: (p?.shortDesc || `item ${it.vnum}`) + (isBag && held > 0 ? ` [${held}]` : ""),
      itemType: p?.itemType ?? "trash",
      cost: p?.cost ?? 0,
      description: [bagNote, (p?.description ?? "").trim()].filter(Boolean).join("\n"),
    };
  });
  viewer.send({ t: "inventory", items });
}

/** Send the character's worn/wielded gear for the equipment panel. */
export function sendEquipment(world: World, viewer: Player): void {
  const eq = viewer.character.equipment ?? {};
  const items = Object.entries(eq).map(([slot, ref]) => {
    const p = world.getObjPrototype(ref.vnum);
    return { slot, vnum: ref.vnum, name: p?.shortDesc || `item ${ref.vnum}`, itemType: p?.itemType ?? "armor" };
  });
  viewer.send({ t: "equipment", items });
}

/** Send the character's class skill/spell tree (union of both classes when dual) for the skills panel. */
export function sendSkills(world: World, viewer: Player): void {
  const ch = viewer.character;
  const cls = world.classes.get(ch.classId);
  const dual = ch.dualClassId != null && ch.dualClassId !== ch.classId ? world.classes.get(ch.dualClassId) : undefined;
  const label = dual ? `${cls?.name}/${dual.name}` : (cls?.name ?? "");
  const skills = [...mergedGrants(world, ch).values()]
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((r) => {
      const def = world.getSkill(r.name);
      return {
        name: r.name,
        type: def?.type ?? "Skill",
        level: r.level,
        adept: r.adept,
        learned: learnedPct(world, ch, r.name), // 0 until unlocked; base until practised
        available: r.level <= ch.level,
        description: (def?.description ?? "").trim(),
        mana: def?.mana,
        category: def?.category,
      };
    });
  viewer.send({ t: "skills", label, skills });
}

/** Send one or more already-colored raw lines as narrative output. */
export function out(viewer: Player, ...raw: string[]): void {
  viewer.send({ t: "output", lines: raw.map(parseColorSpans) });
}
