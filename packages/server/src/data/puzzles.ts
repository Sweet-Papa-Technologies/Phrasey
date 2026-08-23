/**
 * The puzzle corpus (§6.4 `/puzzles`).
 *
 * Puzzles are static, so the whole active set is read once at boot and held in
 * memory. Nothing about a puzzle is ever sent to a client except its category
 * (via `maskBoard`) and, after CRACK, its hint.
 *
 * If Firestore is unreachable the engine's `TEST_PUZZLES` fixtures take over,
 * so `pnpm dev` works on a plane.
 */
import type { Puzzle } from '@phrasey/shared';
import { letterStats, normalizePuzzleText } from '@phrasey/shared';
import { TEST_PUZZLES } from '@phrasey/engine';
import type { Firestore } from './firestore.js';
import type { Logger } from '../logger.js';

export interface PuzzleSource {
  readonly size: number;
  readonly origin: 'firestore' | 'fixtures';
  /**
   * The whole active pool. Handed to the bots as §5's "corpus subset" so their
   * deduction is real; it never goes anywhere near a socket.
   */
  readonly all: readonly Puzzle[];
  /**
   * Pick a puzzle not yet used in this match. `rand` is [0,1) so the caller can
   * supply the room's seeded stream and keep a match reproducible.
   */
  pick(usedIds: readonly string[], rand: () => number): Puzzle;
  byId(id: string): Puzzle | undefined;
}

/** Reject anything that would break the engine or the board renderer. */
function sanitize(id: string, raw: Record<string, unknown>): Puzzle | null {
  const text = typeof raw.text === 'string' ? normalizePuzzleText(raw.text) : '';
  if (text.length < 3) return null;
  if (!/^[A-Z0-9 '\-,.!?]+$/.test(text)) return null;
  const category = typeof raw.category === 'string' ? raw.category : 'Phrasey';
  const hint = typeof raw.hint === 'string' ? raw.hint : '';
  const difficultyRaw = Number(raw.difficulty);
  const difficulty = ([1, 2, 3] as const).includes(difficultyRaw as 1 | 2 | 3) ? (difficultyRaw as 1 | 2 | 3) : 2;
  return {
    id,
    text,
    category,
    hint,
    difficulty,
    // Recomputed rather than trusted: the stored copy is a denormalization.
    letterStats: letterStats(text),
    active: raw.active !== false,
    source: (raw.source as Puzzle['source']) ?? 'generated',
  };
}

function makeSource(puzzles: Puzzle[], origin: PuzzleSource['origin']): PuzzleSource {
  const byId = new Map(puzzles.map((p) => [p.id, p]));
  return {
    size: puzzles.length,
    origin,
    all: puzzles,
    byId: (id) => byId.get(id),
    pick(usedIds, rand) {
      const used = new Set(usedIds);
      // No repeats within a match; once the corpus is exhausted, start over.
      const pool = puzzles.filter((p) => !used.has(p.id));
      const from = pool.length > 0 ? pool : puzzles;
      const idx = Math.min(from.length - 1, Math.max(0, Math.floor(rand() * from.length)));
      return from[idx] as Puzzle;
    },
  };
}

export async function loadPuzzles(db: Firestore | null, log: Logger): Promise<PuzzleSource> {
  if (db) {
    try {
      const snap = await db.collection('puzzles').where('active', '==', true).get();
      const out: Puzzle[] = [];
      let rejected = 0;
      for (const doc of snap.docs) {
        const p = sanitize(doc.id, doc.data() as Record<string, unknown>);
        if (p) out.push(p);
        else rejected++;
      }
      if (out.length > 0) {
        // Deliberately does not log any puzzle text (§11).
        log.info({ loaded: out.length, rejected }, 'puzzle corpus loaded from firestore');
        return makeSource(out, 'firestore');
      }
      log.warn('firestore /puzzles returned nothing usable; falling back to fixtures');
    } catch (err) {
      log.warn({ err: String(err) }, 'puzzle load failed; falling back to fixtures');
    }
  }
  log.info({ loaded: TEST_PUZZLES.length }, 'puzzle corpus loaded from engine fixtures');
  return makeSource([...TEST_PUZZLES], 'fixtures');
}
