import { createBotPolicy } from '../src/bots/index.js';
import { sweep } from '../src/sim/simulate.js';
import { loadCorpus } from '../src/sim/corpus.js';
import { randomPolicy } from '../src/policy.js';
import { defaultBalance, type BotTier } from '@phrasey/shared';
const corpus = loadCorpus(); const balance = defaultBalance();
const G: Record<string, any> = { chill:{minRevealedFraction:0.62,minGuessedLetters:6}, sharp:{minRevealedFraction:0.60,minGuessedLetters:5}, ruthless:{minRevealedFraction:0.58,minGuessedLetters:5} };
const pol = (t: BotTier) => createBotPolicy(t, { corpus, balance, gate: G[t] });
function show(label: string, policies: any) {
  const s = sweep({ matches: 60, startSeed: 1, players:['p1','p2','p3','p4'], policies, puzzles: corpus, balance, maxActions: 80000 }).stats;
  console.log(label.padEnd(30), 'len', s.avgRoundLength.toFixed(1).padStart(5), 'solve', (s.solveRate*100).toFixed(0).padStart(3)+'%', 'blow', (s.blowoutRate*100).toFixed(0).padStart(3)+'%', 'deck', (s.deckExhaustionRate*100).toFixed(0).padStart(3)+'%', 'peakP', s.avgPeakPressure.toFixed(1), 'breath/rnd', s.avgBreathsPerRound.toFixed(2), 'wrongSolve/rnd', s.avgWrongSolvesPerRound.toFixed(2), 'spread', s.avgScoreSpread.toFixed(0));
}
show('1 random + 3 sharp', { p1: randomPolicy, p2: pol('sharp'), p3: pol('sharp'), p4: pol('sharp') });
show('2 random + 2 sharp', { p1: randomPolicy, p2: randomPolicy, p3: pol('sharp'), p4: pol('sharp') });
show('1 random + 3 chill', { p1: randomPolicy, p2: pol('chill'), p3: pol('chill'), p4: pol('chill') });
show('4 random (floor)', { p1: randomPolicy, p2: randomPolicy, p3: randomPolicy, p4: randomPolicy });
