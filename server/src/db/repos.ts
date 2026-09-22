/**
 * Persistence for accounts + characters. The server (service role) is the only writer of
 * gameplay state; these repositories are the single place that touches those tables.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Character, ItemInstance } from "../game/character.ts";
import type { Stats } from "../world/model.ts";

export interface Account {
  id: string;
  email: string | null;
  roles: string[];
  banned: boolean;
  builderLowVnum: number | null;
  builderHighVnum: number | null;
}

const ACCOUNT_COLS = "id,email,roles,banned,builder_low_vnum,builder_high_vnum";

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    email: (row.email as string | null) ?? null,
    roles: (row.roles as string[]) ?? ["player"],
    banned: Boolean(row.banned),
    builderLowVnum: (row.builder_low_vnum as number | null) ?? null,
    builderHighVnum: (row.builder_high_vnum as number | null) ?? null,
  };
}

function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    raceId: row.race_id as number,
    classId: row.class_id as number,
    dualClassId: (row.dual_class_id as number | null) ?? undefined,
    level: row.level as number,
    exp: Number(row.exp),
    tier: (row.tier as number | null) ?? 0,
    tierExp: Number(row.tier_exp ?? 0),
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
    glory: (row.glory as number | null) ?? 0,
    quest: (row.quest as Character["quest"]) ?? undefined,
    clan: (row.clan as Character["clan"]) ?? undefined,
    pk: (row.pk as boolean | null) ?? false,
    inventory: (row.inventory as ItemInstance[] | null) ?? [],
    equipment: (row.equipment as Record<string, ItemInstance> | null) ?? {},
    proficiencies: (row.proficiencies as Record<string, number> | null) ?? {},
    position: row.position as string,
    roomVnum: row.room_vnum as number,
    title: (row.title as string | null) ?? undefined,
    affects: [], // transient buffs/debuffs — not persisted
  };
}

function characterToRow(ch: Character): Record<string, unknown> {
  return {
    id: ch.id,
    account_id: ch.accountId,
    name: ch.name,
    race_id: ch.raceId,
    class_id: ch.classId,
    dual_class_id: ch.dualClassId ?? null,
    level: ch.level,
    exp: ch.exp,
    tier: ch.tier ?? 0,
    tier_exp: ch.tierExp ?? 0,
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
    glory: ch.glory ?? 0,
    quest: ch.quest ?? null,
    clan: ch.clan ?? null,
    pk: ch.pk ?? false,
    inventory: ch.inventory ?? [],
    equipment: ch.equipment ?? {},
    proficiencies: ch.proficiencies ?? {},
    position: ch.position,
    room_vnum: ch.roomVnum,
    title: ch.title ?? null,
  };
}

/** Canonical war pair: both names lowercased and sorted, so each war maps to exactly one row. */
function warPair(a: string, b: string): [string, string] {
  return [a.toLowerCase(), b.toLowerCase()].sort() as [string, string];
}

export class Db {
  constructor(private readonly client: SupabaseClient) {}

  /** Get or create the account row for an authenticated user. */
  async ensureAccount(userId: string, email: string | null): Promise<Account> {
    const existing = await this.client
      .from("accounts")
      .select(ACCOUNT_COLS)
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return rowToAccount(existing.data);

    const inserted = await this.client
      .from("accounts")
      .insert({ id: userId, email })
      .select(ACCOUNT_COLS)
      .single();
    if (inserted.error) throw inserted.error;
    return rowToAccount(inserted.data);
  }

  async getAccountByEmail(email: string): Promise<Account | null> {
    const res = await this.client
      .from("accounts")
      .select(ACCOUNT_COLS)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (res.error) throw res.error;
    return res.data ? rowToAccount(res.data) : null;
  }

  async setAccountRoles(accountId: string, roles: string[]): Promise<void> {
    const res = await this.client.from("accounts").update({ roles }).eq("id", accountId);
    if (res.error) throw res.error;
  }

  async setBuilderRange(accountId: string, low: number | null, high: number | null): Promise<void> {
    const res = await this.client
      .from("accounts")
      .update({ builder_low_vnum: low, builder_high_vnum: high })
      .eq("id", accountId);
    if (res.error) throw res.error;
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

  /** The clan-level record (hall + bank), or null if the clan has none yet. */
  async getClan(name: string): Promise<{ name: string; hallVnum: number | null; bank: number } | null> {
    const res = await this.client.from("clans").select("name, hall_vnum, bank").eq("name", name).maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) return null;
    const r = res.data as Record<string, unknown>;
    return { name: r.name as string, hallVnum: (r.hall_vnum as number | null) ?? null, bank: Number(r.bank ?? 0) };
  }

  /** Create or update a clan's record (hall + bank). */
  async upsertClan(rec: { name: string; hallVnum: number | null; bank: number }): Promise<void> {
    const res = await this.client.from("clans").upsert({ name: rec.name, hall_vnum: rec.hallVnum, bank: rec.bank });
    if (res.error) throw res.error;
  }

  /** Every clan war on record, as canonical [clanA, clanB] pairs (lowercased). Hydrates the runtime
   *  war registry on startup so wars survive a restart (systems-spec §5). */
  async listClanWars(): Promise<[string, string][]> {
    const res = await this.client.from("clan_wars").select("clan_a, clan_b");
    if (res.error) throw res.error;
    return (res.data ?? []).map((r: Record<string, unknown>) => [String(r.clan_a), String(r.clan_b)] as [string, string]);
  }

  /** Record a war between two clans (idempotent; the pair is stored canonically). */
  async addClanWar(a: string, b: string): Promise<void> {
    const [clanA, clanB] = warPair(a, b);
    const res = await this.client.from("clan_wars").upsert({ clan_a: clanA, clan_b: clanB });
    if (res.error) throw res.error;
  }

  /** Clear a war between two clans. */
  async removeClanWar(a: string, b: string): Promise<void> {
    const [clanA, clanB] = warPair(a, b);
    const res = await this.client.from("clan_wars").delete().eq("clan_a", clanA).eq("clan_b", clanB);
    if (res.error) throw res.error;
  }

  /** Does any character (online or offline) already carry a clan of this name? (case-insensitive). */
  async clanNameExists(name: string): Promise<boolean> {
    const res = await this.client.from("characters").select("id").eq("deleted", false).ilike("clan->>name", name).limit(1);
    if (res.error) throw res.error;
    return (res.data ?? []).length > 0;
  }

  /** Every OLC field override, replayed over the loaded world at boot (systems-spec §7). */
  async listOverrides(): Promise<{ kind: string; vnum: number; field: string; value: string }[]> {
    const res = await this.client.from("world_overrides").select("kind, vnum, field, value");
    if (res.error) throw res.error;
    return (res.data ?? []).map((r: Record<string, unknown>) => ({
      kind: String(r.kind), vnum: Number(r.vnum), field: String(r.field), value: String(r.value),
    }));
  }

  /** Write-through a single OLC field edit (idempotent per kind/vnum/field). */
  async saveOverride(kind: string, vnum: number, field: string, value: string): Promise<void> {
    const res = await this.client.from("world_overrides").upsert({ kind, vnum, field, value, updated_at: new Date().toISOString() });
    if (res.error) throw res.error;
  }

  /** Every OLC-created record (mob/obj prototype, or dug room), registered at boot before overrides. */
  async listCreated(): Promise<{ kind: string; vnum: number; data: Record<string, unknown> }[]> {
    const res = await this.client.from("world_created").select("kind, vnum, data");
    if (res.error) throw res.error;
    return (res.data ?? []).map((r: Record<string, unknown>) => ({
      kind: String(r.kind), vnum: Number(r.vnum), data: (r.data ?? {}) as Record<string, unknown>,
    }));
  }

  /** Record a newly-created mob/obj prototype or dug room (data holds the kind's fields). */
  async saveCreated(kind: string, vnum: number, data: Record<string, unknown>): Promise<void> {
    const res = await this.client.from("world_created").upsert({ kind, vnum, data });
    if (res.error) throw res.error;
  }

  /** Every OLC-created exit link (from `dig`), applied at boot after created rooms exist. */
  async listExits(): Promise<{ from: number; dir: string; to: number }[]> {
    const res = await this.client.from("world_exits").select("from_vnum, dir, to_vnum");
    if (res.error) throw res.error;
    return (res.data ?? []).map((r: Record<string, unknown>) => ({ from: Number(r.from_vnum), dir: String(r.dir), to: Number(r.to_vnum) }));
  }

  /** Record (or replace) a directional exit between two rooms. */
  async saveExit(from: number, dir: string, to: number): Promise<void> {
    const res = await this.client.from("world_exits").upsert({ from_vnum: from, dir, to_vnum: to });
    if (res.error) throw res.error;
  }

  /** All members of a clan (online + offline), for a full roster. */
  async charactersInClan(clanName: string): Promise<{ name: string; level: number; rank: string }[]> {
    const res = await this.client
      .from("characters")
      .select("name, level, clan")
      .eq("deleted", false)
      .filter("clan->>name", "eq", clanName)
      .order("level", { ascending: false })
      .limit(200);
    if (res.error) throw res.error;
    return (res.data ?? []).map((r: Record<string, unknown>) => ({
      name: r.name as string,
      level: r.level as number,
      rank: ((r.clan as { rank?: string } | null)?.rank) ?? "member",
    }));
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
