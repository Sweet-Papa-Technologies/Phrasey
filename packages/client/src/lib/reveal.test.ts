import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@phrasey/shared';
import {
  REVEAL_STAGGER_MS,
  cascadeDelayMap,
  cascadeDurationMs,
  collectRevealPositions,
  planRevealCascade,
} from './reveal';

describe('planRevealCascade', () => {
  it('staggers tiles 40ms apart in reading order (§9)', () => {
    expect(planRevealCascade([9, 2, 5, 14])).toEqual([
      { index: 2, delayMs: 0 },
      { index: 5, delayMs: 40 },
      { index: 9, delayMs: 80 },
      { index: 14, delayMs: 120 },
    ]);
  });

  it('uses the documented stagger constant', () => {
    expect(REVEAL_STAGGER_MS).toBe(40);
    const [, second] = planRevealCascade([0, 1]);
    expect(second?.delayMs).toBe(REVEAL_STAGGER_MS);
  });

  it('makes a run of four E’s a run of four flips', () => {
    const steps = planRevealCascade([1, 7, 12, 20]);
    expect(steps.map((s) => s.delayMs)).toEqual([0, 40, 80, 120]);
  });

  it('dedupes positions that arrive from both letter:hit and reveal', () => {
    expect(planRevealCascade([3, 3, 3])).toEqual([{ index: 3, delayMs: 0 }]);
  });

  it('drops nonsense indexes rather than animating a phantom tile', () => {
    expect(planRevealCascade([-1, Number.NaN, 4])).toEqual([{ index: 4, delayMs: 0 }]);
  });

  it('collapses to a simultaneous cross-fade under reduced motion (§10)', () => {
    const steps = planRevealCascade([0, 1, 2, 3], { reducedMotion: true });
    expect(steps.every((s) => s.delayMs === 0)).toBe(true);
  });

  it('honours a custom stagger', () => {
    expect(planRevealCascade([0, 1], { staggerMs: 100 })[1]?.delayMs).toBe(100);
  });

  it('is empty for an empty reveal', () => {
    expect(planRevealCascade([])).toEqual([]);
    expect(cascadeDurationMs([])).toBe(0);
  });
});

describe('cascadeDurationMs', () => {
  it('is the last delay plus one flip', () => {
    expect(cascadeDurationMs(planRevealCascade([0, 1, 2]), 200)).toBe(280);
  });
});

describe('cascadeDelayMap', () => {
  it('maps tile index to delay', () => {
    const map = cascadeDelayMap(planRevealCascade([4, 8]));
    expect(map.get(4)).toBe(0);
    expect(map.get(8)).toBe(40);
    expect(map.get(99)).toBeUndefined();
  });
});

describe('collectRevealPositions', () => {
  it('pulls positions out of letter:hit, reveal and breath events', () => {
    const events: GameEvent[] = [
      { t: 'card:played', playerId: 'p1', card: { id: 'c', kind: 'letter', letter: 'E' } },
      { t: 'letter:hit', playerId: 'p1', letter: 'E', occurrences: 2, points: 20, positions: [1, 4] },
      { t: 'reveal', letters: ['E'], positions: [1, 4], reason: 'play' },
      { t: 'breath', letter: 'S', positions: [9] },
      { t: 'letter:miss', playerId: 'p2', letter: 'Q', pressureDelta: 1 },
    ];
    expect(collectRevealPositions(events)).toEqual([1, 4, 1, 4, 9]);
    expect(planRevealCascade(collectRevealPositions(events)).map((s) => s.index)).toEqual([1, 4, 9]);
  });

  it('returns nothing when the batch revealed nothing', () => {
    expect(collectRevealPositions([{ t: 'notice', message: 'hi' }])).toEqual([]);
  });
});
