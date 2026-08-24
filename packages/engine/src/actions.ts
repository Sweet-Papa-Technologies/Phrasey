/**
 * The reducer. One entry point: `applyAction`.
 *
 * Contract:
 *   - The caller's `state` is NEVER mutated. Every action runs against a
 *     `structuredClone`, so an illegal action that throws mid-way cannot leave
 *     a half-applied board behind — the draft is simply discarded.
 *   - Illegal actions throw `EngineError` with a shared `EngineErrorCode`.
 *   - Zero I/O. `nowMs` is a parameter and randomness comes from the seeded
 *     RNG stored in `state.rngState`.
 *
 * TURN SHAPE (§3.3): one primary action, then *optionally* a solve.
 *   phase 'turn'          -> playCard | discard | timeout
 *   phase 'awaiting-solve'-> solve | pass | timeout
 *   solve is also legal in phase 'turn' — see doSolve
 *   phase 'interrupt'     -> playInterrupt | passInterrupt | tick
 *
 * The `awaiting-solve` step is deliberate: §3.3 offers the solve *after* the
 * primary action, and the whole point of playing a letter is to look at what it
 * revealed before deciding whether to gamble on naming the phrase. Collapsing
 * the two would delete that decision.
 */
import type {
  ActionCard,
  BotTier,
  Card,
  GameEvent,
  InterruptActionKind,
  PlayCardIntent,
  Puzzle,
} from '@phrasey/shared';
import {
  ENGLISH_LETTER_FREQUENCY,
  EngineError,
  guessMatches,
  isActionCard,
  isInterruptKind,
  isLetterCard,
} from '@phrasey/shared';
import { breathe, shouldBreathe } from './antiStall.js';
import { bestLetterFrom, hiddenDistinctLetters, hiddenLetterCount, isGuessed } from './board.js';
import { INTERRUPT_CARD_EFFECTS, TURN_CARD_EFFECTS } from './cards/index.js';
import type { CardContext } from './cards/types.js';
import {
  closeWindow,
  everyoneResponded,
  isExpired,
  openWindow,
  requireWindow,
  resolveStack,
  WINDOW_CARD,
} from './interrupts.js';
import { assertPlayableLetter, resolveLetterPlay } from './letterPlay.js';
import { endRound } from './match.js';
import { applyPressure } from './pressure.js';
import { createRng, type Rng } from './rng.js';
import { award, solvePoints } from './scoring.js';
import {
  activePlayers,
  drawCards,
  drawUp,
  getPlayer,
  makePlayer,
  pushLog,
  startRound,
  type GameState,
  type NewPlayer,
  type PlayerState,
  type RoundState,
} from './state.js';
import { seatAfter, seatOrder } from './turnOrder.js';

export type EngineAction =
  | { type: 'startRound'; puzzle: Puzzle }
  | { type: 'playCard'; playerId: string; intent: PlayCardIntent }
  | { type: 'discard'; playerId: string; cardIds: string[] }
  | { type: 'solve'; playerId: string; guess: string }
  /** Decline the optional post-action solve and end the turn. */
  | { type: 'pass'; playerId: string }
  | { type: 'playInterrupt'; playerId: string; cardId: string; windowId: string }
  /** Decline an open interrupt window; closes it early once everyone has. */
  | { type: 'passInterrupt'; playerId: string; windowId: string }
  | { type: 'timeout'; playerId?: string }
  | { type: 'tick' }
  | { type: 'addPlayer'; player: NewPlayer }
  | { type: 'removePlayer'; playerId: string }
  | { type: 'convertSeatToBot'; playerId: string; tier?: BotTier; name?: string; persona?: string };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export function applyAction(state: GameState, action: EngineAction, nowMs: number): ApplyResult {
  const draft = structuredClone(state) as GameState;
  const events: GameEvent[] = [];
  dispatch(draft, action, nowMs, events);
  pushLog(draft, events);
  return { state: draft, events };
}

/** Convenience: run a list of actions in order, accumulating events. */
export function applyActions(state: GameState, actions: EngineAction[], nowMs: number): ApplyResult {
  let cur = state;
  const all: GameEvent[] = [];
  for (const a of actions) {
    const res = applyAction(cur, a, nowMs);
    cur = res.state;
    all.push(...res.events);
  }
  return { state: cur, events: all };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function dispatch(state: GameState, action: EngineAction, nowMs: number, events: GameEvent[]): void {
  switch (action.type) {
    case 'startRound':
      return doStartRound(state, action.puzzle, nowMs, events);
    case 'playCard':
      return doPlayCard(state, action.playerId, action.intent, nowMs, events);
    case 'discard':
      return doDiscard(state, action.playerId, action.cardIds, nowMs, events);
    case 'solve':
      return doSolve(state, action.playerId, action.guess, nowMs, events);
    case 'pass':
      return doPass(state, action.playerId, nowMs, events);
    case 'playInterrupt':
      return doPlayInterrupt(state, action.playerId, action.cardId, action.windowId, nowMs, events);
    case 'passInterrupt':
      return doPassInterrupt(state, action.playerId, action.windowId, nowMs, events);
    case 'timeout':
      return doTimeout(state, action.playerId, nowMs, events);
    case 'tick':
      return doTick(state, nowMs, events);
    case 'addPlayer':
      return doAddPlayer(state, action.player, events);
    case 'removePlayer':
      return doRemovePlayer(state, action.playerId, nowMs, events);
    case 'convertSeatToBot':
      return doConvertToBot(state, action, events);
  }
}

// ---------------------------------------------------------------------------
// RNG plumbing — the state's uint32 is loaded, used, and written back so a
// snapshot/restore resumes the exact same stream.
// ---------------------------------------------------------------------------

function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.rngState);
  const out = fn(rng);
  state.rngState = rng.state();
  return out;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function requireRound(state: GameState): RoundState {
  const round = state.round;
  if (!round || round.endedReason !== null) throw new EngineError('ROUND_NOT_ACTIVE');
  return round;
}

function requireCurrent(state: GameState, playerId: string): { round: RoundState; player: PlayerState } {
  const round = requireRound(state);
  if (round.currentPlayerId !== playerId) throw new EngineError('NOT_YOUR_TURN');
  return { round, player: getPlayer(state, playerId) };
}

function takeFromHand(player: PlayerState, cardId: string): Card {
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx < 0) throw new EngineError('CARD_NOT_IN_HAND', cardId);
  return player.hand.splice(idx, 1)[0] as Card;
}

// ---------------------------------------------------------------------------
// Round / turn lifecycle
// ---------------------------------------------------------------------------

function doStartRound(state: GameState, puzzle: Puzzle, nowMs: number, events: GameEvent[]): void {
  startRound(state, puzzle, nowMs, events);
  const round = state.round as RoundState;
  const first = seatOrder(state, round)[0];
  if (!first) throw new EngineError('ROUND_NOT_ACTIVE', 'no seats');
  beginTurn(state, round, first, nowMs, events);
}

function beginTurn(
  state: GameState,
  round: RoundState,
  player: PlayerState,
  nowMs: number,
  events: GameEvent[],
): void {
  round.currentPlayerId = player.id;
  round.turnActed = false;
  round.phase = 'turn';
  round.afterWindow = null;
  round.turnEndsAt = state.settings.turnSeconds === null ? null : nowMs + state.settings.turnSeconds * 1000;
  // A player with nothing in hand cannot act; top them up if the deck allows.
  if (player.hand.length === 0 && round.deck.length > 0) drawUp(round, player, state.balance);
  events.push({ t: 'turn:begin', playerId: player.id, endsAt: round.turnEndsAt });
}

/**
 * The primary action is done. Offer the optional solve (§3.3), unless the
 * player is barred from solving — then there is nothing to wait for.
 */
function afterPrimaryAction(state: GameState, round: RoundState, nowMs: number, events: GameEvent[]): void {
  if (round.endedReason !== null) return;
  if (round.window) return; // an interrupt is mid-flight; resume later
  const player = round.currentPlayerId ? state.players.find((p) => p.id === round.currentPlayerId) : undefined;
  if (!player || player.solveLocked || player.lockedNextTurn) {
    endTurn(state, round, nowMs, events);
    return;
  }
  round.phase = 'awaiting-solve';
}

/** Finish the turn: clear the one-turn lock, draw back up, then hand off. */
function endTurn(state: GameState, round: RoundState, nowMs: number, events: GameEvent[]): void {
  if (round.endedReason !== null) return;
  const player = round.currentPlayerId ? state.players.find((p) => p.id === round.currentPlayerId) : undefined;
  if (player) {
    // LOCKOUT covers exactly one turn (§3.5); that turn is now over.
    player.lockedNextTurn = false;
    const drawn = drawUp(round, player, state.balance);
    if (drawn > 0) events.push({ t: 'draw', playerId: player.id, count: drawn });
  }

  // BUZZ IN lives here: "any time between turns" (§3.5).
  round.afterWindow = 'advance';
  const opened = openBetweenWindow(state, round, nowMs, events);
  if (!opened) {
    round.afterWindow = null;
    advanceTurn(state, round, nowMs, events);
  }
}

function openBetweenWindow(state: GameState, round: RoundState, nowMs: number, events: GameEvent[]): boolean {
  return openWindow(state, round, 'between', round.currentPlayerId ?? '', null, 0, nowMs, events);
}

function advanceTurn(state: GameState, round: RoundState, nowMs: number, events: GameEvent[]): void {
  if (round.endedReason !== null) return;

  const seats = seatOrder(state, round);
  if (seats.length < state.balance.setup.minPlayers) {
    endRound(state, 'abandoned', {}, events);
    return;
  }

  // §3.6 — the board breathes before the next player is put on the clock, so
  // they get to act on the freshly opened letter.
  round.turnsSinceReveal += 1;
  if (shouldBreathe(round, seats.length, state.balance)) {
    withRng(state, (rng) => breathe(round, rng, events));
  }

  // Deck exhausted and nobody can act -> the round is over (§ RoundEndReason).
  if (round.deck.length === 0 && seats.every((p) => p.hand.length === 0)) {
    endRound(state, 'deck-exhausted', {}, events);
    return;
  }

  let next: PlayerState | null = null;
  if (round.nextPlayerOverride) {
    next = seats.find((p) => p.id === round.nextPlayerOverride) ?? null;
    round.nextPlayerOverride = null;
  }

  if (!next) {
    let cursor = round.currentPlayerId;
    for (let hops = 0; hops < seats.length * 2 + 1; hops++) {
      const candidate = seatAfter(state, round, cursor, round.direction);
      if (!candidate) break;
      cursor = candidate.id;
      if (candidate.skipNextTurn) {
        candidate.skipNextTurn = false;
        continue;
      }
      if (candidate.hand.length === 0 && round.deck.length === 0) continue;
      next = candidate;
      break;
    }
  }

  if (!next) {
    endRound(state, 'deck-exhausted', {}, events);
    return;
  }
  beginTurn(state, round, next, nowMs, events);
}

// ---------------------------------------------------------------------------
// Primary actions
// ---------------------------------------------------------------------------

function doPlayCard(
  state: GameState,
  playerId: string,
  intent: PlayCardIntent,
  nowMs: number,
  events: GameEvent[],
): void {
  const { round, player } = requireCurrent(state, playerId);
  if (round.phase !== 'turn') throw new EngineError('ALREADY_ACTED');

  const held = player.hand.find((c) => c.id === intent.cardId);
  if (!held) throw new EngineError('CARD_NOT_IN_HAND', intent.cardId);

  if (intent.type === 'letter') {
    if (!isLetterCard(held)) throw new EngineError('WRONG_CARD_TYPE', 'not a letter card');
    const letter = assertPlayableLetter(round, held.letter);
    takeFromHand(player, intent.cardId);
    round.turnActed = true;
    events.push({ t: 'card:played', playerId, card: held, letter });
    const res = resolveLetterPlay(state, round, player, held, letter, nowMs, events);
    if (res.blowout) {
      endRound(state, 'blowout', { blownBy: playerId }, events);
      return;
    }
    if (res.deferred) {
      round.afterWindow = 'resume-turn';
      return;
    }
    afterPrimaryAction(state, round, nowMs, events);
    return;
  }

  if (!isActionCard(held)) throw new EngineError('WRONG_CARD_TYPE', 'not an action card');
  const kind = held.action;
  if (isInterruptKind(kind)) throw new EngineError('WRONG_CARD_TYPE', `${kind} is an interrupt`);

  takeFromHand(player, intent.cardId);
  round.turnActed = true;
  events.push({ t: 'card:played', playerId, card: held, letter: intent.letter, targetPlayerId: intent.targetPlayerId });

  const outcome = withRng(state, (rng) => {
    const ctx: CardContext = {
      state,
      round,
      player,
      card: held,
      letter: intent.letter,
      targetPlayerId: intent.targetPlayerId,
      events,
      nowMs,
      rng,
      balance: state.balance,
    };
    return TURN_CARD_EFFECTS[kind](ctx);
  });

  if (!outcome.retainsCard) round.discard.push(held);

  if (outcome.blowout) {
    endRound(state, 'blowout', { blownBy: playerId }, events);
    return;
  }
  if (outcome.deferred) {
    round.afterWindow = 'resume-turn';
    return;
  }
  afterPrimaryAction(state, round, nowMs, events);
}

function doDiscard(state: GameState, playerId: string, cardIds: string[], nowMs: number, events: GameEvent[]): void {
  const { round, player } = requireCurrent(state, playerId);
  if (round.phase !== 'turn') throw new EngineError('ALREADY_ACTED');
  const { minDiscard, maxDiscard } = state.balance.turn;
  if (cardIds.length < minDiscard || cardIds.length > maxDiscard) throw new EngineError('INVALID_DISCARD');
  if (new Set(cardIds).size !== cardIds.length) throw new EngineError('INVALID_DISCARD', 'duplicate card id');
  for (const id of cardIds) {
    if (!player.hand.some((c) => c.id === id)) throw new EngineError('CARD_NOT_IN_HAND', id);
  }
  for (const id of cardIds) round.discard.push(takeFromHand(player, id));
  round.turnActed = true;
  events.push({ t: 'discard', playerId, count: cardIds.length });
  afterPrimaryAction(state, round, nowMs, events);
}

function doSolve(state: GameState, playerId: string, guess: string, nowMs: number, events: GameEvent[]): void {
  const { round, player } = requireCurrent(state, playerId);

  /*
   * Solving is legal at ANY point in your own turn — before your primary
   * action or after it.
   *
   * §3.3 lists the solve after the primary action, and this engine originally
   * enforced that literally. Playtest killed it: a player who knew the answer
   * pressed Solve, got told "not your turn" on their own turn, and had no way
   * to work out that the game wanted them to spend a card first. §15 is
   * explicit that fun wins over the letter of the doc, and being unable to say
   * the answer you can see is the opposite of this game's premise.
   *
   * The solve stays *optional and additional*, exactly as §3.3 frames it — so
   * a wrong solve before you have acted does not also eat your primary action.
   * It still costs +3 pressure and locks you out of solving for the rest of
   * the round, which is a heavy enough price that guessing early is a real
   * gamble rather than a free roll.
   */
  if (round.phase !== 'turn' && round.phase !== 'awaiting-solve') {
    throw new EngineError('ROUND_NOT_ACTIVE');
  }
  const beforePrimaryAction = round.phase === 'turn' && !round.turnActed;
  if (player.solveLocked) throw new EngineError('SOLVE_LOCKED', 'wrong solve this round');
  if (player.lockedNextTurn) throw new EngineError('SOLVE_LOCKED', 'locked out by LOCKOUT');

  const correct = guessMatches(guess, round.answer);
  events.push({ t: 'solve:attempt', playerId, correct });

  if (correct) {
    const hiddenAtSolve = hiddenLetterCount(round);
    const points = solvePoints(hiddenAtSolve, state.balance);
    award(player, points);
    const remaining = hiddenDistinctLetters(round);
    if (remaining.length > 0) {
      events.push({ t: 'reveal', letters: remaining, positions: [], reason: 'solve' });
    }
    events.push({ t: 'solve:success', playerId, points, hiddenAtSolve });
    endRound(state, 'solved', { solvedBy: playerId }, events);
    return;
  }

  player.solveLocked = true;
  events.push({ t: 'solve:fail', playerId, pressureDelta: state.balance.pressure.wrongSolve });
  const res = applyPressure(round, state.balance.pressure.wrongSolve, 'wrong-solve', playerId, state.balance, events);
  if (res.blowout) {
    endRound(state, 'blowout', { blownBy: playerId }, events);
    return;
  }
  // Guessed before playing: you keep the turn you have not spent yet.
  if (beforePrimaryAction) return;
  endTurn(state, round, nowMs, events);
}

function doPass(state: GameState, playerId: string, nowMs: number, events: GameEvent[]): void {
  const { round } = requireCurrent(state, playerId);
  if (round.phase !== 'awaiting-solve') throw new EngineError('ROUND_NOT_ACTIVE', 'nothing to pass on');
  endTurn(state, round, nowMs, events);
}

// ---------------------------------------------------------------------------
// Timeout (§3.3): "the server auto-plays the player's statistically-best
// letter, or discards if they hold none."
// ---------------------------------------------------------------------------

function doTimeout(state: GameState, playerId: string | undefined, nowMs: number, events: GameEvent[]): void {
  const round = requireRound(state);
  const id = playerId ?? round.currentPlayerId;
  if (!id) throw new EngineError('NOT_YOUR_TURN');
  if (round.currentPlayerId !== id) throw new EngineError('NOT_YOUR_TURN');
  autoAct(state, round, getPlayer(state, id), nowMs, events);
}

function autoAct(
  state: GameState,
  round: RoundState,
  player: PlayerState,
  nowMs: number,
  events: GameEvent[],
): void {
  if (round.phase === 'awaiting-solve') {
    endTurn(state, round, nowMs, events);
    return;
  }
  if (round.phase !== 'turn') return; // an interrupt window owns the clock

  const letters = player.hand.filter(isLetterCard);
  const best = bestLetterFrom(round, letters.map((c) => c.letter), ENGLISH_LETTER_FREQUENCY);
  if (best !== null) {
    const card = letters.find((c) => c.letter === best) as { id: string };
    events.push({ t: 'notice', message: `${player.name} timed out; auto-playing ${best}.` });
    doPlayCard(state, player.id, { type: 'letter', cardId: card.id }, nowMs, events);
    return;
  }

  // No playable letter — discard the least useful card instead.
  const dump = pickDiscard(round, player);
  if (dump) {
    events.push({ t: 'notice', message: `${player.name} timed out; discarding.` });
    doDiscard(state, player.id, [dump], nowMs, events);
    return;
  }

  // Empty hand and an empty deck: nothing to do but move on.
  round.turnActed = true;
  endTurn(state, round, nowMs, events);
}

/** Prefer dumping a dead letter (already guessed) over a live action card. */
function pickDiscard(round: RoundState, player: PlayerState): string | null {
  const dead = player.hand.find((c) => isLetterCard(c) && isGuessed(round, c.letter));
  if (dead) return dead.id;
  const first = player.hand[0];
  return first ? first.id : null;
}

// ---------------------------------------------------------------------------
// Tick — timers, interrupt-window expiry, and the anti-stall breath
// ---------------------------------------------------------------------------

function doTick(state: GameState, nowMs: number, events: GameEvent[]): void {
  const round = state.round;
  if (!round || round.endedReason !== null) return;

  if (round.window && isExpired(round.window, nowMs)) {
    closeAndResolve(state, round, nowMs, events);
    if (round.endedReason !== null) return;
  }

  const seats = seatOrder(state, round);
  if (round.phase !== 'interrupt' && shouldBreathe(round, seats.length, state.balance)) {
    withRng(state, (rng) => breathe(round, rng, events));
  }

  if (
    (round.phase === 'turn' || round.phase === 'awaiting-solve') &&
    round.turnEndsAt !== null &&
    nowMs >= round.turnEndsAt &&
    round.currentPlayerId
  ) {
    autoAct(state, round, getPlayer(state, round.currentPlayerId), nowMs, events);
  }
}

// ---------------------------------------------------------------------------
// Interrupts (§3.5)
// ---------------------------------------------------------------------------

function doPlayInterrupt(
  state: GameState,
  playerId: string,
  cardId: string,
  windowId: string,
  nowMs: number,
  events: GameEvent[],
): void {
  const round = requireRound(state);
  const window = requireWindow(round, windowId);
  if (isExpired(window, nowMs)) throw new EngineError('NO_INTERRUPT_WINDOW', 'window expired');
  if (!window.eligible.includes(playerId)) throw new EngineError('INTERRUPT_NOT_ALLOWED');
  if (window.passed.includes(playerId)) throw new EngineError('INTERRUPT_NOT_ALLOWED', 'already passed');
  if (window.chain >= state.balance.interrupt.maxChain) throw new EngineError('CHAIN_LIMIT');

  const player = getPlayer(state, playerId);
  const held = player.hand.find((c) => c.id === cardId);
  if (!held) throw new EngineError('CARD_NOT_IN_HAND', cardId);
  if (!isActionCard(held)) throw new EngineError('WRONG_CARD_TYPE');
  const kind = held.action;
  if (!isInterruptKind(kind)) throw new EngineError('WRONG_CARD_TYPE');
  const wanted: InterruptActionKind = WINDOW_CARD[window.kind];
  if (kind !== wanted) throw new EngineError('INTERRUPT_NOT_ALLOWED', `${window.kind} needs ${wanted}`);
  if (kind === 'BUZZ_IN' && player.buzzInsLeft <= 0) throw new EngineError('BUZZ_EXHAUSTED');

  takeFromHand(player, cardId);
  events.push({ t: 'card:played', playerId, card: held });

  const outcome = INTERRUPT_CARD_EFFECTS[kind]({
    state,
    round,
    player,
    card: held as ActionCard,
    window,
    events,
    nowMs,
    balance: state.balance,
  });

  if (outcome.chained) return; // a counter-window is open; wait for it
  resumeAfterWindow(state, round, nowMs, events);
}

function doPassInterrupt(
  state: GameState,
  playerId: string,
  windowId: string,
  nowMs: number,
  events: GameEvent[],
): void {
  const round = requireRound(state);
  const window = requireWindow(round, windowId);
  if (!window.eligible.includes(playerId)) throw new EngineError('INTERRUPT_NOT_ALLOWED');
  if (!window.passed.includes(playerId)) window.passed.push(playerId);
  if (everyoneResponded(window)) closeAndResolve(state, round, nowMs, events);
}

function closeAndResolve(state: GameState, round: RoundState, nowMs: number, events: GameEvent[]): void {
  closeWindow(round, events);
  resolveStack(state, round, state.balance, events);
  resumeAfterWindow(state, round, nowMs, events);
}

/** Continue whatever the interrupt window paused. */
function resumeAfterWindow(state: GameState, round: RoundState, nowMs: number, events: GameEvent[]): void {
  if (round.window) return; // a chained window opened
  const mode = round.afterWindow;
  round.afterWindow = null;
  if (round.endedReason !== null) return;
  if (mode === 'advance') {
    round.phase = 'turn';
    advanceTurn(state, round, nowMs, events);
    return;
  }
  round.phase = 'turn';
  afterPrimaryAction(state, round, nowMs, events);
}

// ---------------------------------------------------------------------------
// Seat management (§7)
// ---------------------------------------------------------------------------

function doAddPlayer(state: GameState, incoming: NewPlayer, events: GameEvent[]): void {
  if (state.players.some((p) => p.id === incoming.id && !p.removed)) {
    throw new EngineError('INVALID_TARGET', 'player already seated');
  }
  if (activePlayers(state).length >= state.balance.setup.maxPlayers) {
    throw new EngineError('INVALID_TARGET', 'room is full');
  }
  state.players.push(makePlayer(incoming, state.balance));
  // §7: "Late joiners land in the next round, not mid-round" — the new seat is
  // simply absent from `round.order`, so it is skipped until the next deal.
  events.push({ t: 'notice', message: `${incoming.name} joined.` });
}

function doRemovePlayer(state: GameState, playerId: string, nowMs: number, events: GameEvent[]): void {
  const player = getPlayer(state, playerId);
  player.removed = true;
  player.connection = 'disconnected';
  const round = state.round;
  events.push({ t: 'notice', message: `${player.name} left.` });
  if (!round || round.endedReason !== null) {
    if (state.hostId === playerId) reassignHost(state);
    return;
  }
  // Their cards leave with them, into the discard, so conservation holds.
  round.discard.push(...player.hand);
  player.hand = [];
  if (round.window) {
    round.window.eligible = round.window.eligible.filter((id) => id !== playerId);
    if (everyoneResponded(round.window)) closeAndResolve(state, round, nowMs, events);
  }
  if (state.hostId === playerId) reassignHost(state);
  if (round.endedReason !== null) return;
  if (seatOrder(state, round).length < state.balance.setup.minPlayers) {
    endRound(state, 'abandoned', {}, events);
    return;
  }
  if (round.currentPlayerId === playerId) {
    round.phase = 'turn';
    round.afterWindow = null;
    advanceTurn(state, round, nowMs, events);
  }
}

function reassignHost(state: GameState): void {
  const next = activePlayers(state).find((p) => !p.isBot) ?? activePlayers(state)[0];
  for (const p of state.players) p.isHost = false;
  if (next) {
    next.isHost = true;
    state.hostId = next.id;
  } else {
    state.hostId = '';
  }
}

/**
 * §7: after the 90-second reconnect window the seat converts to a bot with the
 * same name and a "(bot)" tag. The tag is a client concern; the engine records
 * `wasHuman` so the UI knows to draw it.
 */
function doConvertToBot(
  state: GameState,
  action: { playerId: string; tier?: BotTier; name?: string; persona?: string },
  events: GameEvent[],
): void {
  const player = getPlayer(state, action.playerId);
  player.isBot = true;
  player.connection = 'bot';
  player.wasHuman = true;
  player.botTier = action.tier ?? state.settings.botTier;
  if (action.name) player.name = action.name;
  if (action.persona) player.botPersona = action.persona;
  if (state.hostId === player.id) reassignHost(state);
  events.push({ t: 'notice', message: `${player.name} is now a bot.` });
}

// ---------------------------------------------------------------------------

/** Re-exported so callers can use the same draw helper the reducer does. */
export { drawCards };
