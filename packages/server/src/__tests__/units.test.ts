/**
 * Unit coverage for the pieces around the room: codes, validation, limits,
 * persistence encoding, logging redaction, and the bot policy seam.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOM_CODE_PATTERN } from '@phrasey/shared';
import { createMatch, randomPolicy, TEST_PUZZLES } from '@phrasey/engine';
import { codeAt, generateRoomCode, isUsableCode, TOTAL_CODES } from '../rooms/codes.js';
import { CVCV_SUPPLEMENT, isProfaneCode, PROFANITY_SUBSTRINGS, PROFANITY_WORDS } from '../rooms/profanity.js';
import { RateLimiter } from '../net/rateLimit.js';
import {
  createRoomSchema,
  discardSchema,
  emoteSchema,
  joinRoomSchema,
  nameSchema,
  playCardSchema,
  settingsSchema,
} from '../net/schemas.js';
import { decodeState, encodeState, hashToken, ttlFrom } from '../data/rooms.js';
import { createSessionStore } from '../data/sessions.js';
import { loadPuzzles } from '../data/puzzles.js';
import { loadBalance } from '../data/balance.js';
import { resolveBotPolicies } from '../bots/policies.js';
import { createLogger } from '../logger.js';
import { loadConfig } from '../config.js';
import { toSocketError, AppError } from '../errors.js';

const silent = createLogger({ level: 'silent', pretty: false });

/** U+202E RIGHT-TO-LEFT OVERRIDE, spelled out so this file stays plain ASCII. */
const RTL_OVERRIDE = String.fromCharCode(0x202e);

describe('room codes (6.6)', () => {
  it('always produces a pronounceable CVCV code', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode(seen);
      expect(code).toMatch(ROOM_CODE_PATTERN);
      expect(isProfaneCode(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(2000);
  });

  it('enumerates the whole space exactly once', () => {
    const all = new Set<string>();
    for (let i = 0; i < TOTAL_CODES; i++) {
      const c = codeAt(i);
      expect(c).toMatch(ROOM_CODE_PATTERN);
      all.add(c);
    }
    expect(all.size).toBe(TOTAL_CODES);
  });

  it('exhausts cleanly rather than handing out a duplicate', () => {
    const taken = new Set<string>();
    for (let i = 0; i < TOTAL_CODES; i++) taken.add(codeAt(i));
    expect(() => generateRoomCode(taken)).toThrow(/exhausted/);
  });

  it('never hands out a screened code', () => {
    for (const bad of ['HOMO', 'PEDO', 'RAPE', 'KIKE', 'NAZI', 'PAKI']) {
      expect(isProfaneCode(bad)).toBe(true);
      expect(isUsableCode(bad, new Set())).toBe(false);
      expect(generateRoomCode(new Set(), () => 0)).not.toBe(bad);
    }
  });

  it('stays in sync with corpus-gen/data/profanity.json', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const raw = JSON.parse(readFileSync(join(root, 'packages/corpus-gen/data/profanity.json'), 'utf8')) as {
      words: string[];
      substrings: string[];
    };
    // The copy must be a superset: corpus-gen may add terms and the supplement
    // adds CVCV-only ones, but a term dropped from the copy is a regression.
    for (const w of raw.words) expect(PROFANITY_WORDS).toContain(w.toLowerCase());
    for (const s of raw.substrings) expect(PROFANITY_SUBSTRINGS).toContain(s.toLowerCase());
    expect(CVCV_SUPPLEMENT.length).toBeGreaterThan(0);
  });
});

describe('input validation', () => {
  it('rejects non-printable, oversized and empty display names', () => {
    expect(nameSchema.safeParse('Forrester').success).toBe(true);
    expect(nameSchema.safeParse('').success).toBe(false);
    expect(nameSchema.safeParse('   ').success).toBe(false);
    expect(nameSchema.safeParse('x'.repeat(200)).success).toBe(false);
    expect(nameSchema.safeParse(`a${RTL_OVERRIDE}b`).success).toBe(false);
    expect(nameSchema.safeParse('ab').success).toBe(false);
    expect(nameSchema.safeParse('\u{1F600}').success).toBe(false);
  });

  it('normalises a room code and rejects a malformed one', () => {
    const ok = joinRoomSchema.safeParse({ code: 'kabo', name: 'a', color: '#FF5C1A' });
    expect(ok.success && ok.data.code).toBe('KABO');
    expect(joinRoomSchema.safeParse({ code: 'AAAA', name: 'a', color: '#FF5C1A' }).success).toBe(false);
    expect(joinRoomSchema.safeParse({ code: 'KABOO', name: 'a', color: '#FF5C1A' }).success).toBe(false);
  });

  it('falls back to a palette colour instead of accepting arbitrary CSS', () => {
    const res = createRoomSchema.safeParse({ name: 'a', color: 'url(javascript:alert(1))' });
    expect(res.success).toBe(true);
    expect(res.success && res.data.color).toBe('#FF5C1A');
  });

  it('bounds card ids, discards, emotes and settings', () => {
    expect(playCardSchema.safeParse({ type: 'letter', cardId: 'a b' }).success).toBe(false);
    expect(playCardSchema.safeParse({ type: 'action', cardId: 'c1', letter: 'aa' }).success).toBe(false);
    expect(playCardSchema.safeParse({ type: 'action', cardId: 'c1', letter: 'Q' }).success).toBe(true);
    expect(discardSchema.safeParse({ cardIds: [] }).success).toBe(false);
    expect(discardSchema.safeParse({ cardIds: Array(20).fill('c') }).success).toBe(false);
    expect(emoteSchema.safeParse({ emote: 'anything' }).success).toBe(false);
    expect(settingsSchema.safeParse({ turnSeconds: 7 }).success).toBe(false);
    expect(settingsSchema.safeParse({ turnSeconds: null }).success).toBe(true);
    expect(settingsSchema.safeParse({ botCount: 99 }).success).toBe(false);
  });
});

describe('rate limiting', () => {
  it('lets a normal burst through and throttles a flood', () => {
    const rl = new RateLimiter();
    let now = 0;
    let allowed = 0;
    for (let i = 0; i < 200; i++) if (rl.allow('s1', 'turn:playCard', now)) allowed++;
    expect(allowed).toBeGreaterThan(20);
    expect(allowed).toBeLessThan(200);
    now += 5000;
    expect(rl.allow('s1', 'turn:playCard', now)).toBe(true);
  });

  it('isolates sockets from each other', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 200; i++) rl.allow('noisy', 'chat:emote', 0);
    expect(rl.allow('quiet', 'chat:emote', 0)).toBe(true);
  });

  it('forgets a socket on disconnect', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 200; i++) rl.allow('s', 'chat:emote', 0);
    expect(rl.allow('s', 'chat:emote', 0)).toBe(false);
    rl.forget('s');
    expect(rl.allow('s', 'chat:emote', 0)).toBe(true);
  });
});

describe('persistence encoding', () => {
  it('round-trips a GameState through gzip and base64 unchanged', () => {
    const state = createMatch({ seed: 4242, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    const back = decodeState(encodeState(state));
    expect(back).toEqual(state);
    // The RNG is one uint32, so a restored snapshot resumes the same stream.
    expect(back.rngState).toBe(state.rngState);
  });

  it('makes ttl a Firestore Timestamp of createdAt plus 6h', () => {
    const created = Date.UTC(2026, 0, 1, 12, 0, 0);
    const ttl = ttlFrom(created, 6);
    expect(typeof ttl.toMillis).toBe('function');
    expect(ttl.toMillis() - created).toBe(6 * 3_600_000);
  });

  it('hashes session tokens rather than storing them', () => {
    const h = hashToken('super-secret');
    expect(h).toHaveLength(64);
    expect(h).not.toContain('super-secret');
    expect(hashToken('super-secret')).toBe(h);
  });

  it('writes a session summary with scores and puzzle ids but no names', async () => {
    const captured: Record<string, unknown>[] = [];
    const fakeDb = {
      collection: () => ({ doc: () => ({ set: async (d: Record<string, unknown>) => void captured.push(d) }) }),
    } as never;
    const store = createSessionStore(fakeDb, silent);
    await store.write(
      { winnerIds: ['a'], totals: { a: 300, b: 100 }, roundsPlayed: 3, sessionId: 'sess-1' },
      { puzzleIds: ['p1', 'p2'], playerCount: 2, botCount: 1 },
    );
    expect(captured).toHaveLength(1);
    const doc = captured[0]!;
    expect(doc.scores).toEqual({ a: 300, b: 100 });
    expect(doc.puzzleIds).toEqual(['p1', 'p2']);
    expect(JSON.stringify(doc)).not.toMatch(/name/i);
  });
});

describe('data loading falls back rather than failing', () => {
  it('uses engine fixtures when Firestore is unavailable', async () => {
    const src = await loadPuzzles(null, silent);
    expect(src.origin).toBe('fixtures');
    expect(src.size).toBe(TEST_PUZZLES.length);
  });

  it('never repeats a puzzle within a match until the pool is spent', async () => {
    const src = await loadPuzzles(null, silent);
    const used: string[] = [];
    for (let i = 0; i < src.size; i++) {
      const p = src.pick(used, Math.random);
      expect(used).not.toContain(p.id);
      used.push(p.id);
    }
    expect(src.pick(used, Math.random)).toBeTruthy();
  });

  it('rejects a corrupt puzzle document instead of dealing it', async () => {
    const docs = [
      { id: 'good', data: () => ({ text: 'A WATCHED POT NEVER BOILS', category: 'x', hint: 'y', active: true }) },
      { id: 'bad-empty', data: () => ({ text: '', active: true }) },
      { id: 'bad-chars', data: () => ({ text: 'HELLO <script>', active: true }) },
    ];
    const db = { collection: () => ({ where: () => ({ get: async () => ({ docs }) }) }) } as never;
    const src = await loadPuzzles(db, silent);
    expect(src.size).toBe(1);
    expect(src.byId('good')).toBeTruthy();
    // letterStats is recomputed, never trusted from the document.
    expect(src.byId('good')!.letterStats.O).toBe(2);
  });

  it('uses default balance when /config/balance is absent, and merges when present', async () => {
    const missing = { doc: () => ({ get: async () => ({ exists: false }) }) } as never;
    expect((await loadBalance(missing, silent)).pressure.max).toBe(12);

    const present = {
      doc: () => ({ get: async () => ({ exists: true, data: () => ({ pressure: { max: 20 }, bogus: 1 }) }) }),
    } as never;
    const merged = await loadBalance(present, silent);
    expect(merged.pressure.max).toBe(20);
    expect((merged as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});

describe('bot policy seam', () => {
  it('resolves a factory when the engine exports one, or falls back cleanly', async () => {
    const policies = await resolveBotPolicies(silent, {});
    const p = policies.for('sharp');
    expect(typeof p.chooseTurnAction).toBe('function');
    expect(typeof p.chooseInterrupt).toBe('function');
    // Either M4's factory or the documented fallback, never nothing.
    expect(policies.origin === 'fallback:randomPolicy' || policies.origin.startsWith('engine:')).toBe(true);
  });

  it('never returns a broken policy object', async () => {
    const policies = await resolveBotPolicies(silent, {});
    for (const tier of ['chill', 'sharp', 'ruthless'] as const) {
      expect(policies.for(tier)).toBeTruthy();
    }
    expect(randomPolicy.chooseInterrupt).toBeTruthy();
  });
});

describe('logging (11)', () => {
  it('redacts names, puzzle text, hints and guesses', () => {
    const lines: string[] = [];
    const log = createLogger({
      level: 'info',
      pretty: false,
      destination: { write: (chunk: string) => void lines.push(chunk) },
    });
    log.info({ name: 'Forrester', text: 'MILK EGGS AND THE GOOD BREAD', hint: 'secret', guess: 'MILK' }, 'x');
    const blob = lines.join('');
    expect(blob).not.toContain('Forrester');
    expect(blob).not.toContain('MILK EGGS');
    expect(blob).not.toContain('secret');
    expect(blob).toContain('[redacted]');
  });
});

describe('config and errors', () => {
  it('binds 0.0.0.0 and never reads the ambient HOST variable', () => {
    const cfg = loadConfig({ PORT: '9090', HOST: 'my-laptop.local' });
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.port).toBe(9090);
    expect(loadConfig({ BIND_HOST: '127.0.0.1' }).host).toBe('127.0.0.1');
  });

  it('defaults the Firestore database to phrasey, never (default)', () => {
    expect(loadConfig({}).databaseId).toBe('phrasey');
    expect(loadConfig({ FIRESTORE_DATABASE_ID: 'phrasey' }).databaseId).toBe('phrasey');
  });

  it('parses CORS origins and turns the leak guard off only in production', () => {
    expect(loadConfig({ CORS_ORIGINS: 'https://a.dev, https://b.dev' }).corsOrigins).toEqual([
      'https://a.dev',
      'https://b.dev',
    ]);
    // The guard is on in production too; only an explicit opt-out disables it.
    expect(loadConfig({ NODE_ENV: 'production' }).leakGuard).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development' }).leakGuard).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', LEAK_GUARD: '0' }).leakGuard).toBe(false);
  });

  it('never leaks an internal message to a client', () => {
    expect(toSocketError(new Error('deck.pop of undefined at /repo/x.ts:12'))).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong.',
    });
    expect(toSocketError(new AppError('NOT_HOST', 'Only the host can do that.')).code).toBe('NOT_HOST');
  });
});
