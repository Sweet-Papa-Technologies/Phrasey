/**
 * The board (§9): a dark cooler-interior slab, the category on a price sticker,
 * and rows of fixed-width tiles.
 *
 * Tiles are fixed-width Martian Mono by requirement, so the board cannot fit a
 * phone by flexing. It fits by *scaling and wrapping* instead — see
 * `lib/boardFit.ts`. This component measures the width the board actually has,
 * hands that and a height budget to `fitBoard()`, and renders the line breaks
 * it gets back. One number, `--tile`, drives every dimension below it.
 *
 * Words are laid out as explicit rows rather than left to `flex-wrap`, because
 * the wrap the renderer draws has to be the same wrap the sizing was computed
 * from — and because a word must never break across lines: word shape is the
 * primary deduction signal in this game.
 *
 * §10: the board is a labeled region with an accessible text representation of
 * the revealed state, taken straight from `MaskedBoard.accessibleText` — which
 * the server computes, so the screen reader and the pixels can never disagree.
 */
import { useMemo, useRef } from 'react';
import type { MaskedBoard } from '@phrasey/shared';
import { layoutBoard } from '../lib/board';
import { fitBoard, wordWidthUnits, type FitCellKind } from '../lib/boardFit';
import { useReducedMotion } from '../lib/motion';
import { useElementSize, useMediaQuery, useViewportSize } from '../lib/viewport';
import { BoardTile } from './BoardTile';

export interface BoardProps {
  board: MaskedBoard;
  /** Tile index → cascade delay in ms. */
  delays?: Map<number, number>;
  peeks?: Record<number, string>;
  /** Cast view runs bigger type for across-the-room legibility. */
  size?: 'normal' | 'cast' | 'demo';
  className?: string;
}

/**
 * Per-mode sizing. `heightShare` is the fraction of the viewport the tile rows
 * may claim before the fit starts trading tile size for a tidier shape — the
 * board is one element among several on a phone, and it does not get to run
 * the hand off the bottom of the screen.
 */
const SIZING: Record<
  NonNullable<BoardProps['size']>,
  { minTile: number; maxTile: number; heightShare: number; minHeight: number }
> = {
  // The ceiling went up with the fixed-height shell: the board now gets a
  // measured budget rather than a guessed share of the viewport, and on a
  // tablet or a desktop that budget was leaving a third of the slab empty
  // because the tiles were not allowed to grow into it. Width and the budget
  // still bind first, so a phone is unaffected.
  normal: { minTile: 26, maxTile: 66, heightShare: 0.4, minHeight: 140 },
  cast: { minTile: 34, maxTile: 92, heightShare: 0.58, minHeight: 200 },
  demo: { minTile: 22, maxTile: 44, heightShare: 0.32, minHeight: 130 },
};

export function Board({ board, delays, peeks, size = 'normal', className }: BoardProps) {
  const reduced = useReducedMotion();
  const rowsRef = useRef<HTMLDivElement>(null);
  /*
   * On the game screen (`normal` and `cast`) the board sits in a grid track
   * that is `minmax(0, 1fr)` of a fixed-height shell, and the rows box is
   * `flex-1 basis-0 min-h-0` inside it. Both axes are therefore owned by the
   * parent: the rows box is exactly what the chrome left over, and its own
   * content cannot push it. That makes reading the *height* safe here, which
   * it would not be in an auto-height container — and it is the whole reason
   * the board can absorb the leftover instead of guessing at a share of the
   * viewport.
   *
   * `demo` (the landing hero) has no such budget, so it keeps the viewport
   * estimate and the rows box keeps its content-driven minimum.
   */
  const constrained = size !== 'demo';
  const { width, height } = useElementSize(rowsRef);
  const viewport = useViewportSize();
  // A landscape phone has to fit the board *and* the hand into 390px of
  // height; the board takes a smaller share of it than it would upright.
  const shortLandscape = useMediaQuery('(orientation: landscape) and (max-height: 560px)');

  const words = useMemo(() => layoutBoard(board), [board]);
  const wordUnits = useMemo(
    () => words.map((w) => wordWidthUnits(w.cells.map((c) => c.cell.t as FitCellKind))),
    [words],
  );

  const sizing = SIZING[size];
  const fit = useMemo(() => {
    const widest = wordUnits.length > 0 ? Math.max(...wordUnits) : 1;
    // Before the first measurement (and in jsdom) fall back to the widest the
    // board could ever be, so the tiles render at full size rather than at the
    // hard floor for one frame.
    const availableWidth = width > 0 ? width : widest * sizing.maxTile;
    // The measured budget wins wherever there is one. The viewport share is
    // the fallback for the first frame before the ResizeObserver has fired,
    // for jsdom, and for the unconstrained landing hero.
    const share = shortLandscape && size !== 'cast' ? 0.3 : sizing.heightShare;
    const estimate = viewport.height > 0 ? Math.max(sizing.minHeight, viewport.height * share) : null;
    const availableHeight = constrained && height > 0 ? height : estimate;
    return fitBoard({
      availableWidth,
      availableHeight,
      wordUnits,
      minTile: sizing.minTile,
      maxTile: sizing.maxTile,
    });
  }, [width, height, constrained, viewport.height, wordUnits, sizing, shortLandscape, size]);

  const revealedCount = board.totalLetters - board.hiddenLetters;

  return (
    <section
      aria-label="Puzzle board"
      className={[
        // A landscape phone gives the board about 130px in total; the slab's own
        // padding was taking a third of that, so it tightens there.
        'slab relative flex min-w-0 flex-col gap-2 px-3 py-3 sm:gap-3 sm:px-6 sm:py-5 short-landscape:gap-1 short-landscape:px-3 short-landscape:py-2',
        constrained ? 'min-h-0 overflow-hidden' : '',
        className ?? '',
      ].join(' ')}
      style={{ ['--tile' as string]: `${fit.tile}px` }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="sticker bg-lime text-ink">{board.category}</p>
        <p className="font-mono text-[0.625rem] tracking-[0.14em] text-chill/55 uppercase">
          {revealedCount}/{board.totalLetters} revealed
        </p>
      </header>

      {/*
        The measured box. It is the board's own content width — never the
        viewport — so the same puzzle fits differently in the cast column, the
        landing hero and a phone, without any of them knowing about each other.
      */}
      <div
        ref={rowsRef}
        className={[
          'flex flex-1 flex-col items-center justify-center gap-[calc(var(--tile)*0.32)]',
          // `basis-0` + `min-h-0` is what makes this box parent-sized rather
          // than content-sized, which is what makes measuring its height safe.
          constrained ? 'min-h-0 basis-0' : '',
          // A word wider than the hard floor allows is the one case that cannot
          // be wrapped away. It scrolls inside the board — never the page.
          fit.overflows ? 'rail-scroll items-start overflow-x-auto' : '',
          // Same contract on the other axis, for a puzzle too tall for its
          // budget even at the hard floor.
          fit.clipped ? 'rail-scroll justify-start overflow-y-auto' : '',
        ].join(' ')}
      >
        {fit.lines.map((line, lineIndex) => (
          <div key={lineIndex} className="flex shrink-0 items-center justify-center gap-[calc(var(--tile)*0.62)]">
            {line.map((wordIndex) => {
              const word = words[wordIndex];
              if (!word) return null;
              return (
                <div key={word.wordIndex} className="flex items-center gap-[calc(var(--tile)*0.13)]">
                  {word.cells.map(({ cell, index }) => (
                    <BoardTile
                      key={index}
                      cell={cell}
                      delayMs={delays?.get(index) ?? 0}
                      peekChar={cell.t === 'letter' && !cell.revealed ? peeks?.[index] : undefined}
                      reducedMotion={reduced}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {board.hint && (
        <p className="mx-auto max-w-prose shrink-0 text-center text-sm text-soda">
          <span className="sticker mr-2 bg-soda text-ink">Hint</span>
          {board.hint}
        </p>
      )}

      {board.missedLetters.length > 0 && (
        <p className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 font-mono text-[0.6875rem] text-chill/45">
          <span className="tracking-[0.14em] uppercase">Misses</span>
          {board.missedLetters.map((l) => (
            <span key={l} className="rounded bg-cherry/18 px-1.5 py-0.5 text-cherry line-through">
              {l}
            </span>
          ))}
        </p>
      )}

      {/* §10 — the whole board as text, plus a polite summary of progress. */}
      <p className="sr-only">Board reads: {board.accessibleText}</p>
      <p className="sr-only" aria-live="polite">
        {revealedCount} of {board.totalLetters} letters revealed. {board.accessibleText}
      </p>
    </section>
  );
}
