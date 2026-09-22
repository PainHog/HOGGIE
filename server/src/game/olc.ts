/**
 * OLC (online creation), systems-spec §7: staff edit room/mob/object prototype fields live. Edits
 * mutate the in-memory World and are written through to the `world_overrides` table so they survive
 * a restart — applyOverride() is used both by the edit commands and when replaying overrides at boot.
 */
import type { World } from "../world/world.ts";

export type OlcKind = "room" | "mob" | "obj";

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
