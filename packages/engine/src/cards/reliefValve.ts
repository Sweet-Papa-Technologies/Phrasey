import { applyPressure } from '../pressure.js';
import type { CardContext, CardOutcome } from './types.js';

/** RELIEF VALVE (§3.5): -3 pressure, clamped at 0. */
export function applyReliefValve(ctx: CardContext): CardOutcome {
  applyPressure(ctx.round, ctx.balance.pressure.reliefValve, 'relief-valve', ctx.player.id, ctx.balance, ctx.events);
  return {};
}
