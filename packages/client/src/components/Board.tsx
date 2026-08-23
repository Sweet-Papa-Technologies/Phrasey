/**
 * The board (§9): a dark cooler-interior slab, the category on a price sticker,
 * and rows of fixed-width tiles.
 *
 * §10: the board is a labeled region with an accessible text representation of
 * the revealed state, taken straight from `MaskedBoard.accessibleText` — which
 * the server computes, so the screen reader and the pixels can never disagree.
 */
import type { MaskedBoard } from '@phrasey/shared';
import { layoutBoard } from '../lib/board';
import { useReducedMotion } from '../lib/motion';
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

const TILE_SIZE: Record<NonNullable<BoardProps['size']>, string> = {
  normal: 'clamp(1.5rem, 3.6vw, 3.1rem)',
  cast: 'clamp(2.2rem, 5.6vw, 5rem)',
  demo: 'clamp(1.35rem, 2.9vw, 2.5rem)',
};

export function Board({ board, delays, peeks, size = 'normal', className }: BoardProps) {
  const reduced = useReducedMotion();
  const words = layoutBoard(board);
  const revealedCount = board.totalLetters - board.hiddenLetters;

  return (
    <section
      aria-label="Puzzle board"
      className={`slab relative flex flex-col gap-4 px-4 py-5 sm:px-7 sm:py-7 ${className ?? ''}`}
      style={{ ['--tile' as string]: TILE_SIZE[size] }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="sticker bg-lime text-ink">{board.category}</p>
        <p className="font-mono text-[0.625rem] tracking-[0.14em] text-chill/55 uppercase">
          {revealedCount}/{board.totalLetters} revealed
        </p>
      </header>

      <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-x-[calc(var(--tile)*0.85)] gap-y-[calc(var(--tile)*0.3)]">
        {words.map((word) => (
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
