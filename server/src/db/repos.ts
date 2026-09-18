/**
 * Persistence for accounts + characters. The server (service role) is the only writer of
 * gameplay state; these repositories are the single place that touches those tables.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Character } from "../game/character.ts";
import type { Stats } from "../world/model.ts";

export interface Account {
  id: string;
  email: string | null;
  roles: string[];
  banned: boolean;
}

function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    raceId: row.race_id as number,
    classId: row.class_id as number,
    level: row.level as number,
    exp: Number(row.exp),
    alignment: row.alignment as number,
    stats: row.stats as Stats,
    hp: row.hp as number,
    maxHp: row.max_hp as number,
    mana: row.mana as number,
    maxMana: row.max_mana as number,
    move: row.move as number,
    maxMove: row.max_move as number,
    gold: Number(row.gold),
    practices: row.practices as number,
    position: row.position as string,
    roomVnum: row.room_vnum as number,
    title: (row.title as string | null) ?? undefined,
  };
}

function characterToRow(ch: Character): Record<string, unknown> {
  return {
    id: ch.id,
    account_id: ch.accountId,
    name: ch.name,
    race_id: ch.raceId,
    class_id: ch.classId,
    level: ch.level,
    exp: ch.exp,
    alignment: ch.alignment,
    stats: ch.stats,
    hp: ch.hp,
    max_hp: ch.maxHp,
    mana: ch.mana,
    max_mana: ch.maxMana,
    move: ch.move,
    max_move: ch.maxMove,
    gold: ch.gold,
    practices: ch.practices,
    position: ch.position,
    room_vnum: ch.roomVnum,
    title: ch.title ?? null,
  };
}

export class Db {
  constructor(private readonly client: SupabaseClient) {}

  /** Get or create the account row for an authenticated user. */
  async ensureAccount(userId: string, email: string | null): Promise<Account> {
    const existing = await this.client
      .from("accounts")
      .select("id,email,roles,banned")
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as Account;

    const inserted = await this.client
      .from("accounts")
      .insert({ id: userId, email })
      .select("id,email,roles,banned")
      .single();
    if (inserted.error) throw inserted.error;
    return inserted.data as Account;
  }

  async listCharacters(accountId: string): Promise<Character[]> {
    const res = await this.client
      .from("characters")
      .select("*")
      .eq("account_id", accountId)
      .eq("deleted", false)
      .order("created_at", { ascending: true });
    if (res.error) throw res.error;
    return (res.data ?? []).map(rowToCharacter);
  }

  async getCharacter(id: string, accountId: string): Promise<Character | null> {
    const res = await this.client
      .from("characters")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .eq("deleted", false)
      .maybeSingle();
    if (res.error) throw res.error;
    return res.data ? rowToCharacter(res.data) : null;
  }

  /** Case-insensitive name availability check across live characters. */
  async isNameTaken(name: string): Promise<boolean> {
    const res = await this.client
      .from("characters")
      .select("id")
      .ilike("name", name)
      .eq("deleted", false)
      .limit(1);
    if (res.error) throw res.error;
    return (res.data ?? []).length > 0;
  }

  async createCharacter(ch: Character): Promise<void> {
    const res = await this.client.from("characters").insert(characterToRow(ch));
    if (res.error) throw res.error;
  }

  /** Write-behind save of the mutable character state. */
  async saveCharacter(ch: Character): Promise<void> {
    const row = characterToRow(ch);
    delete row.id;
    delete row.account_id;
    delete row.name;
    row.last_played = new Date().toISOString();
    const res = await this.client.from("characters").update(row).eq("id", ch.id);
    if (res.error) throw res.error;
  }
}
