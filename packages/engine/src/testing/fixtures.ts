/**
 * A small inline puzzle set for tests and the balance simulator.
 *
 * The real corpus is M5's job (`packages/corpus-gen`, 500 validated puzzles).
 * These exist so the engine can be exercised without any I/O, and they follow
 * the same validator rules (§4.3): 12–60 chars, >= 3 words, >= 6 distinct
 * letters, ASCII, punctuation limited to ' - , . ! ?
 */
import type { Puzzle } from '@phrasey/shared';
import { letterStats, normalizePuzzleText } from '@phrasey/shared';

interface Seed {
  id: string;
  text: string;
  category: string;
  hint: string;
  difficulty: 1 | 2 | 3;
}

const SEEDS: Seed[] = [
  { id: 'p1', text: 'MILK EGGS AND THE GOOD BREAD', category: 'Grocery list', hint: 'Not the cheap loaf this time.', difficulty: 1 },
  { id: 'p2', text: 'PLEASE TAKE A NUMBER AND WAIT', category: "Sign you'd see at the DMV", hint: 'You will be here a while.', difficulty: 1 },
  { id: 'p3', text: 'CALL ME WHEN YOU LAND HONEY', category: 'Text from your mom', hint: 'She means the second you land.', difficulty: 1 },
  { id: 'p4', text: 'WHO IS STILL AWAKE RIGHT NOW', category: 'Group chat message at 2am', hint: 'Nobody should answer this.', difficulty: 2 },
  { id: 'p5', text: 'UNEXPECTED TOKEN AT LINE ONE', category: 'Error message', hint: 'Something a parser says.', difficulty: 2 },
  { id: 'p6', text: 'THEY GROW UP SO FAST DONT THEY', category: 'Thing said at a wedding', hint: 'Said by someone holding a drink.', difficulty: 2 },
  { id: 'p7', text: 'A WATCHED POT NEVER BOILS', category: 'Idiom / proverb', hint: 'Patience, but about the stove.', difficulty: 1 },
  { id: 'p8', text: 'TEAR HERE TO OPEN THE PACKET', category: 'Instructions on the back of a box', hint: 'It will not tear there.', difficulty: 2 },
  { id: 'p9', text: 'THE SOUP WAS COLD AND SO WAS I', category: 'Yelp review, one star', hint: 'One star, mostly about temperature.', difficulty: 3 },
  { id: 'p10', text: 'THE RENT WAS DUE ON TUESDAY', category: 'Voicemail from your landlord', hint: 'He is not asking.', difficulty: 2 },
  { id: 'p11', text: 'YOU PARKED IN MY SPOT AGAIN', category: 'Note left on a windshield', hint: 'Written in all capitals, angrily.', difficulty: 2 },
  { id: 'p12', text: 'IS THIS THE SEASONAL ONE', category: "Overheard at Trader Joe's", hint: 'Asked about a squash-flavored item.', difficulty: 2 },
  { id: 'p13', text: 'MY OTHER CAR IS A BICYCLE', category: 'Bumper sticker', hint: 'Smug, on a rear windshield.', difficulty: 3 },
  { id: 'p14', text: 'DONT COUNT YOUR CHICKENS YET', category: 'Idiom / proverb', hint: 'Before they hatch, specifically.', difficulty: 2 },
  { id: 'p15', text: 'PLEASE STOP TOUCHING THE GLASS', category: "Sign you'd see at the DMV", hint: 'Aimed at everyone, helps nobody.', difficulty: 2 },
  { id: 'p16', text: 'I LOVE YOU DRIVE SAFE OKAY', category: 'Text from your mom', hint: 'Three sentiments, zero punctuation.', difficulty: 1 },
  { id: 'p17', text: 'MILK EGGS AND THE CHEAP BREAD', category: 'Grocery list', hint: 'The other loaf, this time.', difficulty: 2 },
  { id: 'p18', text: 'PLEASE TAKE A NUMBER AND SIT', category: "Sign you'd see at the DMV", hint: 'There are no chairs.', difficulty: 2 },
  { id: 'p19', text: 'CALL ME WHEN YOU LEAVE HONEY', category: 'Text from your mom', hint: 'She wants the exact minute.', difficulty: 2 },
  { id: 'p20', text: 'WHO IS STILL AWAKE OVER THERE', category: 'Group chat message at 2am', hint: 'Nobody should answer this either.', difficulty: 3 },
  { id: 'p21', text: 'UNEXPECTED TOKEN AT LINE NINE', category: 'Error message', hint: 'A parser, again.', difficulty: 3 },
  { id: 'p22', text: 'THE RENT WAS DUE ON THURSDAY', category: 'Voicemail from your landlord', hint: 'Still not asking.', difficulty: 3 },
  { id: 'p23', text: 'YOU PARKED IN MY SPOT TODAY', category: 'Note left on a windshield', hint: 'Capitals, underlined twice.', difficulty: 3 },
  { id: 'p24', text: 'MY OTHER CAR IS A TRACTOR', category: 'Bumper sticker', hint: 'Rural, and proud of it.', difficulty: 3 },
  { id: 'p25', text: 'A WATCHED CLOCK NEVER MOVES', category: 'Idiom / proverb', hint: 'Patience, but about time.', difficulty: 2 },
  { id: 'p26', text: 'TEAR HERE TO OPEN THE CARTON', category: 'Instructions on the back of a box', hint: 'It will not tear there either.', difficulty: 3 },
  { id: 'p27', text: 'THE FRIES WERE COLD AND SO WAS I', category: 'Yelp review, one star', hint: 'One star, still about temperature.', difficulty: 3 },
  { id: 'p28', text: 'IS THIS THE SEASONAL TWO', category: "Overheard at Trader Joe's", hint: 'Asked about a numbered squash item.', difficulty: 3 },
  { id: 'p29', text: 'THEY GROW UP SO FAST DONT WE', category: 'Thing said at a wedding', hint: 'Said by someone on their third drink.', difficulty: 3 },
  { id: 'p30', text: 'DONT COUNT YOUR HORSES YET', category: 'Idiom / proverb', hint: 'Wrong animal, same warning.', difficulty: 3 },
  { id: 'p31', text: 'PLEASE STOP LEANING ON THE GLASS', category: "Sign you'd see at the DMV", hint: 'Aimed at everyone, helps nobody.', difficulty: 3 },
  { id: 'p32', text: 'I LOVE YOU DRIVE SLOW OKAY', category: 'Text from your mom', hint: 'Three sentiments, still no commas.', difficulty: 2 },
  { id: 'p33', text: 'BRING BACK THE ORANGE JUICE', category: 'Grocery list', hint: 'With pulp, obviously.', difficulty: 2 },
  { id: 'p34', text: 'BRING BACK THE ALMOND BUTTER', category: 'Grocery list', hint: 'Not the crunchy one.', difficulty: 3 },
  { id: 'p35', text: 'THE DRYER IS MAKING THAT SOUND', category: 'Voicemail from your landlord', hint: 'He has heard it before.', difficulty: 3 },
  { id: 'p36', text: 'THE HEATER IS MAKING THAT NOISE', category: 'Voicemail from your landlord', hint: 'He has also heard this one.', difficulty: 3 },
  { id: 'p37', text: 'EVERY GOOD BOY DESERVES FUDGE', category: 'Idiom / proverb', hint: 'A mnemonic, technically.', difficulty: 2 },
  { id: 'p38', text: 'NEVER TRUST A QUIET TODDLER', category: 'Idiom / proverb', hint: 'Silence is the warning.', difficulty: 2 },
  { id: 'p39', text: 'CONNECTION RESET BY THE PEER', category: 'Error message', hint: 'The socket gave up.', difficulty: 2 },
  { id: 'p40', text: 'YOUR SESSION HAS EXPIRED SORRY', category: 'Error message', hint: 'Log in again, sorry.', difficulty: 2 },
];

export const TEST_PUZZLES: Puzzle[] = SEEDS.map((s) => ({
  id: s.id,
  text: normalizePuzzleText(s.text),
  category: s.category,
  hint: s.hint,
  difficulty: s.difficulty,
  letterStats: letterStats(s.text),
  active: true,
  source: 'manual' as const,
}));

export function puzzleById(id: string): Puzzle {
  const p = TEST_PUZZLES.find((x) => x.id === id);
  if (!p) throw new Error(`no fixture puzzle ${id}`);
  return p;
}

/** Build an ad-hoc puzzle for a focused test. */
export function makePuzzle(text: string, opts: Partial<Puzzle> = {}): Puzzle {
  const normalized = normalizePuzzleText(text);
  return {
    id: opts.id ?? `adhoc-${normalized.length}`,
    text: normalized,
    category: opts.category ?? 'Idiom / proverb',
    hint: opts.hint ?? 'A hint nobody needs.',
    difficulty: opts.difficulty ?? 1,
    letterStats: letterStats(normalized),
    active: true,
    source: 'manual',
  };
}
