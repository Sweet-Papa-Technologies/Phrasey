/**
 * §15: "Build M1 with a seeded RNG from day one. Reproducible matches make every
 * later debugging session cheap."
 */
import { describe, expect, it } from 'vitest';
import { applyAction } from '../actions.js';
import { randomPolicy } from '../policy.js';
import { deductionPolicy } from '../sim/policies.js';
import { simulateMatch } from '../sim/simulate.js';
import { TEST_PUZZLES } from '../testing/fixtures.js';
import { startGame } from '../testing/harness.js';

const PLAYERS = ['p1', 'p2', 'p3', 'p4'];

describe('same seed, same match', () => {
  it('produces byte-identical state and events', () => {
    const run = () =>
      simulateMatch({
        seed: 20260823,
        players: PLAYERS,
        policies: {},
        defaultPolicy: randomPolicy,
        puzzles: TEST_PUZZLES,
        settings: { rounds: 3 },
      });
    const a = run();
    const b = run();
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.stats).toEqual(b.stats);
  });

  it('produces a different match for a different seed', () => {
    const mk = (seed: number) =>
      simulateMatch({ seed, players: PLAYERS, policies: {}, defaultPolicy: randomPolicy, puzzles: TEST_PUZZLES, settings: { rounds: 2 } });
    expect(JSON.stringify(mk(1).state)).not.toBe(JSON.stringify(mk(2).state));
  });

  it('deals an identical opening from an identical seed', () => {
    const a = startGame({ seed: 99, players: 4, puzzle: TEST_PUZZLES[0]! });
    const b = startGame({ seed: 99, players: 4, puzzle: TEST_PUZZLES[0]! });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('resumes an identical stream from a restored rngState (§6.2 snapshots)', () => {
    let live = startGame({ seed: 5150, players: 3, puzzle: TEST_PUZZLES[4]! });
    live = applyAction(live, { type: 'timeout', playerId: 'p1' }, 0).state;

    // Simulate a crash + Firestore restore: JSON round-trip, nothing else.
    const restored = JSON.parse(JSON.stringify(live));
    const fromLive = applyAction(live, { type: 'tick' }, 999_999).state;
    const fromRestored = applyAction(restored, { type: 'tick' }, 999_999).state;
    expect(JSON.stringify(fromRestored)).toBe(JSON.stringify(fromLive));
  });

  it('keeps engine randomness independent of policy randomness', () => {
    const opts = { seed: 4242, players: PLAYERS, policies: {}, puzzles: TEST_PUZZLES, settings: { rounds: 1 } };
    const withRandom = simulateMatch({ ...opts, defaultPolicy: randomPolicy });
    const withDeduction = simulateMatch({
      ...opts,
      defaultPolicy: deductionPolicy({ corpus: TEST_PUZZLES, solveRoll: 1, actionCardBias: 0.3, scoreNoise: 0 }),
    });
    // Same seed => same deal, regardless of how the players then behave.
    const deal = (s: ReturnType<typeof simulateMatch>) => s.events.find((e) => e.t === 'round:start');
    expect(deal(withRandom)).toEqual(deal(withDeduction));
  });
});
