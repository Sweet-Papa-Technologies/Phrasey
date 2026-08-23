import type { CardContext, CardOutcome } from './types.js';

/**
 * DOUBLE DOWN (§3.5): your next letter this round scores 2x; if it misses, 2x
 * pressure. Armed here, spent in letterPlay.ts. It expires at round end simply
 * because `doubleDownArmed` is reset by `startRound`.
 */
export function applyDoubleDown(ctx: CardContext): CardOutcome {
  ctx.player.doubleDownArmed = true;
  ctx.events.push({ t: 'notice', message: `${ctx.player.name} doubled down.` });
  return {};
}
