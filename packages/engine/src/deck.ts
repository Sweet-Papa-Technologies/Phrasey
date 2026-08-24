/**
 * Deck construction — design doc §3.2, "the most important tuning knob in the
 * game".
 *
 * The rule that matters: do NOT deal from a uniform letter pool. A uniform pool
 * stalls the board and leaves players holding dead Q's. Instead the deck is
 * biased toward letters that are actually in *this* puzzle, so a turn almost
 * always has a live option, while the noise slice keeps the hand from being a
 * free answer key.
 *
 * Every proportion here comes from `balance.deck`. Nothing is hardcoded.
 */
import type { ActionCardKind, Balance, Card, Letter, Puzzle } from '@phrasey/shared';
import { ENGLISH_LETTER_FREQUENCY, VOWELS, letterStats, normalizePuzzleText, isInterruptKind } from '@phrasey/shared';
import type { Rng } from './rng.js';

const VOWEL_SET = new Set<string>(VOWELS);

export function isVowel(letter: string): boolean {
  return VOWEL_SET.has(letter);
}

/** §3.2: `deckSize = max(60, players * 18)`. */
export function deckSizeFor(playerCount: number, balance: Balance): number {
  return Math.max(balance.deck.minDeckSize, playerCount * balance.deck.perPlayer);
}

/**
 * The puzzle slice: each letter weighted by how many times it occurs, so a
 * phrase full of E's deals plenty of E's. Vowels are scaled down because a
 * revealed vowel does more work for the board than any consonant.
 */
export function puzzleLetterPool(puzzle: Puzzle, balance: Balance): [Letter, number][] {
  const stats = puzzle.letterStats && Object.keys(puzzle.letterStats).length > 0
    ? puzzle.letterStats
    : letterStats(puzzle.text);
  const out: [Letter, number][] = [];
  for (const [letter, count] of Object.entries(stats)) {
    if (count <= 0) continue;
    out.push([letter, isVowel(letter) ? count * balance.deck.vowelWeightMultiplier : count]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

/**
 * The noise slice: English frequency, minus J/Q/X/Z unless the puzzle actually
 * contains them. Dealing a Z that cannot possibly hit is the single most
 * frustrating card in a game like this, so it simply is not in the bag.
 */
export function noiseLetterPool(puzzle: Puzzle, balance: Balance): [Letter, number][] {
  const present = new Set(Object.keys(
    puzzle.letterStats && Object.keys(puzzle.letterStats).length > 0 ? puzzle.letterStats : letterStats(puzzle.text),
  ));
  const excluded = new Set(balance.deck.rareNoiseExcluded);
  const out: [Letter, number][] = [];
  for (const [letter, freq] of Object.entries(ENGLISH_LETTER_FREQUENCY)) {
    if (excluded.has(letter) && !present.has(letter)) continue;
    out.push([letter, isVowel(letter) ? freq * balance.deck.vowelWeightMultiplier : freq]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

/**
 * The action cards a deck may contain.
 *
 * When the host has interrupts switched off, SWIPE / BLOCK / BUZZ IN are left
 * out entirely rather than dealt and ignored. They are playable only inside an
 * interrupt window, so with windows disabled they are cards that can never be
 * played — permanent dead weight in a hand, and the sweep cannot clear them
 * because an action card is never "dead" in the letter sense.
 */
export function actionPool(balance: Balance, interruptsEnabled = true): [ActionCardKind, number][] {
  return (Object.entries(balance.deck.actionWeights) as [ActionCardKind, number][])
    .filter(([kind, w]) => w > 0 && (interruptsEnabled || !isInterruptKind(kind)))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * Build one round's deck.
 *
 * Card ids are `${idPrefix}-${n}` assigned before the shuffle, so they are
 * unique within a deck and byte-identical for a given seed. The server keys
 * play requests on them; the client keys DOM nodes on them.
 */
export function buildDeck(
  puzzle: Puzzle,
  playerCount: number,
  balance: Balance,
  rng: Rng,
  idPrefix = 'd',
  interruptsEnabled = true,
): Card[] {
  const size = deckSizeFor(playerCount, balance);
  const letterCount = Math.round(size * balance.deck.letterCardShare);
  const actionCount = size - letterCount;
  const fromPuzzle = Math.round(letterCount * balance.deck.puzzleLetterShare);
  const fromNoise = letterCount - fromPuzzle;

  const puzzlePool = puzzleLetterPool(puzzle, balance);
  const noisePool = noiseLetterPool(puzzle, balance);
  const actions = actionPool(balance, interruptsEnabled);

  const cards: Card[] = [];
  let n = 0;
  const nextId = (): string => `${idPrefix}-${n++}`;

  // A puzzle with no letters at all cannot happen with a validated corpus
  // (§4.3 requires >= 6 distinct letters), but the engine must not divide by
  // zero if someone hands it a degenerate fixture.
  const letterSource = puzzlePool.length > 0 ? puzzlePool : noisePool;
  for (let i = 0; i < fromPuzzle; i++) {
    cards.push({ id: nextId(), kind: 'letter', letter: rng.weighted(letterSource) });
  }
  for (let i = 0; i < fromNoise; i++) {
    cards.push({ id: nextId(), kind: 'letter', letter: rng.weighted(noisePool) });
  }
  for (let i = 0; i < actionCount; i++) {
    cards.push({ id: nextId(), kind: 'action', action: rng.weighted(actions) });
  }

  return rng.shuffle(cards);
}

/** Convenience for tests and for the corpus validator's solvability check. */
export function puzzleLetterSet(puzzle: Puzzle): Set<Letter> {
  return new Set(Object.keys(letterStats(normalizePuzzleText(puzzle.text))));
}
