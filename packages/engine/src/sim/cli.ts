/**
 * `pnpm --filter @phrasey/engine sim` — run N seeded matches and print the
 * aggregate balance numbers (§15).
 *
 * This file is the ONLY place in the package that writes to stdout, and it is
 * a developer tool, not part of the engine's runtime path.
 *
 * Usage:
 *   pnpm --filter @phrasey/engine sim -- --matches 500 --players 4 --tier sharp
 *   pnpm --filter @phrasey/engine sim -- --policy bot --corpus real
 *   pnpm --filter @phrasey/engine sim -- --mix ruthless,sharp,chill,chill
 *   pnpm --filter @phrasey/engine sim -- --vs ruthless:chill --matches 120
 */
import { defaultBalance } from '@phrasey/shared';
import type { BotTier, MatchMode, Puzzle } from '@phrasey/shared';
import { createBotPolicy } from '../bots/index.js';
import type { PlayerPolicy } from '../policy.js';
import { randomPolicy } from '../policy.js';
import { TEST_PUZZLES } from '../testing/fixtures.js';
import { loadCorpus } from './corpus.js';
import { deductionPolicy } from './policies.js';
import { simulateMatch, sweep } from './simulate.js';

interface Args {
  matches: number;
  players: number;
  seed: number;
  tier: BotTier;
  mode: MatchMode;
  rounds: number;
  target: number;
  /**
   * 'bot' is the shipping M4 bot (§5). 'deduction' is the engine's reference
   * policy and 'random' is the floor of play; both are kept so a change to the
   * bots can be read against the old numbers.
   */
  policy: 'bot' | 'deduction' | 'random';
  /** Solve gate: refuse to solve until this much of the board is open. */
  reveal: number;
  /** 'fixtures' (self-contained) or 'real' (packages/corpus-gen/corpus). */
  corpus: 'fixtures' | 'real';
  /** Per-seat tiers, e.g. --mix ruthless,sharp,chill,chill. Overrides --players. */
  mix: BotTier[] | null;
  /** Head-to-head mode, e.g. --vs ruthless:chill. */
  vs: [BotTier, BotTier] | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    matches: 200, players: 4, seed: 1, tier: 'sharp', mode: 'rounds', rounds: 5, target: 300,
    policy: 'bot', reveal: Number.NaN, corpus: 'fixtures', mix: null, vs: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key || !key.startsWith('--') || val === undefined) continue;
    switch (key) {
      case '--matches': out.matches = Number(val); i++; break;
      case '--players': out.players = Number(val); i++; break;
      case '--seed': out.seed = Number(val); i++; break;
      case '--tier': out.tier = val as BotTier; i++; break;
      case '--mode': out.mode = val as MatchMode; i++; break;
      case '--rounds': out.rounds = Number(val); i++; break;
      case '--target': out.target = Number(val); i++; break;
      case '--policy':
        out.policy = val === 'random' ? 'random' : val === 'deduction' ? 'deduction' : 'bot';
        i++;
        break;
      case '--reveal': out.reveal = Number(val); i++; break;
      case '--corpus': out.corpus = val === 'real' ? 'real' : 'fixtures'; i++; break;
      case '--mix': out.mix = val.split(',').map((t) => t.trim() as BotTier); i++; break;
      case '--vs': {
        const [a, b] = val.split(':');
        if (a && b) out.vs = [a as BotTier, b as BotTier];
        i++;
        break;
      }
      default: break;
    }
  }
  return out;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** The head-to-head §14 M4 asks for, as a CLI mode. Seats alternate by seed. */
function headToHead(args: Args, puzzles: Puzzle[], balance: ReturnType<typeof defaultBalance>): void {
  const [a, b] = args.vs as [BotTier, BotTier];
  const pa = createBotPolicy(a, { corpus: puzzles, balance });
  const pb = createBotPolicy(b, { corpus: puzzles, balance });
  let wins = 0;
  let ties = 0;
  for (let i = 0; i < args.matches; i++) {
    const seed = args.seed + i;
    const aFirst = i % 2 === 0;
    const policies = aFirst ? { p1: pa, p2: pb } : { p1: pb, p2: pa };
    const aId = aFirst ? 'p1' : 'p2';
    const { stats } = simulateMatch({
      seed,
      players: ['p1', 'p2'],
      policies,
      puzzles,
      balance,
      settings: { matchMode: args.mode, rounds: args.rounds, targetScore: args.target },
    });
    if (stats.winnerIds.length === 1 && stats.winnerIds[0] === aId) wins++;
    else if (stats.winnerIds.includes(aId)) ties++;
  }
  process.stdout.write(
    `\nPhrasey head-to-head\n--------------------\n` +
      `${a} vs ${b}: ${a} won ${wins}/${args.matches} (${pct(wins / args.matches)}), ties ${ties}\n\n`,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const balance = defaultBalance();
  const tier = balance.bots.tiers[args.tier];
  const puzzles = args.corpus === 'real' ? loadCorpus() : TEST_PUZZLES;
  if (puzzles.length === 0) throw new Error('no puzzles: --corpus real found nothing on disk');

  if (args.vs) {
    headToHead(args, puzzles, balance);
    return;
  }

  const gate = Number.isFinite(args.reveal) ? { minRevealedFraction: args.reveal } : undefined;
  const botFor = (t: BotTier): PlayerPolicy => createBotPolicy(t, { corpus: puzzles, balance, gate });
  const policy =
    args.policy === 'random'
      ? randomPolicy
      : args.policy === 'bot'
        ? botFor(args.tier)
        : deductionPolicy({
            corpus: puzzles,
            solveRoll: tier.solveRoll,
            actionCardBias: tier.actionCardBias,
            scoreNoise: tier.scoreNoise,
            minRevealedFraction: Number.isFinite(args.reveal) ? args.reveal : 0.35,
          });

  const seatCount = args.mix ? args.mix.length : args.players;
  const players = Array.from({ length: seatCount }, (_, i) => `p${i + 1}`);
  const policies: Record<string, PlayerPolicy> = {};
  if (args.mix) args.mix.forEach((t, i) => (policies[`p${i + 1}`] = botFor(t)));

  const started = Date.now();
  const { stats, perMatch } = sweep({
    matches: args.matches,
    startSeed: args.seed,
    players,
    policies,
    defaultPolicy: policy,
    puzzles,
    balance,
    settings: { matchMode: args.mode, rounds: args.rounds, targetScore: args.target },
  });
  const elapsed = Date.now() - started;

  const wins: Record<string, number> = {};
  for (const m of perMatch) for (const w of m.winnerIds) wins[w] = (wins[w] ?? 0) + 1;

  const describePolicy =
    args.policy === 'random'
      ? 'random (floor of play)'
      : args.policy === 'bot'
        ? args.mix
          ? `bots, mixed: ${args.mix.join(', ')}`
          : `bot (${args.tier})`
        : 'deduction (reference policy)';

  const rows: [string, string][] = [
    ['matches', String(stats.matches)],
    ['players', String(seatCount)],
    ['corpus', `${args.corpus} (${puzzles.length} puzzles)`],
    ['policy', describePolicy],
    ['bot tier', args.mix ? 'mixed' : args.tier],
    ['match mode', args.mode === 'rounds' ? `rounds (${args.rounds})` : `score (${args.target})`],
    ['', ''],
    ['avg round length (turns)', stats.avgRoundLength.toFixed(1)],
    ['avg rounds / match', stats.avgRoundsPerMatch.toFixed(2)],
    ['solve rate', pct(stats.solveRate)],
    ['blowout rate', pct(stats.blowoutRate)],
    ['deck exhaustion rate', pct(stats.deckExhaustionRate)],
    ['abandon rate', pct(stats.abandonRate)],
    ['avg score spread', stats.avgScoreSpread.toFixed(1)],
    ['stalls ("breath") / round', stats.avgBreathsPerRound.toFixed(2)],
    ['avg peak pressure', `${stats.avgPeakPressure.toFixed(1)} / ${balance.pressure.max}`],
    ['wrong solves / round', stats.avgWrongSolvesPerRound.toFixed(2)],
    ['interrupts / match', stats.avgInterruptsPerMatch.toFixed(2)],
    ['actions / match', stats.avgActionsPerMatch.toFixed(0)],
    ['', ''],
    ...(args.mix
      ? args.mix.map((t, i): [string, string] => [
          `seat p${i + 1} (${t}) wins`,
          `${wins[`p${i + 1}`] ?? 0} (${pct((wins[`p${i + 1}`] ?? 0) / stats.matches)})`,
        ])
      : []),
    ...(args.mix ? [['', ''] as [string, string]] : []),
    ['wall clock', `${elapsed}ms`],
  ];

  const width = Math.max(...rows.map(([k]) => k.length));
  process.stdout.write('\nPhrasey balance sweep\n---------------------\n');
  for (const [k, v] of rows) {
    process.stdout.write(k === '' ? '\n' : `${k.padEnd(width)}  ${v}\n`);
  }
  process.stdout.write('\n');
}

main();
