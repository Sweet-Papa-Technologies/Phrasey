/**
 * A card in hand (§9).
 *
 * Letter cards: crisp white tiles, the letter set large in Martian Mono, a
 * small frequency pip in the corner. Action cards: saturated grape or fanta,
 * one bold icon, a short name.
 */
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { ACTION_CARD_META, ENGLISH_LETTER_FREQUENCY, type Card } from '@phrasey/shared';
import { DUR, EASE } from '../lib/motion';
import { ActionIcon } from './ActionIcon';

export interface PlayingCardProps {
  card: Card;
  disabled?: boolean;
  selected?: boolean;
  /** Dimmed because the letter is already on the board. */
  spent?: boolean;
  /** Fan geometry, applied by the Hand. */
  rotate?: number;
  lift?: number;
  onClick?: () => void;
  reducedMotion?: boolean;
  /** Landing-page decoration: not interactive, not focusable. */
  inert?: boolean;
}

/** How common the letter is, as one to three pips. Cheap, readable, no numbers. */
export function frequencyPips(letter: string): number {
  const f = ENGLISH_LETTER_FREQUENCY[letter] ?? 0;
  if (f >= 6) return 3;
  if (f >= 2.2) return 2;
  return 1;
}

export const PlayingCard = forwardRef<HTMLButtonElement, PlayingCardProps>(function PlayingCard(
  { card, disabled, selected, spent, rotate = 0, lift = 0, onClick, reducedMotion = false, inert = false },
  ref,
) {
  const isLetter = card.kind === 'letter';
  const meta = card.kind === 'action' ? ACTION_CARD_META[card.action] : null;
  const interruptCard = meta?.interrupt ?? false;

  const label = isLetter
    ? `Letter ${card.letter}${spent ? ' — already played this round' : ''}`
    : `${meta?.name ?? ''} — ${meta?.blurb ?? ''}`;

  const surface = isLetter
    ? 'bg-chill text-ink'
    : interruptCard
      ? 'bg-fanta text-ink'
      : 'bg-grape text-chill';

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled || inert}
      tabIndex={inert ? -1 : 0}
      aria-hidden={inert || undefined}
      onClick={onClick}
      title={meta ? `${meta.name} — ${meta.blurb}` : undefined}
      aria-label={label}
      className={[
        'relative flex h-[7.5rem] w-[4.75rem] shrink-0 flex-col items-center justify-between',
        'rounded-card border-2 px-2 py-2.5 shadow-card',
        'origin-bottom transition-colors',
        surface,
        selected ? 'border-lime ring-4 ring-lime/45' : 'border-ink/15',
        spent ? 'opacity-40 grayscale' : '',
        disabled && !inert ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
      ].join(' ')}
      initial={false}
      animate={{ rotate, y: lift }}
      whileHover={disabled || inert || reducedMotion ? undefined : { y: lift - 18, rotate: rotate * 0.35, scale: 1.06 }}
      whileFocus={disabled || inert || reducedMotion ? undefined : { y: lift - 18, scale: 1.06 }}
      whileTap={disabled || inert || reducedMotion ? undefined : { y: lift - 6, scale: 0.98 }}
      transition={{ duration: reducedMotion ? 0.01 : DUR.settle, ease: EASE.settle }}
    >
      {spent && (
        <span className="sticker absolute -top-1.5 left-1/2 -translate-x-1/2 rotate-[-6deg] bg-ink text-chill">
          played
        </span>
      )}
      {isLetter ? (
        <>
          <span className="self-start font-mono text-[0.5rem] tracking-[0.12em] opacity-45">
            {'•'.repeat(frequencyPips(card.letter))}
          </span>
          <span className="font-mono text-[2.1rem] leading-none font-extrabold">{card.letter}</span>
          <span className="self-end rotate-180 font-mono text-[0.5rem] tracking-[0.12em] opacity-45">
            {'•'.repeat(frequencyPips(card.letter))}
          </span>
        </>
      ) : (
        <>
          <span className="sticker bg-ink/20 text-current opacity-80">{interruptCard ? 'Out of turn' : 'Action'}</span>
          <ActionIcon kind={card.action} className="h-9 w-9" />
          <span className="text-center font-display text-[0.7rem] leading-tight font-bold">{meta?.name}</span>
        </>
      )}
    </motion.button>
  );
});
