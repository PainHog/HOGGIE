/** A live mob: an instance spun from a MobPrototype and placed in a room by a reset. */
import { randomUUID } from "node:crypto";
import type { MobPrototype } from "../world/model.ts";
import { averageDice, parseDice } from "./dice.ts";

export interface MobInstance {
  id: string;
  proto: MobPrototype;
  roomVnum: number;
  hp: number;
  maxHp: number;
  position: string;
  /** where this mob was spawned (for repop accounting). */
  spawnRoom: number;
}

export function spawnMob(proto: MobPrototype, roomVnum: number): MobInstance {
  const dice = parseDice(proto.hpDice);
  const rolled = averageDice(dice);
  const maxHp = rolled > 0 ? rolled : Math.max(8, proto.level * 8 + 10);
  return {
    id: randomUUID(),
    proto,
    roomVnum,
    hp: maxHp,
    maxHp,
    position: proto.defaultPosition && proto.defaultPosition !== "dead" ? proto.defaultPosition : "standing",
    spawnRoom: roomVnum,
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
