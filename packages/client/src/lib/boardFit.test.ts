/**
 * The board-fit arithmetic. This is the whole of the mobile board layout, so
 * it is tested as arithmetic rather than through the DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_METRICS,
  TILE_HARD_FLOOR,
  fillRatio,
  fitBoard,
  rowsHeight,
  wordWidthUnits,
  wrapWords,
  type FitCellKind,
} from './boardFit';

/** Cell kinds for a plain word of `n` letters. */
function letters(n: number): FitCellKind[] {
  return Array.from({ length: n }, () => 'letter' as const);
}

/** Word widths, in tile units, for a phrase written as plain words. */
function unitsFor(phrase: string): number[] {
  return phrase.split(' ').map((w) => wordWidthUnits([...w].map((ch) => (/[A-Za-z]/.test(ch) ? 'letter' : 'punct'))));
}

const PHONE = 358; // 390px viewport less the board's own padding
const LONG = 'MILK EGGS AND SOMETHING FOR YOUR FATHER'; // 39 characters
const VERY_LONG = 'DO NOT PUT THE AIR FRYER BASKET IN THE DISHWASHER'; // 48 characters

describe('wordWidthUnits', () => {
  it('is the cells plus the gaps between them', () => {
    expect(wordWidthUnits(letters(1))).toBeCloseTo(BOARD_METRICS.letterWidth, 6);
    expect(wordWidthUnits(letters(3))).toBeCloseTo(3 * BOARD_METRICS.letterWidth + 2 * BOARD_METRICS.letterGap, 6);
  });

  it('counts punctuation as a narrow cell', () => {
    const withApostrophe = wordWidthUnits(['letter', 'punct', 'letter']);
    const allLetters = wordWidthUnits(letters(3));
    expect(withApostrophe).toBeLessThan(allLetters);
    expect(withApostrophe).toBeCloseTo(
      2 * BOARD_METRICS.letterWidth + BOARD_METRICS.punctWidth + 2 * BOARD_METRICS.letterGap,
      6,
    );
  });

  it('is zero for an empty word', () => {
    expect(wordWidthUnits([])).toBe(0);
  });
});

describe('wrapWords', () => {
  it('never splits a word across lines — every word lands on exactly one line', () => {
    const units = unitsFor(VERY_LONG);
    const lines = wrapWords(units, 30, PHONE);
    const flat = lines.flat();
    expect(flat).toEqual(units.map((_, i) => i));
    // Word order is preserved, so the phrase still reads left-to-right, top-down.
    expect([...flat].sort((a, b) => a - b)).toEqual(flat);
  });

  it('keeps every line inside the available width when the words can fit', () => {
    const units = unitsFor(VERY_LONG);
    const tile = 28;
    const lines = wrapWords(units, tile, PHONE);
    for (const line of lines) {
      const width =
        line.reduce((sum, i) => sum + (units[i] ?? 0) * tile, 0) + (line.length - 1) * tile * BOARD_METRICS.wordGap;
      expect(width).toBeLessThanOrEqual(PHONE + 0.5);
    }
  });

  it('gives a bigger tile more rows and a smaller tile fewer', () => {
    const units = unitsFor(LONG);
    expect(wrapWords(units, 44, PHONE).length).toBeGreaterThanOrEqual(wrapWords(units, 24, PHONE).length);
  });

  it('puts everything on one line when there is room', () => {
    expect(wrapWords(unitsFor('WHO LEFT THE OVEN ON'), 24, 4000)).toHaveLength(1);
  });

  it('gives an unfittable word a line of its own rather than breaking it', () => {
    const units = unitsFor('A SUPERCALIFRAGILISTIC B');
    const lines = wrapWords(units, 40, 200);
    expect(lines.map((l) => l.length)).toEqual([1, 1, 1]);
    expect(lines.flat()).toEqual([0, 1, 2]);
  });

  it('handles an empty phrase', () => {
    expect(wrapWords([], 30, PHONE)).toEqual([]);
  });
});

describe('fitBoard', () => {
  it('gives a short puzzle on a big screen the maximum tile', () => {
    const fit = fitBoard({
      availableWidth: 900,
      availableHeight: 500,
      wordUnits: unitsFor('WHO LEFT THE OVEN ON'),
      minTile: 24,
      maxTile: 52,
    });
    expect(fit.tile).toBe(52);
    expect(fit.overflows).toBe(false);
  });

  it('shrinks a long puzzle on a phone instead of overflowing it', () => {
    const big = fitBoard({
      availableWidth: 900,
      availableHeight: 500,
      wordUnits: unitsFor(VERY_LONG),
      minTile: 24,
      maxTile: 52,
    });
    const small = fitBoard({
      availableWidth: PHONE,
      availableHeight: 320,
      wordUnits: unitsFor(VERY_LONG),
      minTile: 24,
      maxTile: 52,
    });
    expect(small.tile).toBeLessThan(big.tile);
    expect(small.tile).toBeGreaterThanOrEqual(24);
  });

  it('never lets a line exceed the width it was given', () => {
    for (const width of [300, 358, 414, 768, 1280]) {
      for (const phrase of [LONG, VERY_LONG, 'A WATCHED POT NEVER BOILS', "DON'T MICROWAVE THE POUCH"]) {
        const units = unitsFor(phrase);
        const fit = fitBoard({
          availableWidth: width,
          availableHeight: 340,
          wordUnits: units,
          minTile: 24,
          maxTile: 52,
        });
        for (const line of fit.lines) {
          const w =
            line.reduce((sum, i) => sum + (units[i] ?? 0) * fit.tile, 0) +
            (line.length - 1) * fit.tile * BOARD_METRICS.wordGap;
          expect(w).toBeLessThanOrEqual(width + 0.5);
        }
      }
    }
  });

  it('respects the height budget when it can', () => {
    const budget = 240;
    const fit = fitBoard({
      availableWidth: PHONE,
      availableHeight: budget,
      wordUnits: unitsFor(VERY_LONG),
      minTile: 20,
      maxTile: 52,
    });
    expect(rowsHeight(fit.rows, fit.tile)).toBeLessThanOrEqual(budget);
  });

  /*
   * The height budget is a hard constraint, not a preference. On the game
   * screen it is literally "what the top bar, the hand and the bottle did not
   * take" of a fixed-height shell, so a fit that ignores it does not produce a
   * slightly tall board — it produces the bug this whole pass exists to fix,
   * a page that scrolls and a Solve button under the fold.
   */
  it('goes under the floor rather than overrun a height budget', () => {
    const budget = 40; // room for one row at the floor, and it is not happening
    const fit = fitBoard({
      availableWidth: PHONE,
      availableHeight: budget,
      wordUnits: unitsFor(VERY_LONG),
      minTile: 26,
      maxTile: 52,
    });
    expect(fit.tile).toBeLessThan(26);
    expect(fit.tile).toBeGreaterThanOrEqual(TILE_HARD_FLOOR);
    expect(rowsHeight(fit.rows, fit.tile)).toBeLessThanOrEqual(budget);
    expect(fit.clipped).toBe(false);
  });

  it('never goes under the floor when the budget does not force it', () => {
    const fit = fitBoard({
      availableWidth: PHONE,
      availableHeight: 400,
      wordUnits: unitsFor(VERY_LONG),
      minTile: 26,
      maxTile: 52,
    });
    expect(fit.tile).toBeGreaterThanOrEqual(26);
  });

  it('stops at the hard floor and reports clipped when no tile can fit the height', () => {
    const budget = 18; // shorter than a single row of hard-floor tiles
    const fit = fitBoard({
      availableWidth: 120,
      availableHeight: budget,
      wordUnits: unitsFor(VERY_LONG),
      minTile: 26,
      maxTile: 52,
    });
    expect(fit.tile).toBeGreaterThanOrEqual(TILE_HARD_FLOOR);
    expect(fit.clipped).toBe(true);
    // Clipped is the board's own container scrolling, never the page — so the
    // tiles stay legible rather than being ground down to fit.
    expect(fit.tile).toBeGreaterThanOrEqual(TILE_HARD_FLOOR);
  });

  it('is not clipped whenever the rows actually fit the budget', () => {
    for (const budget of [120, 200, 320, 640]) {
      const fit = fitBoard({
        availableWidth: PHONE,
        availableHeight: budget,
        wordUnits: unitsFor(LONG),
        minTile: 26,
        maxTile: 52,
      });
      expect(fit.clipped).toBe(false);
      expect(rowsHeight(fit.rows, fit.tile)).toBeLessThanOrEqual(budget);
    }
  });

  /*
   * The shell hands the board a *measured* leftover rather than a share of the
   * viewport, so the budget it gets is whatever the chrome happened to leave.
   * Sweeping it catches any budget where the fit would silently overrun.
   */
  it('honours every budget a fixed-height shell could hand it', () => {
    for (let budget = 60; budget <= 600; budget += 10) {
      for (const phrase of [LONG, VERY_LONG, 'HOT DOG', 'A']) {
        const fit = fitBoard({
          availableWidth: PHONE,
          availableHeight: budget,
          wordUnits: unitsFor(phrase),
          minTile: 26,
          maxTile: 52,
        });
        if (fit.clipped) continue; // reported, and the board scrolls itself
        expect(rowsHeight(fit.rows, fit.tile)).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('goes under the floor only for a word wider than the board, and stops at the hard floor', () => {
    const units = unitsFor('CONGRATULATIONS');
    const fit = fitBoard({
      availableWidth: 300,
      wordUnits: units,
      minTile: 26,
      maxTile: 52,
    });
    expect(fit.tile).toBeLessThan(26);
    expect(fit.tile).toBeGreaterThanOrEqual(TILE_HARD_FLOOR);
    expect(fit.overflows).toBe(false);
    const line = fit.lines[0] ?? [];
    expect((units[line[0] ?? 0] ?? 0) * fit.tile).toBeLessThanOrEqual(300 + 0.5);
  });

  it('reports overflow when even the hard floor cannot fit the longest word', () => {
    const fit = fitBoard({
      availableWidth: 90,
      wordUnits: unitsFor('EXTRAORDINARILY'),
      minTile: 26,
      maxTile: 52,
    });
    expect(fit.overflows).toBe(true);
    expect(fit.tile).toBe(TILE_HARD_FLOOR);
  });

  it('never returns a tile above maxTile or a NaN', () => {
    for (const width of [0, 1, 120, 358, 4000]) {
      const fit = fitBoard({
        availableWidth: width,
        availableHeight: 200,
        wordUnits: unitsFor(LONG),
        minTile: 24,
        maxTile: 52,
      });
      expect(Number.isFinite(fit.tile)).toBe(true);
      expect(fit.tile).toBeLessThanOrEqual(52);
      expect(fit.tile).toBeGreaterThan(0);
    }
  });

  it('handles a board with no words at all', () => {
    const fit = fitBoard({
      availableWidth: 358,
      wordUnits: [],
      minTile: 24,
      maxTile: 52,
    });
    expect(fit).toEqual({ tile: 52, lines: [], rows: 0, overflows: false, clipped: false });
  });

  it('is monotonic: a wider board never gets a smaller tile', () => {
    const units = unitsFor(VERY_LONG);
    let previous = 0;
    for (const width of [280, 320, 360, 420, 640, 900, 1200]) {
      const { tile } = fitBoard({
        availableWidth: width,
        wordUnits: units,
        minTile: 24,
        maxTile: 52,
      });
      expect(tile).toBeGreaterThanOrEqual(previous);
      previous = tile;
    }
  });
});

describe('fill ratio', () => {
  it('measures how much of the block the tiles cover', () => {
    expect(fillRatio([5, 5], 10, 100, 1)).toBeCloseTo(1, 6);
    expect(fillRatio([5, 5], 10, 100, 2)).toBeCloseTo(0.5, 6);
    expect(fillRatio([], 10, 100, 0)).toBe(0);
  });

  it('rejects the biggest technically-fitting tile when it orphans every word', () => {
    // A generous height budget and a narrow board: the unconstrained answer is
    // the maximum tile with one word per line, which is not a phrase any more.
    const units = unitsFor('A WATCHED POT NEVER BOILS');
    const loose = fitBoard({
      availableWidth: 319,
      availableHeight: 300,
      wordUnits: units,
      minTile: 20,
      maxTile: 44,
      minFill: 0, // fill check disabled
    });
    const tidy = fitBoard({
      availableWidth: 319,
      availableHeight: 300,
      wordUnits: units,
      minTile: 20,
      maxTile: 44,
    });
    expect(loose.rows).toBe(units.length); // one word per line
    expect(tidy.rows).toBeLessThan(loose.rows);
    expect(fillRatio(units, tidy.tile, 319, tidy.rows)).toBeGreaterThanOrEqual(0.6);
  });

  it('does not apply the fill rule to a board that fits on one line', () => {
    const fit = fitBoard({
      availableWidth: 1200,
      availableHeight: 600,
      wordUnits: unitsFor('WHO LEFT THE OVEN ON'),
      minTile: 26,
      maxTile: 52,
    });
    expect(fit.rows).toBe(1);
    expect(fit.tile).toBe(52);
  });

  it('falls back to the height-fitting tile when no size can be tidy', () => {
    // Two words, one enormous: they can never share a line, so the fill target
    // is unreachable and the fit must still return something sensible.
    const fit = fitBoard({
      availableWidth: 300,
      availableHeight: 400,
      wordUnits: unitsFor('HI CONGRATULATIONS'),
      minTile: 22,
      maxTile: 52,
    });
    expect(fit.rows).toBe(2);
    expect(fit.tile).toBeGreaterThanOrEqual(22);
    expect(fit.tile).toBeLessThanOrEqual(52);
  });
});

describe('rowsHeight', () => {
  it('counts the gaps between rows but not after the last one', () => {
    expect(rowsHeight(0, 30)).toBe(0);
    expect(rowsHeight(1, 30)).toBe(30);
    expect(rowsHeight(3, 30)).toBeCloseTo(3 * 30 + 2 * 30 * BOARD_METRICS.rowGap, 6);
  });
});
