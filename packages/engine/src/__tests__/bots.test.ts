/**
 * M4 — the three bots (design doc §5).
 *
 * The bar §14 sets is "single-player match completes; Ruthless wins >60% vs
 * Chill over 100 sims", and that head-to-head runs here as a real test rather
 * than as a number somebody once saw in a terminal. Around it sit the unit
 * tests for the parts that make the head-to-head mean anything: that the
 * scoring model actually beats guessing, that the tiers differ in the ways the
 * doc says they differ, and that a bot given the same seed does the same thing
 * twice.
 */
import type { ActionCardKind, Balance, Letter, Puzzle } from '@phrasey/shared';
import { defaultBalance, isActionCard, isLetterCard, letterStats } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { positionsOf, revealLetter } from '../board.js';
import {
  BOT_TUNING,
  botThinkDelayMs,
  cardKeepValue,
  botThinkRange,
  buildCorpusIndex,
  corpusIndexFor,
  createBotPolicy,
  createBotSeats,
  deduce,
  estimateLetters,
  isGaugeSafe,
  leader,
  letterValue,
  matchingWords,
  missCost,
  nextSeat,
  planActionCards,
  randomPlayablePlans,
  rankLetterPlays,
  readBoard,
  scoreNoise,
  soleCandidate,
  tipsGauge,
  turnActionCards,
  SOLVE_GATES,
  VOCABULARY_MIN_WEIGHT,
  type Deduction,
} from '../bots/index.js';
import { createRng, type Rng } from '../rng.js';
import { simulateMatch, sweep } from '../sim/simulate.js';
import type { GameState } from '../state.js';
import { TEST_PUZZLES, makePuzzle, puzzleById } from '../testing/fixtures.js';
import { currentId, plantHand, startGame } from '../testing/harness.js';
import { playerView, type InterruptWindowView, type PlayerView } from '../view.js';

const BALANCE: Balance = defaultBalance();
const CORPUS: Puzzle[] = TEST_PUZZLES;
const TIERS = ['chill', 'sharp', 'ruthless'] as const;

// ---------------------------------------------------------------------------
// Scenario builder: a real match, with the board and hand forced to a shape the
// test cares about. Nothing here reaches past `playerView` on the bot's behalf.
// ---------------------------------------------------------------------------

interface ScenarioOptions {
  puzzle?: Puzzle;
  seed?: number;
  players?: number;
  reveal?: string[];
  missed?: string[];
  pressure?: number;
  hand?: (Letter | ActionCardKind)[];
  peek?: number;
  doubleDown?: boolean;
  awaitingSolve?: boolean;
}

interface Scenario {
  state: GameState;
  id: string;
  view: PlayerView;
}

function scenario(opts: ScenarioOptions = {}): Scenario {
  const puzzle = opts.puzzle ?? puzzleById('p7');
  const state = startGame({ seed: opts.seed ?? 4242, players: opts.players ?? 3, puzzle });
  const round = state.round;
  if (!round) throw new Error('no round');
  for (const letter of opts.reveal ?? []) revealLetter(round, letter);
  for (const letter of opts.missed ?? []) if (!round.missed.includes(letter)) round.missed.push(letter);
  if (opts.pressure !== undefined) round.pressure = opts.pressure;
  const id = currentId(state);
  const self = state.players.find((p) => p.id === id);
  if (opts.hand && self) {
    plantHand(state, id, opts.hand);
    // The hand is exactly what the test asked for: leftovers from the deal go
    // to the discard so card conservation still holds.
    round.discard.push(...self.hand.splice(opts.hand.length));
  }
  if (self && opts.peek !== undefined) {
    const answer = round.answer.replace(/ /g, '');
    self.peeks[opts.peek] = answer[opts.peek] as Letter;
  }
  if (self && opts.doubleDown) self.doubleDownArmed = true;
  if (opts.awaitingSolve) {
    round.phase = 'awaiting-solve';
    round.turnActed = true;
  }
  return { state, id, view: playerView(state, id) };
}

/** Reveal letters in frequency order until this tier's evidence gate opens. */
function revealUntilSolvable(puzzle: Puzzle, tier: (typeof TIERS)[number]): string[] {
  const order = Object.entries(letterStats(puzzle.text))
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
  const index = corpusIndexFor(CORPUS);
  const shown: string[] = [];
  for (const letter of order) {
    shown.push(letter);
    const { view } = scenario({ puzzle, reveal: shown });
    const ded = deduce(view, index, SOLVE_GATES[tier], VOCABULARY_MIN_WEIGHT[tier]);
    if (!ded.gated && ded.pool.length === 1) return shown;
  }
  throw new Error(`never became solvable for ${tier}`);
}

function occurrences(puzzle: Puzzle, letter: string): number {
  return positionsOf(puzzle.text, letter).length;
}

function window(kind: InterruptWindowView['kind'], cards = ['c1']): InterruptWindowView {
  return {
    windowId: 'w1',
    kind,
    sourcePlayerId: 'p2',
    targetPlayerId: kind === 'targeted' ? 'p1' : null,
    expiresAt: 4000,
    chain: 0,
    playableCardIds: cards,
    passed: false,
  };
}

// ---------------------------------------------------------------------------

describe('corpus index', () => {
  it('buckets words by cell length and counts how often each recurs', () => {
    const index = buildCorpusIndex([makePuzzle('THE CAT SAT ON THE MAT'), makePuzzle('THE DOG SAT ON A LOG')]);
    const three = index.wordsByLength.get(3) ?? [];
    const the = three.find((w) => w.chars.join('') === 'THE');
    expect(the?.weight).toBe(3); // twice in the first phrase, once in the second
    expect(index.puzzles).toHaveLength(2);
  });

  it('counts punctuation as a cell so board words and corpus words line up', () => {
    const index = buildCorpusIndex([makePuzzle("DONT STOP, ITS FINE")]);
    expect(index.wordsByLength.get(5)?.some((w) => w.chars.join('') === 'STOP,')).toBe(true);
  });

  it('memoizes on the corpus array identity', () => {
    const corpus = [makePuzzle('A WATCHED POT NEVER BOILS')];
    expect(corpusIndexFor(corpus)).toBe(corpusIndexFor(corpus));
    expect(corpusIndexFor([...corpus])).not.toBe(corpusIndexFor(corpus));
  });
});

describe('reading the board', () => {
  it('indexes cells the way the engine indexes tiles', () => {
    const { view } = scenario({ puzzle: makePuzzle("DONT STOP, ITS FINE"), reveal: ['O'] });
    const board = view.board;
    if (!board) throw new Error('no board');
    const words = readBoard(board);
    const flat = words.flatMap((w) => w.cells);
    expect(flat.map((c) => c.index)).toEqual(flat.map((_, i) => i));
    const comma = flat.find((c) => c.kind === 'punct');
    expect(comma?.ch).toBe(',');
    // Revealed Os are face-up; everything else is still hidden.
    expect(flat.filter((c) => c.kind === 'revealed').every((c) => c.ch === 'O')).toBe(true);
  });

  it('gates phrase-level deduction until the board carries real evidence', () => {
    const puzzle = puzzleById('p7');
    const index = corpusIndexFor(CORPUS);
    const fresh = deduce(scenario({ puzzle }).view, index, SOLVE_GATES.ruthless);
    expect(fresh.gated).toBe(true);
    expect(fresh.pool).toHaveLength(0);
    expect(soleCandidate(fresh)).toBeNull();

    const open = deduce(scenario({ puzzle, reveal: revealUntilSolvable(puzzle, 'ruthless') }).view, index, SOLVE_GATES.ruthless);
    expect(open.gated).toBe(false);
    expect(soleCandidate(open)?.text).toBe(puzzle.text);
  });

  it('without a gate the board skeleton alone fingerprints the phrase — the reason the gate exists', () => {
    // This is the failure mode the gate is for: zero letters played, and the
    // word-length pattern has already narrowed the corpus to one answer.
    const index = corpusIndexFor(CORPUS);
    const untouched = deduce(scenario({ puzzle: puzzleById('p37') }).view, index);
    expect(untouched.revealedFraction).toBe(0);
    expect(untouched.pool.length).toBe(1);
  });

  it('narrows the candidate pool with tiles bought by PEEK', () => {
    const puzzle = puzzleById('p11'); // YOU PARKED IN MY SPOT AGAIN
    const twin = puzzleById('p23'); // YOU PARKED IN MY SPOT TODAY
    const corpus = [puzzle, twin];
    const index = corpusIndexFor(corpus);
    const gate = { minRevealedFraction: 0, minGuessedLetters: 0 };
    const both = deduce(scenario({ puzzle }).view, index, gate);
    expect(both.pool).toHaveLength(2);

    // Same skeleton (3 6 2 2 4 5); tile 17 is the A/T that tells them apart.
    const idx = puzzle.text.replace(/ /g, '').indexOf('AGAIN');
    expect(idx).toBe(17);
    const peeked = deduce(scenario({ puzzle, peek: idx }).view, index, gate);
    expect(peeked.pool).toHaveLength(1);
    expect(peeked.pool[0]?.text).toBe(puzzle.text);
    expect(peeked.known.get('A')).toBe(1);
  });

  it('respects the vocabulary floor when matching word shapes', () => {
    const index = buildCorpusIndex([makePuzzle('THE QUIET ZEBRA'), makePuzzle('THE LOUD LLAMA')]);
    const { view } = scenario({ puzzle: makePuzzle('THE QUIET ZEBRA') });
    const base = deduce(view, index, undefined, 1);
    const word = base.words[1];
    if (!word) throw new Error('no word');
    expect(matchingWords(word, base, index).length).toBeGreaterThan(0);
    // QUIET occurs once, so a bot with a floor of 2 is not allowed to know it.
    expect(matchingWords(word, { ...base, vocabularyMinWeight: 2 } as Deduction, index)).toHaveLength(0);
  });
});

describe('letter scoring', () => {
  it('beats picking a letter at random from the same hand', () => {
    const index = corpusIndexFor(CORPUS);
    let bot = 0;
    let random = 0;
    let trials = 0;

    for (let seed = 1; seed <= 120; seed++) {
      const rng = createRng(seed);
      const puzzle = rng.pick(CORPUS);
      const distinct = [...new Set(puzzle.text.replace(/[^A-Z]/g, ''))];
      const reveal = rng.shuffle(distinct).slice(0, 2);
      // A hand of five letters: three plausible, two arbitrary.
      const hand = [
        ...rng.shuffle(distinct.filter((l) => !reveal.includes(l))).slice(0, 3),
        ...rng.shuffle('BCDFGHJKMPQVWXYZ'.split('')).slice(0, 2),
      ] as Letter[];
      const { view } = scenario({ puzzle, reveal, hand, seed });
      const ded = deduce(view, index, SOLVE_GATES.ruthless, VOCABULARY_MIN_WEIGHT.ruthless);
      const est = estimateLetters(ded, index);
      const ranked = rankLetterPlays(view, ded, est, BALANCE, 'ruthless', 0, rng);
      const pick = ranked[0];
      if (!pick) continue;
      const alternatives = view.hand.filter(isLetterCard).map((c) => c.letter);
      if (alternatives.length === 0) continue;
      trials++;
      bot += occurrences(puzzle, pick.letter);
      random += occurrences(puzzle, rng.pick(alternatives));
    }

    expect(trials).toBeGreaterThan(80);
    expect(bot).toBeGreaterThan(random * 1.4);
  });

  it('prices a peeked letter as a certainty', () => {
    const puzzle = puzzleById('p7');
    const index = corpusIndexFor(CORPUS);
    const answer = puzzle.text.replace(/ /g, '');
    const idx = answer.indexOf('W');
    const { view } = scenario({ puzzle, peek: idx });
    const est = estimateLetters(deduce(view, index, SOLVE_GATES.ruthless), index);
    const w = est.get('W');
    expect(w?.certain).toBe(true);
    expect(w?.hitProbability).toBe(1);
    expect(w?.expectedOccurrences).toBeGreaterThanOrEqual(1);
  });

  it('charges more for a miss as the gauge fills, and the full blowout price when it would tip', () => {
    const calm = scenario({ pressure: 0 }).view;
    const tense = scenario({ pressure: 9 }).view;
    const brink = scenario({ pressure: 11 }).view;
    expect(missCost(tense, BALANCE, 'sharp')).toBeGreaterThan(missCost(calm, BALANCE, 'sharp'));
    expect(missCost(brink, BALANCE, 'sharp')).toBeCloseTo(BOT_TUNING.blowoutCost, 5);
    // Ruthless respects the shared gauge most (§3.4: a blowout costs it too).
    expect(missCost(tense, BALANCE, 'ruthless')).toBeGreaterThan(missCost(tense, BALANCE, 'chill'));
  });

  it('doubles both the payoff and the risk once DOUBLE DOWN is armed', () => {
    const index = corpusIndexFor(CORPUS);
    const plain = scenario({ reveal: ['A', 'E'] }).view;
    const armed = scenario({ reveal: ['A', 'E'], doubleDown: true }).view;
    const est = estimateLetters(deduce(plain, index, SOLVE_GATES.sharp), index).get('T');
    if (!est) throw new Error('no estimate');
    expect(letterValue(est, armed, BALANCE, 'sharp')).toBeGreaterThan(letterValue(est, plain, BALANCE, 'sharp'));
    expect(missCost(armed, BALANCE, 'sharp')).toBeGreaterThan(missCost(plain, BALANCE, 'sharp'));
  });

  it('falls back to English frequency with no corpus at all', () => {
    const index = buildCorpusIndex([]);
    const { view } = scenario();
    const est = estimateLetters(deduce(view, index), index);
    const e = est.get('E');
    const z = est.get('Z');
    expect(e && z && e.expectedOccurrences > z.expectedOccurrences).toBe(true);
  });

  it('adds symmetric noise scaled by the tier', () => {
    const rng = createRng(7);
    let big = 0;
    let small = 0;
    for (let i = 0; i < 400; i++) {
      big += Math.abs(scoreNoise(rng, 0.55));
      small += Math.abs(scoreNoise(rng, 0.03));
    }
    expect(big).toBeGreaterThan(small * 5);
  });
});

describe('tier noise ordering', () => {
  it('makes Chill misrank more often than Sharp, and Sharp more often than Ruthless', () => {
    const index = corpusIndexFor(CORPUS);
    const agreement: Record<string, number> = {};

    for (const tier of TIERS) {
      const cfg = BALANCE.bots.tiers[tier];
      let agree = 0;
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const rng = createRng(seed);
        const puzzle = rng.pick(CORPUS);
        const hand = rng.shuffle('ABCDEFGHILMNOPRSTUWY'.split('')).slice(0, 6) as Letter[];
        const { view } = scenario({ puzzle, reveal: ['E'], hand, seed });
        const ded = deduce(view, index, SOLVE_GATES[tier], VOCABULARY_MIN_WEIGHT[tier]);
        const est = estimateLetters(ded, index);
        const truth = rankLetterPlays(view, ded, est, BALANCE, tier, 0, createRng(1))[0];
        if (!truth) continue;
        for (let t = 0; t < 12; t++) {
          const noisy = rankLetterPlays(view, ded, est, BALANCE, tier, cfg.scoreNoise, createRng(seed * 100 + t))[0];
          total++;
          if (noisy && noisy.letter === truth.letter) agree++;
        }
      }
      agreement[tier] = agree / total;
    }

    expect(agreement.chill as number).toBeLessThan(agreement.sharp as number);
    expect(agreement.sharp as number).toBeLessThan(agreement.ruthless as number);
    expect(agreement.ruthless as number).toBeGreaterThan(0.9);
  });
});

describe('solving', () => {
  it('fires at roughly the tier probability once deduction narrows to one candidate', () => {
    for (const tier of TIERS) {
      const puzzle = puzzleById('p9');
      const reveal = revealUntilSolvable(puzzle, tier);
      const { view } = scenario({ puzzle, reveal, awaitingSolve: true });
      const policy = createBotPolicy(tier, { corpus: CORPUS, balance: BALANCE });
      let solves = 0;
      const N = 500;
      for (let seed = 1; seed <= N; seed++) {
        const action = policy.chooseTurnAction(view, createRng(seed));
        if (action.type === 'solve') {
          solves++;
          expect(action.guess).toBe(puzzle.text);
        }
      }
      expect(solves / N).toBeGreaterThan(BALANCE.bots.tiers[tier].solveRoll - 0.06);
      expect(solves / N).toBeLessThan(BALANCE.bots.tiers[tier].solveRoll + 0.06);
    }
  });

  it('never attempts a solve before its evidence gate opens', () => {
    const puzzle = puzzleById('p37'); // one the skeleton alone identifies
    const { view } = scenario({ puzzle, awaitingSolve: true });
    for (const tier of TIERS) {
      const policy = createBotPolicy(tier, { corpus: CORPUS, balance: BALANCE });
      for (let seed = 1; seed <= 60; seed++) {
        expect(policy.chooseTurnAction(view, createRng(seed)).type).toBe('pass');
      }
    }
  });

  it('passes when the rules will not let it solve', () => {
    const { state, id } = scenario({ puzzle: puzzleById('p9'), reveal: revealUntilSolvable(puzzleById('p9'), 'ruthless'), awaitingSolve: true });
    const self = state.players.find((p) => p.id === id);
    if (!self) throw new Error('no self');
    self.solveLocked = true;
    const view = playerView(state, id);
    expect(view.canSolve).toBe(false);
    const policy = createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE });
    expect(policy.chooseTurnAction(view, createRng(1)).type).toBe('pass');
  });

  it('never solves at all without a corpus to deduce from', () => {
    const puzzle = puzzleById('p9');
    const { view } = scenario({ puzzle, reveal: revealUntilSolvable(puzzle, 'ruthless'), awaitingSolve: true });
    const blind = createBotPolicy('ruthless', { balance: BALANCE });
    for (let seed = 1; seed <= 40; seed++) {
      expect(blind.chooseTurnAction(view, createRng(seed)).type).toBe('pass');
    }
  });
});

describe('interrupts', () => {
  const view = () => scenario({ players: 3 }).view;

  it('is a Ruthless-only mechanic (§5)', () => {
    for (const tier of ['chill', 'sharp'] as const) {
      const policy = createBotPolicy(tier, { corpus: CORPUS, balance: BALANCE });
      expect(policy.chooseInterrupt(view(), window('hit'), createRng(1))).toBeNull();
      expect(policy.chooseInterrupt(view(), window('targeted'), createRng(1))).toBeNull();
      expect(policy.chooseInterrupt(view(), window('between'), createRng(1))).toBeNull();
    }
  });

  it('takes every SWIPE and BLOCK, because both are free points', () => {
    const policy = createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE });
    for (const kind of ['hit', 'targeted'] as const) {
      const action = policy.chooseInterrupt(view(), window(kind), createRng(3));
      expect(action).toEqual({ type: 'playInterrupt', playerId: 'p1', cardId: 'c1', windowId: 'w1' });
    }
  });

  it('declines a window it holds nothing for', () => {
    const policy = createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE });
    expect(policy.chooseInterrupt(view(), window('hit', []), createRng(1))).toBeNull();
  });

  it('spends its one BUZZ IN on a solve it can already see, not on a dead board', () => {
    const policy = createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE });
    const puzzle = puzzleById('p9');
    const ready = scenario({ puzzle, reveal: revealUntilSolvable(puzzle, 'ruthless') }).view;
    expect(policy.chooseInterrupt(ready, window('between'), createRng(1))).not.toBeNull();

    // Nothing worth jumping the queue for: no solve in sight and a dead hand.
    const drained = scenario({ puzzle, missed: ['Q', 'X'], hand: ['Q', 'X'] }).view;
    expect(policy.chooseInterrupt(drained, window('between'), createRng(1))).toBeNull();
  });
});

describe('action cards differ by tier', () => {
  const reliefHand: (Letter | ActionCardKind)[] = ['RELIEF_VALVE', 'E', 'T', 'A', 'O', 'N', 'S'];

  function rateOf(tier: (typeof TIERS)[number], kind: ActionCardKind, opts: ScenarioOptions): number {
    const policy = createBotPolicy(tier, { corpus: CORPUS, balance: BALANCE });
    let played = 0;
    const N = 200;
    for (let seed = 1; seed <= N; seed++) {
      const { view } = scenario({ ...opts, seed: 4000 + seed });
      const action = policy.chooseTurnAction(view, createRng(seed));
      if (action.type !== 'playCard' || action.intent.type !== 'action') continue;
      const card = view.hand.find((c) => c.id === action.intent.cardId);
      if (card && isActionCard(card) && card.action === kind) played++;
    }
    return played / N;
  }

  it('Sharp and Ruthless reach for RELIEF VALVE when the gauge is high; Chill barely notices', () => {
    const opts: ScenarioOptions = { hand: reliefHand, pressure: 10 };
    const chill = rateOf('chill', 'RELIEF_VALVE', opts);
    const sharp = rateOf('sharp', 'RELIEF_VALVE', opts);
    const ruthless = rateOf('ruthless', 'RELIEF_VALVE', opts);
    expect(ruthless).toBeGreaterThan(0.9);
    expect(sharp).toBeGreaterThan(0.9);
    expect(chill).toBeLessThan(0.3);
  });

  it('nobody plays RELIEF VALVE on an empty gauge', () => {
    expect(rateOf('sharp', 'RELIEF_VALVE', { hand: reliefHand, pressure: 0 })).toBe(0);
    expect(rateOf('ruthless', 'RELIEF_VALVE', { hand: reliefHand, pressure: 0 })).toBe(0);
  });

  it('Sharp plays CRACK when it is stuck; Ruthless will not hand the table a hint', () => {
    const stuck: ScenarioOptions = { hand: ['CRACK', 'Q', 'X', 'Z', 'J'], missed: ['Q', 'X', 'Z', 'J'] };
    expect(rateOf('sharp', 'CRACK', stuck)).toBeGreaterThan(0.3);
    expect(rateOf('ruthless', 'CRACK', stuck)).toBe(0);
  });

  it('Chill plays action cards at random rather than situationally', () => {
    // A hand where no card has a situation: the gauge is empty and the board is
    // live. Sharp and Ruthless play letters; Chill still fires sometimes.
    const opts: ScenarioOptions = { hand: ['VANDAL', 'SHUFFLE', 'E', 'T', 'A', 'O', 'N'], pressure: 3 };
    const chillAny = ['VANDAL', 'SHUFFLE'].reduce((n, k) => n + rateOf('chill', k as ActionCardKind, opts), 0);
    const sharpAny = ['VANDAL', 'SHUFFLE'].reduce((n, k) => n + rateOf('sharp', k as ActionCardKind, opts), 0);
    expect(chillAny).toBeGreaterThan(0.05);
    expect(sharpAny).toBe(0);
  });

  it('Ruthless holds BLOCK and SWIPE; the tiers that cannot use them throw them away', () => {
    const opts: ScenarioOptions = { hand: ['BLOCK', 'SWIPE', 'E', 'T'], missed: ['E', 'T'] };
    const { view } = scenario(opts);
    const held = view.hand.filter((c) => isActionCard(c) && (c.action === 'BLOCK' || c.action === 'SWIPE')).map((c) => c.id);

    const sharp = createBotPolicy('sharp', { corpus: CORPUS, balance: BALANCE }).chooseTurnAction(view, createRng(5));
    const ruthless = createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE }).chooseTurnAction(view, createRng(5));
    expect(sharp.type).toBe('discard');
    expect(ruthless.type).toBe('discard');
    if (sharp.type !== 'discard' || ruthless.type !== 'discard') return;
    expect(held.some((id) => sharp.cardIds.includes(id))).toBe(true);
    expect(held.some((id) => ruthless.cardIds.includes(id))).toBe(false);
  });

  it('never plays a card whose fixed pressure cost would tip the gauge', () => {
    const brink = scenario({ hand: ['VOWEL_RUSH', 'VANDAL', 'Q'], pressure: 10 }).view;
    expect(isGaugeSafe('VOWEL_RUSH', brink, BALANCE)).toBe(false);
    expect(isGaugeSafe('VANDAL', brink, BALANCE)).toBe(false);
    expect(isGaugeSafe('RELIEF_VALVE', brink, BALANCE)).toBe(true);
    expect(randomPlayablePlans(brink, deduce(brink, corpusIndexFor(CORPUS)), BALANCE)).toHaveLength(0);
    for (const tier of TIERS) {
      const policy = createBotPolicy(tier, { corpus: CORPUS, balance: BALANCE });
      for (let seed = 1; seed <= 80; seed++) {
        const action = policy.chooseTurnAction(brink, createRng(seed));
        if (action.type === 'playCard' && action.intent.type === 'action') {
          const card = brink.hand.find((c) => c.id === action.intent.cardId);
          expect(card && isActionCard(card) ? card.action : '').not.toMatch(/VOWEL_RUSH|VANDAL/);
        }
      }
    }
    expect(tipsGauge(2, 10, 12)).toBe(true);
    expect(tipsGauge(0, 11, 12)).toBe(false);
  });
});

describe('the action-card planner', () => {
  const index = corpusIndexFor(CORPUS);

  function plan(opts: ScenarioOptions, tier: (typeof TIERS)[number] = 'ruthless') {
    const { view } = scenario(opts);
    const ded = deduce(view, index, SOLVE_GATES[tier], VOCABULARY_MIN_WEIGHT[tier]);
    const estimates = estimateLetters(ded, index);
    const ranked = rankLetterPlays(view, ded, estimates, BALANCE, tier, 0, createRng(1));
    return {
      view,
      ranked,
      plans: planActionCards({
        view,
        ded,
        estimates,
        balance: BALANCE,
        tier,
        bestLetterValue: ranked[0]?.value ?? 0,
        secondLetterValue: ranked[1]?.value ?? 0,
        bestLetter: ranked[0]?.letter ?? null,
      }),
    };
  }

  it('offers PEEK when the bot is in the dark', () => {
    const { plans } = plan({ hand: ['PEEK', 'Q'] });
    expect(plans.find((p) => p.kind === 'PEEK')?.advantage).toBeGreaterThan(0);
  });

  it('offers DOUBLE DOWN only when the best letter is far ahead of the next one', () => {
    const { view } = scenario({ hand: ['DOUBLE_DOWN', 'E', 'T'] });
    const ded = deduce(view, index, SOLVE_GATES.ruthless, VOCABULARY_MIN_WEIGHT.ruthless);
    const estimates = estimateLetters(ded, index);
    const confident = [...estimates.entries()].sort(
      (a, b) => b[1].expectedOccurrences - a[1].expectedOccurrences,
    )[0];
    if (!confident) throw new Error('no estimate');
    const [best, est] = confident;
    expect(est.expectedOccurrences).toBeGreaterThan(BOT_TUNING.doubleDownMinOccurrences);
    expect(est.hitProbability).toBeGreaterThan(BOT_TUNING.doubleDownMinHit.ruthless);

    const runaway = planActionCards({
      view, ded, estimates, balance: BALANCE, tier: 'ruthless',
      bestLetterValue: 40, secondLetterValue: 0, bestLetter: best,
    });
    expect(runaway.some((p) => p.kind === 'DOUBLE_DOWN' && p.advantage > 0)).toBe(true);

    // Two equally good letters: spending a turn to double one of them is a loss.
    const tied = planActionCards({
      view, ded, estimates, balance: BALANCE, tier: 'ruthless',
      bestLetterValue: 40, secondLetterValue: 40, bestLetter: best,
    });
    expect(tied.some((p) => p.kind === 'DOUBLE_DOWN' && p.advantage > 0)).toBe(false);

    // Already armed, or the gauge too tight to survive a doubled miss: no offer.
    const armed = scenario({ hand: ['DOUBLE_DOWN', 'E', 'T'], doubleDown: true });
    expect(
      planActionCards({
        view: armed.view, ded, estimates, balance: BALANCE, tier: 'ruthless',
        bestLetterValue: 40, secondLetterValue: 0, bestLetter: best,
      }).some((p) => p.kind === 'DOUBLE_DOWN'),
    ).toBe(false);

    const tight = scenario({ hand: ['DOUBLE_DOWN', 'E', 'T'], pressure: 10 });
    expect(
      planActionCards({
        view: tight.view, ded, estimates, balance: BALANCE, tier: 'ruthless',
        bestLetterValue: 40, secondLetterValue: 0, bestLetter: best,
      }).some((p) => p.kind === 'DOUBLE_DOWN'),
    ).toBe(false);
  });

  it('offers LOCKOUT and SKIP only once the board is open enough for a solve to be live', () => {
    const early = plan({ hand: ['LOCKOUT', 'SKIP'] });
    expect(early.plans.some((p) => p.kind === 'LOCKOUT' || p.kind === 'SKIP')).toBe(false);

    const puzzle = puzzleById('p7');
    const distinct = [...new Set(puzzle.text.replace(/[^A-Z]/g, ''))];
    const late = plan({ puzzle, hand: ['LOCKOUT', 'SKIP'], reveal: distinct.slice(0, distinct.length - 2) });
    expect(late.plans.some((p) => p.kind === 'LOCKOUT')).toBe(true);
    expect(late.plans.some((p) => p.kind === 'SKIP')).toBe(true);
  });

  it('offers VOWEL RUSH and SHUFFLE when the hand is dead, and VANDAL only on an empty gauge', () => {
    const dead = plan({ hand: ['VOWEL_RUSH', 'SHUFFLE', 'Q'], missed: ['Q'] });
    expect(dead.plans.some((p) => p.kind === 'VOWEL_RUSH')).toBe(true);
    expect(dead.plans.some((p) => p.kind === 'SHUFFLE')).toBe(true);

    expect(plan({ hand: ['VANDAL'], pressure: 0 }).plans.some((p) => p.kind === 'VANDAL')).toBe(true);
    expect(plan({ hand: ['VANDAL'], pressure: 4 }).plans.some((p) => p.kind === 'VANDAL')).toBe(false);
  });

  it('returns nothing when the hand holds no turn action cards', () => {
    expect(plan({ hand: ['E', 'T', 'A'] }).plans).toHaveLength(0);
    expect(turnActionCards(scenario({ hand: ['SWIPE', 'BLOCK', 'BUZZ_IN'] }).view)).toHaveLength(0);
  });

  it('reads the seat order and the leader off the public player list', () => {
    const { state, id } = scenario({ players: 3 });
    const other = state.players.find((p) => p.id !== id);
    if (!other) throw new Error('no opponent');
    other.score = 999;
    const view = playerView(state, id);
    expect(leader(view)?.id).toBe(other.id);
    expect(nextSeat(view)?.id).toBeTruthy();

    const solo = scenario({ players: 2 }).view;
    expect(nextSeat({ ...solo, players: [solo.self] })).toBeNull();
    expect(leader({ ...solo, players: [solo.self] })).toBeNull();
  });

  it('plays WILD as the best open letter, but holds it when the margin is thin', () => {
    const { view } = scenario({ hand: ['WILD', 'E'], reveal: [] });
    const ded = deduce(view, index, SOLVE_GATES.ruthless, VOCABULARY_MIN_WEIGHT.ruthless);
    const est = estimateLetters(ded, index);
    const ranked = rankLetterPlays(view, ded, est, BALANCE, 'ruthless', 0, createRng(1));
    const wild = ranked.find((p) => p.wild);
    const plain = ranked.find((p) => !p.wild);
    expect(wild).toBeTruthy();
    // The hold margin means WILD does not automatically outrank a good letter.
    if (wild && plain && wild.letter === plain.letter) expect(wild.value).toBeLessThan(plain.value);
  });

  it('offers every legal card, gauge-safe only, in Chill\'s random pool', () => {
    const { view } = scenario({ hand: ['WILD', 'VOWEL_RUSH', 'LOCKOUT', 'CRACK', 'SKIP'], pressure: 0 });
    const kinds = randomPlayablePlans(view, deduce(view, index), BALANCE).map((p) => p.kind).sort();
    expect(kinds).toEqual(['CRACK', 'LOCKOUT', 'SKIP', 'VOWEL_RUSH', 'WILD']);
  });
});

describe('what a bot keeps and what it throws away', () => {
  const values = new Map<string, number>([['E', 30], ['Q', -4]]);
  const view = () => scenario({ pressure: 2 }).view;
  const letter = (l: Letter) => ({ id: `x-${l}`, kind: 'letter' as const, letter: l });
  const action = (a: ActionCardKind) => ({ id: `x-${a}`, kind: 'action' as const, action: a });

  it('prices letters by what they are worth, and dead ones at nothing', () => {
    expect(cardKeepValue(letter('E'), view(), values, true)).toBe(31);
    expect(cardKeepValue(letter('Q'), view(), values, true)).toBe(1); // negative value, still holdable
    expect(cardKeepValue(letter('Z'), view(), values, true)).toBe(0); // already played
  });

  it('prices interrupts as treasure for Ruthless and as litter for everyone else', () => {
    for (const kind of ['SWIPE', 'BLOCK', 'BUZZ_IN'] as ActionCardKind[]) {
      expect(cardKeepValue(action(kind), view(), values, true)).toBe(25);
      expect(cardKeepValue(action(kind), view(), values, false)).toBe(0.5);
    }
  });

  it('prices the rest of the deck by how much it can actually do', () => {
    expect(cardKeepValue(action('WILD'), view(), values, true)).toBe(20);
    expect(cardKeepValue(action('PEEK'), view(), values, true)).toBe(12);
    expect(cardKeepValue(action('VANDAL'), view(), values, true)).toBe(2);
    expect(cardKeepValue(action('SKIP'), view(), values, true)).toBe(8);
    // RELIEF VALVE is worth far more with the gauge nearly full.
    expect(cardKeepValue(action('RELIEF_VALVE'), view(), values, true)).toBe(10);
    expect(cardKeepValue(action('RELIEF_VALVE'), scenario({ pressure: 9 }).view, values, true)).toBe(22);
    // CRACK is worthless once somebody has already played one.
    const cracked = scenario();
    if (cracked.state.round) cracked.state.round.hintRevealed = true;
    expect(cardKeepValue(action('CRACK'), view(), values, true)).toBe(6);
    expect(cardKeepValue(action('CRACK'), playerView(cracked.state, cracked.id), values, true)).toBe(0);
  });
});

describe('degenerate boards', () => {
  it('reads a view with no round at all', () => {
    const lobby = playerView(startGame({ lobbyOnly: true, players: 2 }), 'p1');
    const ded = deduce(lobby, corpusIndexFor(CORPUS));
    expect(ded.words).toHaveLength(0);
    expect(ded.pool).toHaveLength(0);
    expect(ded.revealedFraction).toBe(0);
    expect(estimateLetters(ded, corpusIndexFor(CORPUS)).size).toBe(26);
  });

  it('copes with a board where every letter has already been played', () => {
    const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const { view } = scenario({ missed: all });
    const index = corpusIndexFor(CORPUS);
    const ded = deduce(view, index);
    expect(ded.open).toHaveLength(0);
    expect(estimateLetters(ded, index).size).toBe(0);
    expect(rankLetterPlays(view, ded, estimateLetters(ded, index), BALANCE, 'sharp', 0, createRng(1))).toHaveLength(0);
  });
});

describe('fallbacks', () => {
  it('discards when nothing in hand is worth playing', () => {
    const { view } = scenario({ hand: ['Q', 'X', 'Z', 'J'], missed: ['Q', 'X', 'Z', 'J'] });
    const action = createBotPolicy('sharp', { corpus: CORPUS, balance: BALANCE }).chooseTurnAction(view, createRng(1));
    expect(action.type).toBe('discard');
    if (action.type === 'discard') {
      expect(action.cardIds.length).toBeGreaterThanOrEqual(BALANCE.turn.minDiscard);
      expect(action.cardIds.length).toBeLessThanOrEqual(BALANCE.turn.maxDiscard);
    }
  });

  it('hands the turn on when the hand is empty and the deck is dry', () => {
    const { state, id } = scenario();
    const self = state.players.find((p) => p.id === id);
    const round = state.round;
    if (!self || !round) throw new Error('no state');
    self.hand = [];
    round.deck = [];
    const view = playerView(state, id);
    expect(createBotPolicy('chill', { corpus: CORPUS, balance: BALANCE }).chooseTurnAction(view, createRng(1)).type).toBe('timeout');
  });
});

describe('determinism', () => {
  it('same seed, same view, same action — every time', () => {
    for (const tier of TIERS) {
      const policy = createBotPolicy(tier, { corpus: CORPUS, balance: BALANCE });
      const { view } = scenario({ hand: ['E', 'T', 'A', 'PEEK', 'RELIEF_VALVE'], pressure: 6 });
      for (let seed = 1; seed <= 25; seed++) {
        const a = policy.chooseTurnAction(view, createRng(seed));
        const b = policy.chooseTurnAction(view, createRng(seed));
        expect(a).toEqual(b);
      }
    }
  });

  it('same seed, same match — identical event stream', () => {
    const policies = {
      p1: createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE }),
      p2: createBotPolicy('sharp', { corpus: CORPUS, balance: BALANCE }),
      p3: createBotPolicy('chill', { corpus: CORPUS, balance: BALANCE }),
    };
    const opts = { seed: 99, players: ['p1', 'p2', 'p3'], policies, puzzles: CORPUS, balance: BALANCE };
    const a = simulateMatch(opts);
    const b = simulateMatch(opts);
    expect(a.events).toEqual(b.events);
    expect(a.stats.finalScores).toEqual(b.stats.finalScores);
  });
});

describe('personas and pacing', () => {
  it('gives a room distinct names and personality lines', () => {
    const seatsOut = createBotSeats(3, 'chill');
    expect(new Set(seatsOut.map((s) => s.name)).size).toBe(3);
    expect(seatsOut.every((s) => s.botPersona.length > 0)).toBe(true);
    expect(seatsOut.every((s) => s.botTier === 'chill' && s.isBot)).toBe(true);
    expect(seatsOut[0]?.persona.flavorTier).toBe('chill');
  });

  it('skips names already taken and invents one if the roster runs out', () => {
    const taken = new Set(['slush', 'fizz']);
    expect(createBotSeats(2, 'chill', { taken }).map((s) => s.name)).not.toContain('Slush');
    const many = createBotSeats(12, 'sharp', { idPrefix: 'b' });
    expect(many).toHaveLength(12);
    expect(new Set(many.map((s) => s.id)).size).toBe(12);
    expect(many[11]?.name).toBe('Bot 12');
  });

  it('reads the think delay out of balance rather than baking it in (§5)', () => {
    for (const tier of TIERS) {
      const cfg = BALANCE.bots.tiers[tier];
      expect(botThinkRange(tier, BALANCE)).toEqual({ minMs: cfg.thinkMsMin, maxMs: cfg.thinkMsMax });
      const rng: Rng = createRng(11);
      for (let i = 0; i < 50; i++) {
        const ms = botThinkDelayMs(tier, BALANCE, rng);
        expect(ms).toBeGreaterThanOrEqual(cfg.thinkMsMin);
        expect(ms).toBeLessThanOrEqual(cfg.thinkMsMax);
      }
    }
    // Retuned from Firestore: the bot must follow the new numbers.
    const retuned = defaultBalance();
    retuned.bots.tiers.chill.thinkMsMin = 100;
    retuned.bots.tiers.chill.thinkMsMax = 100;
    expect(botThinkDelayMs('chill', retuned, createRng(1))).toBe(100);
    expect(botThinkRange('ruthless')).toEqual({ minMs: 1200, maxMs: 2500 });

    // A reversed range is clamped rather than producing nonsense.
    const broken = defaultBalance();
    broken.bots.tiers.sharp.thinkMsMax = 0;
    expect(botThinkRange('sharp', broken)).toEqual({ minMs: 1500, maxMs: 1500 });
  });
});

// ---------------------------------------------------------------------------
// §14 M4: "Single-player match completes; Ruthless wins >60% vs Chill over 100
// sims."
// ---------------------------------------------------------------------------

interface HeadToHead {
  wins: number;
  ties: number;
  matches: number;
  rate: number;
}

function headToHead(a: (typeof TIERS)[number], b: (typeof TIERS)[number], matches: number, puzzles: Puzzle[]): HeadToHead {
  const pa = createBotPolicy(a, { corpus: puzzles, balance: BALANCE });
  const pb = createBotPolicy(b, { corpus: puzzles, balance: BALANCE });
  let wins = 0;
  let ties = 0;
  for (let i = 0; i < matches; i++) {
    // Seats alternate so first-player advantage cannot carry the result.
    const aFirst = i % 2 === 0;
    const policies = aFirst ? { p1: pa, p2: pb } : { p1: pb, p2: pa };
    const aId = aFirst ? 'p1' : 'p2';
    const { stats } = simulateMatch({ seed: i + 1, players: ['p1', 'p2'], policies, puzzles, balance: BALANCE });
    if (stats.winnerIds.length === 1 && stats.winnerIds[0] === aId) wins++;
    else if (stats.winnerIds.includes(aId)) ties++;
  }
  return { wins, ties, matches, rate: wins / matches };
}

describe('§14 M4 exit criterion', () => {
  it('Ruthless beats Chill in more than 60% of 120 seeded matches', () => {
    const result = headToHead('ruthless', 'chill', 120, CORPUS);
    expect(result.wins + result.ties).toBeLessThanOrEqual(result.matches);
    expect(result.rate).toBeGreaterThan(0.6);
  });

  it('orders the tiers: Ruthless > Sharp > Chill', () => {
    expect(headToHead('ruthless', 'sharp', 100, CORPUS).rate).toBeGreaterThan(0.6);
    expect(headToHead('sharp', 'chill', 100, CORPUS).rate).toBeGreaterThan(0.6);
  });

  it('completes a single-player match: one human seat plus three bots', () => {
    // The human is modelled by the reference random policy — the floor of play.
    const policies = {
      human: createBotPolicy('chill', { balance: BALANCE }), // no corpus: never solves
      'bot-a': createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE }),
      'bot-b': createBotPolicy('sharp', { corpus: CORPUS, balance: BALANCE }),
      'bot-c': createBotPolicy('chill', { corpus: CORPUS, balance: BALANCE }),
    };
    for (let seed = 1; seed <= 20; seed++) {
      const { state, stats } = simulateMatch({
        seed,
        players: ['human', 'bot-a', 'bot-b', 'bot-c'],
        policies,
        puzzles: CORPUS,
        balance: BALANCE,
      });
      expect(state.status).toBe('match-end');
      expect(stats.rounds).toBe(BALANCE.match.defaultRounds);
      expect(stats.winnerIds.length).toBeGreaterThan(0);
    }
  });
});

describe('mixed-tier balance sweep', () => {
  it('produces sane round lengths, no stalls and no deadlocks', () => {
    const policies = {
      p1: createBotPolicy('ruthless', { corpus: CORPUS, balance: BALANCE }),
      p2: createBotPolicy('sharp', { corpus: CORPUS, balance: BALANCE }),
      p3: createBotPolicy('chill', { corpus: CORPUS, balance: BALANCE }),
      p4: createBotPolicy('chill', { corpus: CORPUS, balance: BALANCE }),
    };
    const { stats } = sweep({
      matches: 40,
      startSeed: 1,
      players: ['p1', 'p2', 'p3', 'p4'],
      policies,
      puzzles: CORPUS,
      balance: BALANCE,
    });

    // Round length is the number these gates exist to protect: an ungated
    // corpus bot ends a round in three or four turns, which is one turn a seat.
    expect(stats.avgRoundLength).toBeGreaterThan(6);
    expect(stats.avgRoundLength).toBeLessThan(25);
    expect(stats.solveRate).toBeGreaterThan(0.8);
    expect(stats.abandonRate).toBe(0);
    expect(stats.deckExhaustionRate).toBeLessThan(0.1);
    expect(stats.blowoutRate).toBeLessThan(0.2);
    expect(stats.avgBreathsPerRound).toBeLessThan(0.5);
  });
});
