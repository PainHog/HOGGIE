/**
 * Groups / party play (systems-spec §5): a transient, session-only relationship. A character carries
 * its group leader's id (the leader carries their own), so a group is "everyone online sharing a
 * leader id". Grouped members split kill xp and follow their leader between rooms.
 */
import type { Character } from "./character.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";

export function isGrouped(ch: Character): boolean {
  return ch.groupLeaderId != null;
}

export function isLeader(ch: Character): boolean {
  return ch.groupLeaderId != null && ch.groupLeaderId === ch.id;
}

/** Every online member of this character's group (empty when ungrouped). */
export function groupMembers(live: LiveWorld, ch: Character): Player[] {
  if (!ch.groupLeaderId) return [];
  return live.online().filter((p) => p.character.groupLeaderId === ch.groupLeaderId);
}

/** Online group members standing in a particular room. */
export function groupInRoom(live: LiveWorld, ch: Character, vnum: number): Player[] {
  return groupMembers(live, ch).filter((p) => p.character.roomVnum === vnum);
}

export function sameGroup(a: Character, b: Character): boolean {
  return a.groupLeaderId != null && a.groupLeaderId === b.groupLeaderId;
}

/**
 * Disband or leave: clear this character's group tie. If they were the leader, every online member
 * pointing at them is released too (the group dissolves).
 */
export function leaveGroup(live: LiveWorld, ch: Character): void {
  if (isLeader(ch)) {
    for (const p of groupMembers(live, ch)) p.character.groupLeaderId = undefined;
  }
  ch.groupLeaderId = undefined;
}
