import { describe, expect, it } from 'vitest';
import { endMatch, endRound, isMatchComplete, matchWinners } from '../match.js';
import { createMatch } from '../state.js';
import { TEST_PUZZLES, makePuzzle } from '../testing/fixtures.js';
import { act, currentId, startGame } from '../testing/harness.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');
const NO_INTERRUPTS = { interruptsEnabled: false };

/** Solve the current round outright. */
function solveRound(state: ReturnType<typeof startGame>, answer = PUZZLE.text) {
  const id = currentId(state);
  const s = act(state, { type: 'discard', playerId: id, cardIds: [state.players.find((p) => p.id === id)!.hand[0]!.id] });
  return act(s, { type: 'solve', playerId: id, guess: answer });
}

describe("match mode 'rounds' (§3.1)", () => {
  it('runs a fixed number of rounds and then ends', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, matchMode: 'rounds', rounds: 3 } });
    for (let r = 1; r <= 3; r++) {
      s = solveRound(s);
      expect(s.results).toHaveLength(r);
      if (r < 3) {
        expect(s.status).toBe('round-end');
        s = act(s, { type: 'startRound', puzzle: PUZZLE });
      }
    }
    expect(s.status).toBe('match-end');
    expect(s.matchResult).toMatchObject({ roundsPlayed: 3 });
    expect(s.matchResult!.sessionId).toBe(s.sessionId);
  });

  it('refuses to deal another round after the match is over', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, matchMode: 'rounds', rounds: 1 } });
    s = solveRound(s);
    expect(s.status).toBe('match-end');
    expect(() => act(s, { type: 'startRound', puzzle: PUZZLE })).toThrow(/match is over/);
  });
});

describe("match mode 'score' (§3.1)", () => {
  it('ends only after a completed round, once somebody is past the target', () => {
    let s = startGame({
      puzzle: PUZZLE,
      players: 2,
      settings: { ...NO_INTERRUPTS, matchMode: 'score', targetScore: 120, rounds: 99 },
    });
    s = solveRound(s);
    // A single solve on a blank board is worth 50 + 5 x hidden, well past 120.
    expect(s.players.some((p) => p.score >= 120)).toBe(true);
    expect(s.status).toBe('match-end');
  });

  it('keeps dealing while everyone is short of the target', () => {
    let s = startGame({
      puzzle: PUZZLE,
      players: 2,
      settings: { ...NO_INTERRUPTS, matchMode: 'score', targetScore: 5000, rounds: 99 },
    });
    s = solveRound(s);
    expect(s.status).toBe('round-end');
    expect(isMatchComplete(s)).toBe(false);
    s = act(s, { type: 'startRound', puzzle: TEST_PUZZLES[1]! });
    expect(s.status).toBe('playing');
    expect(s.roundNumber).toBe(2);
  });
});

describe('match bookkeeping', () => {
  it('reports every player on the top score as a winner', () => {
    const s = createMatch({ seed: 1, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
    s.players[0]!.score = 40;
    s.players[1]!.score = 40;
    s.players[2]!.score = 10;
    expect(matchWinners(s).sort()).toEqual(['a', 'b']);
    const events: never[] = [];
    expect(endMatch(s, events as never)).toMatchObject({ winnerIds: ['a', 'b'], totals: { a: 40, b: 40, c: 10 } });
    expect(s.status).toBe('match-end');
  });

  it('handles an empty table without throwing', () => {
    const s = createMatch({ seed: 1, players: [{ id: 'a', name: 'A' }] });
    s.players[0]!.removed = true;
    expect(matchWinners(s)).toEqual([]);
    expect(isMatchComplete(s)).toBe(false);
    s.settings.matchMode = 'score';
    expect(isMatchComplete(s)).toBe(false);
  });

  it('carries per-round and running totals in RoundResult', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 2 } });
    s = solveRound(s);
    const first = s.results[0]!;
    expect(first.totals).toEqual(first.roundScores);
    s = act(s, { type: 'startRound', puzzle: PUZZLE });
    s = solveRound(s);
    const second = s.results[1]!;
    expect(second.totals.p1! + second.totals.p2!).toBe(
      first.roundScores.p1! + first.roundScores.p2! + second.roundScores.p1! + second.roundScores.p2!,
    );
  });

  it('endRound is idempotent', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    s = solveRound(s);
    expect(endRound(s, 'abandoned', {}, [])).toBeNull();
    expect(s.results).toHaveLength(1);
  });

  it('resets round scores but not match scores at the next deal', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    s = solveRound(s);
    const banked = s.players.map((p) => p.score);
    s = act(s, { type: 'startRound', puzzle: TEST_PUZZLES[2]! });
    expect(s.players.map((p) => p.score)).toEqual(banked);
    expect(s.players.map((p) => p.roundScore)).toEqual([0, 0]);
    expect(s.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(s.players.every((p) => Object.keys(p.peeks).length === 0)).toBe(true);
  });
});
