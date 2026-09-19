/**
 * Area economy (systems-spec §4.1): each area owns a shared, finite gold pool. Buying, healing and
 * bank deposits pour gold INTO the pool; selling pulls it OUT — and you cannot sell an item worth
 * more than the pool currently holds. Pools are in-memory this pass (seeded per area); persistence
 * and the slow refill-toward-1M are follow-ons.
 */
const SEED_POOL = 250_000_000; // ~250M seed per area
const FLOOR = 1_000_000; // the level pools refill toward (refill itself is a follow-on)

export class Economy {
  private readonly pools = new Map<string, number>();

  /** The area's current gold pool, seeded on first access. */
  pool(area: string): number {
    let p = this.pools.get(area);
    if (p == null) {
      p = SEED_POOL;
      this.pools.set(area, p);
    }
    return p;
  }

  /** Buying / deposits pour gold into the area pool. */
  deposit(area: string, amount: number): void {
    this.pools.set(area, this.pool(area) + Math.max(0, Math.floor(amount)));
  }

  /** Selling pulls gold out — capped at the pool. Returns the gold actually paid out. */
  withdraw(area: string, amount: number): number {
    const paid = Math.max(0, Math.min(Math.floor(amount), this.pool(area)));
    this.pools.set(area, this.pool(area) - paid);
    return paid;
  }

  /** Can the pool cover a sale of this value? (You can't sell above the pool.) */
  canCover(area: string, amount: number): boolean {
    return this.pool(area) >= amount;
  }

  /** The equilibrium the pool refills toward when drained (informational for now). */
  readonly floor = FLOOR;
}
