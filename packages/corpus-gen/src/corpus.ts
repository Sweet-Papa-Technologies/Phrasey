/** Reading and writing the committed corpus under `corpus/`. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, type Category } from '@phrasey/shared';
import { CORPUS_DIR, REVIEW_QUEUE_PATH, categoryPath, categorySlug } from './paths.js';
import { BRIEFS } from './prompts.js';
import type { Candidate, CorpusEntry, RejectedEntry } from './types.js';
import { CorpusIndex, deriveDifficulty, normalizedHash, type ValidationResult } from './validator.js';

export function ensureCorpusDir(): void {
  if (!existsSync(CORPUS_DIR)) mkdirSync(CORPUS_DIR, { recursive: true });
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  const body = readFileSync(path, 'utf8').trim();
  if (!body) return fallback;
  return JSON.parse(body) as T;
}

function writeJson(path: string, data: unknown): void {
  ensureCorpusDir();
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function loadCategory(category: string): CorpusEntry[] {
  return readJson<CorpusEntry[]>(categoryPath(category), []);
}

export function saveCategory(category: string, entries: CorpusEntry[]): void {
  const sorted = [...entries].sort((a, b) => a.text.localeCompare(b.text));
  writeJson(categoryPath(category), sorted);
}

/** Every category file present on disk, whether or not it is a known category. */
export function corpusFiles(): string[] {
  ensureCorpusDir();
  const known = new Set(CATEGORIES.map((c) => `${categorySlug(c)}.json`));
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json') && known.has(f))
    .map((f) => join(CORPUS_DIR, f));
}

export function loadAll(): CorpusEntry[] {
  return corpusFiles().flatMap((f) => readJson<CorpusEntry[]>(f, []));
}

export function loadByCategory(): Map<string, CorpusEntry[]> {
  const out = new Map<string, CorpusEntry[]>();
  for (const c of CATEGORIES) out.set(c, loadCategory(c));
  return out;
}

export function buildIndex(entries: CorpusEntry[] = loadAll()): CorpusIndex {
  return CorpusIndex.from(entries.map((e) => e.text));
}

export function loadReviewQueue(): RejectedEntry[] {
  return readJson<RejectedEntry[]>(REVIEW_QUEUE_PATH, []);
}

export function saveReviewQueue(rows: RejectedEntry[]): void {
  writeJson(REVIEW_QUEUE_PATH, rows);
}

/** Rejects are appended, never overwritten — §4.3 wants them kept for a skim. */
export function appendReviewQueue(rows: RejectedEntry[]): void {
  if (rows.length === 0) return;
  const existing = loadReviewQueue();
  const seen = new Set(existing.map((r) => `${r.category}::${r.raw}`));
  const merged = [...existing];
  for (const r of rows) {
    const key = `${r.category}::${r.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  saveReviewQueue(merged);
}

export function puzzleId(text: string): string {
  return `p_${normalizedHash(text)}`;
}

export function makeEntry(candidate: Candidate, result: ValidationResult): CorpusEntry {
  const entry: CorpusEntry = {
    id: puzzleId(result.text),
    text: result.text,
    raw: candidate.raw.trim(),
    category: candidate.category,
    hint: candidate.hint.trim(),
    difficulty: deriveDifficulty(result.text, {
      recalled: isCategory(candidate.category) ? BRIEFS[candidate.category].recalled === true : false,
    }),
    source: candidate.source ?? 'generated',
    rightsTier: candidate.rightsTier ?? 'core',
    generatedAt: new Date().toISOString(),
  };
  if (candidate.rightsNote) entry.rightsNote = candidate.rightsNote;
  if (candidate.provider) entry.provider = candidate.provider;
  return entry;
}

export function makeRejection(candidate: Candidate, result: ValidationResult): RejectedEntry {
  return {
    raw: candidate.raw.trim(),
    hint: candidate.hint.trim(),
    category: candidate.category,
    reasons: result.failures.map((f) => f.reason),
    details: result.failures.map((f) => `${f.reason}: ${f.detail}`),
    rejectedAt: new Date().toISOString(),
  };
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
