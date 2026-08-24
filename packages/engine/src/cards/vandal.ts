import { applyPressure } from '../pressure.js';
import { drawForPlayer } from '../state.js';
import type { CardContext, CardOutcome } from './types.js';

/**
 * VANDAL (§3.5): +2 pressure, draw 2. Pure chaos/spite.
 *
 * The draw is clamped to the hand cap (§3.3) — the cap is a hard invariant, and
 * a card that could push a hand to 9 would break every downstream assumption.
 */
export function applyVandal(ctx: CardContext): CardOutcome {
  const room = Math.max(0, ctx.balance.setup.handCap - ctx.player.hand.length);
  const drawn = drawForPlayer(ctx.round, ctx.player, Math.min(2, room), ctx.balance);
  ctx.player.hand.push(...drawn);
  if (drawn.length > 0) ctx.events.push({ t: 'draw', playerId: ctx.player.id, count: drawn.length });
  const res = applyPressure(ctx.round, ctx.balance.pressure.vandal, 'vandal', ctx.player.id, ctx.balance, ctx.events);
  return { blowout: res.blowout };
}
