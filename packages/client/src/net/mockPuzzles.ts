/**
 * Puzzles for the mock transport only.
 *
 * These never ship to the real game — the real corpus lives server-side and the
 * answer never crosses the wire (§6.2). This file exists so the landing page
 * demo and the offline dev flow have something real to reveal.
 */
export interface MockPuzzle {
  id: string;
  text: string;
  category: string;
  hint: string;
}

export const MOCK_PUZZLES: MockPuzzle[] = [
  {
    id: 'm1',
    text: 'MILK EGGS AND SOMETHING FOR YOUR FATHER',
    category: 'Grocery list',
    hint: 'She wrote it on the back of an envelope.',
  },
  {
    id: 'm2',
    text: 'NOW SERVING TICKET NUMBER FOUR',
    category: "Sign you'd see at the DMV",
    hint: 'You are holding number ninety-one.',
  },
  {
    id: 'm3',
    text: 'CALL ME WHEN YOU LAND OK LOVE MOM',
    category: 'Text from your mom',
    hint: 'Nine words, zero punctuation, infinite worry.',
  },
  {
    id: 'm4',
    text: 'WHO LEFT THE OVEN ON',
    category: 'Group chat message at 2am',
    hint: 'Nobody answers for eleven minutes.',
  },
  {
    id: 'm5',
    text: 'UNEXPECTED TOKEN AT LINE ONE',
    category: 'Error message',
    hint: 'It is always line one.',
  },
  {
    id: 'm6',
    text: 'A WATCHED POT NEVER BOILS',
    category: 'Idiom / proverb',
    hint: 'Patience, but make it kitchenware.',
  },
  {
    id: 'm7',
    text: 'DO NOT MICROWAVE THE POUCH',
    category: 'Instructions on the back of a box',
    hint: 'Somebody had to learn this the hard way.',
  },
  {
    id: 'm8',
    text: 'THE PARKING LOT IS NOT A HOTEL',
    category: 'Note left on a windshield',
    hint: 'Written in marker, pressed very hard.',
  },
  {
    id: 'm9',
    text: 'THEY WERE OUT OF THE GOOD DIP AGAIN',
    category: "Overheard at Trader Joe's",
    hint: 'The dip situation has become political.',
  },
  {
    id: 'm10',
    text: 'HONK IF YOU MISS DIAL UP',
    category: 'Bumper sticker',
    hint: 'Faded, peeling, on a very old bumper.',
  },
];
