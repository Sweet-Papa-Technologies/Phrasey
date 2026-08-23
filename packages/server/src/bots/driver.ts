/**
 * The BOT DRIVER — timing and plumbing only.
 *
 * §5: "Bots must have a visible thinking delay. Instant bot moves read as
 * cheating even when they aren't." That delay is the whole job of this module,
 * along with calling the policy and refusing to let a broken policy stall the
 * table.
 *
 * NO DECISION LOGIC LIVES HERE. Every choice comes from a `PlayerPolicy`
 * supplied by `@phrasey/engine` (M4). See `bots/policies.ts` for the seam.
 */
import type { Balance, BotTier } from '@phrasey/shared';
import type { EngineAction, PlayerPolicy, PlayerView, Rng } from '@phrasey/engine';

export interface DelayOptions {
  /** Hard ceiling — an interrupt window is only 4s wide. */
  cap?: number | undefined;
  /**
   * The `awaiting-solve` beat. It shares the same turn clock as the primary
   * action, so it gets a fraction of the think time rather than a full helping.
   */
  solveBeat?: boolean;
}

export const SOLVE_BEAT_FRACTION = 0.45;

/** Uniform draw from the tier's `thinkMsMin`..`thinkMsMax` (§5 table). */
export function thinkDelayMs(balance: Balance, tier: BotTier, rng: Rng, opts: DelayOptions = {}): number {
  const cfg = balance.bots.tiers[tier] ?? balance.bots.tiers.sharp;
  const min = Math.max(0, cfg.thinkMsMin);
  const max = Math.max(min, cfg.thinkMsMax);
  let ms = min + rng.next() * (max - min);
  if (opts.solveBeat) ms *= SOLVE_BEAT_FRACTION;
  if (opts.cap !== undefined) ms = Math.min(ms, opts.cap);
  return Math.round(ms);
}

/**
 * Ask the policy what to do. A policy that throws yields `timeout`, which the
 * engine turns into "auto-play the best held letter, or discard" (§3.3) — the
 * table always moves.
 */
export function chooseBotAction(policy: PlayerPolicy, view: PlayerView, rng: Rng): EngineAction {
  try {
    const action = policy.chooseTurnAction(view, rng);
    if (action && typeof action.type === 'string') return action;
  } catch {
    /* fall through */
  }
  return { type: 'timeout', playerId: view.playerId };
}

/** Null means "decline"; the caller turns that into `passInterrupt`. */
export function chooseBotInterrupt(policy: PlayerPolicy, view: PlayerView, rng: Rng): EngineAction | null {
  const window = view.window;
  if (!window) return null;
  try {
    const action = policy.chooseInterrupt(view, window, rng);
    return action && typeof action.type === 'string' ? action : null;
  } catch {
    return null;
  }
}
