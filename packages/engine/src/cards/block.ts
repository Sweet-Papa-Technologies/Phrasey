import { EngineError } from '@phrasey/shared';
import { closeWindow, openWindow, resolveStack } from '../interrupts.js';
import type { InterruptContext, InterruptOutcome } from './interruptTypes.js';

/**
 * BLOCK (§3.5): when an action card targets you, cancel it. Both cards discard.
 *
 * A BLOCK can be blocked — playing one opens a fresh window against the owner of
 * the effect being cancelled, until the chain cap (default 3) is reached.
 */
export function playBlock(ctx: InterruptContext): InterruptOutcome {
  const top = ctx.round.stack[ctx.round.stack.length - 1];
  if (!top) throw new EngineError('INTERRUPT_NOT_ALLOWED', 'nothing to block');
  if (top.playerId === ctx.player.id) throw new EngineError('INTERRUPT_NOT_ALLOWED', 'cannot block yourself');

  const counterTargetId = top.playerId;
  ctx.round.stack.push({ kind: 'block', playerId: ctx.player.id, card: ctx.card });
  closeWindow(ctx.round, ctx.events);

  const chained = openWindow(
    ctx.state, ctx.round, 'targeted', ctx.player.id, counterTargetId, ctx.window.chain + 1, ctx.nowMs, ctx.events,
  );
  if (!chained) resolveStack(ctx.state, ctx.round, ctx.balance, ctx.events);
  return { chained };
}
