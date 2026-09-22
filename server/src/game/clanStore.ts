/**
 * Clan-level state (hall room + shared bank), systems-spec §5. Backed by the `clans` table when a DB
 * is present, with an in-memory fallback so it works standalone (and in tests). Membership stays on
 * the characters; this holds what a clan *owns*.
 */
import type { Db } from "../db/repos.ts";

export interface ClanRecord {
  name: string;
  hallVnum: number | null;
  bank: number;
}

export class ClanStore {
  private readonly mem = new Map<string, ClanRecord>();

  constructor(private readonly db: Db | null = null) {}

  async get(name: string): Promise<ClanRecord> {
    const key = name.toLowerCase();
    if (this.db) {
      const r = await this.db.getClan(name).catch(() => null);
      if (r) { this.mem.set(key, r); return r; }
    }
    return this.mem.get(key) ?? { name, hallVnum: null, bank: 0 };
  }

  async save(rec: ClanRecord): Promise<void> {
    this.mem.set(rec.name.toLowerCase(), rec);
    if (this.db) await this.db.upsertClan(rec).catch(() => {});
  }
}
