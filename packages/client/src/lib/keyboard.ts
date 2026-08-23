/**
 * Keyboard-first play (§10): "typing a letter plays that card if you hold it."
 *
 * The mapping is a pure function so the rule — and, just as importantly, the
 * reasons a keystroke does nothing — can be tested without a rendered board.
 */
import type { Card, LetterCard } from '@phrasey/shared';

export type KeyResolution =
  | { kind: 'play'; card: LetterCard }
  | { kind: 'ignored'; reason: 'not-a-letter' }
  | { kind: 'blocked'; reason: 'already-guessed'; letter: string }
  | { kind: 'blocked'; reason: 'not-held'; letter: string };

const SINGLE_LETTER = /^[A-Z]$/;

/**
 * Uppercase A–Z, or null for anything else — digits, arrows, dead keys, IME
 * composition. Note the post-uppercase length check: 'ß'.toUpperCase() is 'SS',
 * which would otherwise sneak through a naive range comparison.
 */
export function normalizeLetterKey(key: string): string | null {
  if (typeof key !== 'string' || key.length !== 1) return null;
  const up = key.toUpperCase();
  return SINGLE_LETTER.test(up) ? up : null;
}

/** Distinct letters currently in hand, in alphabetical order. */
export function heldLetters(hand: readonly Card[]): string[] {
  const set = new Set<string>();
  for (const c of hand) if (c.kind === 'letter') set.add(c.letter);
  return [...set].sort();
}

/**
 * What a keystroke should do.
 *
 * Deliberately does NOT fall back to a WILD card: WILD is a choice with a cost,
 * and silently spending one because somebody typed a letter would be a bad
 * surprise. The UI surfaces WILD as an explicit affordance instead.
 */
export function resolveLetterKey(key: string, hand: readonly Card[], guessed: readonly string[]): KeyResolution {
  const letter = normalizeLetterKey(key);
  if (!letter) return { kind: 'ignored', reason: 'not-a-letter' };
  if (guessed.some((g) => g.toUpperCase() === letter)) return { kind: 'blocked', reason: 'already-guessed', letter };
  const card = hand.find((c): c is LetterCard => c.kind === 'letter' && c.letter === letter);
  if (!card) return { kind: 'blocked', reason: 'not-held', letter };
  return { kind: 'play', card };
}

/** True when a keystroke should be ignored because the user is typing into a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
