import type { CardContext, CardOutcome } from './types.js';

/** CRACK (§3.5): reveals the puzzle's pre-generated one-line hint to everyone. */
export function applyCrack(ctx: CardContext): CardOutcome {
  ctx.round.hintRevealed = true;
  ctx.events.push({ t: 'crack', playerId: ctx.player.id, hint: ctx.round.puzzle.hint });
  return {};
}
