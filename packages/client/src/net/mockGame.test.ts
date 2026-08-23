import { describe, expect, it } from 'vitest';
import { letterPositions } from '@phrasey/shared';
import { positionsOf } from './mockGame';
import { MOCK_PUZZLES } from './mockPuzzles';

describe('positionsOf', () => {
  it('uses the same flat index space as letterPositions()', () => {
    for (const puzzle of MOCK_PUZZLES) {
      const all = new Set<number>();
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for (const p of positionsOf(puzzle.text, ch)) all.add(p);
      expect([...all].sort((a, b) => a - b)).toEqual(letterPositions(puzzle.text));
    }
  });

  it('finds every occurrence of a repeated letter', () => {
    expect(positionsOf('EEL', 'E')).toEqual([0, 1]);
    expect(positionsOf('A BEE', 'E')).toEqual([2, 3]);
  });

  it('returns nothing for a letter that is not there', () => {
    expect(positionsOf('MILK', 'Z')).toEqual([]);
  });
});
