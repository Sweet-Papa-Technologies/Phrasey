/**
 * The solve box: fill in the blanks.
 *
 * Playtest note that drove the rebuild — "it should be easier to type in the
 * solve; I should not have to type in letters already locked in, and it is
 * unclear if apostrophes and periods need to be typed in." Both complaints are
 * the same complaint: the box asked for the *whole* phrase when the board
 * already knew most of it.
 *
 * So the field is the board's own shape. Revealed letters are pre-filled and
 * not editable, punctuation is drawn as-is, and the player types only the
 * blanks — which means punctuation and spacing are never typed at all, and the
 * question dissolves. The one line of reassurance under the field is there for
 * the player who is still wondering.
 *
 * **One real input.** Every keystroke goes through a single focused
 * `<input>` laid over the field, the pattern OTP and verification-code inputs
 * use. One input per blank is a mess on a phone: the keyboard thrashes on every
 * focus change, iOS zooms the page on any font under 16px, and focus fights the
 * moment the layout wraps. There is exactly one focus target here, its
 * font-size is 16px so Safari leaves the page alone, and the visible cursor is
 * drawn on the active blank.
 *
 * The arithmetic — which cells are blanks, where the cursor goes, how the guess
 * is assembled — is all in `lib/solveInput.ts` so it can be tested without a
 * DOM. This file owns the input, the focus and the pixels.
 *
 * §10: keyboard-only reachable (the input is a normal tab stop), the position
 * is announced, the active blank carries a visible focus indicator, and
 * `prefers-reduced-motion` kills the caret blink.
 *
 * §6.2: the only thing this component ever sees is `MaskedBoard`. It cannot
 * know the answer, and it does not compare anything — it posts a string and the
 * server decides.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BALANCE, type MaskedBoard } from '@phrasey/shared';
import { useReducedMotion } from '../lib/motion';
import { useElementSize, useViewportSize } from '../lib/viewport';
import { fitBoard, wordWidthUnits, type FitCellKind } from '../lib/boardFit';
import { SOLVE_LOCK_COPY, type SolveLockReason } from '../lib/solveLock';
import {
  applyValueChange,
  assembleGuess,
  backspace,
  buildSolveModel,
  clearEntry,
  cursorLabel,
  emptyEntry,
  filledCount,
  isComplete,
  mirrorOf,
  moveCursor,
  progressLabel,
  setCursor,
  typeChar,
  type SolveEntry,
} from '../lib/solveInput';

export interface SolveBoxProps {
  open: boolean;
  /** The masked board. The blanks are its hidden letter cells. */
  board: Pick<MaskedBoard, 'words'>;
  hiddenLetters: number;
  /** Set when solving is barred; the reason changes what we say about it. */
  lockReason?: SolveLockReason | null;
  onSubmit: (guess: string) => void;
  onCancel: () => void;
}

/**
 * §10 — the visible focus indicator for the active blank. The real input is
 * invisible by design, so the ring has to be drawn on the tile the caret is in.
 */
const ACTIVE_BLANK_OUTLINE = { outline: '3px solid var(--color-grape)', outlineOffset: '2px' } as const;

/** Tile sizing for the solve field. Smaller than the board — it is a control. */
const MIN_TILE = 19;
const MAX_TILE = 40;

export function SolveBox({ open, board, hiddenLetters, lockReason = null, onSubmit, onCancel }: SolveBoxProps) {
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const locked = lockReason !== null;

  const model = useMemo(() => buildSolveModel(board), [board]);
  const [entry, setEntry] = useState<SolveEntry>(() => emptyEntry(model.blankCount));
  const [focused, setFocused] = useState(false);

  /*
   * Reset on open, and also whenever the number of blanks changes underneath
   * us — an interrupt can land a reveal while this is on screen, and a typed
   * slot that no longer exists would silently shift every letter after it.
   */
  useEffect(() => {
    setEntry(emptyEntry(model.blankCount));
  }, [open, model.blankCount]);

  useEffect(() => {
    if (!open || locked) return undefined;
    // Focus after paint so the Enter that opened the box is not swallowed.
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open, locked]);

  // `open` re-arms the measurement: the field is not in the DOM until the box
  // opens, and a ref alone gives the hook nothing to re-run on.
  const { width } = useElementSize(fieldRef, open);
  const viewport = useViewportSize();

  const wordUnits = useMemo(
    () =>
      model.words.map((w) =>
        wordWidthUnits(w.cells.map((c) => (c.kind === 'punct' ? 'punct' : 'letter') as FitCellKind)),
      ),
    [model],
  );

  const fit = useMemo(() => {
    const widest = wordUnits.length > 0 ? Math.max(...wordUnits) : 1;
    // `width` is the border box; the field carries `px-2` and a 2px border, so
    // twenty pixels of it are not content. Handing the fit the whole box would
    // pick a tile a hair too wide and put a scrollbar under a phrase that fits.
    const availableWidth = width > 0 ? Math.max(40, width - 20) : widest * MAX_TILE;
    // A quarter of the screen, capped. Past that the field scrolls inside
    // itself — never the page, which is a fixed-height shell.
    const budget = viewport.height > 0 ? Math.min(240, Math.max(96, viewport.height * 0.26)) : null;
    return fitBoard({
      availableWidth,
      availableHeight: budget,
      wordUnits,
      minTile: MIN_TILE,
      maxTile: MAX_TILE,
    });
  }, [width, viewport.height, wordUnits]);

  const mirror = mirrorOf(entry);
  const complete = isComplete(entry);

  /*
   * The caret always sits at the end of the mirrored value, which is what lets
   * `applyValueChange` treat a longer value as "these characters were added".
   */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || document.activeElement !== el) return;
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  }, [mirror]);

  const submit = useCallback(() => {
    if (locked || !complete) return;
    onSubmit(assembleGuess(model, entry));
  }, [locked, complete, onSubmit, model, entry]);

  const focusField = useCallback((blank?: number) => {
    if (blank !== undefined) setEntry((e) => setCursor(e, blank));
    inputRef.current?.focus();
  }, []);

  if (!open) return null;

  const potential = BALANCE.scoring.solveBase + BALANCE.scoring.solveHiddenBonus * hiddenLetters;
  const copy = lockReason ? SOLVE_LOCK_COPY[lockReason] : null;

  const blankUnder = (target: EventTarget | null): number | undefined => {
    const el = target instanceof Element ? target.closest('[data-blank]') : null;
    if (!(el instanceof HTMLElement) || el.dataset.blank === undefined) return undefined;
    const n = Number(el.dataset.blank);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduced ? 0.01 : 0.2, ease: [0.22, 1.2, 0.36, 1] }}
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4"
      role="dialog"
      aria-modal="false"
      aria-label="Solve the puzzle"
    >
      <form
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col gap-2 rounded-slab border-2 border-ink/12 bg-chill p-3 shadow-slab sm:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-display text-lg font-bold">Fill in the blanks</h2>
          <p className="font-mono text-[0.6875rem] tracking-[0.1em] uppercase opacity-70">
            worth {potential} now · wrong costs +{BALANCE.pressure.wrongSolve} pressure and locks you out
          </p>
        </div>

        {copy && (
          <p role="alert" className="shrink-0 rounded-card bg-cherry/15 px-3 py-2 text-sm font-semibold text-ink">
            {copy.note}
          </p>
        )}

        {/*
          The field. `cursor-text` and the click handlers make the whole box one
          big focus target for the single real input, which is what keeps a
          phone from having to hit a 20px tile.
        */}
        <div
          ref={fieldRef}
          data-testid="solve-field"
          onPointerDown={(e) => {
            // Only steal a mouse press. Swallowing a touch here would kill
            // scrolling inside the field on a long phrase.
            if (e.pointerType !== 'mouse' || locked) return;
            e.preventDefault();
            focusField(blankUnder(e.target));
          }}
          onClick={(e) => {
            if (locked) return;
            focusField(blankUnder(e.target));
          }}
          className={[
            'rail-scroll relative flex min-h-[var(--tap)] w-full shrink cursor-text flex-col items-center justify-center',
            'gap-[calc(var(--tile)*0.3)] overflow-y-auto rounded-card border-2 bg-white px-2 py-3',
            fit.overflows ? 'items-start overflow-x-auto' : '',
            focused ? 'border-grape' : 'border-ink/15',
            locked ? 'opacity-50' : '',
          ].join(' ')}
          style={{ ['--tile' as string]: `${fit.tile}px`, maxHeight: 'min(34dvh, 17rem)' }}
        >
          {fit.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              className="flex shrink-0 items-center justify-center gap-[calc(var(--tile)*0.62)]"
              aria-hidden="true"
            >
              {line.map((wordIndex) => {
                const word = model.words[wordIndex];
                if (!word) return null;
                return (
                  <div key={word.wordIndex} className="flex items-center gap-[calc(var(--tile)*0.13)]">
                    {word.cells.map((cell) => {
                      if (cell.kind === 'punct') {
                        return (
                          <span
                            key={cell.index}
                            data-testid="solve-punct"
                            className="flex h-[var(--tile)] w-[calc(var(--tile)*0.44)] items-end justify-center pb-[8%] font-mono text-[calc(var(--tile)*0.5)] leading-none font-bold text-ink/45"
                          >
                            {cell.ch}
                          </span>
                        );
                      }
                      if (cell.kind === 'fixed') {
                        return (
                          <span
                            key={cell.index}
                            data-testid="solve-fixed"
                            className="flex h-[var(--tile)] w-[calc(var(--tile)*0.78)] items-center justify-center rounded-[calc(var(--tile)*0.12)] bg-ink font-mono text-[calc(var(--tile)*0.5)] leading-none font-bold text-chill select-none"
                          >
                            {cell.ch}
                          </span>
                        );
                      }
                      const value = entry.typed[cell.blank] ?? '';
                      const active = focused && !locked && entry.cursor === cell.blank;
                      return (
                        <span
                          key={cell.index}
                          data-testid="solve-blank"
                          data-blank={cell.blank}
                          data-active={active ? 'true' : 'false'}
                          className={[
                            'relative flex h-[var(--tile)] w-[calc(var(--tile)*0.78)] items-center justify-center',
                            'rounded-[calc(var(--tile)*0.12)] font-mono text-[calc(var(--tile)*0.5)] leading-none font-bold select-none',
                            value ? 'bg-fanta text-ink' : 'border-2 border-dashed border-ink/30 bg-chill/60 text-ink',
                          ].join(' ')}
                          style={active ? ACTIVE_BLANK_OUTLINE : undefined}
                        >
                          {value}
                          {active && !value && (
                            <span
                              data-motion="caret"
                              className="absolute bottom-[14%] h-[10%] w-[52%] rounded-full bg-grape"
                              style={reduced ? undefined : { animation: 'phrasey-caret 1.1s steps(2, start) infinite' }}
                            />
                          )}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}

          {/*
            The one real input. Invisible, but a genuine tab stop with a genuine
            caret — `pointer-events-none` so a click lands on the blank under it
            and the handlers above can read which one it was.

            `text-base` is not decoration: iOS zooms the page whenever a focused
            input's font-size is under 16px, and this box lives in a
            fixed-height shell where a zoom is a broken layout.
          */}
          <input
            ref={inputRef}
            type="text"
            value={mirror}
            disabled={locked}
            onChange={(e) => setEntry((en) => applyValueChange(en, e.target.value.toUpperCase()))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
                return;
              }
              // Everything typed in here belongs to the box, not to the game's
              // "press a letter to play that card" hotkeys.
              e.stopPropagation();
              if (e.metaKey || e.ctrlKey || e.altKey) return;

              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Backspace') {
                e.preventDefault();
                setEntry(backspace);
              } else if (e.key === 'Delete') {
                e.preventDefault();
                setEntry(clearEntry);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setEntry((en) => moveCursor(en, -1));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setEntry((en) => moveCursor(en, 1));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setEntry((en) => setCursor(en, 0));
              } else if (e.key === 'End') {
                e.preventDefault();
                setEntry((en) => setCursor(en, en.typed.length - 1));
              } else if (e.key.length === 1) {
                // Punctuation and spaces are swallowed outright — there is no
                // blank they could go in, and that is the whole point.
                e.preventDefault();
                setEntry((en) => typeChar(en, e.key));
              }
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            aria-label={cursorLabel(entry)}
            aria-describedby="solve-help"
            className="pointer-events-none absolute inset-0 h-full w-full border-0 bg-transparent p-0 text-base text-transparent opacity-0 outline-none"
            style={{ caretColor: 'transparent' }}
          />
        </div>

        <p id="solve-help" className="shrink-0 text-center text-xs opacity-70">
          Type the missing letters only. Punctuation and spacing are ignored.
        </p>

        {/* §10 — progress, announced politely rather than on every keystroke. */}
        <p className="sr-only" aria-live="polite">
          {progressLabel(entry)}
        </p>

        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="font-mono text-[0.6875rem] tracking-[0.1em] uppercase opacity-60" aria-hidden="true">
            {model.blankCount === 0 ? 'all revealed' : `${filledCount(entry)}/${model.blankCount} filled`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border-2 border-ink/15 px-4 py-2 text-sm font-semibold hover:bg-ink/6"
            >
              Cancel
            </button>
            {/*
              An explicit Submit, because a phone keyboard's return key is not
              an obvious "solve" button to anybody.
            */}
            <button
              type="submit"
              disabled={locked || !complete}
              className="rounded-full bg-fanta px-5 py-2 text-sm font-bold text-ink shadow-pop disabled:opacity-40 disabled:shadow-none"
            >
              Lock it in
            </button>
          </div>
        </div>
      </form>
    </motion.div>
  );
}
