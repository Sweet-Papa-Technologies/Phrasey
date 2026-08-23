import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance } from '@phrasey/shared';

const corpus = loadCorpus();
console.log('corpus', corpus.length);
const balance = defaultBalance();
const r = createBotPolicy('ruthless', { corpus, balance });
const c = createBotPolicy('chill', { corpus, balance });
const t0 = Date.now();
let wins = 0, ties = 0, n = 0;
for (let seed = 1; seed <= 50; seed++) {
  const ruthFirst = seed % 2 === 1;
  const players = ['p1', 'p2'];
  const policies = ruthFirst ? { p1: r, p2: c } : { p1: c, p2: r };
  const ruthId = ruthFirst ? 'p1' : 'p2';
  const { stats } = simulateMatch({ seed, players, policies, puzzles: corpus, balance });
  n++;
  if (stats.winnerIds.length === 1 && stats.winnerIds[0] === ruthId) wins++;
  else if (stats.winnerIds.includes(ruthId)) ties++;
}
console.log('ruthless wins', wins, '/', n, 'ties', ties, 'ms', Date.now() - t0);
