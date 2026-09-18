/** Building the client-facing views: room snapshots, look narrative, vitals, output lines. */
import { parseColorSpans, toLines, type Line, type RoomView, type Vitals } from "@hoggie/shared";
import type { World } from "../world/world.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import { className, expToNextLevel, raceName, type Character } from "./character.ts";
import { mobShort } from "./mobInstance.ts";

/** Escape user-supplied text so it can't inject `&`-color codes. */
export function esc(s: string): string {
  return s.replace(/&/g, "&&");
}

/** Structured room data for the client's room/exits panel. */
export function buildRoomView(live: LiveWorld, viewer: Player): RoomView {
  const ch = viewer.character;
  const room = live.world.getRoom(ch.roomVnum);
  const others = live
    .roomPlayers(ch.roomVnum)
    .filter((p) => p !== viewer)
    .map((p) => p.character.name);
  return {
    vnum: ch.roomVnum,
    name: room?.name ?? "The Void",
    sector: room?.sector ?? "inside",
    exits: room ? room.exits.map((e) => e.dir) : [],
    players: others,
    mobs: live.roomMobs(ch.roomVnum).map((m) => mobShort(m)),
    items: [], // ground items are Phase 4+
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
  const exits = room.exits.map((e) => e.dir);
  lines.push(parseColorSpans("&c[Exits: " + (exits.length ? exits.join(" ") : "none") + "]&D"));
  for (const p of live.roomPlayers(ch.roomVnum)) {
    if (p === viewer) continue;
    lines.push(parseColorSpans("&w" + esc(p.character.name) + " is here.&D"));
  }
  for (const mob of live.roomMobs(ch.roomVnum)) {
    const line = mob.proto.longDesc || mobShort(mob) + " is here.";
    lines.push(parseColorSpans("&g" + esc(line) + "&D"));
  }
  return lines;
}

export function vitalsOf(world: World, ch: Character): Vitals {
  return {
    name: ch.name,
    level: ch.level,
    race: raceName(world, ch),
    className: className(world, ch),
    hp: ch.hp,
    maxHp: ch.maxHp,
    mana: ch.mana,
    maxMana: ch.maxMana,
    move: ch.move,
    maxMove: ch.maxMove,
    exp: ch.exp,
    tnl: expToNextLevel(world, ch),
    gold: ch.gold,
    position: ch.position,
    alignment: ch.alignment,
  };
}

/** Send the full room presentation (panel + narrative) to a player. */
export function sendRoom(live: LiveWorld, viewer: Player): void {
  viewer.send({ t: "room", room: buildRoomView(live, viewer) });
  viewer.send({ t: "output", lines: lookLines(live, viewer) });
}

export function sendVitals(world: World, viewer: Player): void {
  viewer.send({ t: "vitals", vitals: vitalsOf(world, viewer.character) });
}

/** Send one or more already-colored raw lines as narrative output. */
export function out(viewer: Player, ...raw: string[]): void {
  viewer.send({ t: "output", lines: raw.map(parseColorSpans) });
}
