/**
 * @phrasey/engine — the pure rules engine (design doc §6.1, M1).
 *
 * Zero I/O: no fs, no network, no Date.now(), no Math.random(), no console.
 * Time arrives as `nowMs`; randomness comes from the seeded RNG carried in
 * `GameState.rngState`. Same seed + same action sequence => identical match.
 *
 * THE MASKING RULE (§6.2): the only sanctioned paths from engine state to a
 * client are `maskBoard()`, `playerView()` and `RoundResult.answer` after the
 * round has ended. Nothing else in this surface returns the solution.
 *
 * Typical server usage:
 *
 *   let state = createMatch({ seed, players });
 *   ({ state } = applyAction(state, { type: 'startRound', puzzle }, now));
 *   ({ state, events } = applyAction(state, action, now));
 *   socket.emit('board:update', { board: maskBoard(state), round: roundPublic(state), events });
 *   socket.to(pid).emit('hand:update', pick(playerView(state, pid)));
 */

// --- Reducer -----------------------------------------------------------------
export { applyAction, applyActions, type ApplyResult, type EngineAction } from './actions.js';

// --- State -------------------------------------------------------------------
export {
  activePlayers,
  createMatch,
  defaultSettings,
  drawCards,
  drawUp,
  findPlayer,
  getPlayer,
  makePlayer,
  startRound,
  toPublic,
  LOG_CAP,
  type CreateMatchOptions,
  type GameState,
  type InterruptWindow,
  type InterruptWindowKind,
  type NewPlayer,
  type PendingEffect,
  type PlayerState,
  type RoundPhase,
  type RoundState,
} from './state.js';

// --- Masking (the security boundary) -----------------------------------------
export {
  boardPattern,
  boardWords,
  bestLetterFrom,
  gaugeFraction,
  guessedLetters,
  hiddenDistinctLetters,
  hiddenLetterCount,
  hiddenTiles,
  isGuessed,
  isRevealed,
  maskBoard,
  maskBoardFromRound,
  positionsOf,
  revealAll,
  revealLetter,
  tiles,
  totalLetterCount,
  type Tile,
} from './board.js';

// --- Player-facing projections ------------------------------------------------
export { playerView, roundPublic, type InterruptWindowView, type PlayerView } from './view.js';

// --- Bot seam (M4 implements PlayerPolicy) -------------------------------------
export { passivePolicy, randomPolicy, unguessedLetters, type PlayerPolicy } from './policy.js';

// --- Bots (M4, design doc §5) --------------------------------------------------
export * from './bots/index.js';

// --- Rules modules ------------------------------------------------------------
export { buildDeck, deckSizeFor, isVowel, noiseLetterPool, puzzleLetterPool, puzzleLetterSet, actionPool } from './deck.js';
export { applyPressure, isBlown, type PressureResult } from './pressure.js';
export { award, blowoutPenalty, letterHitPoints, solvePoints, transferPoints } from './scoring.js';
export { breathe, idleCycles, shouldBreathe } from './antiStall.js';
export { endMatch, endRound, isMatchComplete, matchWinners, type EndRoundOptions } from './match.js';
export { seatAfter, seatOrder } from './turnOrder.js';
export {
  closeWindow,
  eligibleFor,
  everyoneResponded,
  findInterruptCard,
  holdsCard,
  isExpired,
  openWindow,
  requireWindow,
  resolveStack,
  topOwner,
  WINDOW_CARD,
} from './interrupts.js';
export { assertPlayableLetter, resolveLetterPlay, type LetterPlayResult } from './letterPlay.js';
export { INTERRUPT_CARD_EFFECTS, TURN_CARD_EFFECTS } from './cards/index.js';
export type { CardContext, CardEffect, CardOutcome, InterruptContext, InterruptOutcome } from './cards/index.js';

// --- RNG ----------------------------------------------------------------------
export { createRng, normalizeSeed, type Rng } from './rng.js';

// --- Diagnostics ---------------------------------------------------------------
export {
  assertInvariants,
  checkInvariants,
  checkMonotonicReveal,
  scoresFromEvents,
  type InvariantViolation,
} from './invariants.js';

// --- Test / sim fixtures --------------------------------------------------------
export { TEST_PUZZLES, makePuzzle, puzzleById } from './testing/fixtures.js';
