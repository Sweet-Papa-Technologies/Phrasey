import { describe, expect, it } from 'vitest';
import type { Card } from '@phrasey/shared';
import { heldLetters, normalizeLetterKey, resolveLetterKey } from './keyboard';

const hand: Card[] = [
  { id: 'c1', kind: 'letter', letter: 'E' },
  { id: 'c2', kind: 'letter', letter: 'T' },
  { id: 'c3', kind: 'letter', letter: 'E' },
  { id: 'c4', kind: 'action', action: 'WILD' },
  { id: 'c5', kind: 'action', action: 'SWIPE' },
];

describe('normalizeLetterKey', () => {
  it('uppercases single letters', () => {
    expect(normalizeLetterKey('e')).toBe('E');
    expect(normalizeLetterKey('Z')).toBe('Z');
  });

  it('rejects anything that is not a single A–Z key', () => {
    for (const k of ['Enter', 'Escape', 'ArrowLeft', '1', ' ', '', 'é', 'ß', 'Shift']) {
      expect(normalizeLetterKey(k)).toBeNull();
    }
  });
});

describe('resolveLetterKey', () => {
  it('plays the held card for that letter', () => {
    const r = resolveLetterKey('t', hand, []);
    expect(r).toEqual({ kind: 'play', card: hand[1] });
  });

  it('is case insensitive and picks the first matching copy', () => {
    expect(resolveLetterKey('E', hand, [])).toEqual({ kind: 'play', card: hand[0] });
    expect(resolveLetterKey('e', hand, [])).toEqual({ kind: 'play', card: hand[0] });
  });

  it('blocks a letter that is already on the board even if held', () => {
    const r = resolveLetterKey('E', hand, ['E']);
    expect(r).toEqual({ kind: 'blocked', reason: 'already-guessed', letter: 'E' });
  });

  it('blocks a letter the player does not hold', () => {
    expect(resolveLetterKey('Q', hand, [])).toEqual({ kind: 'blocked', reason: 'not-held', letter: 'Q' });
  });

  it('never spends a WILD card on a plain keystroke', () => {
    const r = resolveLetterKey('Q', hand, []);
    expect(r.kind).toBe('blocked');
  });

  it('ignores non-letter keys', () => {
    for (const k of ['Enter', 'Escape', '4', 'Tab']) {
      expect(resolveLetterKey(k, hand, [])).toEqual({ kind: 'ignored', reason: 'not-a-letter' });
    }
  });

  it('treats guessed letters case-insensitively', () => {
    expect(resolveLetterKey('T', hand, ['t'])).toEqual({ kind: 'blocked', reason: 'already-guessed', letter: 'T' });
  });
});

describe('heldLetters', () => {
  it('is the distinct sorted set of letters in hand', () => {
    expect(heldLetters(hand)).toEqual(['E', 'T']);
  });
});
