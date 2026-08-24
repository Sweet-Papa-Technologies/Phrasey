/**
 * Board fitting — how big a tile can be, and where the words break.
 *
 * §9 makes the board tiles fixed-width Martian Mono. That is a requirement, not
 * a preference, so a 43-letter phrase on a 390px phone cannot be solved by
 * letting tiles flex. It is solved by two things instead:
 *
 *  1. **Scale.** One number — the tile size — drives every dimension on the
 *     board (`--tile`). It is chosen to fit the container the board actually
 *     has, given how long this particular puzzle is.
 *  2. **Wrap as units.** Word shape is the primary deduction signal in this
 *     game, so a word is never broken across lines. Lines are packed greedily
 *     with whole words, exactly the way the renderer will draw them.
 *
 * Everything here is pure arithmetic on numbers: no DOM, no React, no CSS. The
 * component measures a width and a height budget and hands them over.
 */

/**
 * Board geometry, in multiples of the tile size. These are the same ratios the
 * tile components use in their `calc()` expressions — if one moves, both move.
 */
export const BOARD_METRICS = {
  /** Letter tile width ÷ tile size. */
  letterWidth: 0.78,
  /** Punctuation cell width ÷ tile size (apostrophes and hyphens are narrow). */
  punctWidth: 0.44,
  /** Gap between cells inside one word. */
  letterGap: 0.13,
  /** Gap between two words on the same line. */
  wordGap: 0.62,
  /** Gap between two lines. */
  rowGap: 0.32,
} as const;

/** Below this the tiles stop being letters and start being confetti. */
export const TILE_HARD_FLOOR = 15;

export type FitCellKind = 'letter' | 'punct';

export interface BoardFitOptions {
  /** Content width the board rows may occupy, in px. */
  availableWidth: number;
  /**
   * Height the rows may occupy, in px, or null for "as tall as it likes".
   * A budget makes long puzzles pick a smaller tile so the board still reads
   * as one shape instead of running off the bottom of a phone.
   */
  availableHeight?: number | null;
  /** Width of each word, in tile units (see {@link wordWidthUnits}). */
  wordUnits: number[];
  /** Smallest tile we will shrink to before preferring more rows. */
  minTile: number;
  /** Largest tile, i.e. the size a short puzzle on a big screen gets. */
  maxTile: number;
  /** Absolute floor, only reached when a single word is wider than the board. */
  hardFloor?: number;
  /**
   * How much of each line the tiles have to cover, 0–1, before the layout is
   * called ragged. Without this the fit happily returns the biggest tile that
   * technically fits and leaves you with five lines of one word each — legal,
   * and unreadable as a phrase.
   */
  minFill?: number;
  wordGap?: number;
  rowGap?: number;
}

export interface BoardFitResult {
  /** Tile size in px — the value of `--tile`. */
  tile: number;
  /** Word indexes, grouped into the lines they should render on. */
  lines: number[][];
  rows: number;
  /**
   * True when a single word is still wider than the board at the hard floor.
   * The board must then scroll inside its own container — never the page.
   */
  overflows: boolean;
}

/**
 * Width of one word in tile units: the cells plus the gaps between them.
 * Deliberately takes cell *kinds* rather than cells, so it stays free of the
 * shared board types and trivially testable.
 */
export function wordWidthUnits(kinds: readonly FitCellKind[]): number {
  if (kinds.length === 0) return 0;
  let width = 0;
  for (const kind of kinds) {
    width += kind === 'punct' ? BOARD_METRICS.punctWidth : BOARD_METRICS.letterWidth;
  }
  return width + (kinds.length - 1) * BOARD_METRICS.letterGap;
}

/**
 * Greedy line breaking. A word is an atom: it either fits on the current line
 * or it starts the next one. A word that cannot fit on a line of its own still
 * gets a line of its own — it is never split.
 */
export function wrapWords(
  wordUnits: readonly number[],
  tile: number,
  availableWidth: number,
  wordGap: number = BOARD_METRICS.wordGap,
): number[][] {
  const lines: number[][] = [];
  const gap = tile * wordGap;
  let line: number[] = [];
  let width = 0;

  for (let i = 0; i < wordUnits.length; i++) {
    const w = (wordUnits[i] ?? 0) * tile;
    if (line.length === 0) {
      line = [i];
      width = w;
      continue;
    }
    const next = width + gap + w;
    // The half-pixel slack keeps a word that fits *exactly* from being bumped
    // by floating-point noise, which would silently cost a whole row.
    if (next > availableWidth + 0.5) {
      lines.push(line);
      line = [i];
      width = w;
    } else {
      line.push(i);
      width = next;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Height of `rows` rows of tiles, including the gaps between them. */
export function rowsHeight(rows: number, tile: number, rowGap: number = BOARD_METRICS.rowGap): number {
  if (rows <= 0) return 0;
  return rows * tile + (rows - 1) * tile * rowGap;
}

/**
 * How much of the laid-out block the tiles actually cover, 0–1.
 *
 * This is the difference between a board that reads as a phrase and one that
 * reads as a column of orphans. A big tile that pushes every word onto its own
 * line scores badly here even though it "fits", which is exactly the outcome
 * the fit needs to be able to reject.
 */
export function fillRatio(wordUnits: readonly number[], tile: number, availableWidth: number, rows: number): number {
  if (rows <= 0 || availableWidth <= 0) return 0;
  const ink = wordUnits.reduce((sum, u) => sum + u, 0) * tile;
  return ink / (rows * availableWidth);
}

/** Search granularity, in px. Fine enough that nobody can see the quantisation. */
const STEP = 0.5;

/**
 * Pick the largest tile size that fits, and the line breaks that go with it.
 *
 * The constraints, in the order they bind:
 *
 *  - the longest single word must fit on one line (words never split);
 *  - the wrapped rows fit the height budget, if one was given;
 *  - the lines are reasonably full, so the board reads as a phrase rather than
 *    as a column of orphaned words;
 *  - the tile never exceeds `maxTile`, and never drops below `minTile` for the
 *    sake of either — §9's legibility beats a tidy shape, so below the floor
 *    we take more rows instead of smaller tiles.
 *
 * The search is a descending scan rather than a bisection: neither the row
 * count nor the fill ratio is monotonic in the tile size (one extra pixel can
 * tip a word onto the next line and change both), and at ~60 steps over a dozen
 * words the exact answer is cheaper than being clever about an approximate one.
 *
 * The only case that goes under `minTile` is a word too long for the board at
 * that size, and even then we stop at `hardFloor` and report `overflows`.
 */
export function fitBoard(options: BoardFitOptions): BoardFitResult {
  const {
    availableWidth,
    availableHeight = null,
    wordUnits,
    minTile,
    maxTile,
    hardFloor = TILE_HARD_FLOOR,
    minFill = 0.6,
    wordGap = BOARD_METRICS.wordGap,
    rowGap = BOARD_METRICS.rowGap,
  } = options;

  if (wordUnits.length === 0) {
    return { tile: maxTile, lines: [], rows: 0, overflows: false };
  }

  const width = Math.max(1, availableWidth);
  const widest = Math.max(...wordUnits);
  // The tile size at which the longest word exactly spans the board.
  const widthCap = widest > 0 ? width / widest : maxTile;

  if (widthCap < minTile) {
    // No tile at or above the floor can hold the longest word. Go under the
    // floor, but only as far as the hard floor: past that the board scrolls in
    // its own container rather than becoming unreadable.
    const tile = round2(Math.max(hardFloor, widthCap));
    const lines = wrapWords(wordUnits, tile, width, wordGap);
    return { tile, lines, rows: lines.length, overflows: widthCap < hardFloor };
  }

  const ceiling = Math.min(maxTile, widthCap);
  const heightBudget = availableHeight != null && availableHeight > 0 ? availableHeight : Infinity;

  let best: { tile: number; lines: number[][] } | null = null;
  // The best candidate that fits the height but not the fill target, used when
  // no tile in range can do both — a board of one very long word, say.
  let compromise: { tile: number; lines: number[][] } | null = null;

  const steps = Math.max(1, Math.ceil((ceiling - minTile) / STEP) + 1);
  for (let i = 0; i < steps; i++) {
    const tile = Math.max(minTile, ceiling - i * STEP);
    const lines = wrapWords(wordUnits, tile, width, wordGap);
    if (rowsHeight(lines.length, tile, rowGap) > heightBudget) continue;
    compromise ??= { tile, lines };
    if (lines.length <= 1 || fillRatio(wordUnits, tile, width, lines.length) >= minFill) {
      best = { tile, lines };
      break;
    }
  }

  const chosen = best ??
    compromise ?? {
      // Nothing fits the height even at the floor: take the rows, keep the
      // tiles legible, and let the board's own container do the scrolling.
      tile: minTile,
      lines: wrapWords(wordUnits, minTile, width, wordGap),
    };

  return {
    tile: round2(chosen.tile),
    lines: chosen.lines,
    rows: chosen.lines.length,
    overflows: false,
  };
}

/** Rounds *down*, so a rounded tile can never be wider than the one measured. */
function round2(v: number): number {
  return Math.floor(v * 100) / 100;
}
