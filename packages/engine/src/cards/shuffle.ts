import type { Card } from '@phrasey/shared';
import { seatOrder } from '../turnOrder.js';
import type { CardContext, CardOutcome } from './types.js';

/**
 * SHUFFLE (§3.5): every player passes their hand to the next player in play
 * direction. Total card count is unchanged, which the conservation invariant
 * checks.
 */
export function applyShuffle(ctx: CardContext): CardOutcome {
  const seats = seatOrder(ctx.state, ctx.round);
  if (seats.length < 2) return {};
  const hands: Card[][] = seats.map((p) => p.hand);
  const n = seats.length;
  const step = ctx.round.direction === 1 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const dest = (((i + step) % n) + n) % n;
    const target = seats[dest];
    const hand = hands[i];
    if (target && hand) target.hand = hand;
  }
  ctx.events.push({ t: 'shuffle', order: seats.map((p) => p.id) });
  return {};
}
