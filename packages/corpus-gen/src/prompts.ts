/**
 * Per-category prompt templates (design doc §4.1, §4.3).
 *
 * The corpus has two jobs and they pull in opposite directions. It has to be
 * *funny* — which the mundane observational categories do, and they carry the
 * game — and it has to be *guessable*, which is what a party word game actually
 * runs on. The first pass over-served the first job: surreal one-liners read
 * well and play miserably, because every word is a surprise and the board never
 * gives you traction.
 *
 * So these briefs push three things everywhere:
 *
 *  1. **Familiar shapes.** A phrase you could finish yourself from three
 *     letters. `A WATCHED POT NEVER BOILS`, not `THE DEPOSIT WAS FOR THE DEPOSIT`.
 *  2. **Common words.** The validator enforces this now (`UNCOMMON_VOCABULARY`),
 *     but the prompt should be getting it right before the validator has to.
 *  3. **Short.** 15–40 characters. §4.3's 60 stays as a hard cap for the
 *     occasional long one; it is not a target.
 *
 * Categories carry a `rightsTier`. Everything a lawyer might want removed sits
 * in `pop-culture` and nothing else depends on it — see corpus/SOURCING.md.
 *
 * Every item comes back as `{ text, hint }`: the hint is generated in the same
 * pass (§4.3) and is what the CRACK card reveals.
 */
import { CATEGORIES, type Category } from '@phrasey/shared';
import type { PuzzleSource, RightsTier } from './types.js';

export interface CategoryBrief {
  category: Category;
  /** Relative share of the corpus. Familiar categories are weighted heaviest. */
  weight: number;
  source: PuzzleSource;
  /** `core` or `pop-culture`. Drives `drop --tier` and `seed --tier`. */
  rightsTier: RightsTier;
  /**
   * True when the phrases are RECALLED from culture rather than invented here.
   *
   * It changes two judgements. Repetition is the model's tic in an invented
   * line ("THE DEPOSIT WAS FOR THE DEPOSIT") and the whole mnemonic in a
   * recalled one ("TIME AFTER TIME", "EASY COME EASY GO"), so `triage` only
   * treats it as a smell for invented material. And the difficulty scorer stops
   * charging for unusual vocabulary, because a phrase recognized as a unit is
   * not made harder by containing "baa".
   */
  recalled?: boolean;
  /** One line recorded on every entry, for a human rights review. */
  rightsNote?: string;
  /**
   * Overrides the validator's common-word floor for this category.
   *
   * A title or a nursery rhyme is familiar because the *whole thing* is famous,
   * not because its words are frequent — "ITSY BITSY SPIDER" scores 0.33 on a
   * frequency list and is instantly guessable by any English speaker. Those
   * categories get a lower floor; everything else keeps the default.
   */
  commonWordFloor?: number;
  maxUncommonWords?: number;
  /** Who is speaking and what makes a line land. */
  voice: string;
  /** Where the model habitually goes wrong for this category. */
  avoid: string;
  /** Extra instruction appended to the shared rule block, if any. */
  extraRules?: string[];
  /** Hand-written seeds, in the target register. Never emitted into the corpus. */
  examples: { text: string; hint: string }[];
}

export const BRIEFS: Record<Category, CategoryBrief> = {
  'Grocery list': {
    category: 'Grocery list',
    weight: 3,
    source: 'generated',
    rightsTier: 'core',
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
    rightsTier: 'core',
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
    rightsTier: 'core',
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
    weight: 2,
    source: 'generated',
    rightsTier: 'core',
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
    rightsTier: 'core',
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
    rightsTier: 'core',
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
    weight: 6,
    recalled: true,
    source: 'public-domain',
    rightsTier: 'core',
    rightsNote:
      'Long-established English idiom, proverb or folk saying. In general circulation for generations, no identifiable author, and individually too short for copyright.',
    voice:
      'The sayings an English speaker has heard a hundred times and could finish for you: proverbs, idioms and figures of speech that have been in common use for generations. Plain, well known, no author. The whole point is that a player recognizes it three letters in.',
    avoid:
      'Anything clever or freshly written. Anything traceable to a named modern author, a film, a song or a book. Obscure regional sayings nobody would recognize. If you would have to explain it, it does not belong here.',
    extraRules: [
      'Write the saying in its ordinary, most common wording — the version people actually say, not a literary variant.',
      'Only sayings in genuinely wide circulation. If you are not confident an ordinary adult would recognize it instantly, skip it.',
    ],
    examples: [
      { text: 'A WATCHED POT NEVER BOILS', hint: 'attention slows an anticipated event' },
      { text: 'THE EARLY BIRD CATCHES THE WORM', hint: 'rising first wins the reward' },
      { text: 'BETTER LATE THAN NEVER', hint: 'delayed still beats absent' },
    ],
  },
  'Instructions on the back of a box': {
    category: 'Instructions on the back of a box',
    weight: 2,
    source: 'generated',
    rightsTier: 'core',
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
    weight: 2,
    source: 'generated',
    rightsTier: 'core',
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
    rightsTier: 'core',
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
    weight: 2,
    source: 'generated',
    rightsTier: 'core',
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
    weight: 2,
    source: 'generated',
    rightsTier: 'core',
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
    rightsTier: 'core',
    voice:
      'Short, declarative, faded by sun, applied at a moment the driver has since moved past. A worldview compressed into one strip of vinyl, often a slightly sad one.',
    avoid: 'Politics, real slogans, real bands, and anything trademarked.',
    examples: [
      { text: 'MY OTHER CAR IS ALSO THIS CAR', hint: 'the second vehicle is the first vehicle' },
      { text: 'HONK IF YOU HAVE ALSO GIVEN UP', hint: 'sound your horn in shared resignation' },
      { text: 'I BRAKE FOR NOTHING IN PARTICULAR', hint: 'stopping without a specific cause' },
    ],
  },
  'Nursery rhyme line': {
    category: 'Nursery rhyme line',
    weight: 3,
    recalled: true,
    source: 'public-domain',
    rightsTier: 'core',
    rightsNote:
      'Traditional nursery rhyme, published well before 1930 and in the public domain. No modern children-s song lyrics.',
    commonWordFloor: 0.5,
    maxUncommonWords: 3,
    voice:
      'One line from a traditional nursery rhyme every child learns — the kind printed in collections a century ago. Sing-song, repetitive, and instantly finishable once two words are up.',
    avoid:
      'Modern children-s songs, television theme songs, and anything from a film. Rhymes whose famous line is only a name. Anything you cannot place as traditional and old.',
    extraRules: [
      'Traditional rhymes only, in circulation long before 1930. If it came from a show, a film or a recording, skip it.',
      'Pick the single most recognizable line, not the obscure third verse.',
    ],
    examples: [
      { text: 'TWINKLE TWINKLE LITTLE STAR', hint: 'a small light in the sky, sung to' },
      { text: 'THE COW JUMPED OVER THE MOON', hint: 'livestock clears a satellite' },
      { text: 'ALL THE KINGS HORSES AND ALL THE KINGS MEN', hint: 'a whole royal workforce, and it did not help' },
    ],
  },
  'Common sign or public notice': {
    category: 'Common sign or public notice',
    weight: 4,
    source: 'generated',
    rightsTier: 'core',
    voice:
      'The wording that is actually printed on signs everywhere — doors, walls, parking lots, waiting rooms, break rooms. Flat, functional, and so familiar you can finish it from the first two words.',
    avoid:
      'Jokes. Invented signage. Anything clever. This category earns its keep by being boring and completely recognizable, and the comedy comes from the board, not the line.',
    extraRules: [
      'Write signage that genuinely exists in the ordinary world, in its ordinary wording.',
      'No brand names, no store names, no street names.',
    ],
    examples: [
      { text: 'PLEASE WAIT TO BE SEATED', hint: 'do not choose your own spot yet' },
      { text: 'NO PARKING AT ANY TIME', hint: 'the curb is never yours' },
      { text: 'IN CASE OF FIRE USE THE STAIRS', hint: 'the lifting box is not for emergencies' },
    ],
  },
  'Thing your GPS says': {
    category: 'Thing your GPS says',
    weight: 3,
    source: 'generated',
    rightsTier: 'core',
    voice:
      'The flat, patient voice of a navigation app. Distances, directions, and the small indignity of being corrected. Everyone has heard every one of these.',
    avoid:
      'Any real place, road or highway name. Any product or app name. Jokes about the voice being sentient.',
    extraRules: ['Spell distances out as words. No numerals.', 'No road names, no city names, no app names.'],
    examples: [
      { text: 'TURN LEFT IN FIVE HUNDRED FEET', hint: 'a directional instruction with a distance' },
      { text: 'YOU HAVE ARRIVED AT YOUR DESTINATION', hint: 'the journey is over, allegedly' },
      { text: 'MAKE THE NEXT LEGAL U TURN', hint: 'reverse course when permitted' },
    ],
  },
  'Thing on a restaurant menu': {
    category: 'Thing on a restaurant menu',
    weight: 3,
    source: 'generated',
    rightsTier: 'core',
    voice:
      'A menu line, a section header, or the small print at the bottom. Ordinary food described in the slightly over-serious register menus use.',
    avoid:
      'Any restaurant or brand name. Ingredients nobody has heard of. Invented fusion dishes. Keep it to food a normal person orders.',
    extraRules: ['No restaurant names, no brand names, no chef names.'],
    examples: [
      { text: 'SERVED WITH FRIES OR A SIDE SALAD', hint: 'your choice of two ordinary accompaniments' },
      { text: 'ASK YOUR SERVER ABOUT TODAYS SOUP', hint: 'the hot liquid course is unlisted' },
      { text: 'ALL YOU CAN EAT ON SUNDAYS', hint: 'unlimited portions, one day a week' },
    ],
  },
  'Movie title everyone knows': {
    category: 'Movie title everyone knows',
    weight: 4,
    recalled: true,
    source: 'reference',
    rightsTier: 'pop-culture',
    rightsNote:
      'Film title used as a quiz answer. Titles are not protected by copyright; no dialogue, plot text or artwork is reproduced. Trademark may attach to a title used as a source identifier - flagged for human review. Titles containing personal names, place names or brands are rejected mechanically by the proper-noun rule.',
    commonWordFloor: 0.6,
    maxUncommonWords: 2,
    voice:
      'The title of a film so widely known that naming it settles the room. Nothing but the title itself.',
    avoid:
      'Obscure films, festival films, anything from the last two years. Sequels identified by a number. Titles that are somebody-s name. Taglines, quotes, or a line of dialogue - the TITLE and nothing else.',
    extraRules: [
      'Output ONLY the title. Never a quotation from the film, never a tagline, never a description.',
      'Pick films an ordinary adult anywhere would name unprompted. If it needs explaining, skip it.',
      'The title must be plain English words with no personal name, place name or brand in it.',
      'Spell any number in the title out as a word.',
    ],
    examples: [
      { text: 'BACK TO THE FUTURE', hint: 'a return journey to what is ahead' },
      { text: 'THE SOUND OF MUSIC', hint: 'what melody makes, in the mountains' },
      { text: 'THE SILENCE OF THE LAMBS', hint: 'young sheep, notably quiet' },
    ],
  },
  'Song title everyone knows': {
    category: 'Song title everyone knows',
    weight: 3,
    recalled: true,
    source: 'reference',
    rightsTier: 'pop-culture',
    rightsNote:
      'Song title used as a quiz answer. Titles are not protected by copyright, and NO LYRICS are reproduced anywhere in this corpus. Trademark may attach to a title used as a source identifier - flagged for human review.',
    commonWordFloor: 0.6,
    maxUncommonWords: 2,
    voice: 'The title of a song almost everybody can hum. Nothing but the title itself.',
    avoid:
      'ANY line of lyrics, even one word of them, and even when the title is also the first line - if you cannot separate the title from the words of the song, skip the song. Obscure tracks, album cuts, anything from the last two years. Titles that are somebody-s name.',
    extraRules: [
      'Output ONLY the title. Never a lyric. Never a line from the chorus. Never a verse.',
      'The title must be plain English words with no personal name, place name or brand in it.',
      'If a title is only famous because of the lyric it opens, skip it.',
    ],
    examples: [
      { text: 'DANCING IN THE DARK', hint: 'moving to a beat with the lights off' },
      { text: 'UNDER THE BRIDGE', hint: 'beneath a river crossing' },
      { text: 'THE SOUND OF SILENCE', hint: 'what you hear when nothing is heard' },
    ],
  },
  'TV show title everyone knows': {
    category: 'TV show title everyone knows',
    weight: 3,
    recalled: true,
    source: 'reference',
    rightsTier: 'pop-culture',
    rightsNote:
      'Television series title used as a quiz answer. Titles are not protected by copyright; no dialogue or script text is reproduced. Trademark may attach to a title used as a source identifier - flagged for human review.',
    commonWordFloor: 0.6,
    maxUncommonWords: 2,
    voice: 'The title of a television series that ran long enough that everyone has heard of it. Nothing but the title.',
    avoid:
      'Streaming one-offs, regional shows, anything from the last two years. Episode titles. Catchphrases from the show. Titles that are somebody-s name.',
    extraRules: [
      'Output ONLY the series title. Never a line of dialogue, never a catchphrase, never an episode name.',
      'The title must be plain English words with no personal name, place name or brand in it.',
    ],
    examples: [
      { text: 'THE PRICE IS RIGHT', hint: 'the cost is correct, apparently' },
      { text: 'HOW IT IS MADE', hint: 'the manufacture of a thing, explained' },
      { text: 'THE GREAT BAKE OFF', hint: 'a large contest involving ovens' },
    ],
  },
  'Catchphrase everyone knows': {
    category: 'Catchphrase everyone knows',
    weight: 2,
    recalled: true,
    source: 'reference',
    rightsTier: 'pop-culture',
    rightsNote:
      'Stock phrase in generic everyday circulation with no identifiable author. Deliberately excludes anything still attached to a named film, show, advertisement or performer. Judgment call - flagged for human review, and droppable with the rest of the pop-culture tier.',
    voice:
      'The stock phrases people say to each other constantly and nobody owns: the things you say to wish someone luck, to give up, to agree, to end a conversation. Older than anyone can remember and attached to nobody.',
    avoid:
      'Advertising slogans and taglines. Anything still attached to a named performer, show, film or brand - if you can name who says it, it does not belong here. Anything that would make a reader think of one specific person.',
    extraRules: [
      'The phrase must have no identifiable author or owner and must be in generic everyday use.',
      'If you can name the film, show, advertisement or person it comes from, skip it.',
    ],
    examples: [
      { text: 'BETTER SAFE THAN SORRY', hint: 'caution beats regret' },
      { text: 'EASIER SAID THAN DONE', hint: 'talking about it costs less than doing it' },
      { text: 'FIRST COME FIRST SERVED', hint: 'order of arrival decides order of reward' },
    ],
  },
};

/** The band the prompts ask for. §4.3's 60 stays as the validator's hard cap. */
export const TARGET_MIN_LENGTH = 15;
export const TARGET_MAX_LENGTH = 40;
export const HARD_MAX_LENGTH = 60;

/** Categories a lawyer could remove wholesale without touching anything else. */
export const POP_CULTURE_CATEGORIES: Category[] = CATEGORIES.filter(
  (c) => BRIEFS[c].rightsTier === 'pop-culture',
);

/** Total of all category weights — the denominator for a corpus-wide target. */
export const TOTAL_WEIGHT = Object.values(BRIEFS).reduce((n, b) => n + b.weight, 0);

/** Split a total across categories, familiar ones weighted heaviest. */
export function allocate(total: number, tier?: RightsTier): { category: Category; count: number }[] {
  const cats = tier ? CATEGORIES.filter((c) => BRIEFS[c].rightsTier === tier) : [...CATEGORIES];
  const denominator = cats.reduce((n, c) => n + BRIEFS[c].weight, 0) || 1;
  return cats.map((category) => ({
    category,
    count: Math.max(2, Math.round((total * BRIEFS[category].weight) / denominator)),
  }));
}

export const SYSTEM_PROMPT = [
  'You write phrases for a word-guessing party game. The board masks the letters, so the phrase has to be fun to slowly uncover and, above all, GUESSABLE — a player who has three letters up should feel the shape of it click into place.',
  'That means familiar. Common words, ordinary constructions, and things a person has heard before. A surreal one-liner reads well and plays terribly, because every word is a surprise and nobody can ever get ahead of the board.',
  'When the category calls for observational comedy you are funny the way a real overheard sentence is funny: specific and ordinary. You are never funny the way a greeting card is funny, and never funny at the cost of being guessable.',
  'You reply with JSON and nothing else. No preamble, no commentary, no markdown fence.',
].join(' ');

/** The deterministic validator's rules, restated so the model self-filters. */
function ruleBlock(brief: CategoryBrief): string {
  const lines = [
    'HARD RULES for every phrase:',
    `- ${TARGET_MIN_LENGTH} to ${TARGET_MAX_LENGTH} characters long, counted including spaces. Aim for the middle of that band. Never over ${HARD_MAX_LENGTH}.`,
    '- At least 3 words, and at least 6 different letters of the alphabet.',
    '- Plain ASCII only. No emoji, no accents, no curly quotes.',
    "- The only punctuation allowed is  '  -  ,  .  !  ?  — no colons, semicolons, quotation marks, slashes, parentheses, asterisks or ampersands.",
    '- Spell numbers out as words.',
    '- No proper nouns at all: no personal names, no place names, no brand or company or product names.',
    '- No profanity, no slurs, no sexual content, no cruelty toward a real group of people.',
    '- Do not use the same opening two words twice.',
    '',
    'GUESSABILITY — this is the rule that gets phrases thrown out most often:',
    '- Use ordinary, everyday words. If a word would not turn up in a normal conversation this week, do not use it.',
    '- At most ONE unusual word in the whole phrase, and prefer zero.',
    '- The phrase should read like something a person has heard before: a familiar construction, a complete thought, a shape you could finish yourself.',
    '- Concrete beats abstract every time. Objects, actions and places, not feelings, concepts or wordplay about concepts.',
    '- Do NOT write surreal or absurdist lines. "THE DEPOSIT WAS FOR THE DEPOSIT" and "YOUR GRIEF IS NOT A RECOGNIZED FORMAT" are exactly what to avoid: clever to read, impossible to guess.',
    '- Say it out loud. If it sounds like a sentence somebody would actually say, keep it. If it sounds like a poem, throw it away.',
  ];

  if (brief.rightsTier === 'pop-culture') {
    lines.push(
      '',
      'RIGHTS — non-negotiable for this category:',
      '- Give the TITLE ONLY. Never a lyric, never a line of dialogue, never a tagline, never a quotation.',
      '- Only well-known, long-established works. Nothing from the last two years.',
      '- The title must be ordinary English words with no personal name, place name or brand in it.',
      '- Spell the title EXACTLY as it is officially written, letter for letter. A player has to type it back. If the real title has a dropped letter, a contraction or an unusual spelling, pick a different work instead.',
      '- The hint describes the work without naming it or anyone in it. Keep it under 70 characters.',
    );
  } else {
    lines.push(
      '',
      'RIGHTS:',
      '- Do not quote song lyrics, film or television dialogue, advertising copy, or anything written by a known author.',
    );
  }

  if (brief.extraRules?.length) {
    lines.push('', `EXTRA RULES for ${brief.category}:`, ...brief.extraRules.map((r) => `- ${r}`));
  }

  lines.push(
    '',
    'HARD RULES for every hint:',
    '- One short line, 10 to 90 characters, that nudges a player toward the phrase.',
    '- Write it lowercase, as a fragment, with no full stop at the end. It is a caption, not a sentence.',
    '- It must NOT contain any word that appears in the phrase, and no near-variant of one either (no plural, no tense change).',
    '- Describe the phrase sideways: paraphrase the situation using entirely different vocabulary.',
    '- No proper nouns, no profanity, plain ASCII.',
  );

  return lines.join('\n');
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
    ruleBlock(brief),
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
    'Before you write each one, ask: could a player with three letters on the board guess the rest? If not, write a different one.',
    '',
    'Reply with ONLY a JSON array of objects, each with exactly the keys "text" and "hint":',
    '[{"text": "...", "hint": "..."}]',
  );

  return parts.join('\n');
}
