import { seatAfter } from '../turnOrder.js';
import type { CardContext, CardOutcome } from './types.js';

/** SKIP (§3.5): next player loses their turn. */
export function applySkip(ctx: CardContext): CardOutcome {
  const victim = seatAfter(ctx.state, ctx.round, ctx.player.id, ctx.round.direction);
  if (victim && victim.id !== ctx.player.id) {
    victim.skipNextTurn = true;
    ctx.events.push({ t: 'skip', playerId: ctx.player.id, skippedPlayerId: victim.id });
  }
  return {};
}
