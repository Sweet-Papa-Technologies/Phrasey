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
  // NOT tight, deliberately. `turn:solve` doubles as "decline to solve" (the
  // missing `turn:pass`), so it fires every single turn. Guessing is already
  // rate-limited by the rules: one wrong solve locks you out of solving for the
  // rest of the round (§3.3), which is a far harder cap than a token bucket.
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
