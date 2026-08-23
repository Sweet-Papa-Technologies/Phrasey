import { createBotPolicy } from '../src/bots/index.js';
import { sweep } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';

const corpus = loadCorpus();
const balance = defaultBalance();
function run(label: string, tier: BotTier, c: readonly any[], gate?: any) {
  const p = createBotPolicy(tier, { corpus: c, balance, gate });
  const { stats } = sweep({ matches: 50, startSeed: 1, players: ['p1','p2','p3','p4'], policies: {}, defaultPolicy: p, puzzles: corpus, balance });
  console.log(label.padEnd(28), 'len', stats.avgRoundLength.toFixed(1),
    'solve', (stats.solveRate*100).toFixed(0)+'%', 'blow', (stats.blowoutRate*100).toFixed(0)+'%',
    'deck', (stats.deckExhaustionRate*100).toFixed(0)+'%', 'peakP', stats.avgPeakPressure.toFixed(1),
    'breath', stats.avgBreathsPerRound.toFixed(2), 'spread', stats.avgScoreSpread.toFixed(0));
}
run('ruthless no-corpus', 'ruthless', []);
run('sharp no-corpus', 'sharp', []);
run('chill no-corpus', 'chill', []);
run('ruthless corpus g.30/3', 'ruthless', corpus);
run('ruthless corpus g.55/5', 'ruthless', corpus, { minRevealedFraction: 0.55, minGuessedLetters: 5 });
run('ruthless corpus g.70/7', 'ruthless', corpus, { minRevealedFraction: 0.70, minGuessedLetters: 7 });
