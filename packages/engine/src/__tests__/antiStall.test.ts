import { defaultBalance } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { breathe, idleCycles, shouldBreathe } from '../antiStall.js';
import { hiddenDistinctLetters, revealAll } from '../board.js';
import { createRng } from '../rng.js';
import type { RoundState } from '../state.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, currentId, plantHand, startGame } from '../testing/harness.js';

const balance = defaultBalance();
const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');

describe('idle accounting (§3.6)', () => {
  it('counts full cycles, not turns', () => {
    const round = { turnsSinceReveal: 5, endedReason: null } as RoundState;
    expect(idleCycles(round, 3)).toBe(1);
    expect(idleCycles(round, 0)).toBe(0);
    round.turnsSinceReveal = 6;
    expect(idleCycles(round, 3)).toBe(2);
    expect(shouldBreathe(round, 3, balance)).toBe(true);
    expect(shouldBreathe(round, 8, balance)).toBe(false);
  });

  it('never breathes into an ended round', () => {
    const round = { turnsSinceReveal: 99, endedReason: 'solved' } as RoundState;
    expect(shouldBreathe(round, 2, balance)).toBe(false);
  });
});

describe('the board breathes', () => {
  it('opens one free letter with no pressure and no points', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, seed: 5, settings: { interruptsEnabled: false } });
    const round = s.round as RoundState;
    round.turnsSinceReveal = 9;
    const events: never[] = [];
    expect(breathe(round, createRng(1), events as never)).toBe(true);
    expect(round.revealed).toHaveLength(1);
    expect(round.pressure).toBe(0);
    expect(round.turnsSinceReveal).toBe(0);
    expect(events.map((e: { t: string }) => e.t)).toEqual(['breath', 'reveal']);
  });

  it('is a no-op on a fully open board', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, seed: 5 });
    const round = s.round as RoundState;
    revealAll(round);
    round.turnsSinceReveal = 99;
    expect(breathe(round, createRng(1), [])).toBe(false);
    expect(round.turnsSinceReveal).toBe(0);
  });

  it('fires automatically after two dead cycles of real play', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, seed: 91, settings: { interruptsEnabled: false } });
    // Hands with nothing playable, so every turn is a discard and the board
    // never moves on its own.
    for (const id of ['p1', 'p2']) plantHand(s, id, ['SHUFFLE', 'CRACK', 'PEEK', 'SKIP', 'SHUFFLE', 'CRACK', 'PEEK']);
    s.round!.discard.push(...s.round!.deck);
    s.round!.deck = [];

    for (let i = 0; i < 24 && s.round!.endedReason === null && s.round!.revealed.length === 0; i++) {
      const id = currentId(s);
      s = s.round!.phase === 'awaiting-solve'
        ? act(s, { type: 'pass', playerId: id })
        : act(s, { type: 'timeout', playerId: id });
    }
    expect(s.round!.revealed.length).toBe(1);
    expect(s.round!.pressure).toBe(0);
    expect(hiddenDistinctLetters(s.round!).length).toBeLessThan(16);
  });

  it('can also be driven by tick', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, seed: 5, settings: { interruptsEnabled: false, turnSeconds: null } });
    s.round!.turnsSinceReveal = 99;
    const after = act(s, { type: 'tick' }, 10);
    expect(after.round!.revealed.length).toBe(1);
    expect(after.round!.pressure).toBe(0);
  });
});
