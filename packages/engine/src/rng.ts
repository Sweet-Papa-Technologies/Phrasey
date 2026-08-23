/**
 * Deterministic PRNG (design doc §15: "Build M1 with a seeded RNG from day one").
 *
 * mulberry32: 32 bits of state, ~2^32 period, passes gjrand's smallcrush. That
 * is plenty for card shuffles and it has the one property that actually matters
 * here — the whole generator state is a single uint32, so it round-trips through
 * JSON. `GameState` stores `rngState`, which means a snapshot restored from
 * Firestore (§6.2) resumes the *exact* same stream, and a balance sweep can
 * replay any match from its seed alone.
 *
 * No `Math.random()` anywhere in this package. That is the whole point.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Returns 0 when maxExclusive <= 0. */
  int(maxExclusive: number): number;
  /** Uniform element. Throws on an empty array — callers must guard. */
  pick<T>(arr: readonly T[]): T;
  /** Fisher-Yates into a NEW array; the input is never mutated. */
  shuffle<T>(arr: readonly T[]): T[];
  /** Weighted pick over [value, weight] pairs. Non-positive weights are skipped. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  /** True with probability p. */
  bool(p: number): boolean;
  /**
   * A child generator seeded from this one. Advances the parent, so forking is
   * itself deterministic. Use it to give a subsystem its own stream without
   * coupling its consumption count to the parent's.
   */
  fork(): Rng;
  /** The raw uint32 state. Persist this; `createRng(state)` resumes it. */
  state(): number;
}

/**
 * Seeds are normalized to uint32, so `createRng(-1)` and `createRng(0xffffffff)`
 * are the same stream. NaN seeds normalize to 0 rather than poisoning the state.
 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? seed >>> 0 : 0;
}

export function createRng(seed: number): Rng {
  let s = normalizeSeed(seed);

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  const rng: Rng = {
    next,
    int,
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new RangeError('rng.pick: empty array');
      return arr[int(arr.length)] as T;
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const a = out[i] as T;
        out[i] = out[j] as T;
        out[j] = a;
      }
      return out;
    },
    weighted<T>(entries: readonly (readonly [T, number])[]): T {
      let total = 0;
      for (const [, w] of entries) if (w > 0) total += w;
      if (total <= 0) throw new RangeError('rng.weighted: no positive weights');
      let roll = next() * total;
      for (const [value, w] of entries) {
        if (w <= 0) continue;
        roll -= w;
        if (roll < 0) return value;
      }
      /* c8 ignore start -- floating-point backstop: only reachable if the
         accumulated subtraction leaves `roll` at exactly 0 on the last entry. */
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e && e[1] > 0) return e[0];
      }
      throw new RangeError('rng.weighted: unreachable');
      /* c8 ignore stop */
    },
    bool(p: number): boolean {
      return next() < p;
    },
    fork(): Rng {
      return createRng((next() * 4294967296) >>> 0);
    },
    state(): number {
      return s;
    },
  };

  return rng;
}
