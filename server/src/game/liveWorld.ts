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

/** Anything the live world can hold and message — a connected player's session implements this. */
export interface Player {
  readonly character: Character;
  send(msg: ServerMessage): void;
}

export class LiveWorld {
  private readonly byRoom = new Map<number, Set<Player>>();
  private readonly byName = new Map<string, Player>();

  constructor(readonly world: World) {}

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
