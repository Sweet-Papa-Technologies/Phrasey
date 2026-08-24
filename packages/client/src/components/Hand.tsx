/**
 * The hand: fans across the bottom, cards lift and tilt on hover, and snap to
 * the board with a settle (§9).
 *
 * A fanned eight-card hand does not fit a 390px phone, and a fan you cannot
 * see the ends of is worse than no fan. So the fan is conditional: where there
 * is room it fans, tilts and lifts exactly as §9 asks; on a phone it becomes a
 * flat, snap-scrolling tray of slightly smaller cards. The tap settle stays in
 * both — it is the half of the feel that a touch screen can actually deliver.
 *
 * Cards that need a decision before they can be played — WILD and VOWEL RUSH
 * need a letter, LOCKOUT needs a target — open a small chooser rather than
 * guessing for you.
 *
 * There is one way to spend a turn now: play a card. The "discard and draw"
 * escape hatch is gone, because the thing it escaped from is gone — a letter
 * already on the board is swapped out of every hand automatically, so a hand
 * cannot hold a card it has no use for.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ACTION_CARD_META, ALPHABET, VOWELS, type Card, type PlayerPublic } from '@phrasey/shared';
import { useReducedMotion } from '../lib/motion';
import { useMediaQuery } from '../lib/viewport';
import { PlayingCard } from './PlayingCard';

export interface HandProps {
  hand: Card[];
  guessed: string[];
  players: PlayerPublic[];
  selfId: string | null;
  myTurn: boolean;
  onPlayLetter: (cardId: string) => void;
  onPlayAction: (cardId: string, letter?: string, targetPlayerId?: string) => void;
  /** Flashed when a keystroke plays a card, so the keyboard path is visible. */
  highlightCardId?: string | null;
  /**
   * Turn controls — Solve and Pass — rendered at the head of the hand's own
   * control row. They live here rather than up in the status bar because this
   * is where the thumb already is: the playtest report was "play a piece and
   * then SCROLL UP to see the pass or solve button", and putting them back on
   * screen without putting them back within reach only fixes half of that.
   */
  controls?: ReactNode;
}

type Pending = {
  cardId: string;
  need: 'letter' | 'vowel' | 'target';
  name: string;
} | null;

export function Hand({
  hand,
  guessed,
  players,
  selfId,
  myTurn,
  onPlayLetter,
  onPlayAction,
  highlightCardId,
  controls,
}: HandProps) {
  const reduced = useReducedMotion();
  // A fan needs width for the spread *and* height for the lift. A landscape
  // phone has the first and none of the second, so it gets the flat tray too.
  const fanned = useMediaQuery('(min-width: 640px) and (min-height: 561px)');
  // A landscape phone has 390px of height for the board *and* the hand. The
  // cards get their own step down rather than pushing the board off the screen.
  const shortLandscape = useMediaQuery('(orientation: landscape) and (max-height: 560px)');
  const density = fanned ? 'roomy' : shortLandscape ? 'tight' : 'snug';
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    if (!myTurn) setPending(null);
  }, [myTurn]);

  // §10: Escape cancels.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  const n = hand.length;
  const spread = Math.min(4.5 * Math.max(0, n - 1), 34);

  function geometry(i: number): { rotate: number; lift: number } {
    if (!fanned || n <= 1) return { rotate: 0, lift: 0 };
    const t = i / (n - 1) - 0.5;
    return { rotate: t * spread, lift: Math.abs(t) * Math.abs(t) * 34 };
  }

  function activate(card: Card): void {
    if (!myTurn) return;
    if (card.kind === 'letter') {
      onPlayLetter(card.id);
      return;
    }
    const meta = ACTION_CARD_META[card.action];
    if (card.action === 'WILD') return setPending({ cardId: card.id, need: 'letter', name: meta.name });
    if (card.action === 'VOWEL_RUSH') return setPending({ cardId: card.id, need: 'vowel', name: meta.name });
    if (meta.targets) return setPending({ cardId: card.id, need: 'target', name: meta.name });
    onPlayAction(card.id);
  }

  const others = players.filter((p) => p.id !== selfId);

  return (
    <div className="relative flex w-full min-w-0 flex-col items-center gap-1 sm:gap-2">
      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: reduced ? 0.01 : 0.18 }}
            className="max-h-[58vh] w-full max-w-xl overflow-y-auto rounded-slab border-2 border-ink/12 bg-chill p-3 shadow-card sm:p-4"
            role="dialog"
            aria-label={`${pending.name}: choose`}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-sm font-bold">
                {pending.name} — pick {pending.need === 'target' ? 'a player' : 'a letter'}
              </p>
              <button
                type="button"
                className="font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-60 hover:opacity-100"
                onClick={() => setPending(null)}
              >
                Cancel (Esc)
              </button>
            </div>

            {pending.need === 'target' ? (
              <div className="flex flex-wrap gap-2">
                {others.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="rounded-full border-2 border-ink/12 px-3 py-1.5 text-sm font-semibold hover:bg-ink/6"
                    onClick={() => {
                      onPlayAction(pending.cardId, undefined, p.id);
                      setPending(null);
                    }}
                  >
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ background: p.color }}
                    />
                    {p.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(pending.need === 'vowel' ? [...VOWELS] : ALPHABET).map((l) => {
                  const used = guessed.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      disabled={used}
                      className={[
                        'h-9 w-9 rounded-tile border-2 font-mono text-sm font-bold',
                        used
                          ? 'cursor-not-allowed border-ink/8 opacity-30'
                          : 'border-ink/15 hover:bg-grape hover:text-chill',
                      ].join(' ')}
                      onClick={() => {
                        onPlayAction(pending.cardId, l);
                        setPending(null);
                      }}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Turn controls. There is no "discard and draw" any more: a hand can no
        longer hold a card it cannot use, because a letter already on the board
        is swapped out from every hand automatically. The button existed only to
        escape that, and on a phone it was a permanent row directly under the
        board. What is left here is Solve and Pass, and nothing when it is not
        your turn — but the row keeps its height either way. In a fixed-height
        shell an empty row that collapses would hand its pixels to the board,
        re-fit every tile, and jolt the whole surface at the exact moment your
        turn begins. A stable board is worth 44px of air.
      */}
      <div
        className="flex min-h-[var(--tap)] flex-wrap items-center justify-center gap-2"
        role="group"
        aria-label="Turn controls"
      >
        {controls}
      </div>

      {/*
        The scroller and the row are two elements on purpose. A single flex box
        with `justify-center` and `overflow-x: auto` centres its overflow, which
        pushes the first and last cards past *both* edges and makes the leading
        ones unreachable — that is the "cut off on the left and right" this
        screen was reported for. An auto-margined `w-max` row centres when the
        hand fits and starts flush left when it does not.
      */}
      <div
        className={[
          'rail-scroll -mx-1 flex w-full overflow-x-auto overflow-y-hidden px-1',
          fanned ? 'pt-10 pb-5' : 'snap-x snap-mandatory scroll-px-3 pt-2 pb-1',
        ].join(' ')}
        role="group"
        aria-label="Your hand"
      >
        {/*
          The fan's tilt is a transform, so it sticks out past the row's own
          width; without the padding the outermost card gets its corner shaved
          off by the scroller.
        */}
        <div className={`m-auto flex w-max items-end ${fanned ? 'gap-2 px-6' : 'gap-1.5 px-2'}`}>
          <AnimatePresence initial={false}>
            {hand.map((card, i) => {
              const g = geometry(i);
              const spent = card.kind === 'letter' && guessed.includes(card.letter);
              return (
                <motion.div
                  key={card.id}
                  layout={!reduced}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 60, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -160, scale: 0.7 }}
                  transition={{
                    duration: reduced ? 0.01 : 0.35,
                    ease: [0.22, 1.2, 0.36, 1],
                  }}
                  className={highlightCardId === card.id ? 'drop-shadow-[0_0_18px_rgba(184,255,60,0.9)]' : undefined}
                >
                  <PlayingCard
                    card={card}
                    density={density}
                    rotate={g.rotate}
                    lift={g.lift}
                    spent={spent}
                    disabled={!myTurn || spent}
                    reducedMotion={reduced}
                    onClick={() => activate(card)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
          {hand.length === 0 && <p className="px-2 py-8 text-sm opacity-50">No cards yet.</p>}
        </div>
      </div>
    </div>
  );
}
