/**
 * The invariant checker is what the soak test trusts, so it gets its own tests:
 * every violation code must actually fire when the corresponding rule is broken.
 */
import { describe, expect, it } from 'vitest';
import { assertInvariants, checkInvariants, checkMonotonicReveal, scoresFromEvents } from '../invariants.js';
import type { GameState } from '../state.js';
import { makePuzzle } from '../testing/fixtures.js';
import { startGame } from '../testing/harness.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');

function fresh(): GameState {
  return startGame({ puzzle: PUZZLE, players: 3, seed: 17, settings: { interruptsEnabled: false } });
}

function codes(s: GameState): string[] {
  return checkInvariants(s).map((v) => v.code);
}

describe('checkInvariants', () => {
  it('is clean on a freshly dealt round', () => {
    expect(checkInvariants(fresh())).toEqual([]);
    expect(() => assertInvariants(fresh(), 'fresh')).not.toThrow();
  });

  it('short-circuits with no round', () => {
    const lobby = startGame({ players: 2, lobbyOnly: true });
    expect(checkInvariants(lobby)).toEqual([]);
  });

  it('catches a card appearing from nowhere', () => {
    const s = fresh();
    s.players[0]!.hand.push({ id: 'ghost', kind: 'letter', letter: 'E' });
    expect(codes(s)).toContain('CARD_CONSERVATION');
  });

  it('catches a duplicated card', () => {
    const s = fresh();
    const card = s.players[0]!.hand[0]!;
    s.round!.deck.pop();
    s.players[1]!.hand.push({ ...card });
    expect(codes(s)).toContain('DUPLICATE_CARD');
  });

  it('catches an over-full hand', () => {
    const s = fresh();
    s.players[0]!.hand.push(...s.round!.deck.splice(0, 5));
    expect(codes(s)).toContain('HAND_SIZE');
  });

  it('catches a gauge outside the range', () => {
    const s = fresh();
    s.round!.pressure = 13;
    expect(codes(s)).toContain('PRESSURE_RANGE');
    s.round!.pressure = -1;
    expect(codes(s)).toContain('PRESSURE_RANGE');
  });

  it('catches a live round with nobody, or the wrong body, on the clock', () => {
    const a = fresh();
    a.round!.currentPlayerId = null;
    expect(codes(a)).toContain('NO_CURRENT_PLAYER');

    const b = fresh();
    b.round!.currentPlayerId = 'ghost';
    expect(codes(b)).toContain('CURRENT_PLAYER_NOT_SEATED');

    const c = fresh();
    c.round!.endedReason = 'solved';
    c.round!.phase = 'ended';
    expect(codes(c)).toContain('CURRENT_PLAYER_AFTER_END');
  });

  it('catches phantom reveals and phantom misses', () => {
    const a = fresh();
    a.round!.revealed.push('Z');
    expect(codes(a)).toContain('PHANTOM_REVEAL');

    const b = fresh();
    b.round!.missed.push('E');
    expect(codes(b)).toContain('PHANTOM_MISS');

    const c = fresh();
    c.round!.revealed.push('E');
    c.round!.missed.push('E');
    expect(codes(c)).toContain('REVEALED_AND_MISSED');
  });

  it('catches an over-deep interrupt chain', () => {
    const a = fresh();
    a.round!.window = {
      id: 'w', kind: 'hit', sourcePlayerId: 'p1', targetPlayerId: null, expiresAt: 0, chain: 9, eligible: [], passed: [],
    };
    expect(codes(a)).toContain('CHAIN_OVERFLOW');

    const b = fresh();
    const card = b.round!.deck.pop()!;
    b.round!.stack = Array.from({ length: 6 }, () => ({ kind: 'block' as const, playerId: 'p1', card: card as never }));
    expect(codes(b)).toContain('STACK_OVERFLOW');
  });

  it('catches a phase that disagrees with the end reason', () => {
    const a = fresh();
    a.round!.phase = 'ended';
    expect(codes(a)).toContain('PHASE_MISMATCH');

    const b = fresh();
    b.round!.endedReason = 'solved';
    b.round!.currentPlayerId = null;
    expect(codes(b)).toContain('PHASE_MISMATCH');
  });

  it('assertInvariants reports every violation it found', () => {
    const s = fresh();
    s.round!.pressure = 99;
    expect(() => assertInvariants(s, 'boom')).toThrow(/boom.*PRESSURE_RANGE/s);
    expect(() => assertInvariants(s)).toThrow(/PRESSURE_RANGE/);
  });
});

describe('checkMonotonicReveal', () => {
  it('flags a letter that went back into hiding', () => {
    const before = fresh();
    before.round!.revealed.push('E', 'A');
    const after = structuredClone(before);
    after.round!.revealed = ['A'];
    expect(checkMonotonicReveal(before, after).map((v) => v.code)).toEqual(['UNREVEAL']);
  });

  it('accepts new reveals and ignores a round boundary', () => {
    const before = fresh();
    before.round!.revealed.push('E');
    const after = structuredClone(before);
    after.round!.revealed.push('A');
    expect(checkMonotonicReveal(before, after)).toEqual([]);

    after.round!.roundNumber = 2;
    after.round!.revealed = [];
    expect(checkMonotonicReveal(before, after)).toEqual([]);

    const lobby = startGame({ players: 2, lobbyOnly: true });
    expect(checkMonotonicReveal(lobby, lobby)).toEqual([]);
  });
});

describe('scoresFromEvents', () => {
  it('replays every scoring event and ignores the rest', () => {
    const totals = scoresFromEvents([
      { t: 'letter:hit', playerId: 'a', letter: 'E', occurrences: 3, points: 30, positions: [] },
      { t: 'solve:success', playerId: 'b', points: 75, hiddenAtSolve: 5 },
      { t: 'swipe', playerId: 'c', fromPlayerId: 'a', points: 30 },
      { t: 'blowout', byPlayerId: 'b', penalty: -20 },
      { t: 'blowout', byPlayerId: null, penalty: -20 },
      { t: 'notice', message: 'ignored' },
    ]);
    expect(totals).toEqual({ a: 0, b: 55, c: 30 });
  });
});
