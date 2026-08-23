/**
 * The solve box. §10: Enter opens it, Escape cancels — the open/close keys are
 * owned by the game screen; this component owns the field and the warning.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BALANCE } from '@phrasey/shared';
import { useReducedMotion } from '../lib/motion';

export interface SolveBoxProps {
  open: boolean;
  hiddenLetters: number;
  locked: boolean;
  onSubmit: (guess: string) => void;
  onCancel: () => void;
}

export function SolveBox({ open, hiddenLetters, locked, onSubmit, onCancel }: SolveBoxProps) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      // Focus after paint so the Enter that opened the box is not swallowed.
      const id = setTimeout(() => input.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const potential = BALANCE.scoring.solveBase + BALANCE.scoring.solveHiddenBonus * hiddenLetters;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduced ? 0.01 : 0.2, ease: [0.22, 1.2, 0.36, 1] }}
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4"
      role="dialog"
      aria-modal="false"
      aria-label="Solve the puzzle"
    >
      <form
        className="w-full max-w-2xl rounded-slab border-2 border-ink/12 bg-chill p-4 shadow-slab"
        onSubmit={(e) => {
          e.preventDefault();
          const guess = value.trim();
          if (guess) onSubmit(guess);
        }}
      >
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="solve-input" className="font-display text-lg font-bold">
            Solve it
          </label>
          <p className="font-mono text-[0.6875rem] tracking-[0.1em] uppercase opacity-70">
            worth {potential} now · wrong costs +{BALANCE.pressure.wrongSolve} pressure and locks you out
          </p>
        </div>
        <input
          id="solve-input"
          ref={input}
          value={value}
          disabled={locked}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
            e.stopPropagation();
          }}
          placeholder={locked ? "You're locked out this round" : 'Type the whole phrase…'}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-card border-2 border-ink/15 bg-white px-3 py-3 font-mono text-lg tracking-wide uppercase disabled:opacity-50"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border-2 border-ink/15 px-4 py-2 text-sm font-semibold hover:bg-ink/6"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={locked || value.trim().length === 0}
            className="rounded-full bg-fanta px-5 py-2 text-sm font-bold text-ink shadow-pop disabled:opacity-40"
          >
            Lock it in
          </button>
        </div>
      </form>
    </motion.div>
  );
}
