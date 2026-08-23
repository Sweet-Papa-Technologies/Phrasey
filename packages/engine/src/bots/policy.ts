/**
 * The three bots (design doc §5).
 *
 *   | Tier     | Solve roll | Action card use          | Think delay |
 *   | Chill    | 25%        | Rare, random             | 2.5-4s      |
 *   | Sharp    | 60%        | Situational              | 1.5-3s      |
 *   | Ruthless | 90%        | Optimal, uses interrupts | 1.2-2.5s    |
 *
 * Every number in that table comes from `balance.bots.tiers[tier]`, never from
 * here, so a designer can retune bots from `/config/balance` without a deploy.
 *
 * A bot sees a `PlayerView` and nothing else. It has no access to the answer,
 * the deck, or anyone else's hand — the deduction is real, which is the entire
 * point of §5 and why the tiers feel different rather than just cheating by
 * different amounts.
 *
 * THE TURN-ONE PROBLEM. A corpus-matching bot is *too* strong at the moment the
 * board is dealt: with a few hundred phrases, the word-length skeleton alone
 * ("5 3 6 3 4") fingerprints most of them, so `boardPattern` narrows to one
 * candidate before a single letter is played and the bot solves on turn one.
 * That is not deduction, it is having the corpus memorized, and no human can do
 * it. So every tier carries an evidence gate (`SOLVE_GATES`): a bot will not
 * attempt a solve until enough of the board is actually face-up AND enough
 * distinct letters have been played, and until then it has no phrase-level
 * information to score letters with either. Left ungated, a Ruthless round ends
 * on turn three with the gauge at zero and every balance number collapses; with
 * the gate it runs nine to thirteen turns and the misses come back.
 */
import type { Balance, BotTier, BotTierConfig, Card, Puzzle } from '@phrasey/shared';
import { defaultBalance, isActionCard, isLetterCard } from '@phrasey/shared';
import type { EngineAction } from '../actions.js';
import type { PlayerPolicy } from '../policy.js';
import type { Rng } from '../rng.js';
import type { InterruptWindowView, PlayerView } from '../view.js';
import { planActionCards, randomPlayablePlans, type ActionPlan } from './actionPlan.js';
import { corpusIndexFor, type CorpusIndex } from './corpusIndex.js';
import { DEFAULT_VOCABULARY_MIN_WEIGHT, deduce, soleCandidate, type Deduction } from './deduction.js';
import { estimateLetters, letterValue, scoreNoise, type LetterEstimates } from './letterScore.js';
import { BOT_TUNING } from './tuning.js';

/** How much evidence a tier needs before it will risk a solve. */
export interface SolveGate {
  /** Fraction of letter tiles that must be face-up. */
  minRevealedFraction: number;
  /** Distinct letters that must have been played this round, hit or miss. */
  minGuessedLetters: number;
}

/**
 * Tuned by simulation, not by taste. The gate is set at roughly 0.6 for every
 * tier because it is an anti-clairvoyance correction, not a difficulty dial —
 * difficulty is `solveRoll` and `scoreNoise`, which live in balance.ts where a
 * designer can reach them. The small gradient (a stronger bot commits on
 * slightly less evidence) is the only skill content here.
 *
 * At these values a four-bot round runs 9-13 turns, which is roughly three
 * turns per seat. Drop the gate to 0.3 and a Ruthless round ends on turn 3 or 4
 * — one turn each — which is the degenerate case this whole mechanism exists to
 * prevent.
 */
export const SOLVE_GATES: Record<BotTier, SolveGate> = {
  chill: { minRevealedFraction: 0.62, minGuessedLetters: 6 },
  sharp: { minRevealedFraction: 0.6, minGuessedLetters: 5 },
  ruthless: { minRevealedFraction: 0.58, minGuessedLetters: 5 },
};

export interface BotOptions {
  /**
   * The puzzle pool the room draws from — the "corpus subset" of §5. Injected
   * rather than imported so the server can hand the bot exactly the pool the
   * round was dealt from, and so tests can control it. With no corpus a bot
   * falls back to pure English-frequency play and never solves.
   */
  corpus?: readonly Puzzle[];
  /** Defaults to `defaultBalance()`. Pass the room's balance in production. */
  balance?: Balance;
  /** Per-bot overrides on top of `balance.bots.tiers[tier]`. */
  config?: Partial<BotTierConfig>;
  /** Per-bot overrides on top of `SOLVE_GATES[tier]`. */
  gate?: Partial<SolveGate>;
  /**
   * Vocabulary floor for word-shape scoring: a corpus word must occur at least
   * this many times before the bot is allowed to pattern-match against it.
   * Defaults to the tier's `VOCABULARY_MIN_WEIGHT`.
   *
   * This is the second half of the anti-clairvoyance story. Two thirds of the
   * distinct words in a few-hundred-phrase corpus occur exactly once, and
   * matching a board word against one of those is not vocabulary, it is
   * recognizing the answer by its silhouette. Restricting the bot to words that
   * actually recur models a player who knows English rather than one who has
   * the corpus memorized — and it is the single biggest lever on the bot's miss
   * rate, which is what drives the pressure gauge (§3.4).
   */
  vocabularyMinWeight?: number;
}

/** Per-tier vocabulary floor. A better bot "knows" more words. */
export const VOCABULARY_MIN_WEIGHT: Record<BotTier, number> = {
  chill: 4,
  sharp: 3,
  ruthless: DEFAULT_VOCABULARY_MIN_WEIGHT,
};

export interface LetterPlay {
  letter: string;
  cardId: string;
  /** WILD is a letter play that can name any open letter (§3.5). */
  wild: boolean;
  /** Expected points net of gauge risk, before tier noise. */
  value: number;
  /** Value as the bot actually ranked it, noise included. */
  noisyValue: number;
}

/** WILD is flexible; a bot should not burn it to save four points. */
const WILD_HOLD_MARGIN: Record<BotTier, number> = { chill: 0, sharp: 4, ruthless: 8 };

/** Keep-value used when deciding what to throw away. */
function keepValue(card: Card, view: PlayerView, values: Map<string, number>, usesInterrupts: boolean): number {
  if (isLetterCard(card)) {
    const v = values.get(card.letter);
    if (v === undefined) return 0; // already played this round: dead weight
    return Math.max(0, v) + 1;
  }
  if (!isActionCard(card)) return 0;
  switch (card.action) {
    case 'SWIPE':
    case 'BLOCK':
    case 'BUZZ_IN':
      return usesInterrupts ? 25 : 0.5;
    case 'WILD':
      return 20;
    case 'PEEK':
      return 12;
    case 'RELIEF_VALVE':
      return view.pressure >= view.pressureMax - 4 ? 22 : 10;
    case 'VANDAL':
      return 2;
    case 'CRACK':
      return view.board?.hint ? 0 : 6;
    default:
      return 8;
  }
}

/** Rank every letter the bot could actually play this turn. */
export function rankLetterPlays(
  view: PlayerView,
  ded: Deduction,
  estimates: LetterEstimates,
  balance: Balance,
  tier: BotTier,
  noise: number,
  rng: Rng,
): LetterPlay[] {
  const out: LetterPlay[] = [];

  for (const card of view.hand) {
    if (!isLetterCard(card)) continue;
    const est = estimates.get(card.letter);
    if (!est) continue; // letter already guessed
    const value = letterValue(est, view, balance, tier);
    out.push({ letter: card.letter, cardId: card.id, wild: false, value, noisyValue: value + scoreNoise(rng, noise) });
  }

  // WILD can name any open letter, so it competes with the best of them.
  const wild = view.hand.find((c) => isActionCard(c) && c.action === 'WILD');
  if (wild) {
    let best: { letter: string; value: number } | null = null;
    for (const letter of ded.open) {
      const est = estimates.get(letter);
      if (!est) continue;
      const value = letterValue(est, view, balance, tier);
      if (!best || value > best.value) best = { letter, value };
    }
    if (best) {
      const value = best.value - (WILD_HOLD_MARGIN[tier] ?? 0);
      out.push({ letter: best.letter, cardId: wild.id, wild: true, value, noisyValue: value + scoreNoise(rng, noise) });
    }
  }

  out.sort((a, b) => b.noisyValue - a.noisyValue);
  return out;
}

function letterAction(view: PlayerView, play: LetterPlay): EngineAction {
  return {
    type: 'playCard',
    playerId: view.playerId,
    intent: play.wild
      ? { type: 'action', cardId: play.cardId, letter: play.letter }
      : { type: 'letter', cardId: play.cardId },
  };
}

function discardAction(
  view: PlayerView,
  estimates: LetterEstimates,
  balance: Balance,
  tier: BotTier,
  usesInterrupts: boolean,
): EngineAction | null {
  if (view.hand.length === 0) return null;
  const values = new Map<string, number>();
  for (const [letter, est] of estimates) values.set(letter, letterValue(est, view, balance, tier));

  const ranked = view.hand
    .map((c) => ({ id: c.id, keep: keepValue(c, view, values, usesInterrupts) }))
    .sort((a, b) => a.keep - b.keep);

  const ids: string[] = [];
  for (const entry of ranked) {
    if (ids.length >= balance.turn.maxDiscard) break;
    if (ids.length >= balance.turn.minDiscard && entry.keep > 6) break;
    ids.push(entry.id);
  }
  if (ids.length === 0) return null;
  return { type: 'discard', playerId: view.playerId, cardIds: ids };
}

/** Probability a tier commits to the best situational card it can see. */
function actionCardProbability(tier: BotTier, bias: number, advantage: number): number {
  if (tier === 'chill') return bias;
  return Math.max(0, Math.min(1, bias + advantage / 20));
}

export function createBotPolicy(tier: BotTier, opts: BotOptions = {}): PlayerPolicy {
  const balance = opts.balance ?? defaultBalance();
  const cfg: BotTierConfig = { ...balance.bots.tiers[tier], ...(opts.config ?? {}) };
  const gate: SolveGate = { ...SOLVE_GATES[tier], ...(opts.gate ?? {}) };
  const corpus = opts.corpus ?? [];
  const index: CorpusIndex = corpusIndexFor(corpus);
  const vocabulary = opts.vocabularyMinWeight ?? VOCABULARY_MIN_WEIGHT[tier];

  /**
   * `deduce` applies the gate itself: below it the candidate pool is left empty,
   * so the bot has no phrase-level information to score letters with *or* to
   * solve from. One gate, both effects — which is the point. Gating only the
   * solve leaves a bot that plays perfect letters from a phrase it will not
   * admit to recognizing, and that is worse than the disease.
   */
  const read = (view: PlayerView): Deduction => deduce(view, index, gate, vocabulary);

  const solveReady = (ded: Deduction): Puzzle | null => soleCandidate(ded);

  return {
    chooseTurnAction(view: PlayerView, rng: Rng): EngineAction {
      const id = view.playerId;
      const ded = read(view);

      // ---- The optional solve, offered after the primary action (§3.3).
      if (view.phase === 'awaiting-solve') {
        if (!view.canSolve) return { type: 'pass', playerId: id };
        const only = solveReady(ded);
        // §5: "If exactly one candidate matches, the bot rolls against a
        // per-tier probability to solve."
        if (only && rng.bool(cfg.solveRoll)) return { type: 'solve', playerId: id, guess: only.text };
        return { type: 'pass', playerId: id };
      }

      // ---- The primary action.
      const estimates = estimateLetters(ded, index);
      const letters = rankLetterPlays(view, ded, estimates, balance, tier, cfg.scoreNoise, rng);
      const best = letters[0];
      const V = best ? best.value : 0;
      const V2 = letters[1] ? (letters[1] as LetterPlay).value : 0;

      let chosen: ActionPlan | null = null;
      if (tier === 'chill') {
        // "Rare, random" — no situational reasoning at all, just a dice roll
        // and a card off the top of whatever is legal.
        const pool = randomPlayablePlans(view, ded, balance);
        if (pool.length > 0 && rng.bool(cfg.actionCardBias)) chosen = rng.pick(pool);
      } else {
        const plans = planActionCards({
          view,
          ded,
          estimates,
          balance,
          tier,
          bestLetterValue: V,
          secondLetterValue: V2,
          bestLetter: best ? best.letter : null,
        }).filter((p) => p.advantage > 0);
        plans.sort((a, b) => b.advantage - a.advantage);
        const top = plans[0];
        if (top && rng.bool(actionCardProbability(tier, cfg.actionCardBias, top.advantage))) chosen = top;
      }

      if (chosen) return { type: 'playCard', playerId: id, intent: chosen.intent };
      if (best) return letterAction(view, best);

      const dump = discardAction(view, estimates, balance, tier, cfg.usesInterrupts);
      if (dump) return dump;
      // Empty hand and an empty deck: let the turn loop move on.
      return { type: 'timeout', playerId: id };
    },

    chooseInterrupt(view: PlayerView, window: InterruptWindowView, rng: Rng): EngineAction | null {
      // §5: only Ruthless uses interrupts.
      if (!cfg.usesInterrupts) return null;
      if (window.playableCardIds.length === 0) return null;
      const cardId = window.playableCardIds[0] as string;
      const play: EngineAction = { type: 'playInterrupt', playerId: view.playerId, cardId, windowId: window.windowId };

      // SWIPE: the window only opens on a hit, so there are always points on the
      // table. BLOCK: something is aimed at you; cancelling it is free.
      if (window.kind === 'hit' || window.kind === 'targeted') return play;

      // BUZZ IN is once per round (§3.5), so it is spent only to take a turn
      // that is actually worth taking: a solve the bot can already see, or a
      // letter big enough to be worth jumping the queue for.
      const ded = read(view);
      if (solveReady(ded)) return play;
      const estimates = estimateLetters(ded, index);
      const letters = rankLetterPlays(view, ded, estimates, balance, tier, cfg.scoreNoise, rng);
      const top = letters[0];
      const est = top ? estimates.get(top.letter) : undefined;
      if (est && est.expectedOccurrences >= BOT_TUNING.buzzInMinOccurrences && top && top.value > 0) return play;
      return null;
    },
  };
}
