import { EngineError, accessibleBoardText, normalizePuzzleText } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import {
  bestLetterFrom,
  boardWords,
  gaugeFraction,
  guessedLetters,
  hiddenDistinctLetters,
  hiddenLetterCount,
  hiddenTiles,
  isGuessed,
  isRevealed,
  maskBoard,
  maskBoardFromRound,
  positionsOf,
  revealAll,
  revealLetter,
  tiles,
  totalLetterCount,
} from '../board.js';
import { createMatch, type RoundState } from '../state.js';
import { makePuzzle } from '../testing/fixtures.js';
import { startGame } from '../testing/harness.js';
import { defaultBalance } from '@phrasey/shared';

const PUZZLE = makePuzzle("DONT COUNT YOUR CHICKENS", { hint: 'Before they hatch.' });

function roundOf(): RoundState {
  const state = startGame({ puzzle: PUZZLE, seed: 42 });
  return state.round as RoundState;
}

describe('tile indexing', () => {
  it('skips spaces but counts punctuation, matching shared letterPositions', () => {
    const t = tiles("DON'T GO");
    expect(t.map((x) => x.ch).join('')).toBe("DON'TGO");
    expect(t.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(t.find((x) => x.ch === "'")!.isLetter).toBe(false);
  });

  it('positionsOf finds every occurrence', () => {
    expect(positionsOf('BANANA SPLIT', 'A')).toEqual([1, 3, 5]);
    expect(positionsOf('BANANA SPLIT', 'Z')).toEqual([]);
  });
});

describe('revealLetter', () => {
  it('reveals every occurrence at once and resets the stall counter', () => {
    const round = roundOf();
    round.turnsSinceReveal = 5;
    const res = revealLetter(round, 'O');
    expect(res.occurrences).toBe(positionsOf(round.answer, 'O').length);
    expect(res.occurrences).toBeGreaterThan(1);
    expect(round.turnsSinceReveal).toBe(0);
    expect(isRevealed(round, 'O')).toBe(true);
  });

  it('is idempotent — a second reveal scores nothing', () => {
    const round = roundOf();
    revealLetter(round, 'O');
    expect(revealLetter(round, 'O')).toEqual({ occurrences: 0, positions: [] });
    expect(round.revealed.filter((l) => l === 'O')).toHaveLength(1);
  });

  it('returns nothing for a letter not in the puzzle and does not record it', () => {
    const round = roundOf();
    expect(revealLetter(round, 'Z')).toEqual({ occurrences: 0, positions: [] });
    expect(round.revealed).not.toContain('Z');
  });

  it('revealAll flips the whole board', () => {
    const round = roundOf();
    revealAll(round);
    expect(hiddenLetterCount(round)).toBe(0);
    expect(hiddenDistinctLetters(round)).toEqual([]);
    revealAll(round);
    expect(new Set(round.revealed).size).toBe(round.revealed.length);
  });
});

describe('counts', () => {
  it('total and hidden agree with the puzzle', () => {
    const round = roundOf();
    const total = normalizePuzzleText(PUZZLE.text).replace(/[^A-Z]/g, '').length;
    expect(totalLetterCount(round)).toBe(total);
    expect(hiddenLetterCount(round)).toBe(total);
    revealLetter(round, 'C');
    expect(hiddenLetterCount(round)).toBe(total - positionsOf(round.answer, 'C').length);
    expect(hiddenTiles(round).every((t) => t.ch !== 'C')).toBe(true);
  });
});

describe('guessedLetters', () => {
  it('is the union of revealed and missed, sorted and deduped', () => {
    const round = roundOf();
    revealLetter(round, 'C');
    round.missed.push('Z', 'Q');
    expect(guessedLetters(round)).toEqual(['C', 'Q', 'Z']);
    expect(isGuessed(round, 'Z')).toBe(true);
    expect(isGuessed(round, 'C')).toBe(true);
    expect(isGuessed(round, 'B')).toBe(false);
  });
});

describe('maskBoard', () => {
  it('emits no ch field for hidden tiles', () => {
    const round = roundOf();
    revealLetter(round, 'O');
    const board = maskBoardFromRound(round);
    for (const word of board.words) {
      for (const cell of word) {
        if (cell.t === 'letter' && !cell.revealed) {
          expect(Object.prototype.hasOwnProperty.call(cell, 'ch')).toBe(false);
        }
      }
    }
  });

  it('keeps the hint null until CRACK', () => {
    const round = roundOf();
    expect(maskBoardFromRound(round).hint).toBeNull();
    round.hintRevealed = true;
    expect(maskBoardFromRound(round).hint).toBe('Before they hatch.');
  });

  it('renders accessible text with underscores for hidden tiles (§10)', () => {
    const round = roundOf();
    revealLetter(round, 'O');
    const board = maskBoardFromRound(round);
    expect(board.accessibleText).toBe(accessibleBoardText(boardWords(round)));
    expect(board.accessibleText).toContain('O');
    expect(board.accessibleText).toContain('_');
  });

  it('shows punctuation unmasked (§3.1)', () => {
    const state = startGame({ puzzle: makePuzzle("ITS NOT A BIG DEAL, REALLY") });
    const board = maskBoard(state);
    const flat = board.words.flat();
    expect(flat.some((c) => c.t === 'punct' && c.ch === ',')).toBe(true);
  });

  it('throws when there is no round to mask', () => {
    const lobby = createMatch({ seed: 1, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(() => maskBoard(lobby)).toThrow(EngineError);
  });
});

describe('helpers', () => {
  it('bestLetterFrom picks the highest-frequency unguessed letter', () => {
    const round = roundOf();
    const freq = { E: 12.7, T: 9, Z: 0.07 };
    expect(bestLetterFrom(round, ['Z', 'E', 'T'], freq)).toBe('E');
    revealLetter(round, 'T');
    round.missed.push('E');
    expect(bestLetterFrom(round, ['Z', 'E', 'T'], freq)).toBe('Z');
    round.missed.push('Z');
    expect(bestLetterFrom(round, ['Z', 'E', 'T'], freq)).toBeNull();
  });

  it('gaugeFraction reports the fill level', () => {
    const round = roundOf();
    const balance = defaultBalance();
    expect(gaugeFraction(round, balance)).toBe(0);
    round.pressure = 6;
    expect(gaugeFraction(round, balance)).toBe(0.5);
    balance.pressure.max = 0;
    expect(gaugeFraction(round, balance)).toBe(0);
  });
});
