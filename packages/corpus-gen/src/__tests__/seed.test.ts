/**
 * Seeding contract (§6.4): the document shape the server reads, and the
 * idempotency that makes re-seeding an update rather than a duplicate.
 */
import { describe, expect, it } from 'vitest';
import { puzzleId } from '../corpus.js';
import { seedPuzzles, toPuzzleDoc } from '../seed.js';
import type { CorpusEntry } from '../types.js';
import { deriveDifficulty } from '../validator.js';

function entry(text: string, over: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    id: puzzleId(text),
    text,
    raw: text,
    category: 'Grocery list',
    hint: 'a plausible one line nudge',
    difficulty: deriveDifficulty(text),
    source: 'generated',
    rightsTier: 'core',
    generatedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

describe('toPuzzleDoc', () => {
  const doc = toPuzzleDoc(entry('MILK, EGGS, AND WHATEVER THAT SMELL IS'));

  it('emits exactly the §6.4 puzzle fields', () => {
    expect(Object.keys(doc).sort()).toEqual(
      ['active', 'category', 'difficulty', 'hint', 'id', 'letterStats', 'rightsTier', 'source', 'text', 'updatedAt'].sort(),
    );
  });
  it('marks the puzzle active', () => {
    expect(doc.active).toBe(true);
  });
  it('records the source', () => {
    expect(doc.source).toBe('generated');
    expect(toPuzzleDoc(entry('A WATCHED POT NEVER BOILS', { source: 'public-domain' })).source).toBe('public-domain');
  });
  it('precomputes letterStats so the runtime never has to', () => {
    expect(doc.letterStats.M).toBe(2);
    expect(doc.letterStats.L).toBe(3);
    expect(doc.letterStats[' ']).toBeUndefined();
    expect(doc.letterStats[',']).toBeUndefined();
  });
  it('derives a difficulty of 1, 2 or 3', () => {
    expect([1, 2, 3]).toContain(doc.difficulty);
  });
});

describe('idempotency', () => {
  it('derives the same document id from the same phrase', () => {
    expect(toPuzzleDoc(entry('WHY IS THERE A SECOND FRIDGE')).id).toBe(
      toPuzzleDoc(entry('why is there a second fridge?!')).id,
    );
  });
  it('collapses duplicate entries onto one document', async () => {
    const result = await seedPuzzles([entry('WHY IS THERE A SECOND FRIDGE'), entry('WHY IS THERE A SECOND FRIDGE!')], {
      projectId: 'test',
      databaseId: 'test',
      dryRun: true,
    });
    expect(result.docs).toHaveLength(1);
  });
});

describe('dry run', () => {
  it('writes nothing and never touches GCP', async () => {
    const result = await seedPuzzles([entry('ADD MORE SALT TO THE POT')], {
      projectId: 'fofoapps-934be',
      databaseId: 'phrasey',
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.written).toBe(0);
    expect(result.docs).toHaveLength(1);
  });
});
