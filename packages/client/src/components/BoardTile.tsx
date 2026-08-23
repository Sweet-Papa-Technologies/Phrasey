/**
 * One board cell.
 *
 * SECURITY: an unrevealed cell renders NOTHING. There is no branch here that
 * can print a character the server did not send, because an unrevealed
 * `BoardCell` has no `ch` field at all. A private PEEK is drawn in a visibly
 * different, dotted style so it can never be mistaken for a revealed tile.
 */
import { motion } from 'motion/react';
import type { BoardCell } from '@phrasey/shared';
import { DUR, EASE } from '../lib/motion';

export interface BoardTileProps {
  cell: BoardCell;
  /** Cascade delay in ms for this tile's flip (§9, 40ms stagger). */
  delayMs?: number;
  /** Letter this player privately peeked at. Never rendered as revealed. */
  peekChar?: string;
  reducedMotion?: boolean;
}

export function BoardTile({ cell, delayMs = 0, peekChar, reducedMotion = false }: BoardTileProps) {
  if (cell.t === 'punct') {
    return (
      <span
        aria-hidden="true"
        data-testid="punct"
        className="flex h-[var(--tile)] w-[calc(var(--tile)*0.44)] items-end justify-center pb-[8%] font-mono text-[calc(var(--tile)*0.5)] leading-none font-bold text-chill/70"
      >
        {cell.ch}
      </span>
    );
  }

  const revealed = cell.revealed;
  const delay = reducedMotion ? 0 : delayMs / 1000;

  return (
    <span
      aria-hidden="true"
      data-testid="tile"
      data-revealed={revealed ? 'true' : 'false'}
      className="relative block h-[var(--tile)] w-[calc(var(--tile)*0.78)] [perspective:600px]"
    >
      <motion.span
        key={revealed ? 'up' : 'down'}
        initial={
          reducedMotion
            ? { opacity: 0 }
            : revealed
              ? { rotateX: -92, opacity: 0.2 }
              : { opacity: 1, rotateX: 0 }
        }
        animate={reducedMotion ? { opacity: 1 } : { rotateX: 0, opacity: 1 }}
        transition={{
          duration: reducedMotion ? 0.12 : DUR.tileFlip,
          delay,
          ease: EASE.settle,
        }}
        className={[
          'absolute inset-0 flex items-center justify-center rounded-[calc(var(--tile)*0.12)]',
          'font-mono leading-none font-bold tabular-nums select-none',
          'text-[calc(var(--tile)*0.5)]',
          revealed
            ? 'bg-chill text-ink shadow-[inset_0_-3px_0_0_rgba(20,18,31,0.16)]'
            : 'border border-chill/25 bg-chill/10 text-transparent shadow-[inset_0_2px_0_0_rgba(255,255,255,0.12)]',
        ].join(' ')}
        style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
      >
        {revealed ? cell.ch : ''}
      </motion.span>

      {/* The reveal flash — a lime pop on the beat the tile lands. */}
      {revealed && !reducedMotion && (
        <motion.span
          key={`flash-${delayMs}`}
          initial={{ opacity: 0.85, scale: 1 }}
          animate={{ opacity: 0, scale: 1.35 }}
          transition={{ duration: 0.5, delay, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 rounded-[calc(var(--tile)*0.12)] bg-lime"
        />
      )}

      {/* Private PEEK. Deliberately not styled like a revealed tile. */}
      {!revealed && peekChar && (
        <span
          className="absolute inset-0 flex items-center justify-center rounded-[calc(var(--tile)*0.12)] border border-dashed border-soda/70 font-mono text-[calc(var(--tile)*0.42)] leading-none font-bold text-soda/85"
          title="You peeked at this tile"
        >
          {peekChar}
        </span>
      )}
    </span>
  );
}
