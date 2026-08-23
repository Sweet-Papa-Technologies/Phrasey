/**
 * Letter selection (§5): "score each letter by expected occurrences given
 * (a) English frequency, (b) the revealed pattern, and (c) word-length
 * constraints. Play the highest. Tier modifies how much noise is added."
 *
 * The estimate is built bottom-up, each layer conditioning the one below it:
 *
 *   1. **English frequency**, renormalized over the letters still unplayed —
 *      a hidden tile provably is not a guessed letter (a hit reveals every
 *      occurrence), so the prior conditions on that.
 *   2. **Word shape** — every board word is matched against corpus words of
 *      the same cell length with the same revealed letters in the same
 *      positions. "A three-cell word ending in E" is a real constraint and it
 *      is where most of the early-board signal lives.
 *   3. **Whole-phrase deduction** — when the board pattern still matches
 *      corpus phrases, that joint constraint replaces the word-level one.
 *   4. **PEEK** — a tile this bot paid to see is a certainty, not an estimate.
 *
 * Each layer is blended into the one below with a fixed pseudo-count
 * (`priorStrength`) rather than switching hard, so one lucky corpus match does
 * not get treated as gospel.
 *
 * The score itself is in POINTS, not in abstract units, so the risk term is
 * commensurable: expected reveal points minus the expected cost of putting a
 * unit on a gauge everybody shares (§3.4).
 */
import type { Balance, BotTier } from '@phrasey/shared';
import { ENGLISH_LETTER_FREQUENCY } from '@phrasey/shared';
import type { Rng } from '../rng.js';
import type { PlayerView } from '../view.js';
import type { CorpusIndex } from './corpusIndex.js';
import { matchingWords, type Deduction } from './deduction.js';
import { BOT_TUNING } from './tuning.js';

export interface LetterEstimate {
  letter: string;
  /** Expected number of tiles this letter would flip. */
  expectedOccurrences: number;
  /** Probability the letter appears at all — i.e. probability of not missing. */
  hitProbability: number;
  /** True when a PEEK makes this a certainty rather than an estimate. */
  certain: boolean;
}

export type LetterEstimates = Map<string, LetterEstimate>;

/** English frequency, renormalized over the letters still in play. */
function priorShare(open: readonly string[]): Map<string, number> {
  let total = 0;
  for (const l of open) total += ENGLISH_LETTER_FREQUENCY[l] ?? 0;
  const out = new Map<string, number>();
  if (total <= 0) {
    for (const l of open) out.set(l, 1 / Math.max(1, open.length));
    return out;
  }
  for (const l of open) out.set(l, (ENGLISH_LETTER_FREQUENCY[l] ?? 0) / total);
  return out;
}

interface Acc {
  occ: Map<string, number>;
  /** Probability the letter is absent from every word considered so far. */
  absent: Map<string, number>;
}

function newAcc(open: readonly string[]): Acc {
  const absent = new Map<string, number>();
  for (const l of open) absent.set(l, 1);
  return { occ: new Map(), absent };
}

function addWord(acc: Acc, open: readonly string[], occ: Map<string, number>, present: Map<string, number>): void {
  for (const l of open) {
    acc.occ.set(l, (acc.occ.get(l) ?? 0) + (occ.get(l) ?? 0));
    acc.absent.set(l, (acc.absent.get(l) ?? 1) * (1 - (present.get(l) ?? 0)));
  }
}

/**
 * Layer 1+2: per-word expected occurrences from corpus words of the same shape,
 * shrunk toward the renormalized English prior.
 */
function estimateFromWords(ded: Deduction, index: CorpusIndex, prior: Map<string, number>): Acc {
  const acc = newAcc(ded.open);
  const { priorStrength } = BOT_TUNING;

  for (const word of ded.words) {
    if (word.hiddenCount === 0) continue;
    const matches = matchingWords(word, ded, index);

    // The prior for this word: `hiddenCount` independent draws from the
    // conditioned English distribution.
    const priorOcc = new Map<string, number>();
    const priorPresent = new Map<string, number>();
    for (const l of ded.open) {
      const share = prior.get(l) ?? 0;
      priorOcc.set(l, share * word.hiddenCount);
      priorPresent.set(l, 1 - Math.pow(1 - share, word.hiddenCount));
    }

    if (matches.length === 0) {
      addWord(acc, ded.open, priorOcc, priorPresent);
      continue;
    }

    let mass = 0;
    const occ = new Map<string, number>();
    const present = new Map<string, number>();
    for (const cand of matches) {
      mass += cand.weight;
      const seen = new Set<string>();
      for (let i = 0; i < word.cells.length; i++) {
        if ((word.cells[i] as { kind: string }).kind !== 'hidden') continue;
        const ch = cand.chars[i] as string;
        occ.set(ch, (occ.get(ch) ?? 0) + cand.weight);
        seen.add(ch);
      }
      for (const ch of seen) present.set(ch, (present.get(ch) ?? 0) + cand.weight);
    }

    const denom = mass + priorStrength;
    const blendedOcc = new Map<string, number>();
    const blendedPresent = new Map<string, number>();
    for (const l of ded.open) {
      blendedOcc.set(l, ((occ.get(l) ?? 0) + (priorOcc.get(l) ?? 0) * priorStrength) / denom);
      blendedPresent.set(l, ((present.get(l) ?? 0) + (priorPresent.get(l) ?? 0) * priorStrength) / denom);
    }
    addWord(acc, ded.open, blendedOcc, blendedPresent);
  }

  return acc;
}

/** Layer 3: the joint constraint, when the phrase pool is still non-empty. */
function estimateFromPool(ded: Deduction, wordLevel: Acc): Acc {
  const { priorStrength } = BOT_TUNING;
  const acc = newAcc(ded.open);
  const n = ded.pool.length;
  const denom = n + priorStrength;

  for (const l of ded.open) {
    let occ = 0;
    let present = 0;
    for (const cand of ded.pool) {
      const c = cand.counts[l] ?? 0;
      occ += c;
      if (c > 0) present += 1;
    }
    const priorOcc = wordLevel.occ.get(l) ?? 0;
    const priorPresent = 1 - (wordLevel.absent.get(l) ?? 1);
    acc.occ.set(l, (occ + priorOcc * priorStrength) / denom);
    acc.absent.set(l, 1 - (present + priorPresent * priorStrength) / denom);
  }
  return acc;
}

/** The full estimate for every letter still in play. */
export function estimateLetters(ded: Deduction, index: CorpusIndex): LetterEstimates {
  const prior = priorShare(ded.open);
  const wordLevel = estimateFromWords(ded, index, prior);
  const acc = ded.pool.length > 0 ? estimateFromPool(ded, wordLevel) : wordLevel;

  const out: LetterEstimates = new Map();
  for (const letter of ded.open) {
    const peeked = ded.known.get(letter) ?? 0;
    const modelOcc = acc.occ.get(letter) ?? 0;
    const hit = 1 - (acc.absent.get(letter) ?? 1);
    out.set(letter, {
      letter,
      // Layer 4: a peeked tile is not a guess. It cannot be a miss and there
      // are at least that many of them.
      expectedOccurrences: peeked > 0 ? Math.max(modelOcc, peeked) : modelOcc,
      hitProbability: peeked > 0 ? 1 : Math.min(1, Math.max(0, hit)),
      certain: peeked > 0,
    });
  }
  return out;
}

/**
 * What one miss costs, in points. Cheap with the gauge empty, catastrophic when
 * the next unit tips it: §3.4 gives the tipper -20 and burns the round's solve
 * bonus for the whole table, so the bot prices both.
 */
export function missCost(view: PlayerView, balance: Balance, tier: BotTier): number {
  const armed = view.self.doubleDownArmed;
  const delta = balance.pressure.wrongLetter * (armed ? balance.pressure.doubleDownMissMultiplier : 1);
  const headroom = view.pressureMax - view.pressure;
  const aversion = BOT_TUNING.riskAversion[tier] ?? 1;
  if (delta >= headroom) return BOT_TUNING.blowoutCost * aversion;
  const after = Math.max(1, headroom - delta);
  return BOT_TUNING.pressureUnitCost * aversion * (view.pressureMax / after) * delta;
}

/** Expected points from playing this letter, net of the shared-gauge risk. */
export function letterValue(est: LetterEstimate, view: PlayerView, balance: Balance, tier: BotTier): number {
  const mult = view.self.doubleDownArmed ? balance.scoring.doubleDownMultiplier : 1;
  const gain = est.expectedOccurrences * balance.scoring.perRevealedLetter * mult;
  const risk = (1 - est.hitProbability) * missCost(view, balance, tier);
  return gain - risk;
}

/** The tier's fog. Symmetric so it degrades ranking rather than biasing it. */
export function scoreNoise(rng: Rng, amount: number): number {
  return (rng.next() - 0.5) * 2 * amount * BOT_TUNING.noisePoints;
}
