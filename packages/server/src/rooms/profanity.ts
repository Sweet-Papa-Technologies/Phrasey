/**
 * Room-code profanity screen (design doc §6.6: "Screen generated codes against
 * a profanity list").
 *
 * PROVENANCE: `words` and `substrings` are a verbatim copy of
 * `packages/corpus-gen/data/profanity.json`. They are copied, not imported:
 * corpus-gen is an offline CLI and the runtime server must not depend on it.
 * `profanity.test.ts` re-reads that JSON at test time and fails if this file
 * has drifted out of sync, so the copy cannot silently rot.
 *
 * `CVCV_SUPPLEMENT` covers strings that only ever appear as a 4-character
 * consonant-vowel-consonant-vowel room code, which the corpus list has no
 * reason to carry (it screens English phrases, not four-letter codes).
 */

/** Verbatim from corpus-gen/data/profanity.json → `words`. */
export const PROFANITY_WORDS: readonly string[] = [
  'anal', 'anus', 'arse', 'arsehole', 'ass', 'asses', 'asshat', 'asshole',
  'assholes', 'ballsack', 'bastard', 'bastards', 'bellend', 'bitch', 'bitches', 'bitchy',
  'blowjob', 'bollocks', 'boner', 'boob', 'boobs', 'bugger', 'bukkake', 'bullshit',
  'butthole', 'clit', 'clitoris', 'cock', 'cocks', 'cocksucker', 'coon', 'coons',
  'crap', 'crappy', 'cum', 'cumming', 'cunt', 'cunts', 'dick', 'dickhead',
  'dicks', 'dildo', 'dipshit', 'douche', 'douchebag', 'dyke', 'ejaculate', 'erection',
  'fag', 'faggot', 'faggots', 'fags', 'fanny', 'fellatio', 'fuck', 'fucked',
  'fucker', 'fuckers', 'fucking', 'fucks', 'fuk', 'gangbang', 'goddamn', 'gook',
  'handjob', 'hentai', 'homo', 'horny', 'jackass', 'jerkoff', 'jism', 'jizz',
  'kike', 'kunt', 'labia', 'masturbate', 'masturbation', 'milf', 'molest', 'motherfucker',
  'motherfucking', 'nigga', 'niggas', 'nigger', 'niggers', 'nipple', 'nipples', 'nutsack',
  'paki', 'pedo', 'pedophile', 'penis', 'phallic', 'piss', 'pissed', 'pissing',
  'porn', 'porno', 'pornography', 'prick', 'pube', 'pubes', 'pussies', 'pussy',
  'queer', 'rape', 'raped', 'rapist', 'retard', 'retarded', 'rimjob', 'scrotum',
  'semen', 'sex', 'sexual', 'sexy', 'shit', 'shite', 'shits', 'shitting',
  'shitty', 'skank', 'slut', 'sluts', 'smegma', 'spic', 'spunk', 'testicle',
  'testicles', 'tit', 'tits', 'titties', 'titty', 'tranny', 'turd', 'twat',
  'vagina', 'viagra', 'vulva', 'wank', 'wanker', 'whore', 'whores', 'wop',
];

/** Verbatim from corpus-gen/data/profanity.json → `substrings`. */
export const PROFANITY_SUBSTRINGS: readonly string[] = [
  'asshole', 'bullshit', 'cocksuck', 'cunt', 'dickhead', 'faggot', 'fuck', 'motherfuck',
  'nigga', 'nigger', 'shithead',
];

/**
 * CVCV-shaped strings the corpus list does not carry because they are not
 * English words in running text, but which would be unpleasant to read out as
 * a room code. Slurs, ethnic shorthand, and obvious misspellings of the above.
 */
export const CVCV_SUPPLEMENT: readonly string[] = [
  'nazi', 'kuni', 'fuko', 'fuku', 'fuka', 'fugu', 'puta', 'pusi',
  'pusa', 'dego', 'dago', 'gubo', 'gogo', 'jigo', 'koki', 'kuku',
  'kaka', 'kike', 'lezo', 'lezi', 'mofo', 'muzo', 'nigo', 'niga',
  'pedo', 'peni', 'poki', 'rapa', 'rapo', 'homo', 'hobo', 'gimp',
  'lebo', 'zibi', 'bimo', 'bofa', 'dike', 'diko', 'dodo', 'gash',
  'gipo', 'gypo', 'hoji', 'jape', 'jigi', 'kafi', 'mome', 'pape',
  'pima', 'puke', 'raho', 'sepo', 'tato', 'titi', 'tuki', 'vaji',
  'vago', 'zipo',
];

const BANNED: ReadonlySet<string> = new Set<string>([
  ...PROFANITY_WORDS,
  ...CVCV_SUPPLEMENT,
]);

/**
 * True when `code` must never be handed out as a room code.
 *
 * Exact-word match against the copied list plus the CVCV supplement, and a
 * substring match against the terms that have no innocent English host word.
 * Case-insensitive; room codes are uppercase on the wire.
 */
export function isProfaneCode(code: string): boolean {
  const c = code.toLowerCase();
  if (BANNED.has(c)) return true;
  return PROFANITY_SUBSTRINGS.some((s) => c.includes(s));
}
