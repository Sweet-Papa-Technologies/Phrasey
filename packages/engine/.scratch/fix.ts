import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch, sweep } from '../src/sim/simulate.js';
import { TEST_PUZZLES } from '../src/testing/fixtures.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const balance = defaultBalance();
const pol = (t: BotTier) => createBotPolicy(t, { corpus: TEST_PUZZLES, balance });
function h2h(a: BotTier, b: BotTier, n = 120) {
  const pa = pol(a), pb = pol(b); let win=0, tie=0;
  for (let i=0;i<n;i++){ const seed=i+1; const aFirst=i%2===0;
    const policies = aFirst?{p1:pa,p2:pb}:{p1:pb,p2:pa}; const aId=aFirst?'p1':'p2';
    const { stats } = simulateMatch({ seed, players:['p1','p2'], policies, puzzles: TEST_PUZZLES, balance, maxActions: 60000 });
    if (stats.winnerIds.length===1&&stats.winnerIds[0]===aId) win++; else if (stats.winnerIds.includes(aId)) tie++; }
  console.log(`${a} vs ${b}`, (win/n*100).toFixed(1)+'%', win, 'ties', tie);
}
h2h('ruthless','chill'); h2h('ruthless','sharp'); h2h('sharp','chill');
const mixed = { p1: pol('ruthless'), p2: pol('sharp'), p3: pol('chill'), p4: pol('chill') };
const t0=Date.now();
const m = sweep({ matches: 40, startSeed: 1, players:['p1','p2','p3','p4'], policies: mixed, puzzles: TEST_PUZZLES, balance, maxActions: 60000 });
console.log('fixtures mixed len', m.stats.avgRoundLength.toFixed(1), 'solve', (m.stats.solveRate*100).toFixed(0)+'%', 'blow', (m.stats.blowoutRate*100).toFixed(0)+'%', 'deck', (m.stats.deckExhaustionRate*100).toFixed(0)+'%', 'peakP', m.stats.avgPeakPressure.toFixed(1), 'ms', Date.now()-t0);
