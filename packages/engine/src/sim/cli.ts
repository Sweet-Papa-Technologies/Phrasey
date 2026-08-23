/**
 * `pnpm --filter @phrasey/engine sim` — run N seeded matches and print the
 * aggregate balance numbers (§15).
 *
 * This file is the ONLY place in the package that writes to stdout, and it is
 * a developer tool, not part of the engine's runtime path.
 *
 * Usage:
 *   pnpm --filter @phrasey/engine sim -- --matches 500 --players 4 --tier sharp
 */
import { defaultBalance } from '@phrasey/shared';
import type { BotTier, MatchMode } from '@phrasey/shared';
import { randomPolicy } from '../policy.js';
import { TEST_PUZZLES } from '../testing/fixtures.js';
import { deductionPolicy } from './policies.js';
import { sweep } from './simulate.js';

interface Args {
  matches: number;
  players: number;
  seed: number;
  tier: BotTier;
  mode: MatchMode;
  rounds: number;
  target: number;
  /** 'deduction' models a competent bot; 'random' models the floor of play. */
  policy: 'deduction' | 'random';
  /** Deduction bots refuse to solve until this much of the board is open. */
  reveal: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    matches: 200, players: 4, seed: 1, tier: 'sharp', mode: 'rounds', rounds: 5, target: 300,
    policy: 'deduction', reveal: 0.35,
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
      case '--policy': out.policy = val === 'random' ? 'random' : 'deduction'; i++; break;
      case '--reveal': out.reveal = Number(val); i++; break;
      default: break;
    }
  }
  return out;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const balance = defaultBalance();
  const tier = balance.bots.tiers[args.tier];
  const policy =
    args.policy === 'random'
      ? randomPolicy
      : deductionPolicy({
          corpus: TEST_PUZZLES,
          solveRoll: tier.solveRoll,
          actionCardBias: tier.actionCardBias,
          scoreNoise: tier.scoreNoise,
          minRevealedFraction: args.reveal,
        });

  const players = Array.from({ length: args.players }, (_, i) => `p${i + 1}`);
  const started = Date.now();
  const { stats } = sweep({
    matches: args.matches,
    startSeed: args.seed,
    players,
    policies: {},
    defaultPolicy: policy,
    puzzles: TEST_PUZZLES,
    balance,
    settings: { matchMode: args.mode, rounds: args.rounds, targetScore: args.target },
  });
  const elapsed = Date.now() - started;

  const rows: [string, string][] = [
    ['matches', String(stats.matches)],
    ['players', String(args.players)],
    ['policy', args.policy === 'random' ? 'random (floor of play)' : `deduction, reveal gate ${args.reveal}`],
    ['bot tier', args.tier],
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
