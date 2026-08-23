import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch, sweep } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const corpus = loadCorpus();
const balance = defaultBalance();
const G: Record<string, any> = { chill:{minRevealedFraction:0.62,minGuessedLetters:6}, sharp:{minRevealedFraction:0.60,minGuessedLetters:5}, ruthless:{minRevealedFraction:0.58,minGuessedLetters:5} };
const pol = (t: BotTier) => createBotPolicy(t, { corpus, balance, gate: G[t] });
function h2h(a: BotTier, b: BotTier, n = 120) {
  const pa = pol(a), pb = pol(b);
  let win=0, tie=0, len=0;
  for (let seed=1; seed<=n; seed++) {
    const aFirst = seed % 2 === 1;
    const policies = aFirst ? { p1: pa, p2: pb } : { p1: pb, p2: pa };
    const aId = aFirst ? 'p1' : 'p2';
    const { stats } = simulateMatch({ seed, players:['p1','p2'], policies, puzzles: corpus, balance, maxActions: 60000 });
    len += stats.avgRoundLength;
    if (stats.winnerIds.length===1 && stats.winnerIds[0]===aId) win++; else if (stats.winnerIds.includes(aId)) tie++;
  }
  console.log(`${a} vs ${b}`.padEnd(22), (win/n*100).toFixed(1)+'%', `(${win}/${n}, ties ${tie}, avg round ${ (len/n).toFixed(1)} turns)`);
}
h2h('ruthless','chill'); h2h('ruthless','sharp'); h2h('sharp','chill');
console.log();
for (const t of ['chill','sharp','ruthless'] as BotTier[]) {
  const { stats } = sweep({ matches: 60, startSeed: 1, players:['p1','p2','p3','p4'], policies:{}, defaultPolicy: pol(t), puzzles: corpus, balance, maxActions: 60000 });
  console.log(('4p all-'+t).padEnd(16), 'len', stats.avgRoundLength.toFixed(1), 'solve', (stats.solveRate*100).toFixed(0)+'%', 'blow', (stats.blowoutRate*100).toFixed(0)+'%', 'deck', (stats.deckExhaustionRate*100).toFixed(0)+'%', 'peakP', stats.avgPeakPressure.toFixed(1), 'spread', stats.avgScoreSpread.toFixed(0), 'intr/match', stats.avgInterruptsPerMatch.toFixed(2));
}
const mixed = { p1: pol('ruthless'), p2: pol('sharp'), p3: pol('chill'), p4: pol('chill') };
const m = sweep({ matches: 100, startSeed: 1, players:['p1','p2','p3','p4'], policies: mixed, puzzles: corpus, balance, maxActions: 60000 });
const wins: Record<string,number> = {}; const sc: Record<string,number> = {};
for (const s of m.perMatch) { for (const w of s.winnerIds) wins[w]=(wins[w]??0)+1; for (const [k,v] of Object.entries(s.finalScores)) sc[k]=(sc[k]??0)+v; }
console.log('\nmixed R/S/C/C  len', m.stats.avgRoundLength.toFixed(1), 'solve', (m.stats.solveRate*100).toFixed(0)+'%', 'blow', (m.stats.blowoutRate*100).toFixed(0)+'%', 'deck', (m.stats.deckExhaustionRate*100).toFixed(0)+'%', 'spread', m.stats.avgScoreSpread.toFixed(0), 'peakP', m.stats.avgPeakPressure.toFixed(1), 'breath/rnd', m.stats.avgBreathsPerRound.toFixed(2), 'wrongSolve/rnd', m.stats.avgWrongSolvesPerRound.toFixed(2), 'intr/match', m.stats.avgInterruptsPerMatch.toFixed(2));
console.log('mixed wins', wins, 'avg score', Object.fromEntries(Object.entries(sc).map(([k,v])=>[k,(v/100).toFixed(0)])));
