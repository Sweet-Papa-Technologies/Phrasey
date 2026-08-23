/**
 * Per-category prompt templates (design doc §4.1, §4.3).
 *
 * The mundane categories are the funny ones and they carry the game, so they
 * are weighted heaviest and their briefs push hardest for the specific,
 * observational, slightly deranged register — "WHY IS THERE A SECOND FRIDGE",
 * not "PLEASE WAIT YOUR TURN".
 *
 * Every item comes back as `{ text, hint }`: the hint is generated in the same
 * pass (§4.3) and is what the CRACK card reveals.
 */
import { CATEGORIES, type Category } from '@phrasey/shared';
import type { PuzzleSource } from './types.js';

export interface CategoryBrief {
  category: Category;
  /** Relative share of the corpus. Mundane categories are weighted heaviest. */
  weight: number;
  source: PuzzleSource;
  /** Who is speaking and what makes a line land. */
  voice: string;
  /** Where the model habitually goes wrong for this category. */
  avoid: string;
  /** Hand-written seeds, in the target register. Never emitted into the corpus. */
  examples: { text: string; hint: string }[];
}

export const BRIEFS: Record<Category, CategoryBrief> = {
  'Grocery list': {
    category: 'Grocery list',
    weight: 3,
    source: 'generated',
    voice:
      'A real list written fast on a phone or the back of an envelope. The comedy is in the one item that does not belong, the item written with a doubt attached, or the sudden pivot from food to feelings.',
    avoid: 'Bland three-item lists like "milk eggs bread". Every line needs one thing that makes a stranger raise an eyebrow.',
    examples: [
      { text: 'MILK, EGGS, AND WHATEVER THAT SMELL IS', hint: 'a shopping run derailed by an odor' },
      { text: 'BREAD, TAPE, MORE TAPE, SOMETHING GREEN', hint: 'adhesive outranks nutrition here' },
      { text: 'BANANAS FOR THE PERSON I AM BECOMING', hint: 'fruit purchased for a future self' },
    ],
  },
  "Sign you'd see at the DMV": {
    category: "Sign you'd see at the DMV",
    weight: 3,
    source: 'generated',
    voice:
      'Laminated, taped crooked to a plexiglass window, printed in a font nobody chose on purpose. Passive-aggressive bureaucratic despair. Often a rule that only exists because somebody did the thing.',
    avoid: 'Generic politeness signage. The funny ones imply an incident.',
    examples: [
      { text: 'DO NOT ASK ME WHAT NUMBER WE ARE ON', hint: 'a plea about the queue counter' },
      { text: 'THE PEN IS ON A STRING FOR A REASON', hint: 'why the writing tool is tethered' },
      { text: 'YELLING WILL NOT CREATE A NEW WINDOW', hint: 'volume does not open more counters' },
    ],
  },
  'Text from your mom': {
    category: 'Text from your mom',
    weight: 3,
    source: 'generated',
    voice:
      'Punctuation used wrong but with total confidence. A question that is actually a statement. Non-sequitur updates about neighbors, weather, or a dog. Sudden tenderness at the end.',
    avoid: 'Sitcom-mom cliches. Emoji. Anything that sounds written by a comedy writer instead of a mother.',
    examples: [
      { text: 'CALL ME WHEN YOU GET THIS. NOT URGENT.', hint: 'contradictory instructions about urgency' },
      { text: 'YOUR FATHER FOUND A RACCOON. HE IS FINE.', hint: 'a masked visitor and a reassurance' },
      { text: 'I SAW A BIRD TODAY AND THOUGHT OF YOU', hint: 'wildlife triggers maternal affection' },
    ],
  },
  'Group chat message at 2am': {
    category: 'Group chat message at 2am',
    weight: 3,
    source: 'generated',
    voice:
      'Sleep-deprived, lowercase energy, a thought that seemed profound at the time. Fixations on appliances, ceilings, the concept of doors. Sent to five people who are all asleep.',
    avoid: 'Party talk and drunk cliches. The good ones are lonely and specific, not rowdy.',
    examples: [
      { text: 'WHY IS THERE A SECOND FRIDGE', hint: 'an extra cold appliance raises questions' },
      { text: 'I THINK MY CEILING HAS A FACE IN IT', hint: 'the overhead surface appears to watch' },
      { text: 'ARE WE SURE ABOUT HOW BREAD WORKS', hint: 'a late doubt concerning a baked staple' },
    ],
  },
  'Error message': {
    category: 'Error message',
    weight: 2,
    source: 'generated',
    voice:
      'Software confessing something it should not confess, or refusing in a way that helps nobody. Technical register applied to an emotional problem, or an apology with no information in it.',
    avoid: 'Real product names, real error codes, and anything that reads like a stack trace.',
    examples: [
      { text: 'SOMETHING WENT WRONG. WE WILL NOT SAY WHAT.', hint: 'a failure notice that withholds detail' },
      { text: 'CANNOT UNDO. CANNOT REDO. GOOD LUCK.', hint: 'neither direction of history works' },
      { text: 'THE FILE YOU WANT IS THE ONE YOU DELETED', hint: 'the needed document was already removed' },
    ],
  },
  'Thing said at a wedding': {
    category: 'Thing said at a wedding',
    weight: 2,
    source: 'generated',
    voice:
      'Overheard at a table near the back, or a toast going slightly off the rails. Weddings run on catering logistics, seating politics, and someone who has had exactly one drink too many.',
    avoid: 'Actual vows and greeting-card sentiment. The comedy is at the edges of the event, not the ceremony.',
    examples: [
      { text: 'I HAVE KNOWN HIM SINCE THE INCIDENT', hint: 'a friendship dated from an event' },
      { text: 'WHOSE CHILD IS UNDER THE CAKE TABLE', hint: 'an unclaimed kid beneath the dessert' },
      { text: 'THE SEATING CHART WAS A POLITICAL ACT', hint: 'assigning places had consequences' },
    ],
  },
  'Idiom / proverb': {
    category: 'Idiom / proverb',
    weight: 1,
    source: 'public-domain',
    voice:
      'Genuine common-property English proverbs, idioms and folk sayings that have been in circulation for generations. Plain, well known, no author.',
    avoid:
      'Anything traceable to a named modern author, a film, a song, or a book. Only sayings in common public use with no identifiable owner.',
    examples: [
      { text: 'A WATCHED POT NEVER BOILS', hint: 'attention slows an anticipated event' },
      { text: 'DO NOT COUNT YOUR CHICKENS TOO EARLY', hint: 'tallying poultry before they hatch' },
      { text: 'THE EARLY BIRD CATCHES THE WORM', hint: 'rising first wins the reward' },
    ],
  },
  'Instructions on the back of a box': {
    category: 'Instructions on the back of a box',
    weight: 2,
    source: 'generated',
    voice:
      'Translated twice, numbered oddly, confident about the wrong step. Steps that assume equipment you do not have, or a warning that arrives too late in the sequence.',
    avoid: 'Real recipes and real appliance copy. Keep it a step, not a paragraph.',
    examples: [
      { text: 'REMOVE ALL PARTS BEFORE REMOVING ANY PARTS', hint: 'a circular disassembly order' },
      { text: 'STIR UNTIL IT LOOKS LIKE THE PICTURE', hint: 'mixing judged against an illustration' },
      { text: 'STEP FOUR SHOULD HAVE BEEN STEP ONE', hint: 'the sequence was printed out of order' },
    ],
  },
  'Yelp review, one star': {
    category: 'Yelp review, one star',
    weight: 3,
    source: 'generated',
    voice:
      'Aggrieved, over-detailed, and secretly about something else entirely. The complaint is never the real complaint. Often admits something that undermines the reviewer.',
    avoid: 'Naming any real business. No slurs, no cruelty about staff appearance.',
    examples: [
      { text: 'THE SOUP WAS FINE BUT NOBODY LOOKED AT ME', hint: 'adequate broth, insufficient eye contact' },
      { text: 'I WAS NOT TOLD THE CHAIRS WOULD BE LIKE THAT', hint: 'unwarned about the seating' },
      { text: 'ASKED FOR WATER. RECEIVED A CONVERSATION.', hint: 'requested a drink, got dialogue' },
    ],
  },
  'Voicemail from your landlord': {
    category: 'Voicemail from your landlord',
    weight: 2,
    source: 'generated',
    voice:
      'Left at an inconvenient hour. Vague about responsibility, precise about money. Mentions a guy who will come by. The guy never comes by.',
    avoid: 'Legal threats and anything that reads like an actual eviction notice.',
    examples: [
      { text: 'MY GUY WILL COME BY. HE HAS A KEY.', hint: 'an unnamed worker with access' },
      { text: 'THAT NOISE IS NORMAL FOR THE BUILDING', hint: 'a sound declared unremarkable' },
      { text: 'THE RENT WENT UP. I WILL EXPLAIN LATER.', hint: 'a cost increase with deferred reasoning' },
    ],
  },
  'Note left on a windshield': {
    category: 'Note left on a windshield',
    weight: 3,
    source: 'generated',
    voice:
      'Written in anger on whatever paper was to hand, or written in kindness and somehow worse. Parking is the subject; the tone is a whole personality.',
    avoid: 'License plates, phone numbers, and any real place name.',
    examples: [
      { text: 'YOU PARKED LIKE A QUESTION, NOT A STATEMENT', hint: 'the vehicle placement lacks conviction' },
      { text: 'I AM NOT MAD. I AM WRITING THIS IN PENCIL.', hint: 'calm asserted, in graphite' },
      { text: 'TWO SPOTS. BOLD CHOICE. WE ALL SAW.', hint: 'occupying double the space, publicly' },
    ],
  },
  "Overheard at Trader Joe's": {
    category: "Overheard at Trader Joe's",
    weight: 3,
    source: 'generated',
    voice:
      'Half of a conversation, caught in an aisle. Seasonal snacks discussed with unearned intensity. Sudden personal disclosure between two shelf items.',
    avoid: 'Naming the store or any product brand. Keep it to what a stranger says out loud.',
    examples: [
      { text: 'THEY MOVED THE FROZEN AISLE AND I AM SHAKEN', hint: 'a relocated cold section causes distress' },
      { text: 'IS THIS SEASONAL OR IS THIS FOREVER', hint: 'questioning a snack timeline' },
      { text: 'I ONLY CAME IN FOR ONE THING AND LOOK AT ME', hint: 'a single errand that expanded' },
    ],
  },
  'Bumper sticker': {
    category: 'Bumper sticker',
    weight: 2,
    source: 'generated',
    voice:
      'Short, declarative, faded by sun, applied at a moment the driver has since moved past. A worldview compressed into one strip of vinyl, often a slightly sad one.',
    avoid: 'Politics, real slogans, real bands, and anything trademarked.',
    examples: [
      { text: 'MY OTHER CAR IS ALSO THIS CAR', hint: 'the second vehicle is the first vehicle' },
      { text: 'HONK IF YOU HAVE ALSO GIVEN UP', hint: 'sound your horn in shared resignation' },
      { text: 'I BRAKE FOR NOTHING IN PARTICULAR', hint: 'stopping without a specific cause' },
    ],
  },
};

/** Total of all category weights — the denominator for a corpus-wide target. */
export const TOTAL_WEIGHT = Object.values(BRIEFS).reduce((n, b) => n + b.weight, 0);

/** Split a total across categories, mundane ones weighted heaviest. */
export function allocate(total: number): { category: Category; count: number }[] {
  return CATEGORIES.map((category) => {
    const brief = BRIEFS[category];
    return { category, count: Math.max(2, Math.round((total * brief.weight) / TOTAL_WEIGHT)) };
  });
}

export const SYSTEM_PROMPT = [
  'You write phrases for a word-guessing party game. The board masks the letters, so the phrase has to be fun to slowly uncover and satisfying to say out loud when someone finally cracks it.',
  'You are funny the way a real overheard sentence is funny: specific, observational, a little unhinged. You are never funny the way a greeting card is funny.',
  'You reply with JSON and nothing else. No preamble, no commentary, no markdown fence.',
].join(' ');

/** The deterministic validator's rules, restated so the model self-filters. */
function ruleBlock(): string {
  return [
    'HARD RULES for every phrase:',
    '- 12 to 60 characters long, counted including spaces.',
    '- At least 3 words, and at least 6 different letters of the alphabet.',
    '- Plain ASCII only. No emoji, no accents, no curly quotes.',
    "- The only punctuation allowed is  '  -  ,  .  !  ?  — no colons, semicolons, quotation marks, slashes, parentheses, asterisks or ampersands.",
    '- Spell numbers out as words.',
    '- No proper nouns at all: no personal names, no place names, no brand or company or product names, no titles of films, songs, books or games.',
    '- No profanity, no slurs, no sexual content, no cruelty toward a real group of people.',
    '- Original writing only. Do not quote song lyrics, film or television dialogue, or anything written by a known author.',
    '- Do not use the same opening two words twice.',
    '',
    'HARD RULES for every hint:',
    '- One short line, 10 to 90 characters, that nudges a player toward the phrase.',
    '- It must NOT contain any word that appears in the phrase, and no near-variant of one either (no plural, no tense change).',
    '- Describe the phrase sideways: paraphrase the situation using entirely different vocabulary.',
    '- No proper nouns, no profanity, plain ASCII.',
  ].join('\n');
}

export interface PromptArgs {
  category: Category;
  count: number;
  /** Phrases already accepted in this category — the model is told to steer clear. */
  existing?: string[];
}

export function buildPrompt({ category, count, existing = [] }: PromptArgs): string {
  const brief = BRIEFS[category];
  const shown = existing.slice(-40);

  const parts: string[] = [
    `CATEGORY: ${category}`,
    '',
    `VOICE: ${brief.voice}`,
    '',
    `AVOID: ${brief.avoid}`,
    '',
    'CALIBRATION — this is the register, do not reuse these lines:',
    ...brief.examples.map((e) => `  ${JSON.stringify(e)}`),
    '',
    ruleBlock(),
  ];

  if (shown.length > 0) {
    parts.push(
      '',
      'ALREADY WRITTEN — do not repeat these, and do not write a variation of one:',
      ...shown.map((t) => `  - ${t}`),
    );
  }

  parts.push(
    '',
    `TASK: write ${count} new phrases for this category, each with its hint.`,
    'Make them different from each other in shape, length and subject. Vary the sentence structure — some questions, some flat statements, some fragments.',
    '',
    'Reply with ONLY a JSON array of objects, each with exactly the keys "text" and "hint":',
    '[{"text": "...", "hint": "..."}]',
  );

  return parts.join('\n');
}
