import { EngineError } from '@phrasey/shared';
import { openWindow, resolveStack } from '../interrupts.js';
import { seatOrder } from '../turnOrder.js';
import type { CardContext, CardOutcome } from './types.js';

/**
 * LOCKOUT (§3.5): target player cannot Solve on their next turn.
 *
 * This is the only turn card that targets a player (see `ACTION_CARD_META`),
 * so it is the only one that opens a BLOCK window. The effect is parked on the
 * interrupt stack rather than applied immediately — applying and then undoing it
 * would emit a lockout the table could see and then un-see.
 */
export function applyLockout(ctx: CardContext): CardOutcome {
  const targetId = ctx.targetPlayerId;
  if (!targetId) throw new EngineError('TARGET_REQUIRED');
  if (targetId === ctx.player.id) throw new EngineError('INVALID_TARGET', 'cannot lock yourself out');
  const target = seatOrder(ctx.state, ctx.round).find((p) => p.id === targetId);
  if (!target) throw new EngineError('INVALID_TARGET', targetId);

  ctx.round.stack.push({ kind: 'lockout', playerId: ctx.player.id, targetPlayerId: targetId, card: ctx.card });
  const deferred = openWindow(ctx.state, ctx.round, 'targeted', ctx.player.id, targetId, 0, ctx.nowMs, ctx.events);
  if (!deferred) resolveStack(ctx.state, ctx.round, ctx.balance, ctx.events);
  return { deferred, retainsCard: true };
}
