import { EngineError } from '@phrasey/shared';
import { closeWindow } from '../interrupts.js';
import type { InterruptContext, InterruptOutcome } from './interruptTypes.js';

/**
 * BUZZ IN (§3.5): take the next turn out of order. Once per round per player.
 *
 * It does not target anybody and never goes on the pending stack, so it cannot
 * be BLOCKed — it simply redirects who is dealt the next turn.
 */
export function playBuzzIn(ctx: InterruptContext): InterruptOutcome {
  if (ctx.player.buzzInsLeft <= 0) throw new EngineError('BUZZ_EXHAUSTED');
  ctx.player.buzzInsLeft -= 1;
  ctx.round.nextPlayerOverride = ctx.player.id;
  ctx.round.discard.push(ctx.card);
  ctx.events.push({ t: 'buzz', playerId: ctx.player.id });
  closeWindow(ctx.round, ctx.events);
  return { chained: false, immediate: true };
}
