import { buildCorpusIndex } from '../src/bots/corpusIndex.js';
import { loadCorpus } from '../src/sim/corpus.js';
const idx = buildCorpusIndex(loadCorpus());
const h: Record<number, number> = {};
let total = 0;
for (const [, ws] of idx.wordsByLength) for (const w of ws) { h[w.weight] = (h[w.weight]??0)+1; total++; }
console.log('distinct words', total);
console.log(Object.entries(h).sort((a,b)=>+a[0]-+b[0]).map(([k,v])=>`w${k}:${v}`).join(' '));
for (const t of [1,2,3,4,5,6]) {
  let n=0, mass=0, all=0;
  for (const [, ws] of idx.wordsByLength) for (const w of ws) { all+=w.weight; if (w.weight>=t) { n++; mass+=w.weight; } }
  console.log('minWeight', t, 'words kept', n, 'token coverage', (mass/all*100).toFixed(0)+'%');
}
