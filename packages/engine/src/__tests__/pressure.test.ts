import { defaultBalance } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../invariants.js';
import { applyPressure, isBlown } from '../pressure.js';
import { award, blowoutPenalty, letterHitPoints, solvePoints, transferPoints } from '../scoring.js';
import type { RoundState } from '../state.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, actWithEvents, plantAction, plantLetter, scoreOf, startGame } from '../testing/harness.js';

const balance = defaultBalance();
const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');
const NO_INTERRUPTS = { interruptsEnabled: false };

describe('scoring arithmetic (§3.3)', () => {
  it('pays 10 per occurrence, doubled by DOUBLE DOWN', () => {
    expect(letterHitPoints(1, balance, false)).toBe(10);
    expect(letterHitPoints(4, balance, false)).toBe(40);
    expect(letterHitPoints(4, balance, true)).toBe(80);
  });

  it('pays 50 plus 5 per hidden letter for a solve', () => {
    expect(solvePoints(0, balance)).toBe(50);
    expect(solvePoints(11, balance)).toBe(105);
  });

  it('penalises the blowout culprit 20', () => {
    expect(blowoutPenalty(balance)).toBe(-20);
  });

  it('keeps match and round totals in step', () => {
    const p = { score: 5, roundScore: 2 } as never as { score: number; roundScore: number };
    award(p as never, 10);
    expect(p).toMatchObject({ score: 15, roundScore: 12 });
    const q = { score: 0, roundScore: 0 };
    transferPoints(p as never, q as never, 12);
    expect(p).toMatchObject({ score: 3, roundScore: 0 });
    expect(q).toMatchObject({ score: 12, roundScore: 12 });
  });
});

describe('the pressure gauge (§3.4)', () => {
  function fakeRound(pressure: number): RoundState {
    return { pressure } as RoundState;
  }

  it('clamps to [0, max]', () => {
    const low = fakeRound(1);
    expect(applyPressure(low, -5, 'relief', null, balance, [])).toMatchObject({ value: 0, delta: -1 });
    const high = fakeRound(11);
    expect(applyPressure(high, 9, 'chaos', 'p1', balance, [])).toMatchObject({ value: 12, delta: 1, blowout: true });
  });

  it('emits the event with the delta actually applied', () => {
    const events: never[] = [];
    const round = fakeRound(0);
    applyPressure(round, 3, 'wrong-solve', 'p2', balance, events as never);
    expect(events[0]).toMatchObject({ t: 'pressure', value: 3, delta: 3, cause: 'wrong-solve', byPlayerId: 'p2' });
  });

  it('reports a blown gauge', () => {
    expect(isBlown(fakeRound(12), balance)).toBe(true);
    expect(isBlown(fakeRound(11), balance)).toBe(false);
  });
});

describe('BLOWOUT ends the round (§3.4)', () => {
  it('fires at 12, docks the culprit 20 and keeps everyone else banked', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, seed: 61, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    // Bank some reveal points for p1 first.
    const eId = plantLetter(s, 'p1', 'E');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: eId } });
    const banked = scoreOf(s, 'p1');
    expect(banked).toBeGreaterThan(0);
    s = act(s, { type: 'pass', playerId: 'p1' });

    s.round!.pressure = 11;
    const zId = plantLetter(s, 'p2', 'Z');
    const { state, events } = actWithEvents(s, { type: 'playCard', playerId: 'p2', intent: { type: 'letter', cardId: zId } });

    expect(events.find((e) => e.t === 'blowout')).toMatchObject({ byPlayerId: 'p2', penalty: -20 });
    expect(state.round!.endedReason).toBe('blowout');
    expect(state.results[0]).toMatchObject({ reason: 'blowout', blownBy: 'p2', solvedBy: null });
    expect(scoreOf(state, 'p1')).toBe(banked);
    expect(scoreOf(state, 'p2')).toBe(-20);
    expect(state.round!.currentPlayerId).toBeNull();
    expect(checkInvariants(state)).toEqual([]);
  });

  it('can be tipped by a wrong solve', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, seed: 62, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    s.round!.pressure = 10;
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    s = act(s, { type: 'solve', playerId: 'p1', guess: 'DEFINITELY WRONG' });
    expect(s.round!.endedReason).toBe('blowout');
    expect(s.round!.blownBy).toBe('p1');
  });

  it('can be tipped by VOWEL RUSH or VANDAL', () => {
    for (const [kind, extra] of [['VOWEL_RUSH', { letter: 'O' }], ['VANDAL', {}]] as const) {
      const s = startGame({ puzzle: PUZZLE, players: 2, seed: 63, settings: { ...NO_INTERRUPTS, rounds: 3 } });
      s.round!.pressure = 11;
      const id = plantAction(s, 'p1', kind);
      const after = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id, ...extra } });
      expect(after.round!.endedReason, kind).toBe('blowout');
      expect(after.round!.blownBy).toBe('p1');
      expect(checkInvariants(after)).toEqual([]);
    }
  });

  it('offers no solve bonus once it blows', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, seed: 64, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    s.round!.pressure = 11;
    const zId = plantLetter(s, 'p1', 'Z');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: zId } });
    expect(s.results[0]!.roundScores.p1).toBe(-20);
    expect(s.results[0]!.solvedBy).toBeNull();
  });
});
