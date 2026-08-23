/**
 * @phrasey/engine/bots — the three deterministic heuristic bots of §5.
 *
 * The server's bot driver needs exactly three things from here:
 *
 *   const seats  = createBotSeats(3, 'sharp');            // names + personas
 *   const policy = createBotPolicy('sharp', { corpus, balance });
 *   const delay  = botThinkDelayMs('sharp', balance, rng); // pacing
 *
 * Everything else is exported for tests and the balance simulator.
 */
export {
  cardKeepValue,
  createBotPolicy,
  rankLetterPlays,
  SOLVE_GATES,
  VOCABULARY_MIN_WEIGHT,
  type BotOptions,
  type LetterPlay,
  type SolveGate,
} from './policy.js';
export { botThinkDelayMs, botThinkRange, createBotSeats, type BotSeat, type BotSeatOptions, type ThinkRange } from './seats.js';
export { buildCorpusIndex, corpusIndexFor, type CorpusIndex, type IndexedPuzzle, type IndexedWord } from './corpusIndex.js';
export {
  DEFAULT_VOCABULARY_MIN_WEIGHT,
  deduce,
  matchingWords,
  readBoard,
  soleCandidate,
  type BotCell,
  type BotWord,
  type Deduction,
  type DeductionGate,
} from './deduction.js';
export {
  estimateLetters,
  letterValue,
  missCost,
  scoreNoise,
  type LetterEstimate,
  type LetterEstimates,
} from './letterScore.js';
export {
  isGaugeSafe,
  leader,
  nextSeat,
  planActionCards,
  randomPlayablePlans,
  turnActionCards,
  type ActionPlan,
  type PlanInput,
} from './actionPlan.js';
export { BOT_TUNING, tipsGauge } from './tuning.js';
