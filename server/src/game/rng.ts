/**
 * Seedable RNG so combat is deterministic in tests. The default instance uses Math.random;
 * tests can construct a seeded one and inject it.
 */
export class Rng {
  private state: number;
  private readonly seeded: boolean;

  constructor(seed?: number) {
    this.seeded = seed !== undefined;
    this.state = (seed ?? (Math.random() * 2 ** 32)) >>> 0;
  }

  /** float in [0,1). */
  next(): number {
    if (!this.seeded) return Math.random();
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** integer in [min,max] inclusive. */
  range(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 1..100 inclusive (SMAUG number_percent). */
  percent(): number {
    return this.range(1, 100);
  }

  /** roll `n` dice of `size` sides. */
  dice(n: number, size: number): number {
    if (n <= 0 || size <= 0) return 0;
    let total = 0;
    for (let i = 0; i < n; i++) total += this.range(1, size);
    return total;
  }
}

/** Process-wide default RNG (non-deterministic). */
export const rng = new Rng();
