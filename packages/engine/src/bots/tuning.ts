/**
 * Bot-local tuning constants (design doc §5).
 *
 * Everything a *designer* would want to tune lives in `balance.bots.tiers` in
 * @phrasey/shared — solve roll, action-card bias, score noise, think delay,
 * whether the tier uses interrupts. The numbers here are the internals of the
 * heuristic itself: how a bot converts board evidence into points, and how much
 * it fears the shared gauge. They are the bot's *implementation*, not the
 * game's balance, so they live with the bot.
 *
 * If a later playtest wants them designer-facing, they lift cleanly into
 * `balance.bots` — nothing else reads them.
 */
import type { BotTier } from '@phrasey/shared';

export const BOT_TUNING = {
  /**
   * Points of symmetric noise added per unit of the tier's `scoreNoise`.
   * A typical letter is worth 10–40 points, so chill (0.55) gets +-16 points of
   * fog — enough to routinely mis-rank — and ruthless (0.03) gets +-0.9, which
   * only ever breaks a near-tie.
   */
  noisePoints: 30,

  /**
   * Pseudo-count of prior evidence blended into every corpus estimate. With
   * twenty matching phrases the prior is noise; with one it still carries ~43%
   * of the weight, which is the honest amount of doubt to have about a single
   * corpus match.
   */
  priorStrength: 0.75,

  /**
   * Points a bot charges itself for one unit of gauge risk at full headroom.
   * Scales up as the gauge fills — see `missCost` in letterScore.ts.
   */
  pressureUnitCost: 3,

  /**
   * What tipping the gauge is actually worth: the -20 from §3.4 plus the round
   * it burns for everyone (nobody gets the solve bonus, §3.4). A bot that
   * blows the gauge hurts itself too, and this is the number that says so.
   */
  blowoutCost: 45,

  /** Multiplier on the risk term. Ruthless respects the gauge most. */
  riskAversion: { chill: 0.6, sharp: 1, ruthless: 1.25 } as Record<BotTier, number>,

  /** Expected occurrences a letter needs before DOUBLE DOWN is worth arming. */
  doubleDownMinOccurrences: 1.2,
  /** Hit probability DOUBLE DOWN demands. A miss costs 2x pressure (§3.5). */
  doubleDownMinHit: { chill: 0.8, sharp: 0.9, ruthless: 0.95 } as Record<BotTier, number>,

  /** Candidate-pool size above which a bot considers itself "in the dark". */
  ambiguousPool: 6,

  /** Ruthless buzzes in for a letter this good even when it cannot solve yet. */
  buzzInMinOccurrences: 2,
} as const;

/** Never let a deterministic-cost card tip the gauge — see §3.4. */
export function tipsGauge(delta: number, pressure: number, pressureMax: number): boolean {
  return delta > 0 && pressure + delta >= pressureMax;
}
