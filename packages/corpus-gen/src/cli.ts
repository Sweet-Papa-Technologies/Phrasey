#!/usr/bin/env node
/**
 * phrasey-corpus — offline puzzle generation CLI (design doc §4.3).
 *
 * The runtime never calls a model. Everything an LLM touches happens here, and
 * what it produces is a reviewed artifact committed to git.
 */
import { Command } from 'commander';
import { CATEGORIES, type Category } from '@phrasey/shared';
import {
  appendReviewQueue,
  buildIndex,
  isCategory,
  loadAll,
  loadByCategory,
  loadCategory,
  loadReviewQueue,
  makeEntry,
  makeRejection,
  saveCategory,
  saveReviewQueue,
} from './corpus.js';
import { generateCategory, pool } from './generate.js';
import { allocate, BRIEFS } from './prompts.js';
import { makeProvider, PROVIDER_NAMES } from './providers/index.js';
import { seedPuzzles } from './seed.js';
import { computeStats, formatStats } from './stats.js';
import type { Candidate, CorpusEntry, RejectedEntry } from './types.js';
import { CorpusIndex, validateCandidate } from './validator.js';

const program = new Command();

program
  .name('phrasey-corpus')
  .description('Offline puzzle corpus generation, validation and seeding for Phrasey')
  .version('0.1.0');

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

program
  .command('generate')
  .description('Generate and validate puzzles, writing corpus/<category>.json')
  .requiredOption('-c, --category <c>', 'a category name, or "all"')
  .requiredOption('-n, --count <n>', 'validated puzzles to add (total across categories when --category all)', (v) => parseInt(v, 10))
  .option('-p, --provider <p>', `model provider: ${PROVIDER_NAMES.join(' | ')}`, 'infinity')
  .option('--concurrency <n>', 'categories generated in parallel', (v) => parseInt(v, 10), 3)
  .option('--batch-size <n>', 'phrases requested per model call', (v) => parseInt(v, 10), 15)
  .option('--max-rounds <n>', 'model calls per category before giving up', (v) => parseInt(v, 10), 6)
  .action(async (opts: { category: string; count: number; provider: string; concurrency: number; batchSize: number; maxRounds: number }) => {
    const provider = makeProvider(opts.provider);

    let targets: { category: Category; count: number }[];
    if (opts.category === 'all') {
      targets = allocate(opts.count);
    } else {
      if (!isCategory(opts.category)) {
        console.error(`Unknown category "${opts.category}".\nKnown categories:\n  ${CATEGORIES.join('\n  ')}`);
        process.exitCode = 1;
        return;
      }
      targets = [{ category: opts.category, count: opts.count }];
    }

    const existingByCategory = loadByCategory();
    const index = buildIndex(loadAll());
    console.log(
      `Provider: ${provider.name} | corpus already holds ${index.size} phrases | targeting ${targets.reduce((n, t) => n + t.count, 0)} new across ${targets.length} categor${targets.length === 1 ? 'y' : 'ies'}`,
    );
    for (const t of targets) {
      console.log(`  ${t.category.padEnd(36)} +${t.count} (weight ${BRIEFS[t.category].weight}, source ${BRIEFS[t.category].source})`);
    }
    console.log('');

    const started = Date.now();
    const outcomes = await pool(targets, opts.concurrency, async (t) => {
      const existing = (existingByCategory.get(t.category) ?? []).map((e) => e.text);
      return generateCategory({
        provider,
        category: t.category,
        target: t.count,
        index,
        existing,
        batchSize: opts.batchSize,
        maxRounds: opts.maxRounds,
        onLog: (line) => console.log(line),
      });
    });

    let accepted = 0;
    let rejected = 0;
    let produced = 0;
    const allRejects: RejectedEntry[] = [];
    for (const o of outcomes) {
      if (o.accepted.length > 0) {
        const merged = [...(existingByCategory.get(o.category) ?? []), ...o.accepted];
        saveCategory(o.category, merged);
      }
      accepted += o.accepted.length;
      rejected += o.rejected.length;
      produced += o.produced;
      allRejects.push(...o.rejected);
    }
    appendReviewQueue(allRejects);

    console.log('');
    console.log(
      `Done in ${((Date.now() - started) / 1000).toFixed(0)}s: ${produced} produced, ${accepted} accepted, ${rejected} rejected (${produced ? ((rejected / produced) * 100).toFixed(0) : 0}% reject rate)`,
    );
    console.log(reasonHistogram(allRejects));
    console.log(`Corpus now holds ${loadAll().length} validated puzzles.`);
  });

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

program
  .command('validate')
  .description('Re-run the validator over the committed corpus; rejects go to corpus/review-queue.json with their reason')
  .option('--fix', 'rewrite the category files with the rejected entries removed', false)
  .action((opts: { fix: boolean }) => {
    const byCategory = loadByCategory();
    // Rebuilt incrementally so an entry is only ever compared against entries
    // ahead of it — otherwise every phrase is a duplicate of itself.
    const index = new CorpusIndex();
    let kept = 0;
    const rejects: RejectedEntry[] = [];
    const keptByCategory = new Map<string, CorpusEntry[]>();

    for (const [category, entries] of byCategory) {
      const survivors: CorpusEntry[] = [];
      for (const entry of entries) {
        const candidate: Candidate = {
          raw: entry.raw || entry.text,
          hint: entry.hint,
          category,
          source: entry.source,
        };
        const result = validateCandidate(candidate, { index });
        if (result.ok) {
          index.add(result.text);
          survivors.push(makeEntry(candidate, result));
          kept++;
        } else {
          rejects.push(makeRejection(candidate, result));
          console.log(`REJECT [${category}] "${entry.text}"`);
          for (const f of result.failures) console.log(`         ${f.reason}: ${f.detail}`);
        }
      }
      keptByCategory.set(category, survivors);
    }

    appendReviewQueue(rejects);
    if (opts.fix) {
      for (const [category, survivors] of keptByCategory) {
        if (byCategory.get(category)?.length) saveCategory(category, survivors);
      }
      console.log('\nCategory files rewritten with rejects removed.');
    }

    const total = kept + rejects.length;
    console.log('');
    console.log(`Validated ${total} entries: ${kept} pass, ${rejects.length} rejected.`);
    console.log(reasonHistogram(rejects));
    console.log(`Review queue: ${loadReviewQueue().length} entries at corpus/review-queue.json`);
    if (rejects.length > 0 && !opts.fix) process.exitCode = 1;
  });

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

program
  .command('stats')
  .description('Corpus size per category, difficulty spread and letter distribution')
  .option('--json', 'emit JSON instead of a table', false)
  .action((opts: { json: boolean }) => {
    const stats = computeStats(loadAll());
    if (opts.json) console.log(JSON.stringify(stats, null, 2));
    else console.log(formatStats(stats));
  });

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

program
  .command('seed')
  .description('Seed /puzzles/{puzzleId} in Firestore. Idempotent — re-seeding updates in place.')
  .requiredOption('--project <id>', 'GCP project id')
  .option('--database <id>', 'Firestore named database', 'phrasey')
  .option('--dry-run', 'print what would be written and touch nothing', false)
  .option('--category <c>', 'seed one category only')
  .option('--limit <n>', 'seed at most n puzzles', (v) => parseInt(v, 10))
  .action(async (opts: { project: string; database: string; dryRun: boolean; category?: string; limit?: number }) => {
    let entries = opts.category ? loadCategory(opts.category) : loadAll();
    if (opts.limit) entries = entries.slice(0, opts.limit);
    if (entries.length === 0) {
      console.error('Nothing to seed — the corpus is empty.');
      process.exitCode = 1;
      return;
    }

    try {
      const result = await seedPuzzles(entries, {
        projectId: opts.project,
        databaseId: opts.database,
        dryRun: opts.dryRun,
        onLog: (l) => console.log(l),
      });
      if (result.dryRun) {
        console.log('');
        for (const doc of result.docs.slice(0, 3)) {
          console.log(JSON.stringify(doc, null, 2));
        }
        if (result.docs.length > 3) console.log(`... and ${result.docs.length - 3} more`);
        console.log('');
        console.log(`[dry-run] ${result.docs.length} puzzle documents ready. No writes performed.`);
      } else {
        console.log(`Seeded ${result.written} puzzles to projects/${opts.project}/databases/${opts.database}.`);
      }
    } catch (err) {
      console.error(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error('If the named database does not exist yet, create it (Terraform) and re-run — this command is idempotent.');
      process.exitCode = 1;
    }
  });

// ---------------------------------------------------------------------------

function reasonHistogram(rejects: RejectedEntry[]): string {
  if (rejects.length === 0) return 'No rejections.';
  const counts = new Map<string, number>();
  for (const r of rejects) {
    for (const reason of r.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ['Rejection reasons:', ...rows.map(([reason, n]) => `  ${reason.padEnd(24)} ${n}`)].join('\n');
}

// Only parse when actually run as a program, so importing the module in a test
// does not execute the CLI.
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
