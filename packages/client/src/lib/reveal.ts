/**
 * The reveal cascade (§9).
 *
 * "Tiles flip in sequence, 40ms stagger. Revealing four E's produces a little
 * run of flips — this is the game's best moment, make it feel good."
 *
 * The sequencing is a pure function of the `positions` array carried by
 * `letter:hit` / `reveal` / `breath` events, so it can be unit tested without
 * a DOM and so the board component stays dumb: it just asks "what is my delay".
 */
import type { GameEvent } from '@phrasey/shared';

/** §9. Also mirrored as `--stagger` in CSS so both agree. */
export const REVEAL_STAGGER_MS = 40;
/** Duration of a single tile's flip. */
export const REVEAL_FLIP_MS = 260;
/** Card play: arc from hand to board (§9). */
export const CARD_ARC_MS = 350;

export interface CascadeStep {
  /** Flat tile index, matching `letterPositions()` in @phrasey/shared. */
  index: number;
  delayMs: number;
}

export interface CascadeOptions {
  staggerMs?: number;
  /** §9/§10: reduced motion collapses the run into one simultaneous cross-fade. */
  reducedMotion?: boolean;
}

/**
 * Turn a set of newly-revealed tile indexes into an ordered flip schedule.
 * Reading order, deduped, one stagger step apart.
 */
export function planRevealCascade(positions: readonly number[], opts: CascadeOptions = {}): CascadeStep[] {
  const stagger = opts.reducedMotion ? 0 : (opts.staggerMs ?? REVEAL_STAGGER_MS);
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const p of [...positions].sort((a, b) => a - b)) {
    if (!Number.isFinite(p) || p < 0 || seen.has(p)) continue;
    seen.add(p);
    ordered.push(p);
  }
  return ordered.map((index, i) => ({ index, delayMs: i * stagger }));
}

/** Total wall time for a cascade, used to gate follow-up beats (sound, feed). */
export function cascadeDurationMs(steps: readonly CascadeStep[], flipMs = REVEAL_FLIP_MS): number {
  if (steps.length === 0) return 0;
  return (steps[steps.length - 1]?.delayMs ?? 0) + flipMs;
}

/** Index → delay, the shape the board actually consumes. */
export function cascadeDelayMap(steps: readonly CascadeStep[]): Map<number, number> {
  return new Map(steps.map((s) => [s.index, s.delayMs]));
}

/**
 * Every tile index a batch of events just uncovered. `reveal` and `letter:hit`
 * can both describe the same play, so the result is deduped by `planRevealCascade`.
 */
export function collectRevealPositions(events: readonly GameEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.t === 'letter:hit' || e.t === 'reveal' || e.t === 'breath') out.push(...e.positions);
  }
  return out;
}
