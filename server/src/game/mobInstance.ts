/** A live mob: an instance spun from a MobPrototype and placed in a room by a reset. */
import { randomUUID } from "node:crypto";
import type { MobPrototype } from "../world/model.ts";
import type { Affect } from "./affects.ts";
import { averageDice, parseDice } from "./dice.ts";

export interface MobInstance {
  id: string;
  proto: MobPrototype;
  roomVnum: number;
  hp: number;
  maxHp: number;
  /** Mana pool for caster mobs (systems-spec §2.7): spending it throttles spellcasting. 0 = no caster. */
  mana: number;
  maxMana: number;
  /** Transient: set the round after a cast so a caster doesn't chain spells every single round. */
  castRecover?: boolean;
  position: string;
  /** where this mob was spawned (for repop accounting). */
  spawnRoom: number;
  /** Active spell affects (e.g. debuffs cast on it). */
  affects: Affect[];
}

export function spawnMob(proto: MobPrototype, roomVnum: number): MobInstance {
  const dice = parseDice(proto.hpDice);
  const rolled = averageDice(dice);
  const maxHp = rolled > 0 ? rolled : Math.max(8, proto.level * 8 + 10);
  // A classed mob may be a caster — give it a mana pool scaled by level. Non-classed mobs never cast.
  const maxMana = proto.classId != null ? Math.max(20, proto.level * 5) : 0;
  return {
    id: randomUUID(),
    proto,
    roomVnum,
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    position: proto.defaultPosition && proto.defaultPosition !== "dead" ? proto.defaultPosition : "standing",
    spawnRoom: roomVnum,
    affects: [],
  };
}

export function mobShort(mob: MobInstance): string {
  return mob.proto.shortDesc || mob.proto.keywords || "someone";
}

/** Does `keyword` match this mob (any of its keywords, prefix match)? */
export function mobMatches(mob: MobInstance, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  return mob.proto.keywords
    .toLowerCase()
    .split(/\s+/)
    .some((k) => k.startsWith(kw));
}
