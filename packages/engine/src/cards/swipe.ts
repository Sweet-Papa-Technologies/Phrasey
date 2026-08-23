import { EngineError } from '@phrasey/shared';
import { closeWindow, openWindow, resolveStack } from '../interrupts.js';
import type { InterruptContext, InterruptOutcome } from './interruptTypes.js';

/**
 * SWIPE (§3.5): immediately after another player's letter hits, steal the
 * reveal points from that play.
 *
 * The swipe is itself parked on the stack, because the player who was swiped
 * may hold a BLOCK — that is the LIFO chain the doc asks for.
 */
export function playSwipe(ctx: InterruptContext): InterruptOutcome {
  const top = ctx.round.stack[ctx.round.stack.length - 1];
  if (!top || top.kind !== 'hit') throw new EngineError('INTERRUPT_NOT_ALLOWED', 'nothing to swipe');
  if (top.playerId === ctx.player.id) throw new EngineError('INTERRUPT_NOT_ALLOWED', 'cannot swipe yourself');

  const victimId = top.playerId;
  ctx.round.stack.push({ kind: 'swipe', playerId: ctx.player.id, card: ctx.card });
  closeWindow(ctx.round, ctx.events);

  const chained = openWindow(
    ctx.state, ctx.round, 'targeted', ctx.player.id, victimId, ctx.window.chain + 1, ctx.nowMs, ctx.events,
  );
  if (!chained) resolveStack(ctx.state, ctx.round, ctx.balance, ctx.events);
  return { chained };
}
