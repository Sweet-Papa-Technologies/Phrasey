/**
 * Anti-enumeration. The 4-character CVCV code is a name, not a secret — there
 * are only 6,400 of them — so the key is what actually gates a join, and the
 * guard is what makes guessing keys expensive.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_JOIN_GUARD, JoinGuard } from '../net/rateLimit.js';
import { generateRoomKey, keyMatches } from '../rooms/codes.js';
import { ROOM_KEY_PATTERN, formatRoomHandle, isValidRoomKey, parseRoomHandle } from '@phrasey/shared';

describe('room keys', () => {
  it('generates keys in the documented alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const k = generateRoomKey();
      expect(ROOM_KEY_PATTERN.test(k), k).toBe(true);
      expect(isValidRoomKey(k)).toBe(true);
    }
  });

  it('excludes the characters people transcribe wrong', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of generateRoomKey()) seen.add(ch);
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect([...seen], `key alphabet must not contain ${ambiguous}`).not.toContain(ambiguous);
    }
  });

  it('is not concentrated on a few values', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const k = generateRoomKey();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // 31^4 ≈ 923k, so 3000 draws should essentially never repeat much.
    expect([...counts.values()].every((n) => n <= 3)).toBe(true);
    expect(counts.size).toBeGreaterThan(2900);
  });

  it('matches case-insensitively and rejects everything else', () => {
    expect(keyMatches('M3XR', 'm3xr')).toBe(true);
    expect(keyMatches('M3XR', 'M3XR')).toBe(true);
    expect(keyMatches('M3XR', 'M3XQ')).toBe(false);
    expect(keyMatches('M3XR', 'M3X')).toBe(false);
    expect(keyMatches('M3XR', '')).toBe(false);
    expect(keyMatches('M3XR', undefined)).toBe(false);
  });
});

describe('room handles', () => {
  it('round-trips', () => {
    expect(parseRoomHandle(formatRoomHandle('KABO', 'M3XR'))).toEqual({ code: 'KABO', key: 'M3XR' });
  });

  it('forgives how a human retypes one off a screen', () => {
    for (const input of ['kabo-m3xr', 'KABO M3XR', ' kabo_m3xr ', 'KABOM3XR', 'Kabo–M3xr']) {
      expect(parseRoomHandle(input), input).toEqual({ code: 'KABO', key: 'M3XR' });
    }
  });

  it('rejects malformed handles rather than guessing', () => {
    for (const bad of ['KABO', 'M3XR', 'KABO-M3X', 'KABO-M3XRR', 'AAAA-M3XR', '', 'KABO-M0XR']) {
      expect(parseRoomHandle(bad), bad).toBeNull();
    }
  });
});

describe('JoinGuard', () => {
  function guard(now: { t: number }) {
    return new JoinGuard(DEFAULT_JOIN_GUARD, () => now.t);
  }

  it('lets honest mistakes through untouched', () => {
    const now = { t: 0 };
    const g = guard(now);
    for (let i = 0; i < DEFAULT_JOIN_GUARD.freeAttempts; i++) {
      expect(g.fail('1.2.3.4')).toBe(0);
      expect(g.retryAfterMs('1.2.3.4')).toBe(0);
    }
  });

  it('locks out and backs off exponentially after the free attempts', () => {
    const now = { t: 0 };
    const g = guard(now);
    for (let i = 0; i < DEFAULT_JOIN_GUARD.freeAttempts; i++) g.fail('1.2.3.4');

    const first = g.fail('1.2.3.4');
    expect(first).toBe(DEFAULT_JOIN_GUARD.baseLockoutMs);
    const second = g.fail('1.2.3.4');
    expect(second).toBe(DEFAULT_JOIN_GUARD.baseLockoutMs * 2);
    const third = g.fail('1.2.3.4');
    expect(third).toBe(DEFAULT_JOIN_GUARD.baseLockoutMs * 4);
  });

  it('caps the lockout so an address is never bricked forever', () => {
    const now = { t: 0 };
    const g = guard(now);
    let last = 0;
    for (let i = 0; i < 40; i++) last = g.fail('1.2.3.4');
    expect(last).toBe(DEFAULT_JOIN_GUARD.maxLockoutMs);
  });

  it('makes walking the whole 6,400-code space take days, not minutes', () => {
    const now = { t: 0 };
    const g = guard(now);
    const addr = '9.9.9.9';
    let attempts = 0;
    // Simulate an attacker who always waits exactly as long as told to.
    while (attempts < 6400) {
      const wait = g.retryAfterMs(addr);
      if (wait > 0) now.t += wait;
      g.fail(addr);
      attempts++;
    }
    const hours = now.t / 3_600_000;
    expect(hours, `6400 guesses took only ${hours.toFixed(1)}h`).toBeGreaterThan(24);
  });

  it('forgets an address after a clean stretch', () => {
    const now = { t: 0 };
    const g = guard(now);
    for (let i = 0; i < 20; i++) g.fail('1.2.3.4');
    expect(g.retryAfterMs('1.2.3.4')).toBeGreaterThan(0);

    now.t += DEFAULT_JOIN_GUARD.decayMs + 1;
    expect(g.retryAfterMs('1.2.3.4')).toBe(0);
    expect(g.fail('1.2.3.4')).toBe(0); // counter reset, back to free attempts
  });

  it('a successful join clears the address', () => {
    const now = { t: 0 };
    const g = guard(now);
    for (let i = 0; i < 8; i++) g.fail('1.2.3.4');
    g.succeed('1.2.3.4');
    expect(g.retryAfterMs('1.2.3.4')).toBe(0);
    expect(g.size).toBe(0);
  });

  it('tracks addresses independently', () => {
    const now = { t: 0 };
    const g = guard(now);
    for (let i = 0; i < 20; i++) g.fail('1.1.1.1');
    expect(g.retryAfterMs('1.1.1.1')).toBeGreaterThan(0);
    expect(g.retryAfterMs('2.2.2.2')).toBe(0);
  });

  it('sweep drops decayed records so the map cannot grow forever', () => {
    const now = { t: 0 };
    const g = guard(now);
    for (let i = 0; i < 50; i++) g.fail(`10.0.0.${i}`);
    expect(g.size).toBe(50);
    now.t += DEFAULT_JOIN_GUARD.decayMs + 1;
    g.sweep();
    expect(g.size).toBe(0);
  });
});
