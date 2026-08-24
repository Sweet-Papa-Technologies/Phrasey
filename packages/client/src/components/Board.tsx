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
  normal: { minTile: 26, maxTile: 52, heightShare: 0.4, minHeight: 140 },
  cast: { minTile: 34, maxTile: 92, heightShare: 0.58, minHeight: 200 },
  demo: { minTile: 22, maxTile: 44, heightShare: 0.32, minHeight: 130 },
};

export function Board({ board, delays, peeks, size = 'normal', className }: BoardProps) {
  const reduced = useReducedMotion();
  const rowsRef = useRef<HTMLDivElement>(null);
  // Width only: the parent owns it, so reading it cannot feed back into layout.
  const { width } = useElementSize(rowsRef);
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
    const share = shortLandscape && size !== 'cast' ? 0.3 : sizing.heightShare;
    const availableHeight = viewport.height > 0 ? Math.max(sizing.minHeight, viewport.height * share) : null;
    return fitBoard({
      availableWidth,
      availableHeight,
      wordUnits,
      minTile: sizing.minTile,
      maxTile: sizing.maxTile,
    });
  }, [width, viewport.height, wordUnits, sizing, shortLandscape, size]);

  const revealedCount = board.totalLetters - board.hiddenLetters;

  return (
    <section
      aria-label="Puzzle board"
      className={`slab relative flex min-w-0 flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-7 sm:py-7 ${className ?? ''}`}
      style={{ ['--tile' as string]: `${fit.tile}px` }}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
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
          // A word wider than the hard floor allows is the one case that cannot
          // be wrapped away. It scrolls inside the board — never the page.
          fit.overflows ? 'rail-scroll items-start overflow-x-auto' : '',
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
        <p className="mx-auto max-w-prose text-center text-sm text-soda">
          <span className="sticker mr-2 bg-soda text-ink">Hint</span>
          {board.hint}
        </p>
      )}

      {board.missedLetters.length > 0 && (
        <p className="flex flex-wrap items-center justify-center gap-1.5 font-mono text-[0.6875rem] text-chill/45">
          <span className="tracking-[0.14em] uppercase">Dead letters</span>
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
