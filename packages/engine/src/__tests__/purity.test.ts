/**
 * §6.1 / §14 M1: "pure TS rules engine — no I/O, no network, seeded RNG".
 *
 * This is a static guard rather than a runtime one: it reads the engine's own
 * source and fails if anybody reintroduces ambient time, ambient randomness,
 * logging or I/O into the rules path. The simulator CLI is exempt — it is a
 * developer tool that prints to stdout by design.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url).pathname;

const EXEMPT = ['/sim/', '/__tests__/'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!full.endsWith('.ts')) continue;
    if (EXEMPT.some((x) => full.includes(x))) continue;
    out.push(full);
  }
  return out;
}

/** Comments are allowed to name the things the code must not do. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, 'Math.random — use the injected seeded Rng'],
  [/\bDate\.now\b/, 'Date.now — time arrives as the nowMs parameter'],
  [/\bnew Date\b/, 'new Date — time arrives as the nowMs parameter'],
  [/\bperformance\.now\b/, 'performance.now — time arrives as the nowMs parameter'],
  [/\bconsole\.\w+/, 'console.* — the engine never logs'],
  [/\bprocess\.(env|stdout|stderr|argv)\b/, 'process.* — no ambient environment'],
  [/from ['"]node:/, 'node: builtin import — the engine does no I/O'],
  [/\bfetch\s*\(/, 'fetch — no network'],
  [/\brequire\s*\(/, 'require — no dynamic loading'],
];

describe('the engine is pure', () => {
  it('has no ambient time, randomness, logging or I/O anywhere in the rules path', () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(20);
    const offences: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(src)) offences.push(`${file.replace(ROOT, '')}: ${why}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
