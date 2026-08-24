/**
 * The out-of-turn interrupt window (§3.5): four seconds, and the countdown is
 * the whole affordance. The arithmetic lives in `lib/interrupt.ts` so it can be
 * tested; this component is the face of it.
 */
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ACTION_CARD_META, type Card } from '@phrasey/shared';
import { INTERRUPT_WINDOW_MS, interruptFraction, interruptSecondsLeft } from '../lib/interrupt';
import { useReducedMotion } from '../lib/motion';
import { ActionIcon } from './ActionIcon';

export interface InterruptPromptProps {
  expiresAt: number;
  playableCardIds: string[];
  hand: Card[];
  sourceName: string;
  onPlay: (cardId: string) => void;
  onDismiss: () => void;
}

/** Ticks a countdown and reports how much of the window is left, 1 → 0. */
export function useInterruptCountdown(expiresAt: number, reduced = false): { fraction: number; seconds: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (reduced) {
      const id = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(id);
    }
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [expiresAt, reduced]);

  return {
    fraction: interruptFraction(expiresAt, now),
    seconds: interruptSecondsLeft(expiresAt, now),
  };
}

export function InterruptPrompt({
  expiresAt,
  playableCardIds,
  hand,
  sourceName,
  onPlay,
  onDismiss,
}: InterruptPromptProps) {
  const reduced = useReducedMotion();
  const { fraction, seconds } = useInterruptCountdown(expiresAt, reduced);
  const cards = hand.filter((c) => playableCardIds.includes(c.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (fraction <= 0 || cards.length === 0) return null;

  /*
   * Four seconds is not enough time to reach the top of a phone with a thumb.
   * On small screens the prompt sits at the bottom of the screen, over the
   * hand; from `sm` up it goes back to the top of the board, where it covers
   * nothing anyone is reading.
   */
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.01 : 0.18 }}
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:top-32 sm:bottom-auto sm:px-4 sm:pb-0"
      role="alertdialog"
      aria-label="Interrupt window"
    >
      <div className="w-full max-w-md overflow-hidden rounded-slab border-2 border-fanta bg-ink text-chill shadow-slab">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <p className="font-display text-base font-bold">{sourceName} just hit. Steal it?</p>
          <span
            className="font-mono text-xl font-extrabold tabular-nums text-fanta"
            aria-label={`${seconds} seconds left`}
          >
            {seconds}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPlay(c.id)}
              className="flex items-center gap-2 rounded-full bg-fanta px-4 py-2 text-sm font-bold text-ink shadow-pop"
            >
              {c.kind === 'action' && <ActionIcon kind={c.action} className="h-4 w-4" />}
              {c.kind === 'action' ? ACTION_CARD_META[c.action].name : c.letter}
            </button>
          ))}
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto rounded-full border-2 border-chill/25 px-3 py-2 font-mono text-[0.625rem] tracking-[0.14em] uppercase"
          >
            Pass
          </button>
        </div>
        <div className="h-1.5 w-full bg-chill/15" aria-hidden="true">
          <div
            className="h-full bg-fanta"
            style={{
              width: `${fraction * 100}%`,
              transition: reduced ? undefined : 'width 80ms linear',
            }}
          />
        </div>
        <span className="sr-only">
          {seconds} of {INTERRUPT_WINDOW_MS / 1000} seconds left to interrupt.
        </span>
      </div>
    </motion.div>
  );
}
