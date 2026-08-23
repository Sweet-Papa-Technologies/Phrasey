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
import { allocate, BRIEFS, POP_CULTURE_CATEGORIES } from './prompts.js';
import { makeProvider, PROVIDER_NAMES } from './providers/index.js';
import { seedPuzzles } from './seed.js';
import { computeStats, formatStats } from './stats.js';
import type { Candidate, CorpusEntry, RejectedEntry } from './types.js';
import { CorpusIndex, RULES, triage, validateCandidate } from './validator.js';
import type { RightsTier } from './types.js';
import { unlinkSync, existsSync } from 'node:fs';
import { categoryPath } from './paths.js';

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
  .option(
    '--max-length <n>',
    `length ceiling for NEW phrases (the validator's hard cap stays at ${RULES.MAX_LENGTH})`,
    (v) => parseInt(v, 10),
    RULES.TARGET_MAX_LENGTH,
  )
  .option('--tier <t>', 'restrict --category all to one rights tier: core | pop-culture')
  .action(async (opts: { category: string; count: number; provider: string; concurrency: number; batchSize: number; maxRounds: number; maxLength: number; tier?: string }) => {
    const provider = makeProvider(opts.provider);

    let targets: { category: Category; count: number }[];
    if (opts.category === 'all') {
      targets = allocate(opts.count, opts.tier as RightsTier | undefined);
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
        maxLength: opts.maxLength,
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
        const brief = isCategory(category) ? BRIEFS[category] : undefined;
        // Rights metadata is taken from the brief, not from the file, so a
        // re-validate repairs entries written before a brief changed.
        const candidate: Candidate = {
          raw: entry.raw || entry.text,
          hint: entry.hint,
          category,
          source: brief?.source ?? entry.source,
          rightsTier: brief?.rightsTier ?? entry.rightsTier ?? 'core',
          ...(brief?.rightsNote ? { rightsNote: brief.rightsNote } : {}),
          // Preserved, or a re-validate silently erases which model wrote it.
          ...(entry.provider ? { provider: entry.provider } : {}),
        };
        const result = validateCandidate(candidate, {
          index,
          ...(brief?.commonWordFloor !== undefined ? { commonWordFloor: brief.commonWordFloor } : {}),
          ...(brief?.maxUncommonWords !== undefined ? { maxUncommonWords: brief.maxUncommonWords } : {}),
        });
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
  .option('--tier <t>', 'seed one rights tier only: core | pop-culture')
  .option('--limit <n>', 'seed at most n puzzles', (v) => parseInt(v, 10))
  .option(
    '--deactivate-missing',
    'set active:false on live puzzles no longer in the corpus. Without it, merge-seeding leaves removed puzzles serving forever.',
    false,
  )
  .action(async (opts: { project: string; database: string; dryRun: boolean; category?: string; tier?: string; limit?: number; deactivateMissing: boolean }) => {
    let entries = opts.category ? loadCategory(opts.category) : loadAll();
    if (opts.tier) entries = entries.filter((e) => (e.rightsTier ?? 'core') === opts.tier);
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
        // Only safe when seeding the whole corpus — a filtered seed would
        // deactivate everything outside the filter.
        deactivateMissing: opts.deactivateMissing && !opts.category && !opts.tier && !opts.limit,
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
        if (result.deactivated.length > 0) {
          console.log(`Deactivated ${result.deactivated.length} puzzles that are no longer in the corpus.`);
        } else if (opts.deactivateMissing && (opts.category || opts.tier || opts.limit)) {
          console.log('--deactivate-missing ignored: it is only safe on a full-corpus seed.');
        }
      }
    } catch (err) {
      console.error(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error('If the named database does not exist yet, create it (Terraform) and re-run — this command is idempotent.');
      process.exitCode = 1;
    }
  });

// ---------------------------------------------------------------------------
// triage — move the abstract tail to the review queue
// ---------------------------------------------------------------------------

program
  .command('triage')
  .description(
    'Shortlist committed entries that pass the validator but are unlikely to be fun to guess, and move them to the review queue with a reason. Nothing is deleted.',
  )
  .option('--max-length <n>', 'flag entries longer than this', (v) => parseInt(v, 10), RULES.TARGET_MAX_LENGTH)
  // Default 3 = off. Difficulty is a *spread* to keep, not a bar to clear: the
  // corpus should skew easy, and it does, but a run of hard boards is still
  // worth having. Length and the surreal-tautology register are what triage is
  // actually for. Pass --max-difficulty 2 to build a strictly-easy set.
  .option('--max-difficulty <n>', 'flag entries above this difficulty (3 = off)', (v) => parseInt(v, 10) as 1 | 2 | 3, 3)
  .option('--no-register', 'skip the self-referential / abstract-vocabulary checks')
  .option('--apply', 'actually rewrite the category files; without it this is a report', false)
  .action((opts: { maxLength: number; maxDifficulty: 1 | 2 | 3; register: boolean; apply: boolean }) => {
    const byCategory = loadByCategory();
    const moved: RejectedEntry[] = [];
    const keptByCategory = new Map<string, CorpusEntry[]>();
    let kept = 0;

    for (const [category, entries] of byCategory) {
      const survivors: CorpusEntry[] = [];
      for (const entry of entries) {
        const brief = isCategory(category) ? BRIEFS[category] : undefined;
        const verdict = triage(entry.text, {
          maxLength: opts.maxLength,
          maxDifficulty: opts.maxDifficulty,
          checkRegister: opts.register,
          recalled: brief?.recalled === true,
        });
        if (verdict.flagged) {
          moved.push({
            raw: entry.raw || entry.text,
            hint: entry.hint,
            category,
            reasons: ['MANUAL_REVIEW_GUESSABILITY'],
            details: verdict.reasons,
            rejectedAt: new Date().toISOString(),
          });
          console.log(`FLAG [${category}] "${entry.text}"`);
          for (const r of verdict.reasons) console.log(`       ${r}`);
        } else {
          survivors.push(entry);
          kept++;
        }
      }
      keptByCategory.set(category, survivors);
    }

    if (opts.apply) {
      appendReviewQueue(moved);
      for (const [category, survivors] of keptByCategory) {
        if (byCategory.get(category)?.length) saveCategory(category, survivors);
      }
    }

    console.log('');
    console.log(
      `${kept} entries hold up, ${moved.length} flagged.` +
        (opts.apply ? ' Flagged entries moved to corpus/review-queue.json.' : ' Dry run — pass --apply to move them.'),
    );
  });

// ---------------------------------------------------------------------------
// drop — remove a whole rights tier in one command
// ---------------------------------------------------------------------------

program
  .command('drop')
  .description('Delete every category file in a rights tier. The lever a legal review needs (see corpus/SOURCING.md).')
  .requiredOption('--tier <t>', 'rights tier to remove: pop-culture')
  .option('--dry-run', 'list what would be deleted and touch nothing', false)
  .action((opts: { tier: string; dryRun: boolean }) => {
    if (opts.tier !== 'pop-culture') {
      console.error(`Refusing to drop tier "${opts.tier}". Only "pop-culture" is separable by design.`);
      process.exitCode = 1;
      return;
    }
    let removed = 0;
    for (const category of POP_CULTURE_CATEGORIES) {
      const path = categoryPath(category);
      const n = loadCategory(category).length;
      if (!existsSync(path)) continue;
      console.log(`${opts.dryRun ? '[dry-run] would delete' : 'deleted'} ${path} (${n} puzzles)`);
      if (!opts.dryRun) unlinkSync(path);
      removed += n;
    }
    console.log('');
    console.log(
      `${opts.dryRun ? 'Would remove' : 'Removed'} ${removed} puzzles across ${POP_CULTURE_CATEGORIES.length} categories.` +
        (opts.dryRun ? '' : ' Re-run `seed` to push the change, or use `seed --tier core`.'),
    );
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
