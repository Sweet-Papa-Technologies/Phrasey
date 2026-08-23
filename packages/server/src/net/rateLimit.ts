/**
 * Per-socket rate limiting.
 *
 * Not a DoS defence — Cloud Run and the single-instance posture handle volume.
 * This exists so one misbehaving or malicious client cannot spin the engine
 * (every action `structuredClone`s the whole game state) or spam the table.
 *
 * A token bucket per socket, plus a tighter bucket for the two events that are
 * cheap to send and expensive or annoying to receive: `turn:solve` and
 * `chat:emote`.
 */
export interface BucketSpec {
  /** Tokens the bucket holds — the burst. */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSec: number;
}

/**
 * Sized for a fast round, not for a human's reflexes: one turn is up to four
 * client→server calls (play, decline-to-solve, decline-an-interrupt, and a
 * retry), and an 8-player table can cycle several times a second when everyone
 * is quick. Too tight a bucket does not stop an attacker, it stops the game.
 */
export const GLOBAL_BUCKET: BucketSpec = { capacity: 60, refillPerSec: 25 };

export const EVENT_BUCKETS: Record<string, BucketSpec> = {
  'room:create': { capacity: 3, refillPerSec: 0.2 },
  'room:join': { capacity: 6, refillPerSec: 0.5 },
  // NOT tight, deliberately. Guessing is already rate-limited by the rules:
  // one wrong solve locks you out of solving for the rest of the round (§3.3),
  // which is a far harder cap than any token bucket.
  'turn:solve': { capacity: 12, refillPerSec: 4 },
  'chat:emote': { capacity: 5, refillPerSec: 1 },
  'interrupt:play': { capacity: 12, refillPerSec: 4 },
  'game:start': { capacity: 4, refillPerSec: 0.5 },
  'room:settings': { capacity: 8, refillPerSec: 2 },
};

class Bucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly spec: BucketSpec,
    now: number,
  ) {
    this.tokens = spec.capacity;
    this.last = now;
  }
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.spec.capacity, this.tokens + elapsed * this.spec.refillPerSec);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class RateLimiter {
  private readonly global = new Map<string, Bucket>();
  private readonly perEvent = new Map<string, Bucket>();

  /** False means "drop this call and tell the client RATE_LIMITED". */
  allow(socketId: string, event: string, now: number = Date.now()): boolean {
    const g = this.global.get(socketId) ?? new Bucket(GLOBAL_BUCKET, now);
    this.global.set(socketId, g);
    if (!g.take(now)) return false;

    const spec = EVENT_BUCKETS[event];
    if (!spec) return true;
    const key = `${socketId}|${event}`;
    const b = this.perEvent.get(key) ?? new Bucket(spec, now);
    this.perEvent.set(key, b);
    return b.take(now);
  }

  forget(socketId: string): void {
    this.global.delete(socketId);
    for (const key of this.perEvent.keys()) {
      if (key.startsWith(`${socketId}|`)) this.perEvent.delete(key);
    }
  }
}


// ---------------------------------------------------------------------------
// Failed-join tracking — anti-enumeration
// ---------------------------------------------------------------------------

/**
 * The per-socket `room:join` bucket does not stop code enumeration, because a
 * client just opens a new socket. This tracks *failures* by remote address and
 * locks the address out for progressively longer, so walking the 6,400-code
 * space costs days instead of minutes.
 *
 * Deliberately forgiving of honest mistakes: the first few misses are free, so
 * someone fat-fingering a key off a screen never notices this exists.
 */
export interface JoinGuardOptions {
  /** Misses allowed before any lockout. */
  freeAttempts: number;
  /** First lockout, doubling each subsequent failure. */
  baseLockoutMs: number;
  maxLockoutMs: number;
  /** A clean stretch this long forgets the address entirely. */
  decayMs: number;
}

export const DEFAULT_JOIN_GUARD: JoinGuardOptions = {
  freeAttempts: 5,
  baseLockoutMs: 2_000,
  maxLockoutMs: 5 * 60_000,
  decayMs: 10 * 60_000,
};

interface JoinRecord {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

export class JoinGuard {
  private readonly records = new Map<string, JoinRecord>();

  constructor(
    private readonly opts: JoinGuardOptions = DEFAULT_JOIN_GUARD,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds remaining on a lockout, or 0 if the address may try. */
  retryAfterMs(addr: string): number {
    const rec = this.records.get(addr);
    if (!rec) return 0;
    const t = this.now();
    if (t - rec.lastFailureAt > this.opts.decayMs) {
      this.records.delete(addr);
      return 0;
    }
    return Math.max(0, rec.lockedUntil - t);
  }

  /** Record a failed join. Returns the new lockout in ms (0 while still free). */
  fail(addr: string): number {
    const t = this.now();
    const existing = this.records.get(addr);
    const rec: JoinRecord =
      existing && t - existing.lastFailureAt <= this.opts.decayMs
        ? existing
        : { failures: 0, lockedUntil: 0, lastFailureAt: t };

    rec.failures += 1;
    rec.lastFailureAt = t;

    const over = rec.failures - this.opts.freeAttempts;
    if (over > 0) {
      const lockout = Math.min(this.opts.baseLockoutMs * 2 ** (over - 1), this.opts.maxLockoutMs);
      rec.lockedUntil = t + lockout;
    }
    this.records.set(addr, rec);
    return Math.max(0, rec.lockedUntil - t);
  }

  /** A successful join clears the address. */
  succeed(addr: string): void {
    this.records.delete(addr);
  }

  /** Drop decayed records so the map cannot grow without bound. */
  sweep(): void {
    const t = this.now();
    for (const [addr, rec] of this.records) {
      if (t - rec.lastFailureAt > this.opts.decayMs) this.records.delete(addr);
    }
  }

  get size(): number {
    return this.records.size;
  }
}
