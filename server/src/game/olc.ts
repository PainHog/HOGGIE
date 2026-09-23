/**
 * OLC (online creation), systems-spec §7: staff edit room/mob/object prototype fields live. Edits
 * mutate the in-memory World and are written through to the `world_overrides` table so they survive
 * a restart — applyOverride() is used both by the edit commands and when replaying overrides at boot.
 */
import type { MobPrototype, ObjPrototype } from "../world/model.ts";
import type { World } from "../world/world.ts";

export type OlcKind = "room" | "mob" | "obj";

/** A default, editable mob prototype for a freshly-created vnum (fields filled in later via medit). */
export function defaultMob(vnum: number, keywords: string, area: string): MobPrototype {
  const kw = keywords.trim() || `mob${vnum}`;
  return {
    vnum, area, keywords: kw, shortDesc: kw, longDesc: `${kw} is here.`, description: "",
    level: 1, alignment: 0, actFlags: [], affectFlags: [], thac0: 20, ac: 100, hpDice: "1d6+1", damDice: "1d4",
    gold: 0, exp: 0, position: "standing", defaultPosition: "standing", sex: "neutral",
    resistant: [], immune: [], susceptible: [], specialAttacks: [], specialDefenses: [],
  };
}

/** A default, editable object prototype for a freshly-created vnum (fields filled in later via oedit). */
export function defaultObj(vnum: number, keywords: string, area: string): ObjPrototype {
  const kw = keywords.trim() || `obj${vnum}`;
  return {
    vnum, area, keywords: kw, shortDesc: kw, description: "", actionDesc: "",
    itemType: "trash", extraFlags: [], wearFlags: ["take"], values: [0, 0, 0, 0, 0], weight: 1, cost: 0, affects: [],
  };
}

/** Register a newly-dug room into the world. Returns an error if the vnum is taken. */
export function createRoom(world: World, vnum: number, name: string, sector: string, area: string): string | null {
  if (world.getRoom(vnum)) return `Room ${vnum} already exists.`;
  world.rooms.set(vnum, { vnum, area, name: name.slice(0, 60), description: "", sector, roomFlags: [], exits: [] });
  return null;
}

/** Add or replace a directional exit on `from` pointing at `to`. */
export function linkExit(world: World, fromVnum: number, dir: string, toVnum: number): string | null {
  const from = world.getRoom(fromVnum);
  if (!from) return `No room ${fromVnum} is loaded.`;
  if (!world.getRoom(toVnum)) return `No room ${toVnum} is loaded.`;
  const existing = from.exits.find((e) => e.dir === dir);
  if (existing) existing.toVnum = toVnum;
  else from.exits.push({ dir, toVnum });
  return null;
}

/** Register a created prototype into the world (idempotent). Returns an error if the vnum is taken. */
export function createProto(world: World, kind: "mob" | "obj", vnum: number, keywords: string, area: string): string | null {
  if (kind === "mob") {
    if (world.getMobPrototype(vnum)) return `Mob ${vnum} already exists.`;
    world.mobPrototypes.set(vnum, defaultMob(vnum, keywords, area));
  } else {
    if (world.getObjPrototype(vnum)) return `Object ${vnum} already exists.`;
    world.objPrototypes.set(vnum, defaultObj(vnum, keywords, area));
  }
  return null;
}

/** The editable fields per kind, for usage/help text. */
export const OLC_FIELDS: Record<OlcKind, string[]> = {
  room: ["name", "desc", "sector"],
  mob: ["level", "align", "gold", "hp", "damage", "short"],
  obj: ["short", "cost", "weight", "keywords"],
};

/** Parse a numeric field value, or null if it isn't a finite number. */
function num(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function applyRoomField(world: World, vnum: number, field: string, value: string): string | null {
  const r = world.getRoom(vnum);
  if (!r) return `No room ${vnum} is loaded.`;
  switch (field) {
    case "name": r.name = value.slice(0, 60); return null;
    case "desc": r.description = value; return null;
    case "sector": r.sector = value; return null;
    default: return `Unknown room field '${field}'. Try: ${OLC_FIELDS.room.join(", ")}.`;
  }
}

function applyMobField(world: World, vnum: number, field: string, value: string): string | null {
  const m = world.getMobPrototype(vnum);
  if (!m) return `No mob ${vnum} is loaded.`;
  switch (field) {
    case "level": { const n = num(value); if (n === null) return `'${value}' isn't a number.`; m.level = Math.max(1, Math.floor(n)); return null; }
    case "align": { const n = num(value); if (n === null) return `'${value}' isn't a number.`; m.alignment = Math.max(-1000, Math.min(1000, Math.floor(n))); return null; }
    case "gold": { const n = num(value); if (n === null) return `'${value}' isn't a number.`; m.gold = Math.max(0, Math.floor(n)); return null; }
    case "hp": m.hpDice = value; return null;
    case "damage": m.damDice = value; return null;
    case "short": m.shortDesc = value; return null;
    default: return `Unknown mob field '${field}'. Try: ${OLC_FIELDS.mob.join(", ")}.`;
  }
}

function applyObjField(world: World, vnum: number, field: string, value: string): string | null {
  const o = world.getObjPrototype(vnum);
  if (!o) return `No object ${vnum} is loaded.`;
  switch (field) {
    case "short": o.shortDesc = value; return null;
    case "cost": { const n = num(value); if (n === null) return `'${value}' isn't a number.`; o.cost = Math.max(0, Math.floor(n)); return null; }
    case "weight": { const n = num(value); if (n === null) return `'${value}' isn't a number.`; o.weight = Math.max(0, Math.floor(n)); return null; }
    case "keywords": o.keywords = value; return null;
    default: return `Unknown object field '${field}'. Try: ${OLC_FIELDS.obj.join(", ")}.`;
  }
}

/** Apply one field edit to a prototype in place. Returns null on success, or an error string. */
export function applyOverride(world: World, kind: OlcKind, vnum: number, field: string, value: string): string | null {
  switch (kind) {
    case "room": return applyRoomField(world, vnum, field, value);
    case "mob": return applyMobField(world, vnum, field, value);
    case "obj": return applyObjField(world, vnum, field, value);
    default: return `Unknown edit kind '${kind as string}'.`;
  }
}
