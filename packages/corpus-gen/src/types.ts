/** Types local to the offline corpus pipeline. Nothing here ships to a client. */

export type PuzzleSource = 'generated' | 'public-domain' | 'manual';

/** A candidate straight off the model, before validation. */
export interface Candidate {
  /** The phrase exactly as generated — casing preserved so proper-noun
   * detection still has something to work with. */
  raw: string;
  /** One-line hint revealed by the CRACK card (§3.5, §4.3). */
  hint: string;
  category: string;
  source?: PuzzleSource;
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
