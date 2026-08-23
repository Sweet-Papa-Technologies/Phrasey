/**
 * Filesystem anchors for the corpus-gen package.
 *
 * Everything here resolves relative to the package root (the directory holding
 * package.json) rather than to the module's own directory, so the same code
 * works when run from `src/` under tsx and from `dist/` after a build.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate package root from ${start}`);
}

export const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Bundled wordlists: profanity, proper-noun lexicon, allowlist. */
export const DATA_DIR = resolve(PKG_ROOT, 'data');

/** Committed corpus output. */
export const CORPUS_DIR = resolve(PKG_ROOT, 'corpus');

export const FIXTURES_DIR = resolve(CORPUS_DIR, 'fixtures');

export const REVIEW_QUEUE_PATH = resolve(CORPUS_DIR, 'review-queue.json');

/** `Grocery list` -> `grocery-list.json` */
export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function categoryPath(category: string): string {
  return join(CORPUS_DIR, `${categorySlug(category)}.json`);
}
