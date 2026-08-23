import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const corpus = loadCorpus();
const balance = defaultBalance();
function h2h(a: BotTier, b: BotTier, gates: Record<string, any>, n = 120) {
  const pa = createBotPolicy(a, { corpus, balance, gate: gates[a] });
  const pb = createBotPolicy(b, { corpus, balance, gate: gates[b] });
  let win=0, tie=0, len=0;
  for (let seed=1; seed<=n; seed++) {
    const aFirst = seed % 2 === 1;
    const policies = aFirst ? { p1: pa, p2: pb } : { p1: pb, p2: pa };
    const aId = aFirst ? 'p1' : 'p2';
    const { stats } = simulateMatch({ seed, players: ['p1','p2'], policies, puzzles: corpus, balance, maxActions: 60000 });
    len += stats.avgRoundLength;
    if (stats.winnerIds.length === 1 && stats.winnerIds[0] === aId) win++;
    else if (stats.winnerIds.includes(aId)) tie++;
  }
  return { win, tie, n, rate: win/n, len: len/n };
}
const options: Record<string, Record<string, any>> = {
  'A wide  (.70/.62/.55)': { chill:{minRevealedFraction:0.70,minGuessedLetters:7}, sharp:{minRevealedFraction:0.62,minGuessedLetters:6}, ruthless:{minRevealedFraction:0.55,minGuessedLetters:5} },
  'B mid   (.65/.60/.55)': { chill:{minRevealedFraction:0.65,minGuessedLetters:6}, sharp:{minRevealedFraction:0.60,minGuessedLetters:5}, ruthless:{minRevealedFraction:0.55,minGuessedLetters:5} },
  'C flat  (.60/.60/.60)': { chill:{minRevealedFraction:0.60,minGuessedLetters:5}, sharp:{minRevealedFraction:0.60,minGuessedLetters:5}, ruthless:{minRevealedFraction:0.60,minGuessedLetters:5} },
};
for (const [label, g] of Object.entries(options)) {
  const rc = h2h('ruthless','chill',g);
  const rs = h2h('ruthless','sharp',g);
  const sc = h2h('sharp','chill',g);
  console.log(label, '| R>C', (rc.rate*100).toFixed(0)+'%', `(${rc.win}/${rc.n} ties ${rc.tie}, len ${rc.len.toFixed(1)})`,
    '| R>S', (rs.rate*100).toFixed(0)+'%', '| S>C', (sc.rate*100).toFixed(0)+'%');
}
