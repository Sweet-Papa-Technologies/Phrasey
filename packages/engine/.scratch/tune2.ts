import { createBotPolicy } from '../src/bots/index.js';
import { sweep } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const corpus = loadCorpus();
function run(label: string, tier: BotTier, o: any = {}, bal = defaultBalance()) {
  const p = createBotPolicy(tier, { corpus, balance: bal, ...o });
  const { stats } = sweep({ matches: 40, startSeed: 1, players: ['p1','p2','p3','p4'], policies: {}, defaultPolicy: p, puzzles: corpus, balance: bal, maxActions: 60000 });
  console.log(label.padEnd(32), 'len', stats.avgRoundLength.toFixed(1).padStart(5), 'solve', (stats.solveRate*100).toFixed(0).padStart(3)+'%',
    'blow', (stats.blowoutRate*100).toFixed(0).padStart(3)+'%', 'deck', (stats.deckExhaustionRate*100).toFixed(0).padStart(3)+'%',
    'peakP', stats.avgPeakPressure.toFixed(1), 'wrongSolve', stats.avgWrongSolvesPerRound.toFixed(2), 'spread', stats.avgScoreSpread.toFixed(0));
}
for (const g of [[0.5,5],[0.55,5],[0.6,5],[0.65,6]]) {
  for (const t of ['ruthless','sharp','chill'] as BotTier[]) run(`${t} gate ${g[0]}/${g[1]}`, t, { gate: { minRevealedFraction: g[0], minGuessedLetters: g[1] } });
  console.log('--');
}
// diagnosis: is the deck's puzzle-letter bias why nobody ever misses?
const b2 = defaultBalance(); b2.deck.puzzleLetterShare = 0.4;
run('ruthless (puzzleShare 0.40)', 'ruthless', { gate: { minRevealedFraction: 0.55, minGuessedLetters: 5 } }, b2);
run('chill (puzzleShare 0.40)', 'chill', { gate: { minRevealedFraction: 0.55, minGuessedLetters: 5 } }, b2);
