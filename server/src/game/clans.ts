/**
 * Clans (systems-spec §5): lightweight, character-owned membership — a character carries its clan
 * {name, rank}, so a clan "exists" as long as members carry it. Invites are transient and in-memory.
 * Clan chat and the online roster read the live world (online members only).
 */
import type { Character } from "./character.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";

/** Pending invites: invitee character id -> { clan, at }. Cleared on accept or expiry. */
const invites = new Map<string, { clan: string; at: number }>();
const INVITE_TTL_MS = 5 * 60_000;

/** Glory it costs to found a clan (keeps clan-spam down). */
export const CLAN_COST_GLORY = 10;

export function inviteToClan(inviteeId: string, clan: string): void {
  invites.set(inviteeId, { clan, at: Date.now() });
}

export function pendingInvite(inviteeId: string): string | null {
  const inv = invites.get(inviteeId);
  if (!inv) return null;
  if (Date.now() - inv.at > INVITE_TTL_MS) { invites.delete(inviteeId); return null; }
  return inv.clan;
}

export function clearInvite(inviteeId: string): void {
  invites.delete(inviteeId);
}

export function sameClan(a: Character, b: Character): boolean {
  return !!a.clan && !!b.clan && a.clan.name.toLowerCase() === b.clan.name.toLowerCase();
}

/** Online members of a clan (case-insensitive by name). */
export function clanOnline(live: LiveWorld, clan: string): Player[] {
  const lc = clan.toLowerCase();
  return live.online().filter((p) => p.character.clan?.name.toLowerCase() === lc);
}

/** Is an online player already carrying a clan of this name? (dup-name guard among the online). */
export function clanNameTaken(live: LiveWorld, name: string): boolean {
  const lc = name.toLowerCase();
  return live.online().some((p) => p.character.clan?.name.toLowerCase() === lc);
}

/** Valid clan name: 3–20 letters/spaces, no leading/trailing space. */
export function validClanName(name: string): boolean {
  return /^[A-Za-z][A-Za-z ]{1,18}[A-Za-z]$/.test(name);
}
