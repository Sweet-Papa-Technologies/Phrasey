/**
 * Headless match simulator — the balance-tuning tool §14/§15 asks for:
 * "A pure, seeded, I/O-free engine means balance can be tuned by running ten
 * thousand simulated matches instead of by playtesting sessions with humans."
 *
 * Everything here is deterministic given `seed`. The engine's RNG and the
 * policies' RNG are separate streams (forked from the same seed) so that
 * changing a policy does not reshuffle the decks.
 */
import type { Balance, GameEvent, Puzzle, RoomSettings } from '@phrasey/shared';
import { applyAction, type EngineAction } from '../actions.js';
import { createRng, type Rng } from '../rng.js';
import type { PlayerPolicy } from '../policy.js';
import { createMatch, type GameState, type NewPlayer } from '../state.js';
import { playerView } from '../view.js';

export interface SimulateMatchOptions {
  seed: number;
  /** Player ids, or full seat specs. */
  players: (string | NewPlayer)[];
  policies: Record<string, PlayerPolicy>;
  defaultPolicy?: PlayerPolicy;
  puzzles: Puzzle[];
  balance?: Balance;
  settings?: Partial<RoomSettings>;
  /** Deadlock guard. Exceeding it throws — that is the point (§14 M1). */
  maxActions?: number;
  /** Virtual milliseconds advanced per action. */
  msPerAction?: number;
  /** Called after every applied action; the soak test hangs invariants here. */
  onStep?: (before: GameState, after: GameState, action: EngineAction, events: GameEvent[]) => void;
}

export interface MatchStats {
  seed: number;
  rounds: number;
  /** Turns taken, per round. */
  roundLengths: number[];
  avgRoundLength: number;
  solvedRounds: number;
  blowoutRounds: number;
  deckExhaustedRounds: number;
  abandonedRounds: number;
  /** "The board breathes" firings (§3.6) — the stall counter. */
  breaths: number;
  peakPressure: number;
  totalActions: number;
  finalScores: Record<string, number>;
  scoreSpread: number;
  winnerIds: string[];
  interruptsPlayed: number;
  wrongSolves: number;
}

export interface SimulateMatchResult {
  state: GameState;
  events: GameEvent[];
  stats: MatchStats;
}

function toNewPlayer(p: string | NewPlayer, i: number): NewPlayer {
  return typeof p === 'string' ? { id: p, name: p, isHost: i === 0 } : { isHost: i === 0, ...p };
}

export function simulateMatch(opts: SimulateMatchOptions): SimulateMatchResult {
  const seats = opts.players.map(toNewPlayer);
  const maxActions = opts.maxActions ?? 20000;
  const msPerAction = opts.msPerAction ?? 500;

  let state = createMatch({
    seed: opts.seed,
    players: seats,
    settings: opts.settings,
    balance: opts.balance,
  });

  // A separate stream so policy randomness never perturbs deck construction.
  const policyRng: Rng = createRng(opts.seed).fork().fork();
  const puzzleRng: Rng = createRng(opts.seed ^ 0x5bf03635);

  const allEvents: GameEvent[] = [];
  const stats: MatchStats = {
    seed: opts.seed,
    rounds: 0,
    roundLengths: [],
    avgRoundLength: 0,
    solvedRounds: 0,
    blowoutRounds: 0,
    deckExhaustedRounds: 0,
    abandonedRounds: 0,
    breaths: 0,
    peakPressure: 0,
    totalActions: 0,
    finalScores: {},
    scoreSpread: 0,
    winnerIds: [],
    interruptsPlayed: 0,
    wrongSolves: 0,
  };

  let now = 0;
  let turnsThisRound = 0;
  let actions = 0;

  const step = (action: EngineAction): void => {
    const before = state;
    const res = applyAction(before, action, now);
    state = res.state;
    allEvents.push(...res.events);
    actions++;
    stats.totalActions++;
    for (const e of res.events) {
      if (e.t === 'turn:begin') turnsThisRound++;
      if (e.t === 'breath') stats.breaths++;
      if (e.t === 'pressure') stats.peakPressure = Math.max(stats.peakPressure, e.value);
      if (e.t === 'solve:fail') stats.wrongSolves++;
      if (e.t === 'swipe' || e.t === 'block' || e.t === 'buzz') stats.interruptsPlayed++;
      if (e.t === 'round:end') {
        stats.rounds++;
        stats.roundLengths.push(turnsThisRound);
        turnsThisRound = 0;
        if (e.result.reason === 'solved') stats.solvedRounds++;
        if (e.result.reason === 'blowout') stats.blowoutRounds++;
        if (e.result.reason === 'deck-exhausted') stats.deckExhaustedRounds++;
        if (e.result.reason === 'abandoned') stats.abandonedRounds++;
      }
    }
    opts.onStep?.(before, state, action, res.events);
    now += msPerAction;
  };

  const policyFor = (id: string): PlayerPolicy => {
    const p = opts.policies[id] ?? opts.defaultPolicy;
    if (!p) throw new Error(`no policy for player ${id}`);
    return p;
  };

  while (state.status !== 'match-end') {
    if (actions >= maxActions) {
      throw new Error(`simulateMatch: deadlock guard tripped at ${actions} actions (seed ${opts.seed})`);
    }

    const round = state.round;
    if (!round || round.endedReason !== null) {
      const puzzle = opts.puzzles[puzzleRng.int(opts.puzzles.length)];
      if (!puzzle) throw new Error('simulateMatch: empty puzzle list');
      step({ type: 'startRound', puzzle });
      continue;
    }

    // An open interrupt window owns the table until it resolves.
    const window = round.window;
    if (window) {
      const pending = window.eligible.find((id) => !window.passed.includes(id));
      if (!pending) {
        now = Math.max(now, window.expiresAt);
        step({ type: 'tick' });
        continue;
      }
      const view = playerView(state, pending);
      const wv = view.window;
      if (!wv) {
        step({ type: 'passInterrupt', playerId: pending, windowId: window.id });
        continue;
      }
      const choice = policyFor(pending).chooseInterrupt(view, wv, policyRng);
      step(choice ?? { type: 'passInterrupt', playerId: pending, windowId: window.id });
      continue;
    }

    const currentId = round.currentPlayerId;
    if (!currentId) {
      now += 1;
      step({ type: 'tick' });
      continue;
    }

    const view = playerView(state, currentId);
    step(policyFor(currentId).chooseTurnAction(view, policyRng));
  }

  const seated = state.players.filter((p) => !p.removed);
  for (const p of seated) stats.finalScores[p.id] = p.score;
  const totals = seated.map((p) => p.score);
  stats.scoreSpread = totals.length > 0 ? Math.max(...totals) - Math.min(...totals) : 0;
  stats.avgRoundLength = stats.roundLengths.length
    ? stats.roundLengths.reduce((a, b) => a + b, 0) / stats.roundLengths.length
    : 0;
  stats.winnerIds = state.matchResult?.winnerIds ?? [];

  return { state, events: allEvents, stats };
}

export interface SweepOptions extends Omit<SimulateMatchOptions, 'seed'> {
  matches: number;
  startSeed?: number;
}

export interface SweepStats {
  matches: number;
  avgRoundLength: number;
  avgRoundsPerMatch: number;
  solveRate: number;
  blowoutRate: number;
  deckExhaustionRate: number;
  abandonRate: number;
  avgScoreSpread: number;
  avgBreathsPerRound: number;
  avgPeakPressure: number;
  avgWrongSolvesPerRound: number;
  avgInterruptsPerMatch: number;
  avgActionsPerMatch: number;
}

/** Run N seeded matches and aggregate. This is the balance-tuning loop. */
export function sweep(opts: SweepOptions): { stats: SweepStats; perMatch: MatchStats[] } {
  const start = opts.startSeed ?? 1;
  const perMatch: MatchStats[] = [];
  for (let i = 0; i < opts.matches; i++) {
    perMatch.push(simulateMatch({ ...opts, seed: start + i }).stats);
  }
  const rounds = perMatch.reduce((n, m) => n + m.rounds, 0) || 1;
  const sum = (f: (m: MatchStats) => number): number => perMatch.reduce((n, m) => n + f(m), 0);
  return {
    stats: {
      matches: perMatch.length,
      avgRoundLength: sum((m) => m.roundLengths.reduce((a, b) => a + b, 0)) / rounds,
      avgRoundsPerMatch: rounds / perMatch.length,
      solveRate: sum((m) => m.solvedRounds) / rounds,
      blowoutRate: sum((m) => m.blowoutRounds) / rounds,
      deckExhaustionRate: sum((m) => m.deckExhaustedRounds) / rounds,
      abandonRate: sum((m) => m.abandonedRounds) / rounds,
      avgScoreSpread: sum((m) => m.scoreSpread) / perMatch.length,
      avgBreathsPerRound: sum((m) => m.breaths) / rounds,
      avgPeakPressure: sum((m) => m.peakPressure) / perMatch.length,
      avgWrongSolvesPerRound: sum((m) => m.wrongSolves) / rounds,
      avgInterruptsPerMatch: sum((m) => m.interruptsPlayed) / perMatch.length,
      avgActionsPerMatch: sum((m) => m.totalActions) / perMatch.length,
    },
    perMatch,
  };
}
