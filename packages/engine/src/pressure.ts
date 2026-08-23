/**
 * The shared pressure gauge — design doc §3.4 and §9's signature element.
 *
 * One gauge per round, 0–12. It is shared *on purpose*: a wrong letter is a
 * social act, not a personal mistake (§2, tension 3). Nothing here is
 * per-player except the attribution of who tipped it.
 */
import type { Balance, GameEvent } from '@phrasey/shared';
import type { RoundState } from './state.js';

export interface PressureResult {
  value: number;
  /** The delta actually applied after clamping — not the requested one. */
  delta: number;
  /** True the instant the gauge hits max. The caller ends the round (§3.4). */
  blowout: boolean;
}

/**
 * Move the gauge and emit the event. Clamped to [0, max] so RELIEF_VALVE at
 * pressure 1 cannot drive it negative and bank free headroom.
 */
export function applyPressure(
  round: RoundState,
  requested: number,
  cause: string,
  byPlayerId: string | null,
  balance: Balance,
  events: GameEvent[],
): PressureResult {
  const before = round.pressure;
  const next = Math.max(0, Math.min(balance.pressure.max, before + requested));
  const delta = next - before;
  round.pressure = next;
  if (delta !== 0 || requested !== 0) {
    events.push({ t: 'pressure', value: next, delta, cause, byPlayerId });
  }
  return { value: next, delta, blowout: next >= balance.pressure.max };
}

export function isBlown(round: RoundState, balance: Balance): boolean {
  return round.pressure >= balance.pressure.max;
}
