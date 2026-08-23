import { assertPlayableLetter, resolveLetterPlay } from '../letterPlay.js';
import type { CardContext, CardOutcome } from './types.js';

/** WILD (§3.5): play as any letter of your choice. Scores as a normal letter. */
export function applyWild(ctx: CardContext): CardOutcome {
  const letter = assertPlayableLetter(ctx.round, ctx.letter);
  const res = resolveLetterPlay(ctx.state, ctx.round, ctx.player, ctx.card, letter, ctx.nowMs, ctx.events);
  // A hit parks the card on the interrupt stack; a miss already discarded it.
  return { blowout: res.blowout, deferred: res.deferred, retainsCard: true };
}
