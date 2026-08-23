/**
 * Seeds the validated corpus into Firestore `/puzzles/{puzzleId}` (§6.4).
 *
 * `letterStats` and `difficulty` are computed here so the runtime never has to,
 * and the document id is derived from the normalized text, which makes
 * re-seeding an update rather than a duplicate.
 *
 * NOTE (§6.2): puzzle text living in Firestore is fine — only the *server*
 * reads this collection. Nothing here is exposed to a client SDK.
 */
import { letterStats } from '@phrasey/shared';
import { puzzleId } from './corpus.js';
import type { CorpusEntry, PuzzleSource, RightsTier } from './types.js';
import { deriveDifficulty } from './validator.js';

export interface PuzzleDoc {
  id: string;
  text: string;
  category: string;
  hint: string;
  difficulty: 1 | 2 | 3;
  letterStats: Record<string, number>;
  active: boolean;
  /**
   * NOTE: `'reference'` (a film / song / TV title) is wider than
   * `@phrasey/shared`'s `Puzzle['source']`, which still lists only the original
   * three. The server casts rather than narrowing, so nothing breaks, but
   * whoever owns `packages/shared` should widen that union to match. Flagged in
   * corpus/SOURCING.md.
   */
  source: PuzzleSource;
  /** `core` or `pop-culture` — lets a whole rights tier be deactivated in place. */
  rightsTier: RightsTier;
  rightsNote?: string;
  updatedAt: string;
}

export function toPuzzleDoc(entry: CorpusEntry): PuzzleDoc {
  return {
    id: entry.id || puzzleId(entry.text),
    text: entry.text,
    category: entry.category,
    hint: entry.hint,
    difficulty: entry.difficulty ?? deriveDifficulty(entry.text),
    letterStats: letterStats(entry.text),
    active: true,
    source: entry.source ?? 'generated',
    rightsTier: entry.rightsTier ?? 'core',
    ...(entry.rightsNote ? { rightsNote: entry.rightsNote } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export interface SeedOptions {
  projectId: string;
  databaseId: string;
  dryRun: boolean;
  batchSize?: number;
  /**
   * Set `active: false` on every puzzle already in Firestore that is no longer
   * in the corpus.
   *
   * Without this, `merge: true` makes a removal invisible: a puzzle pulled from
   * the corpus for being unguessable, or a whole rights tier dropped, keeps
   * serving to live games forever. Deactivation rather than deletion keeps the
   * document around for the audit trail.
   */
  deactivateMissing?: boolean;
  onLog?: (line: string) => void;
}

export interface SeedResult {
  docs: PuzzleDoc[];
  written: number;
  /** Puzzle ids flipped to `active: false` because they left the corpus. */
  deactivated: string[];
  dryRun: boolean;
}

/** Firestore's hard limit is 500 writes per batch; stay under it. */
const DEFAULT_BATCH = 400;

export async function seedPuzzles(entries: CorpusEntry[], opts: SeedOptions): Promise<SeedResult> {
  const {
    projectId,
    databaseId,
    dryRun,
    batchSize = DEFAULT_BATCH,
    deactivateMissing = false,
    onLog = () => {},
  } = opts;

  // De-duplicate by id: two identical phrases in different category files must
  // not fight over the same document.
  const byId = new Map<string, PuzzleDoc>();
  for (const e of entries) {
    const doc = toPuzzleDoc(e);
    byId.set(doc.id, doc);
  }
  const docs = [...byId.values()];

  if (dryRun) {
    onLog(`[dry-run] would write ${docs.length} docs to projects/${projectId}/databases/${databaseId}/puzzles`);
    return { docs, written: 0, deactivated: [], dryRun: true };
  }

  // Imported lazily so `--dry-run` and the unit tests never touch GCP.
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore({ projectId, databaseId });
  const col = db.collection('puzzles');

  let written = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const slice = docs.slice(i, i + batchSize);
    const batch = db.batch();
    for (const doc of slice) {
      const { id, ...rest } = doc;
      // merge:true — idempotent update, and it will not clobber fields another
      // system may have added to an existing puzzle document.
      batch.set(col.doc(id), rest, { merge: true });
    }
    await batch.commit();
    written += slice.length;
    onLog(`  wrote ${written}/${docs.length}`);
  }

  const deactivated: string[] = [];
  if (deactivateMissing) {
    const live = await col.where('active', '==', true).select().get();
    const stale = live.docs.map((d) => d.id).filter((id) => !byId.has(id));
    for (let i = 0; i < stale.length; i += batchSize) {
      const slice = stale.slice(i, i + batchSize);
      const batch = db.batch();
      for (const id of slice) batch.set(col.doc(id), { active: false, updatedAt: new Date().toISOString() }, { merge: true });
      await batch.commit();
      deactivated.push(...slice);
    }
    if (deactivated.length > 0) onLog(`  deactivated ${deactivated.length} puzzles no longer in the corpus`);
  }

  await db.terminate();
  return { docs, written, deactivated, dryRun: false };
}
