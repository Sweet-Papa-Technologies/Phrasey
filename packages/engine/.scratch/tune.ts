import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch, sweep } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const corpus = loadCorpus();
const balance = defaultBalance();
function run(label: string, tier: BotTier, o: any = {}) {
  const p = createBotPolicy(tier, { corpus, balance, ...o });
  let hit=0,miss=0;
  for (let seed=1; seed<=30; seed++) {
    const { events } = simulateMatch({ seed, players:['p1','p2','p3','p4'], policies:{}, defaultPolicy:p, puzzles: corpus, balance, maxActions: 60000 });
    for (const e of events) { if (e.t==='letter:hit')hit++; if(e.t==='letter:miss')miss++; }
  }
  const { stats } = sweep({ matches: 40, startSeed: 1, players: ['p1','p2','p3','p4'], policies: {}, defaultPolicy: p, puzzles: corpus, balance, maxActions: 60000 });
  console.log(label.padEnd(34), 'miss', (miss/(hit+miss)*100).toFixed(1).padStart(5)+'%',
    'len', stats.avgRoundLength.toFixed(1).padStart(5), 'solve', (stats.solveRate*100).toFixed(0).padStart(3)+'%',
    'blow', (stats.blowoutRate*100).toFixed(0).padStart(3)+'%', 'deck', (stats.deckExhaustionRate*100).toFixed(0).padStart(3)+'%',
    'peakP', stats.avgPeakPressure.toFixed(1), 'breath', stats.avgBreathsPerRound.toFixed(2), 'spread', stats.avgScoreSpread.toFixed(0));
}
for (const v of [1,2,3,4,6]) run(`ruthless vocab${v}`, 'ruthless', { vocabularyMinWeight: v });
console.log('--');
for (const v of [2,3,4,6]) run(`chill vocab${v}`, 'chill', { vocabularyMinWeight: v });
console.log('--');
for (const g of [[0.3,3],[0.45,4],[0.55,5],[0.7,6]]) run(`ruthless gate ${g[0]}/${g[1]}`, 'ruthless', { gate: { minRevealedFraction: g[0], minGuessedLetters: g[1] } });
