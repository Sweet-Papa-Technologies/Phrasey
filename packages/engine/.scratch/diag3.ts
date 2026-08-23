import { createBotPolicy } from '../src/bots/index.js';
import { simulateMatch } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const corpus = loadCorpus();
const balance = defaultBalance();
function run(label: string, tier: BotTier, c: readonly any[], gate?: any) {
  const p = createBotPolicy(tier, { corpus: c, balance, gate });
  let hit=0, miss=0, occ=0, rounds=0, turns=0;
  for (let seed=1; seed<=40; seed++) {
    const { events } = simulateMatch({ seed, players:['p1','p2','p3','p4'], policies:{}, defaultPolicy:p, puzzles: corpus, balance, maxActions: 60000 });
    for (const e of events) { if (e.t==='letter:hit'){hit++;occ+=e.occurrences;} if(e.t==='letter:miss')miss++; if(e.t==='round:end')rounds++; if(e.t==='turn:begin')turns++; }
  }
  console.log(label.padEnd(26), 'missRate', (miss/(hit+miss)*100).toFixed(1)+'%', 'occ/hit', (occ/hit).toFixed(2), 'plays/turn', ((hit+miss)/turns).toFixed(2));
}
run('ruthless corpus', 'ruthless', corpus);
run('sharp corpus', 'sharp', corpus);
run('chill corpus', 'chill', corpus);
run('ruthless no-corpus', 'ruthless', []);
run('chill no-corpus', 'chill', []);
