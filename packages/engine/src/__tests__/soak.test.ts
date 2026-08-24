/**
 * §14 M1 exit criterion: "200 seeded random matches complete without deadlock or
 * illegal state."
 *
 * Every single action in every single match is followed by a full invariant
 * sweep. The invariants are the ones the milestone names:
 *   - card conservation (deck + hands + discard + in-play === deck size)
 *   - pressure inside [0, 12]
 *   - hand sizes inside [0, handCap]
 *   - exactly one current player while a round is live
 *   - no revealed letter ever un-reveals
 *   - score arithmetic matches the event log
 *
 * Deadlock is caught by `simulateMatch`'s action guard, which throws rather than
 * spinning.
 */
import type { GameEvent } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { checkInvariants, checkMonotonicReveal, scoresFromEvents } from '../invariants.js';
import { randomPolicy } from '../policy.js';
import { applyAction, createMatch } from '../index.js';
import { deductionPolicy } from '../sim/policies.js';
import { simulateMatch } from '../sim/simulate.js';
import { TEST_PUZZLES } from '../testing/fixtures.js';

const SHARP = deductionPolicy({ corpus: TEST_PUZZLES, solveRoll: 0.6, actionCardBias: 0.35, scoreNoise: 0.2 });
const CHILL = deductionPolicy({ corpus: TEST_PUZZLES, solveRoll: 0.25, actionCardBias: 0.15, scoreNoise: 0.55 });

/** Rotate table sizes, match modes and policy mixes across the 200 seeds. */
function configFor(seed: number) {
  const playerCount = 2 + (seed % 7);
  const players = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const policies: Record<string, typeof randomPolicy> = {};
  // Every fourth table is all-random. Random players miss constantly and rarely
  // solve, which is what drives the soak into blowouts and deck exhaustion —
  // the terminal states a table of competent bots almost never reaches.
  const allRandom = seed % 4 === 0;
  players.forEach((id, i) => {
    policies[id] = allRandom ? randomPolicy : ([randomPolicy, SHARP, CHILL][(seed + i) % 3] as typeof randomPolicy);
  });
  const scoreMode = seed % 3 === 0;
  return {
    players,
    policies,
    settings: scoreMode
      ? ({ matchMode: 'score', targetScore: 200, rounds: 20, interruptsEnabled: seed % 2 === 0 } as const)
      : ({ matchMode: 'rounds', rounds: 1 + (seed % 3), interruptsEnabled: seed % 2 === 0 } as const),
  };
}

describe('soak: 200 seeded matches', () => {
  it('completes with no deadlock and no illegal state', () => {
    const MATCHES = 200;
    let totalActions = 0;
    let totalRounds = 0;
    const reasons: Record<string, number> = {};

    for (let seed = 1; seed <= MATCHES; seed++) {
      const cfg = configFor(seed);
      const log: GameEvent[] = [];

      const result = simulateMatch({
        seed,
        players: cfg.players,
        policies: cfg.policies,
        puzzles: TEST_PUZZLES,
        settings: cfg.settings,
        maxActions: 6000,
        onStep: (before, after, action, events) => {
          log.push(...events);

          const violations = checkInvariants(after);
          expect(violations, `seed ${seed} after ${action.type}: ${JSON.stringify(violations)}`).toEqual([]);

          const unreveal = checkMonotonicReveal(before, after);
          expect(unreveal, `seed ${seed}: ${JSON.stringify(unreveal)}`).toEqual([]);

          // Score arithmetic must equal the replayed event log at every instant.
          const fromLog = scoresFromEvents(log);
          for (const p of after.players) {
            expect(p.score, `seed ${seed} score drift for ${p.id} after ${action.type}`).toBe(fromLog[p.id] ?? 0);
          }
        },
      });

      expect(result.state.status, `seed ${seed}`).toBe('match-end');
      expect(result.state.matchResult, `seed ${seed}`).not.toBeNull();
      expect(result.state.matchResult!.winnerIds.length, `seed ${seed}`).toBeGreaterThan(0);

      // Every round reached a terminal reason; none was left dangling.
      for (const r of result.state.results) {
        expect(r.reason).toBeDefined();
        reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      }
      totalActions += result.stats.totalActions;
      totalRounds += result.stats.rounds;
    }

    expect(totalRounds).toBeGreaterThan(MATCHES);
    expect(totalActions).toBeGreaterThan(MATCHES * 10);
    // The soak must actually exercise the interesting terminal states, not just
    // grind out clean solves.
    for (const reason of ['solved', 'blowout', 'deck-exhausted']) {
      expect(reasons[reason] ?? 0, `no round ended in ${reason}`).toBeGreaterThan(0);
    }
  });
});

describe('a round can always end', () => {
  /**
   * The live bug this guards: every letter got revealed without anyone
   * solving, and the round had no end condition, so the table looped forever.
   * The soak above did not catch it because its policies solve often enough
   * that a fully-revealed board is rare — so this drives the board to complete
   * on purpose.
   */
  it('ends the round once the last letter is up, never loops', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const puzzle = TEST_PUZZLES[seed % TEST_PUZZLES.length]!;
      let st = createMatch({
        seed,
        players: ['p1', 'p2', 'p3'].map((id) => ({ id, name: id, color: '#fff' })),
        settings: { rounds: 1 },
        nowMs: 0,
      });
      st = applyAction(st, { type: 'startRound', puzzle }, 0).state;

      // Reveal letters as fast as the rules allow; never solve.
      let guard = 0;
      while (st.round && st.round.endedReason === null) {
        if (++guard > 800) break;
        try {
          st = applyAction(st, { type: 'timeout' }, guard * 1000).state;
        } catch {
          break;
        }
      }
      expect(guard, `seed ${seed} never terminated`).toBeLessThanOrEqual(800);
      expect(st.round?.endedReason, `seed ${seed}`).not.toBeNull();
    }
  });
});
