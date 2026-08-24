/**
 * `PlayerView` leak tests (§5, §6.2).
 *
 * A bot's whole claim to legitimacy is that it deduces from the same
 * information a human has. These tests assert that directly.
 */
import { normalizeGuess } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { hiddenDistinctLetters, revealLetter } from '../board.js';
import { createRng } from '../rng.js';
import { randomPolicy, unguessedLetters, passivePolicy } from '../policy.js';
import type { GameState } from '../state.js';
import { TEST_PUZZLES, makePuzzle } from '../testing/fixtures.js';
import { act, currentId, plantAction, plantLetter, startGame } from '../testing/harness.js';
import { playerView, roundPublic } from '../view.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS', { hint: 'Patience, at the stove.' });

function walkStrings(node: unknown, skip: Set<string>, out: string[] = []): string[] {
  if (typeof node === 'string') return (out.push(node), out);
  if (Array.isArray(node)) {
    for (const v of node) walkStrings(v, skip, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (skip.has(k)) continue;
      walkStrings(v, skip, out);
    }
  }
  return out;
}

// Public prose and structural discriminators inside the board payload.
const BOARD_SKIP = new Set(['category', 'hint', 't']);

/** Key names that would mean the server-only round state escaped. */
const FORBIDDEN_KEYS = ['puzzle', 'answer', 'text', 'solution', 'deck', 'discard', 'rngState', 'stack', 'letterStats'];

function keysOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) keysOf(v, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe('playerView never carries the answer', () => {
  it('holds across puzzles and reveal states', () => {
    const rng = createRng(4242);
    for (const puzzle of TEST_PUZZLES) {
      for (let trial = 0; trial < 4; trial++) {
        const state = startGame({ puzzle, seed: rng.int(100000), players: 4, settings: { interruptsEnabled: true } });
        const round = state.round!;
        for (const l of hiddenDistinctLetters(round)) if (rng.bool(0.4)) revealLetter(round, l);
        if (rng.bool(0.5)) round.hintRevealed = true;
        const hidden = new Set(hiddenDistinctLetters(round));
        const answer = normalizeGuess(round.answer);

        for (const p of state.players) {
          const view = playerView(state, p.id);

          // 1. The board carried inside the view is masked, character by
          //    character — the same sweep mask-adversarial.test.ts runs.
          for (const str of walkStrings(view.board, BOARD_SKIP)) {
            for (const ch of str.toUpperCase()) {
              expect(hidden.has(ch), `${ch} leaked to ${p.id} via the board`).toBe(false);
            }
          }

          // 2. None of the server-only round state is reachable at all.
          const keys = new Set(keysOf(view));
          for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);

          // 3. The answer itself never appears, in any spelling.
          const json = JSON.stringify(view);
          if (hidden.size > 0) {
            expect(json.includes(answer)).toBe(false);
            expect(normalizeGuess(json).includes(answer)).toBe(false);
          }

          // 4. Only this player's cards are visible.
          const mine = new Set(p.hand.map((c) => c.id));
          for (const other of state.players) {
            if (other.id === p.id) continue;
            for (const card of other.hand) {
              if (mine.has(card.id)) continue;
              expect(json.includes(`"${card.id}"`), `card ${card.id} leaked to ${p.id}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('shows a player only their own hand and peeks', () => {
    const state = startGame({ puzzle: PUZZLE, players: 3, settings: { interruptsEnabled: true } });
    state.players[1]!.peeks = { 3: 'X' };
    const view = playerView(state, 'p1');
    expect(view.hand.map((c) => c.id).sort()).toEqual(state.players[0]!.hand.map((c) => c.id).sort());
    expect(view.peeks).toEqual({});
    expect(JSON.stringify(view)).not.toContain(state.players[1]!.hand[0]!.id);
    expect(view.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(view.players.every((p) => 'handCount' in p && !('hand' in p))).toBe(true);
  });

  it('surfaces your own peeks, and only yours', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, settings: { interruptsEnabled: false } });
    const id = plantAction(s, 'p1', 'PEEK');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id } });
    expect(Object.keys(playerView(s, 'p1').peeks)).toHaveLength(1);
    expect(playerView(s, 'p2').peeks).toEqual({});
  });

  it('boardPattern is a regex over what is visible, and it matches the answer', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, settings: { interruptsEnabled: false } });
    const cardId = plantLetter(s, 'p1', 'E');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    const view = playerView(s, 'p2');
    const re = new RegExp(view.boardPattern!);
    expect(re.test(s.round!.answer)).toBe(true);
    expect(re.test('SOMETHING COMPLETELY ELSE')).toBe(false);
    // The pattern excludes already-played letters from hidden slots.
    expect(view.boardPattern).toContain('E');
  });
});

describe('playerView state reporting', () => {
  it('reports turn and solve availability', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, settings: { interruptsEnabled: false } });
    expect(playerView(s, 'p1')).toMatchObject({ isMyTurn: true, canAct: true, canSolve: false, hasActed: false });
    expect(playerView(s, 'p2')).toMatchObject({ isMyTurn: false, canAct: false, canSolve: false });
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    expect(playerView(s, 'p1')).toMatchObject({ canAct: false, canSolve: true, hasActed: true });
    s.players[0]!.solveLocked = true;
    expect(playerView(s, 'p1').canSolve).toBe(false);
  });

  it('exposes an open interrupt window only to eligible players', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, seed: 314, settings: { interruptsEnabled: true } });
    for (const p of s.players) {
      p.hand = p.hand.map((c) =>
        c.kind === 'action' && ['SWIPE', 'BLOCK', 'BUZZ_IN'].includes(c.action) ? { id: c.id, kind: 'letter', letter: 'Q' } : c,
      );
    }
    const swipeId = plantAction(s, 'p2', 'SWIPE');
    const cardId = plantLetter(s, 'p1', 'E');
    const next = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    expect(playerView(next, 'p2').window).toMatchObject({ kind: 'hit', playableCardIds: [swipeId], passed: false });
    expect(playerView(next, 'p1').window).toBeNull();
    expect(playerView(next, 'p3').window).toBeNull();
  });

  it('degrades gracefully in the lobby', () => {
    const lobby = startGame({ lobbyOnly: true, players: 3, settings: { interruptsEnabled: true } });
    const view = playerView(lobby, 'p1');
    expect(view).toMatchObject({ phase: null, board: null, round: null, boardPattern: null, canAct: false });
    expect(roundPublic(lobby)).toBeNull();
  });

  it('roundPublic mirrors the masked board and gauge', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, settings: { interruptsEnabled: true } });
    const rp = roundPublic(s)!;
    expect(rp).toMatchObject({ roundNumber: 1, pressure: 0, pressureMax: 12, currentPlayerId: 'p1', direction: 1 });
    expect(rp.deckRemaining).toBe(s.round!.deck.length);
    expect(rp.board.hiddenLetters).toBe(rp.board.totalLetters);
  });

  it('throws for an unknown player', () => {
    const s = startGame({ players: 2, settings: { interruptsEnabled: true } });
    expect(() => playerView(s, 'ghost')).toThrow();
  });
});

describe('reference policies', () => {
  it('randomPolicy always returns a legal action', () => {
    const rng = createRng(9);
    let s: GameState = startGame({ puzzle: PUZZLE, players: 4, seed: 55, settings: { interruptsEnabled: true } });
    for (let i = 0; i < 300 && s.status !== 'match-end'; i++) {
      if (!s.round || s.round.endedReason !== null) {
        s = act(s, { type: 'startRound', puzzle: TEST_PUZZLES[i % TEST_PUZZLES.length]! });
        continue;
      }
      const w = s.round.window;
      if (w) {
        const pending = w.eligible.find((id) => !w.passed.includes(id));
        if (!pending) {
          s = act(s, { type: 'tick' }, w.expiresAt);
          continue;
        }
        const view = playerView(s, pending);
        const choice = view.window ? randomPolicy.chooseInterrupt(view, view.window, rng) : null;
        s = act(s, choice ?? { type: 'passInterrupt', playerId: pending, windowId: w.id });
        continue;
      }
      const id = currentId(s);
      s = act(s, randomPolicy.chooseTurnAction(playerView(s, id), rng));
    }
    expect(s.results.length).toBeGreaterThan(0);
  });

  it('randomPolicy falls back to a timeout with an empty hand', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: { interruptsEnabled: true } });
    s.players[0]!.hand = [];
    const view = playerView(s, 'p1');
    expect(randomPolicy.chooseTurnAction(view, createRng(1)).type).toBe('timeout');
    expect(passivePolicy.chooseTurnAction(view, createRng(1)).type).toBe('timeout');
    expect(passivePolicy.chooseInterrupt(view, { windowId: 'w', kind: 'hit', sourcePlayerId: 'p2', targetPlayerId: null, expiresAt: 0, chain: 0, playableCardIds: ['x'], passed: false }, createRng(1))).toBeNull();
  });

  it('unguessedLetters reflects the board', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { interruptsEnabled: false } });
    expect(unguessedLetters(playerView(s, 'p1'))).toHaveLength(26);
    const cardId = plantLetter(s, 'p1', 'E');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    expect(unguessedLetters(playerView(s, 'p1'))).not.toContain('E');
  });
});
