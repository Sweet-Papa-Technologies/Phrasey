/**
 * The corpus grows (corpus-gen seed). Before this, a running server held the
 * set it read at boot forever, so seeding 597 puzzles left the live game
 * serving 209 and the only symptom was that nothing changed.
 */
import { describe, expect, it, vi } from 'vitest';
import { refreshing, type PuzzleSource } from '../data/puzzles.js';
import type { Logger } from '../logger.js';
import type { Puzzle } from '@phrasey/shared';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => log } as unknown as Logger;

function puzzle(id: string): Puzzle {
  return { id, text: 'A WATCHED POT NEVER BOILS', category: 'Idiom / proverb', hint: 'h',
           difficulty: 1, letterStats: {}, active: true, source: 'generated' };
}

function source(ids: string[], origin: PuzzleSource['origin'] = 'firestore'): PuzzleSource {
  const ps = ids.map(puzzle);
  return {
    size: ps.length, origin, all: ps,
    byId: (id) => ps.find((p) => p.id === id),
    pick: () => ps[0]!,
  };
}

/** A fake Firestore whose `get()` returns whatever the test queues up next. */
function fakeDb(pages: Array<{ docs: Array<{ id: string; data: () => unknown }> } | Error>) {
  let i = 0;
  return {
    collection: () => ({
      where: () => ({
        get: async () => {
          const next = pages[Math.min(i++, pages.length - 1)]!;
          if (next instanceof Error) throw next;
          return next;
        },
      }),
    }),
  } as never;
}

function docs(ids: string[]) {
  return {
    docs: ids.map((id) => ({
      id,
      data: () => ({ text: 'A WATCHED POT NEVER BOILS', category: 'c', hint: 'h', difficulty: 1, active: true }),
    })),
  };
}

describe('refreshing puzzle source', () => {
  it('serves the initial corpus and does not refresh while fresh', async () => {
    const t = { now: 1000 };
    const db = fakeDb([docs(['a', 'b', 'c'])]);
    const s = refreshing(source(['a']), db, log, { refreshMs: 60_000, now: () => t.now });

    expect(s.size).toBe(1);
    s.pick([], () => 0);
    await Promise.resolve();
    expect(s.size).toBe(1); // still inside the window
  });

  it('picks up a grown corpus once stale', async () => {
    const t = { now: 1000 };
    const db = fakeDb([docs(['a', 'b', 'c', 'd'])]);
    const s = refreshing(source(['a']), db, log, { refreshMs: 60_000, now: () => t.now });

    t.now += 61_000;
    s.pick([], () => 0);      // notices staleness, kicks off a reload
    await s.refresh();        // await the in-flight one
    expect(s.size).toBe(4);
    expect(s.byId('d')).toBeDefined();
  });

  it('keeps the current corpus when a refresh throws', async () => {
    const t = { now: 1000 };
    const db = fakeDb([new Error('firestore is having a day')]);
    const s = refreshing(source(['a', 'b']), db, log, { refreshMs: 1, now: () => t.now });

    t.now += 10;
    await s.refresh();
    expect(s.size).toBe(2);
    expect(s.origin).toBe('firestore');
  });

  it('never trades a working corpus for the fixture fallback', async () => {
    // An empty read makes loadPuzzles fall back to fixtures. A live game must
    // not silently swap its real corpus for test data.
    const t = { now: 1000 };
    const db = fakeDb([docs([])]);
    const s = refreshing(source(['a', 'b', 'c']), db, log, { refreshMs: 1, now: () => t.now });

    t.now += 10;
    await s.refresh();
    expect(s.size).toBe(3);
    expect(s.origin).toBe('firestore');
  });

  it('does not stack concurrent reloads', async () => {
    const t = { now: 1000 };
    let gets = 0;
    const db = {
      collection: () => ({
        where: () => ({
          get: async () => {
            gets++;
            await new Promise((r) => setTimeout(r, 5));
            return docs(['a', 'b']);
          },
        }),
      }),
    } as never;
    const s = refreshing(source(['a']), db, log, { refreshMs: 1, now: () => t.now });

    t.now += 10;
    await Promise.all([s.refresh(), s.refresh(), s.refresh()]);
    expect(gets).toBe(1);
  });

  it('is inert with no database, so offline dev keeps its fixtures', async () => {
    const s = refreshing(source(['a'], 'fixtures'), null, log, { refreshMs: 1 });
    await s.refresh();
    expect(s.size).toBe(1);
    expect(s.origin).toBe('fixtures');
  });
});
