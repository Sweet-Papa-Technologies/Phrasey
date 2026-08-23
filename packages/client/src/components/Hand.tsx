/**
 * The hand: fans across the bottom, cards lift and tilt on hover, and snap to
 * the board with a settle (§9).
 *
 * Cards that need a decision before they can be played — WILD and VOWEL RUSH
 * need a letter, LOCKOUT needs a target — open a small chooser rather than
 * guessing for you.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ACTION_CARD_META, ALPHABET, VOWELS, type Card, type PlayerPublic } from '@phrasey/shared';
import { BALANCE } from '@phrasey/shared';
import { useReducedMotion } from '../lib/motion';
import { PlayingCard } from './PlayingCard';

export interface HandProps {
  hand: Card[];
  guessed: string[];
  players: PlayerPublic[];
  selfId: string | null;
  myTurn: boolean;
  onPlayLetter: (cardId: string) => void;
  onPlayAction: (cardId: string, letter?: string, targetPlayerId?: string) => void;
  onDiscard: (cardIds: string[]) => void;
  /** Flashed when a keystroke plays a card, so the keyboard path is visible. */
  highlightCardId?: string | null;
}

type Pending = { cardId: string; need: 'letter' | 'vowel' | 'target'; name: string } | null;

export function Hand({
  hand,
  guessed,
  players,
  selfId,
  myTurn,
  onPlayLetter,
  onPlayAction,
  onDiscard,
  highlightCardId,
}: HandProps) {
  const reduced = useReducedMotion();
  const [discardMode, setDiscardMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    if (!myTurn) {
      setDiscardMode(false);
      setPicked([]);
      setPending(null);
    }
  }, [myTurn]);

  // §10: Escape cancels. Applies to the chooser and to discard mode alike.
  useEffect(() => {
    if (!pending && !discardMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPending(null);
      setDiscardMode(false);
      setPicked([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, discardMode]);

  const n = hand.length;
  const spread = Math.min(4.5 * Math.max(0, n - 1), 34);

  function geometry(i: number): { rotate: number; lift: number } {
    if (n <= 1) return { rotate: 0, lift: 0 };
    const t = i / (n - 1) - 0.5;
    return { rotate: t * spread, lift: Math.abs(t) * Math.abs(t) * 34 };
  }

  function activate(card: Card): void {
    if (discardMode) {
      setPicked((p) =>
        p.includes(card.id)
          ? p.filter((x) => x !== card.id)
          : p.length >= BALANCE.turn.maxDiscard
            ? p
            : [...p, card.id],
      );
      return;
    }
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
    <div className="relative flex w-full flex-col items-center gap-3">
      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: reduced ? 0.01 : 0.18 }}
            className="w-full max-w-xl rounded-slab border-2 border-ink/12 bg-chill p-4 shadow-card"
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
                        used ? 'cursor-not-allowed border-ink/8 opacity-30' : 'border-ink/15 hover:bg-grape hover:text-chill',
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!myTurn}
          onClick={() => {
            setDiscardMode((d) => !d);
            setPicked([]);
          }}
          className={[
            'rounded-full border-2 px-3 py-1.5 font-mono text-[0.625rem] tracking-[0.14em] uppercase',
            discardMode ? 'border-cherry bg-cherry text-chill' : 'border-ink/15 hover:bg-ink/6',
            !myTurn ? 'opacity-40' : '',
          ].join(' ')}
        >
          {discardMode ? 'Choose 1–3 to toss' : 'Discard & draw'}
        </button>
        {discardMode && (
          <button
            type="button"
            disabled={picked.length === 0}
            onClick={() => {
              onDiscard(picked);
              setDiscardMode(false);
              setPicked([]);
            }}
            className="rounded-full bg-fanta px-3 py-1.5 font-mono text-[0.625rem] tracking-[0.14em] text-ink uppercase shadow-pop disabled:opacity-40"
          >
            Toss {picked.length}
          </button>
        )}
      </div>

      <div
        className="rail-scroll flex w-full items-end justify-center gap-1 overflow-x-auto overflow-y-hidden px-2 pt-10 pb-6 sm:gap-2"
        role="group"
        aria-label="Your hand"
      >
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
                transition={{ duration: reduced ? 0.01 : 0.35, ease: [0.22, 1.2, 0.36, 1] }}
                className={highlightCardId === card.id ? 'drop-shadow-[0_0_18px_rgba(184,255,60,0.9)]' : undefined}
              >
                <PlayingCard
                  card={card}
                  rotate={g.rotate}
                  lift={g.lift}
                  spent={spent}
                  selected={picked.includes(card.id)}
                  disabled={!discardMode && (!myTurn || spent)}
                  reducedMotion={reduced}
                  onClick={() => activate(card)}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {hand.length === 0 && <p className="py-8 text-sm opacity-50">No cards yet.</p>}
      </div>
    </div>
  );
}
