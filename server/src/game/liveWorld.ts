/**
 * LiveWorld — the mutable presence layer over the (mostly immutable) World.
 *
 * Tracks which players are in which room so the server can broadcast room events ("X arrives",
 * "X says …") to everyone present in real time. This is the authoritative source of "who is
 * here", driven by the server, not Supabase realtime.
 */
import type { ServerMessage } from "@hoggie/shared";
import type { World } from "../world/world.ts";
import type { Character } from "./character.ts";
import type { MobInstance } from "./mobInstance.ts";
import type { Corpse, GroundItem } from "./ground.ts";
import type { Fighter } from "./fighter.ts";
import type { StaffAccount } from "./roles.ts";

/** Anything the live world can hold and message — a connected player's session implements this. */
export interface Player {
  readonly character: Character;
  /** The controlling account (roles + builder scope), for staff commands like `users`. */
  readonly account?: StaffAccount;
  /** The player's combat wrapper (so another player can target them for PvP). */
  readonly fighter?: Fighter;
  send(msg: ServerMessage): void;
}

export class LiveWorld {
  private readonly byRoom = new Map<number, Set<Player>>();
  private readonly byName = new Map<string, Player>();
  private readonly mobsByRoom = new Map<number, Set<MobInstance>>();
  private readonly mobsById = new Map<string, MobInstance>();
  private readonly groundByRoom = new Map<number, GroundItem[]>();
  private readonly corpsesByRoom = new Map<number, Corpse[]>();

  constructor(readonly world: World) {}

  // --- ground items + corpses (loot loop) ---------------------------------
  roomGround(vnum: number): GroundItem[] {
    return this.groundByRoom.get(vnum) ?? [];
  }

  roomCorpses(vnum: number): Corpse[] {
    return this.corpsesByRoom.get(vnum) ?? [];
  }

  addGround(vnum: number, item: GroundItem): void {
    const list = this.groundByRoom.get(vnum) ?? [];
    list.push(item);
    this.groundByRoom.set(vnum, list);
  }

  addCorpse(vnum: number, corpse: Corpse): void {
    const list = this.corpsesByRoom.get(vnum) ?? [];
    list.push(corpse);
    this.corpsesByRoom.set(vnum, list);
  }

  /** Take a loose ground item by id; returns it (removed from the floor) or undefined. */
  takeGround(vnum: number, id: string): GroundItem | undefined {
    const list = this.groundByRoom.get(vnum);
    if (!list) return undefined;
    const idx = list.findIndex((g) => g.id === id);
    if (idx < 0) return undefined;
    const [taken] = list.splice(idx, 1);
    if (list.length === 0) this.groundByRoom.delete(vnum);
    return taken;
  }

  getCorpse(vnum: number, id: string): Corpse | undefined {
    return (this.corpsesByRoom.get(vnum) ?? []).find((c) => c.id === id);
  }

  /** Drop a corpse from a room (called once it's empty or has decayed). */
  removeCorpse(vnum: number, id: string): void {
    const list = this.corpsesByRoom.get(vnum);
    if (!list) return;
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this.corpsesByRoom.delete(vnum);
  }

  /**
   * Sweep expired ground items and corpses. Returns the rooms that changed, each with the display
   * names that decayed, so the caller can refresh room views and narrate the rot.
   */
  decayGround(now: number): { vnum: number; names: string[] }[] {
    const changed: { vnum: number; names: string[] }[] = [];
    for (const [vnum, list] of [...this.groundByRoom]) {
      const gone = list.filter((g) => g.decayAt <= now);
      if (!gone.length) continue;
      const kept = list.filter((g) => g.decayAt > now);
      if (kept.length) this.groundByRoom.set(vnum, kept);
      else this.groundByRoom.delete(vnum);
      changed.push({ vnum, names: gone.map((g) => this.world.getObjPrototype(g.vnum)?.shortDesc ?? "something") });
    }
    for (const [vnum, list] of [...this.corpsesByRoom]) {
      const gone = list.filter((c) => c.decayAt <= now);
      if (!gone.length) continue;
      const kept = list.filter((c) => c.decayAt > now);
      if (kept.length) this.corpsesByRoom.set(vnum, kept);
      else this.corpsesByRoom.delete(vnum);
      const at = changed.find((e) => e.vnum === vnum);
      const names = gone.map((c) => c.name);
      if (at) at.names.push(...names);
      else changed.push({ vnum, names });
    }
    return changed;
  }

  // --- mobs ---------------------------------------------------------------
  addMob(mob: MobInstance): void {
    this.mobsById.set(mob.id, mob);
    this.mobSet(mob.roomVnum).add(mob);
  }

  removeMob(mob: MobInstance): void {
    this.mobsById.delete(mob.id);
    const set = this.mobsByRoom.get(mob.roomVnum);
    if (set) {
      set.delete(mob);
      if (set.size === 0) this.mobsByRoom.delete(mob.roomVnum);
    }
  }

  moveMob(mob: MobInstance, toVnum: number): void {
    this.mobSet(mob.roomVnum).delete(mob);
    mob.roomVnum = toVnum;
    this.mobSet(toVnum).add(mob);
  }

  roomMobs(vnum: number): MobInstance[] {
    return [...(this.mobsByRoom.get(vnum) ?? [])];
  }

  allMobs(): MobInstance[] {
    return [...this.mobsById.values()];
  }

  countMobProto(vnum: number): number {
    let n = 0;
    for (const m of this.mobsById.values()) if (m.proto.vnum === vnum) n++;
    return n;
  }

  private mobSet(vnum: number): Set<MobInstance> {
    let set = this.mobsByRoom.get(vnum);
    if (!set) {
      set = new Set();
      this.mobsByRoom.set(vnum, set);
    }
    return set;
  }

  online(): Player[] {
    return [...this.byName.values()];
  }

  isOnline(name: string): boolean {
    return this.byName.has(name.toLowerCase());
  }

  roomPlayers(vnum: number): Player[] {
    return [...(this.byRoom.get(vnum) ?? [])];
  }

  enter(p: Player): void {
    this.byName.set(p.character.name.toLowerCase(), p);
    this.addToRoom(p, p.character.roomVnum);
  }

  leave(p: Player): void {
    this.byName.delete(p.character.name.toLowerCase());
    this.removeFromRoom(p, p.character.roomVnum);
  }

  moveTo(p: Player, toVnum: number): void {
    this.removeFromRoom(p, p.character.roomVnum);
    p.character.roomVnum = toVnum;
    this.addToRoom(p, toVnum);
  }

  /** Send a message to everyone in a room, optionally excluding one player (usually the actor). */
  broadcast(vnum: number, msg: ServerMessage, except?: Player): void {
    for (const p of this.roomPlayers(vnum)) if (p !== except) p.send(msg);
  }

  private addToRoom(p: Player, vnum: number): void {
    let set = this.byRoom.get(vnum);
    if (!set) {
      set = new Set();
      this.byRoom.set(vnum, set);
    }
    set.add(p);
  }

  private removeFromRoom(p: Player, vnum: number): void {
    const set = this.byRoom.get(vnum);
    if (!set) return;
    set.delete(p);
    if (set.size === 0) this.byRoom.delete(vnum);
  }
}
