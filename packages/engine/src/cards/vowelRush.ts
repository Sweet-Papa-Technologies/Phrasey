import { EngineError, VOWELS } from '@phrasey/shared';
import { isGuessed, revealLetter } from '../board.js';
import { applyPressure } from '../pressure.js';
import type { CardContext, CardOutcome } from './types.js';

const VOWEL_SET = new Set<string>(VOWELS);

/**
 * VOWEL RUSH (§3.5): reveal every instance of one vowel of your choice. You
 * score nothing, and it costs +2 pressure — it is a board-opener for the table,
 * not a scoring play.
 *
 * A vowel that is not in the puzzle still costs the pressure and is recorded as
 * missed, so the deduction pattern stays sound.
 */
export function applyVowelRush(ctx: CardContext): CardOutcome {
  const letter = ctx.letter;
  if (!letter || !VOWEL_SET.has(letter)) throw new EngineError('LETTER_REQUIRED', 'vowel required');
  if (isGuessed(ctx.round, letter)) throw new EngineError('LETTER_ALREADY_GUESSED', letter);

  const { occurrences, positions } = revealLetter(ctx.round, letter);
  if (occurrences > 0) {
    ctx.events.push({ t: 'reveal', letters: [letter], positions, reason: 'vowel-rush' });
  } else {
    ctx.round.missed.push(letter);
  }
  const res = applyPressure(ctx.round, ctx.balance.pressure.vowelRush, 'vowel-rush', ctx.player.id, ctx.balance, ctx.events);
  return { blowout: res.blowout };
}
