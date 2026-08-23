import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch, sweep } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';

const corpus = loadCorpus();
const balance = defaultBalance();
const pol = (t: BotTier) => createBotPolicy(t, { corpus, balance });

for (const tier of ['chill', 'sharp', 'ruthless'] as BotTier[]) {
  const { stats } = sweep({
    matches: 60, startSeed: 1, players: ['p1','p2','p3','p4'],
    policies: {}, defaultPolicy: pol(tier), puzzles: corpus, balance,
  });
  console.log(tier.padEnd(9), 'len', stats.avgRoundLength.toFixed(1),
    'solve', (stats.solveRate*100).toFixed(1)+'%',
    'blow', (stats.blowoutRate*100).toFixed(1)+'%',
    'deck', (stats.deckExhaustionRate*100).toFixed(1)+'%',
    'spread', stats.avgScoreSpread.toFixed(0),
    'breath', stats.avgBreathsPerRound.toFixed(2),
    'peakP', stats.avgPeakPressure.toFixed(1),
    'wrongSolve', stats.avgWrongSolvesPerRound.toFixed(2),
    'intr', stats.avgInterruptsPerMatch.toFixed(2));
}

// mixed 4p: 1 ruthless 1 sharp 2 chill
const mixed = { p1: pol('ruthless'), p2: pol('sharp'), p3: pol('chill'), p4: pol('chill') };
const agg = { p1:0,p2:0,p3:0,p4:0 } as Record<string,number>;
const scoreSum = { p1:0,p2:0,p3:0,p4:0 } as Record<string,number>;
const m = sweep({ matches: 60, startSeed: 1, players: ['p1','p2','p3','p4'], policies: mixed, puzzles: corpus, balance });
for (const s of m.perMatch) { for (const w of s.winnerIds) agg[w] = (agg[w]??0)+1; for (const [k,v] of Object.entries(s.finalScores)) scoreSum[k]+=v; }
console.log('mixed wins', agg, 'avgScore', Object.fromEntries(Object.entries(scoreSum).map(([k,v])=>[k,(v/60).toFixed(0)])));
console.log('mixed', 'len', m.stats.avgRoundLength.toFixed(1), 'solve', (m.stats.solveRate*100).toFixed(1)+'%', 'blow', (m.stats.blowoutRate*100).toFixed(1)+'%', 'deck', (m.stats.deckExhaustionRate*100).toFixed(1)+'%', 'spread', m.stats.avgScoreSpread.toFixed(0), 'intr', m.stats.avgInterruptsPerMatch.toFixed(2));

// how early do solves happen?
let turnsAtSolve: number[] = [];
for (let seed=1; seed<=40; seed++) {
  const { events } = simulateMatch({ seed, players:['p1','p2','p3','p4'], policies: {}, defaultPolicy: pol('ruthless'), puzzles: corpus, balance });
  let t = 0;
  for (const e of events) {
    if (e.t === 'turn:begin') t++;
    if (e.t === 'solve:success') { turnsAtSolve.push(t); }
    if (e.t === 'round:end') t = 0;
  }
}
turnsAtSolve.sort((a,b)=>a-b);
console.log('ruthless solve turn: min', turnsAtSolve[0], 'p10', turnsAtSolve[Math.floor(turnsAtSolve.length*0.1)], 'median', turnsAtSolve[Math.floor(turnsAtSolve.length/2)], 'max', turnsAtSolve[turnsAtSolve.length-1], 'n', turnsAtSolve.length);
