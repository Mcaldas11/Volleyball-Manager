/**
 * Deterministic random number generation.
 *
 * Every stochastic decision in the simulation — a rally outcome, an injury, a
 * regen's potential — flows through here. A save game stores its RNG state, so
 * re-simulating the same match with the same state always produces the same
 * result. That property is what makes the engine testable and what makes bug
 * reports reproducible fifty seasons into a career.
 *
 * Algorithm is PCG-XSH-RR 32-bit: small state, no bad seeds, passes TestU01
 * BigCrush. Implemented on Math.imul/32-bit ops rather than BigInt because the
 * rally loop calls it millions of times per simulated season.
 */

const MUL_LO = 0x4c957f2d;
const MUL_HI = 0x5851f42d;
const INC_LO = 0xf767814f;
const INC_HI = 0x14057b7e;

export class Rng {
  /** 64-bit state, split across two 32-bit halves. */
  private hi: number;
  private lo: number;

  constructor(seed: number | string = 0) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.hi = 0;
    this.lo = 0;
    this.step();
    // Seed both halves so that nearby integer seeds diverge immediately.
    this.lo = (this.lo + s) >>> 0;
    this.hi = (this.hi + Math.imul(s, 0x9e3779b1)) >>> 0;
    this.step();
  }

  /** Advance the LCG one step: state = state * MUL + INC (mod 2^64). */
  private step(): void {
    const hi = this.hi;
    const lo = this.lo;

    // Full 32x32 -> 64 product of (lo * MUL_LO), computed in 16-bit limbs so
    // every intermediate stays inside the float64 mantissa.
    const aLo = lo & 0xffff;
    const aHi = lo >>> 16;
    const bLo = MUL_LO & 0xffff;
    const bHi = MUL_LO >>> 16;

    const p0 = aLo * bLo;
    const p1 = aHi * bLo + (p0 >>> 16);
    const p2 = aLo * bHi + (p1 & 0xffff);

    const prodLo = (((p2 & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
    const prodHi = aHi * bHi + (p1 >>> 16) + (p2 >>> 16);

    // The cross terms only contribute to the high word.
    const newHi = (prodHi + Math.imul(hi, MUL_LO) + Math.imul(lo, MUL_HI)) >>> 0;

    // Add the increment, propagating carry from low to high.
    const sumLo = (prodLo + INC_LO) >>> 0;
    const carry = sumLo < prodLo ? 1 : 0;
    this.lo = sumLo;
    this.hi = (newHi + INC_HI + carry) >>> 0;
  }

  /** Uniform 32-bit unsigned integer. */
  next(): number {
    const hi = this.hi;
    const lo = this.lo;
    this.step();

    // XSH-RR output permutation on the *previous* state.
    const xorshifted = (((hi << 13) | (lo >>> 19)) ^ hi) >>> 0;
    const rot = hi >>> 27;
    return ((xorshifted >>> rot) | (xorshifted << ((-rot >>> 0) & 31))) >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.next() / 0x100000000;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /**
   * Standard normal via Box-Muller. The spare value is cached because each
   * transform naturally yields two independent samples.
   */
  private spare: number | null = null;
  gaussian(mean = 0, stdev = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + stdev * v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.float() * 2 - 1;
      v = this.float() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    return mean + stdev * u * mul;
  }

  /** Normal sample clamped to [min, max]; resamples rather than truncating. */
  gaussianClamped(mean: number, stdev: number, min: number, max: number): number {
    for (let i = 0; i < 8; i++) {
      const v = this.gaussian(mean, stdev);
      if (v >= min && v <= max) return v;
    }
    return Math.min(max, Math.max(min, this.gaussian(mean, stdev)));
  }

  /** Pick a uniformly random element. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)];
  }

  /** Pick an index with probability proportional to its weight. */
  weightedIndex(weights: readonly number[] | Float64Array, total?: number): number {
    let sum = total;
    if (sum === undefined) {
      sum = 0;
      for (let i = 0; i < weights.length; i++) sum += weights[i];
    }
    if (sum <= 0) return 0;
    let r = this.float() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const t = items[i];
      items[i] = items[j];
      items[j] = t;
    }
    return items;
  }

  /** Serializable state, for save games. */
  getState(): [number, number] {
    return [this.hi, this.lo];
  }

  setState(state: readonly [number, number]): void {
    this.hi = state[0] >>> 0;
    this.lo = state[1] >>> 0;
    this.spare = null;
  }

  /**
   * Derive an independent stream. Used so that, say, injury rolls don't shift
   * when the match engine changes how many rally rolls it makes.
   */
  fork(label: string): Rng {
    return new Rng((this.next() ^ hashString(label)) >>> 0);
  }
}

/** FNV-1a. Used for seeding and for stable IDs derived from names. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
