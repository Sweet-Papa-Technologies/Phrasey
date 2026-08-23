/** Types local to the offline corpus pipeline. Nothing here ships to a client. */

export type PuzzleSource = 'generated' | 'public-domain' | 'manual' | 'reference';

/**
 * Rights bucket, so the pop-culture slice can be dropped wholesale.
 *
 * `core`        — original generated observational material plus long-established
 *                 public-domain idioms, proverbs and nursery rhymes.
 * `pop-culture` — film / song / TV titles and generic catchphrases. Titles are
 *                 not protected by copyright, but this tier is the one a lawyer
 *                 might want removed, so it is separable by construction:
 *                 `pnpm --filter @phrasey/corpus-gen cli -- drop --tier pop-culture`.
 *
 * See corpus/SOURCING.md.
 */
export type RightsTier = 'core' | 'pop-culture';

/** A candidate straight off the model, before validation. */
export interface Candidate {
  /** The phrase exactly as generated — casing preserved so proper-noun
   * detection still has something to work with. */
  raw: string;
  /** One-line hint revealed by the CRACK card (§3.5, §4.3). */
  hint: string;
  category: string;
  source?: PuzzleSource;
  rightsTier?: RightsTier;
  rightsNote?: string;
  provider?: string;
}

/** A candidate that passed every validator rule. */
export interface CorpusEntry {
  /** Deterministic id derived from the normalized text — makes seeding idempotent. */
  id: string;
  /** Canonical solution text: uppercase ASCII, punctuation limited to ' - , . ! ? */
  text: string;
  /** Original-cased generation, kept for re-validation of proper nouns. */
  raw: string;
  category: string;
  hint: string;
  difficulty: 1 | 2 | 3;
  source: PuzzleSource;
  /** Which rights bucket this entry belongs to. Defaults to `core`. */
  rightsTier: RightsTier;
  /** One line a human reviewer can read without opening SOURCING.md. */
  rightsNote?: string;
  provider?: string;
  generatedAt: string;
}

/** A rejected candidate, kept for a human skim (§4.3) — never silently dropped. */
export interface RejectedEntry {
  raw: string;
  hint: string;
  category: string;
  /** Every rule that failed, most important first. */
  reasons: string[];
  /** Human-readable detail per reason. */
  details: string[];
  rejectedAt: string;
}
