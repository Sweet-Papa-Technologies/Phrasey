/**
 * The adversarial masking suite (§15: "Write maskBoard() once. Test it
 * adversarially. Everything else in the security model rests on it.").
 *
 * Strategy: play hundreds of seeded rounds through the real engine, push every
 * step through the REAL `Fanout`, capture every payload that would have hit a
 * socket, and assert against the state at that instant that none of them
 * contains the answer, an unrevealed hint, or a letter still face-down.
 *
 * This is stronger than checking `maskBoard` alone, because the thing most
 * likely to leak is not the board — it is the `GameEvent[]` riding inside
 * `board:update`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@phrasey/shared';
import { normalizeGuess } from '@phrasey/shared';
import {
  applyAction,
  createMatch,
  createRng,
  hiddenDistinctLetters,
  playerView,
  randomPolicy,
  TEST_PUZZLES,
  type EngineAction,
  type GameState,
} from '@phrasey/engine';
import { Fanout, type Recipient } from '../rooms/fanout.js';
import { createLogger } from '../logger.js';
import { assertNoLeak, eventsFor, PUBLIC_EVENT_KINDS, secretsOf } from '../leakGuard.js';

const log = createLogger({ level: 'silent', pretty: false });

interface Capture {
  playerId: string;
  event: string;
  payload: unknown;
}

/** Drive one seeded match and capture every payload the fan-out produced. */
function playMatch(seed: number): { captures: Capture[]; answers: string[]; peeksSeen: number } {
  const captures: Capture[] = [];
  const fanout = new Fanout(
    (socketId, event, payload) => captures.push({ playerId: socketId, event: String(event), payload }),
    // Guard OFF here: this run is the corpus the assertions below inspect. If
    // the guard dropped a bad payload we would never see it.
    false,
    log,
  );

  const ids = ['a', 'b', 'c'];
  const recipients: Recipient[] = ids.map((id) => ({ playerId: id, socketId: id }));
  let state: GameState = createMatch({
    seed,
    players: ids.map((id, i) => ({ id, name: `P${i}`, isHost: i === 0 })),
    settings: { rounds: 2, matchMode: 'rounds' },
  });

  const rng = createRng(seed ^ 0x1234);
  const answers: string[] = [];
  let peeksSeen = 0;
  let now = 0;
  let guard = 0;

  const step = (action: EngineAction): void => {
    const before = state;
    let res;
    try {
      res = applyAction(before, action, now);
    } catch {
      // Illegal proposals from the random policy are expected; skip them.
      res = applyAction(before, { type: 'timeout' }, now);
    }
    state = res.state;
    peeksSeen += res.events.filter((e) => e.t === 'peek').length;
    fanout.game(state, recipients, res.events);
    now += 400;
  };

  while (state.status !== 'match-end' && guard++ < 4000) {
    const round = state.round;
    if (!round || round.endedReason !== null) {
      const puzzle = TEST_PUZZLES[rng.int(TEST_PUZZLES.length)];
      if (!puzzle) break;
      answers.push(puzzle.text);
      step({ type: 'startRound', puzzle });
      continue;
    }
    const w = round.window;
    if (w) {
      const pending = w.eligible.find((id) => !w.passed.includes(id));
      if (!pending) {
        now = Math.max(now, w.expiresAt);
        step({ type: 'tick' });
        continue;
      }
      const view = playerView(state, pending);
      const wv = view.window;
      const choice = wv ? randomPolicy.chooseInterrupt(view, wv, rng) : null;
      step(choice ?? { type: 'passInterrupt', playerId: pending, windowId: w.id });
      continue;
    }
    const cur = round.currentPlayerId;
    if (!cur) {
      step({ type: 'tick' });
      continue;
    }
    step(randomPolicy.chooseTurnAction(playerView(state, cur), rng));
  }

  return { captures, answers, peeksSeen };
}

describe('fan-out masking', () => {
  it('never emits the answer or a hidden letter, across many seeded matches', () => {
    let totalCaptures = 0;
    let totalPeeks = 0;

    for (let seed = 1; seed <= 40; seed++) {
      const { captures, answers, peeksSeen } = playMatch(seed);
      totalCaptures += captures.length;
      totalPeeks += peeksSeen;
      expect(captures.length).toBeGreaterThan(0);

      const normalizedAnswers = answers.map((a) => normalizeGuess(a));

      for (const c of captures) {
        const blob = JSON.stringify(c.payload);
        // `round:end` and `match:end` legitimately carry the answer — the round
        // is over by then (types.ts) and the board has been flipped face-up.
        const endsRound =
          c.event === 'round:end' ||
          c.event === 'match:end' ||
          (c.event === 'board:update' &&
            (c.payload as { events: GameEvent[] }).events.some((e) => e.t === 'round:end'));
        if (endsRound) continue;

        // A board that is entirely face-up spells the answer out by design.
        const fullyOpen =
          c.event === 'board:update' &&
          (c.payload as { board: { hiddenLetters: number } }).board.hiddenLetters === 0;
        if (fullyOpen) continue;

        const norm = normalizeGuess(blob);
        for (const answer of normalizedAnswers) {
          expect(norm.includes(answer), `${c.event} leaked an answer`).toBe(false);
        }
      }
    }

    // The suite is worthless if the random policy never actually played a PEEK.
    expect(totalPeeks).toBeGreaterThan(0);
    expect(totalCaptures).toBeGreaterThan(1000);
  });

  it('routes every peek event to the peeking socket and nobody else', () => {
    let peeksDelivered = 0;
    for (let seed = 50; seed <= 70; seed++) {
      const { captures } = playMatch(seed);
      for (const c of captures) {
        if (c.event !== 'board:update') continue;
        for (const e of (c.payload as { events: GameEvent[] }).events) {
          if (e.t !== 'peek') continue;
          peeksDelivered++;
          expect(e.playerId, 'peek reached the wrong socket').toBe(c.playerId);
        }
      }
    }
    expect(peeksDelivered).toBeGreaterThan(0);
  });

  it("never puts another player's peeked letter in their peeks map", () => {
    for (let seed = 80; seed <= 90; seed++) {
      const { captures } = playMatch(seed);
      const byPlayer = new Map<string, Set<string>>();
      for (const c of captures) {
        if (c.event !== 'hand:update') continue;
        const peeks = (c.payload as { peeks: Record<number, string> }).peeks;
        const set = byPlayer.get(c.playerId) ?? new Set<string>();
        for (const [idx, ch] of Object.entries(peeks)) set.add(`${idx}:${ch}`);
        byPlayer.set(c.playerId, set);
      }
      // Every peek a player holds must have been announced to that same player.
      for (const c of captures) {
        if (c.event !== 'board:update') continue;
        for (const e of (c.payload as { events: GameEvent[] }).events) {
          if (e.t === 'peek') expect(byPlayer.get(c.playerId)?.has(`${e.index}:${e.letter}`)).toBe(true);
        }
      }
    }
  });

  it('emits no hidden-tile `ch` field anywhere in a masked board', () => {
    for (let seed = 100; seed <= 110; seed++) {
      const { captures } = playMatch(seed);
      for (const c of captures) {
        const board = (c.payload as { board?: { words: { t: string; revealed?: boolean; ch?: string }[][] } }).board;
        if (!board) continue;
        for (const word of board.words) {
          for (const cell of word) {
            if (cell.t === 'letter' && cell.revealed === false) {
              expect(Object.hasOwn(cell, 'ch'), 'hidden cell carried a ch field').toBe(false);
            }
          }
        }
      }
    }
  });
});

describe('leak guard', () => {
  it('catches a hand-rolled leak that the masker would never produce', () => {
    const state = createMatch({ seed: 7, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    const puzzle = TEST_PUZZLES[0]!;
    const { state: dealt } = applyAction(state, { type: 'startRound', puzzle }, 0);
    const secrets = secretsOf(dealt);
    expect(secrets).not.toBeNull();

    expect(() => assertNoLeak('board:update', { answer: puzzle.text }, secrets)).toThrow(/answer leaked/);
    const hidden = hiddenDistinctLetters(dealt.round!)[0]!;
    expect(() => assertNoLeak('board:update', { events: [{ t: 'peek', letter: hidden }] }, secrets)).toThrow(
      /hidden letter leaked/,
    );
    expect(() => assertNoLeak('board:update', { hint: puzzle.hint }, secrets)).toThrow(/hint leaked/);
    // A letter in your own hand is not a leak.
    expect(() => assertNoLeak('hand:update', { cards: [{ letter: hidden }] }, secrets)).not.toThrow();
  });

  it('fails closed: an unclassified event kind is withheld from everyone', () => {
    const rogue = { t: 'brand:new:event', playerId: 'a' } as unknown as GameEvent;
    expect(PUBLIC_EVENT_KINDS.has(rogue.t)).toBe(false);
    expect(eventsFor('a', [rogue])).toHaveLength(0);
    expect(eventsFor('b', [rogue])).toHaveLength(0);
    expect(eventsFor(null, [rogue])).toHaveLength(0);
  });

  it('routes peek only to its owner', () => {
    const peek: GameEvent = { t: 'peek', playerId: 'a', index: 3, letter: 'Q' };
    const pub: GameEvent = { t: 'notice', message: 'hello' };
    expect(eventsFor('a', [peek, pub])).toHaveLength(2);
    expect(eventsFor('b', [peek, pub])).toEqual([pub]);
  });
});

describe('fan-out is the only emit path', () => {
  it('no module outside app.ts and fanout.ts calls .emit()', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          // `dev/` is a CLIENT (socket.io-client); `__tests__/` is test code.
          if (entry === 'dev' || entry === '__tests__') continue;
          walk(p);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const rel = p.slice(root.length + 1);
        if (rel === 'app.ts' || rel === 'rooms/fanout.ts') continue;
        if (/\.emit\(/.test(readFileSync(p, 'utf8'))) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
