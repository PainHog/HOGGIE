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
  /** Per-clan promise chain: the tail of each clan's in-flight mutate() queue. */
  private readonly tail = new Map<string, Promise<unknown>>();

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

  /**
   * Serialize a read-modify-write against one clan's record so concurrent bank deposits and
   * withdrawals from different members can't lose or duplicate gold (get→mutate→save is atomic
   * per clan). `apply` runs with the freshly-read record; return an error string to abort with the
   * record untouched, or return nothing to commit the mutation. Resolves to the error, or null.
   */
  async mutate(name: string, apply: (rec: ClanRecord) => string | null | undefined | void): Promise<string | null> {
    const key = name.toLowerCase();
    const step = async (): Promise<string | null> => {
      const rec = await this.get(name);
      const err = apply(rec);
      if (err) return err;
      await this.save(rec);
      return null;
    };
    const prev = this.tail.get(key) ?? Promise.resolve();
    const run = prev.then(step, step); // run after prev settles, success or failure
    this.tail.set(key, run.catch(() => {})); // keep the chain alive past any rejection
    return run;
  }
}
