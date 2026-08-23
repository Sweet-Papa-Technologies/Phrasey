/**
 * Action-card play (§5): "Chill: rare, random. Sharp: situational. Ruthless:
 * optimal, uses interrupts."
 *
 * Every candidate play is scored as an **advantage over simply playing the best
 * letter in hand**. Zero means "no better than the obvious move", so a tier
 * that only plays positive-advantage cards is by construction situational, and
 * one that plays the highest positive advantage is by construction greedy-
 * optimal over the one-turn horizon. Chill ignores all of it and plays a legal
 * card at random, which is what "rare, random" means.
 *
 * Two rules bind every tier:
 *   - No play whose *deterministic* pressure cost would tip the gauge. §3.4
 *     makes a blowout everyone's problem and the tipper's -20; a bot that
 *     walks into that on purpose is not a bot, it is a griefer.
 *   - Interrupt cards (SWIPE / BLOCK / BUZZ IN) are never a turn action.
 */
import type { ActionCardKind, Balance, BotTier, PlayCardIntent } from '@phrasey/shared';
import { VOWELS, isActionCard } from '@phrasey/shared';
import type { PlayerView } from '../view.js';
import type { Deduction } from './deduction.js';
import { missCost, type LetterEstimates } from './letterScore.js';
import { BOT_TUNING, tipsGauge } from './tuning.js';

export interface ActionPlan {
  kind: ActionCardKind;
  cardId: string;
  intent: PlayCardIntent;
  /** Points of advantage over playing the best letter in hand. */
  advantage: number;
}

const INTERRUPTS: readonly string[] = ['SWIPE', 'BLOCK', 'BUZZ_IN'];

/** Action cards in hand that are legal as a primary action right now. */
export function turnActionCards(view: PlayerView) {
  return view.hand.filter(isActionCard).filter((c) => !INTERRUPTS.includes(c.action));
}

/** Would this card's fixed pressure cost tip the gauge? */
function fixedPressure(kind: ActionCardKind, balance: Balance): number {
  if (kind === 'VOWEL_RUSH') return balance.pressure.vowelRush;
  if (kind === 'VANDAL') return balance.pressure.vandal;
  return 0;
}

export function isGaugeSafe(kind: ActionCardKind, view: PlayerView, balance: Balance): boolean {
  return !tipsGauge(fixedPressure(kind, balance), view.pressure, view.pressureMax);
}

/** `missCost` evaluated at a hypothetical gauge reading. */
function costAtPressure(view: PlayerView, balance: Balance, tier: BotTier, pressure: number): number {
  return missCost({ ...view, pressure: Math.max(0, pressure) }, balance, tier);
}

/** The seat that acts after this one, from the public seat list and direction. */
export function nextSeat(view: PlayerView): { id: string; score: number } | null {
  const seats = view.players;
  if (seats.length < 2) return null;
  const at = seats.findIndex((p) => p.id === view.playerId);
  if (at < 0) return null;
  const dir = view.round?.direction ?? 1;
  const idx = (((at + dir) % seats.length) + seats.length) % seats.length;
  const p = seats[idx];
  return p ? { id: p.id, score: p.score } : null;
}

/** Highest-scoring opponent that is actually seated in this round. */
export function leader(view: PlayerView): { id: string; score: number } | null {
  const others = view.players.filter((p) => p.id !== view.playerId);
  const dealt = others.filter((p) => p.handCount > 0);
  const pool = dealt.length > 0 ? dealt : others;
  if (pool.length === 0) return null;
  const best = pool.reduce((a, b) => (b.score > a.score ? b : a));
  return { id: best.id, score: best.score };
}

export interface PlanInput {
  view: PlayerView;
  ded: Deduction;
  estimates: LetterEstimates;
  balance: Balance;
  tier: BotTier;
  /** Value of the best letter play available this turn, in points. */
  bestLetterValue: number;
  /** Value of the second-best, for the DOUBLE DOWN comparison. */
  secondLetterValue: number;
  /** The letter behind `bestLetterValue`, if any. */
  bestLetter: string | null;
}

/**
 * Every situational play the bot can see, with its advantage. Only plays whose
 * situation is actually happening are returned — an empty list means "nothing
 * here beats a letter".
 */
export function planActionCards(input: PlanInput): ActionPlan[] {
  const { view, ded, estimates, balance, tier, bestLetterValue: V, secondLetterValue: V2 } = input;
  const cards = turnActionCards(view).filter((c) => isGaugeSafe(c.action, view, balance));
  if (cards.length === 0) return [];

  const plans: ActionPlan[] = [];
  const headroom = view.pressureMax - view.pressure;
  const ambiguous = ded.pool.length === 0 || ded.pool.length > BOT_TUNING.ambiguousPool;
  const first = (kind: ActionCardKind) => cards.find((c) => c.action === kind);

  // RELIEF VALVE — the gauge is a shared consequence, and the bot prices the
  // relief as the drop in what the table's next miss will cost (§3.4).
  const relief = first('RELIEF_VALVE');
  if (relief) {
    const now = costAtPressure(view, balance, tier, view.pressure);
    const after = costAtPressure(view, balance, tier, view.pressure + balance.pressure.reliefValve);
    const benefit = (now - after) * 1.5;
    plans.push({
      kind: 'RELIEF_VALVE',
      cardId: relief.id,
      intent: { type: 'action', cardId: relief.id },
      advantage: benefit - V,
    });
  }

  // DOUBLE DOWN — worth it only when the best letter is far ahead of the next
  // one, because the card spends a turn to double a play you have to survive to
  // make. Two-turn comparison: 0.8 * 2V  vs  V + V2.
  const dd = first('DOUBLE_DOWN');
  const bestEst = input.bestLetter ? estimates.get(input.bestLetter) : undefined;
  if (dd && bestEst && !view.self.doubleDownArmed) {
    const confident =
      bestEst.hitProbability >= (BOT_TUNING.doubleDownMinHit[tier] ?? 0.9) &&
      bestEst.expectedOccurrences >= BOT_TUNING.doubleDownMinOccurrences &&
      headroom > balance.pressure.wrongLetter * balance.pressure.doubleDownMissMultiplier + 1;
    if (confident) {
      plans.push({
        kind: 'DOUBLE_DOWN',
        cardId: dd.id,
        intent: { type: 'action', cardId: dd.id },
        advantage: 0.8 * 2 * V - (V + V2),
      });
    }
  }

  // PEEK — the only card that buys a *certainty*. It converts straight into a
  // guaranteed hit next turn and prunes the candidate pool, so a bot that is in
  // the dark should want it badly and one holding a live board should not.
  const peek = first('PEEK');
  if (peek && ded.hiddenLetters > 0) {
    const info = balance.scoring.perRevealedLetter * 1.2 + (ambiguous ? 8 : 0) + (tier === 'ruthless' && ambiguous ? 10 : 0);
    plans.push({
      kind: 'PEEK',
      cardId: peek.id,
      intent: { type: 'action', cardId: peek.id },
      advantage: info - V,
    });
  }

  // CRACK — the hint is a line of English. A deterministic heuristic cannot
  // read it, so its only value to a bot is that it is a free primary action on
  // a dead turn. Ruthless additionally counts the cost of handing a *human* the
  // hint for nothing, and so effectively never plays it.
  const crack = first('CRACK');
  if (crack && !view.board?.hint) {
    const worth = tier === 'ruthless' ? 2 : 9;
    plans.push({ kind: 'CRACK', cardId: crack.id, intent: { type: 'action', cardId: crack.id }, advantage: worth - V });
  }

  // VOWEL RUSH — opens the board for everybody, scores you nothing, +2
  // pressure. Only worth it when the bot is lost and the gauge has room.
  const rush = first('VOWEL_RUSH');
  if (rush) {
    const vowels = (VOWELS as readonly string[])
      .filter((v) => !ded.guessed.has(v))
      .map((v) => ({ v, est: estimates.get(v) }))
      .filter((x) => x.est !== undefined)
      .sort((a, b) => (b.est?.hitProbability ?? 0) - (a.est?.hitProbability ?? 0));
    const pick = vowels[0];
    if (pick && pick.est && headroom > balance.pressure.vowelRush + 2) {
      const cost = costAtPressure(view, balance, tier, view.pressure) * balance.pressure.vowelRush;
      const worth = (ambiguous ? 10 : 3) * pick.est.hitProbability;
      plans.push({
        kind: 'VOWEL_RUSH',
        cardId: rush.id,
        intent: { type: 'action', cardId: rush.id, letter: pick.v },
        advantage: worth - cost - V,
      });
    }
  }

  // LOCKOUT — denies the table's leader the one action that ends the round.
  // Only meaningful once the board is open enough for a solve to be live.
  const lock = first('LOCKOUT');
  const target = leader(view);
  if (lock && target && ded.revealedFraction >= 0.45) {
    plans.push({
      kind: 'LOCKOUT',
      cardId: lock.id,
      intent: { type: 'action', cardId: lock.id, targetPlayerId: target.id },
      advantage: 15 * ded.revealedFraction - V,
    });
  }

  // SKIP / REVERSE — tempo denial, worth something only in the endgame when the
  // seat you are skipping is plausibly about to solve.
  const next = nextSeat(view);
  const denial = first('SKIP') ?? first('REVERSE');
  if (denial && next && ded.revealedFraction >= 0.55) {
    plans.push({
      kind: denial.action,
      cardId: denial.id,
      intent: { type: 'action', cardId: denial.id },
      advantage: 12 * ded.revealedFraction - V,
    });
  }

  // SHUFFLE — a hand of dead letters is worth trading wholesale.
  const shuffle = first('SHUFFLE');
  if (shuffle && view.hand.length >= 3 && input.bestLetter === null) {
    plans.push({ kind: 'SHUFFLE', cardId: shuffle.id, intent: { type: 'action', cardId: shuffle.id }, advantage: 10 - V });
  }

  // VANDAL — +2 pressure to draw 2. Only ever defensible with an empty gauge
  // and an empty hand.
  const vandal = first('VANDAL');
  if (vandal && view.pressure === 0 && view.hand.length <= 2) {
    plans.push({ kind: 'VANDAL', cardId: vandal.id, intent: { type: 'action', cardId: vandal.id }, advantage: 6 - V });
  }

  return plans;
}

/** Every legal primary action-card play, unscored — Chill's "random" pool. */
export function randomPlayablePlans(view: PlayerView, ded: Deduction, balance: Balance): ActionPlan[] {
  const out: ActionPlan[] = [];
  for (const card of turnActionCards(view)) {
    if (!isGaugeSafe(card.action, view, balance)) continue;
    if (card.action === 'VOWEL_RUSH') {
      const vowel = (VOWELS as readonly string[]).find((v) => !ded.guessed.has(v));
      if (!vowel) continue;
      out.push({ kind: card.action, cardId: card.id, intent: { type: 'action', cardId: card.id, letter: vowel }, advantage: 0 });
      continue;
    }
    if (card.action === 'WILD') {
      const letter = ded.open[0];
      if (!letter) continue;
      out.push({ kind: card.action, cardId: card.id, intent: { type: 'action', cardId: card.id, letter }, advantage: 0 });
      continue;
    }
    if (card.action === 'LOCKOUT') {
      const target = leader(view);
      if (!target) continue;
      out.push({
        kind: card.action,
        cardId: card.id,
        intent: { type: 'action', cardId: card.id, targetPlayerId: target.id },
        advantage: 0,
      });
      continue;
    }
    if (card.action === 'CRACK' && view.board?.hint) continue;
    out.push({ kind: card.action, cardId: card.id, intent: { type: 'action', cardId: card.id }, advantage: 0 });
  }
  return out;
}
