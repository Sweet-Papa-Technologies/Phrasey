import { seatOrder } from '../turnOrder.js';
import { applySkip } from './skip.js';
import type { CardContext, CardOutcome } from './types.js';

/**
 * REVERSE (§3.5): flip play direction. With 2 players a flip returns the turn
 * to the same opponent, so the doc specifies it acts as SKIP instead.
 */
export function applyReverse(ctx: CardContext): CardOutcome {
  if (seatOrder(ctx.state, ctx.round).length <= 2) return applySkip(ctx);
  ctx.round.direction = ctx.round.direction === 1 ? -1 : 1;
  ctx.events.push({ t: 'reverse', playerId: ctx.player.id, direction: ctx.round.direction });
  return {};
}
