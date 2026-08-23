/**
 * The generation pipeline (design doc §4.3):
 *
 *   provider  ->  batch of {text, hint}  ->  deterministic validator
 *      accepted -> corpus/<category>.json
 *      rejected -> corpus/review-queue.json, with the reason
 *
 * Categories run concurrently behind a small cap because INFINITY is a single
 * home-lab box; batches are large because each round trip costs ~20s.
 */
import type { Category } from '@phrasey/shared';
import { parseItems } from './json.js';
import { buildPrompt, BRIEFS, SYSTEM_PROMPT } from './prompts.js';
import type { Provider } from './providers/index.js';
import type { Candidate, CorpusEntry, RejectedEntry } from './types.js';
import { makeEntry, makeRejection } from './corpus.js';
import { RULES, validateCandidate, type CorpusIndex } from './validator.js';

export interface GenerateCategoryOptions {
  provider: Provider;
  category: Category;
  /** How many *validated* entries to add. */
  target: number;
  /** Shared across categories so dedupe is corpus-wide. Mutated as we accept. */
  index: CorpusIndex;
  /** Phrases already in this category, fed back into the prompt. */
  existing: string[];
  batchSize?: number;
  /** Stop after this many model calls even if the target was not reached. */
  maxRounds?: number;
  /**
   * Length ceiling for NEW material. Defaults to `RULES.TARGET_MAX_LENGTH`, not
   * to §4.3's 60 — the hard cap exists for the occasional long one already in
   * the corpus, and is the wrong thing to generate against.
   */
  maxLength?: number;
  onLog?: (line: string) => void;
}

export interface CategoryOutcome {
  category: Category;
  accepted: CorpusEntry[];
  rejected: RejectedEntry[];
  rounds: number;
  /** Items the model returned in total, before validation. */
  produced: number;
}

export async function generateCategory(opts: GenerateCategoryOptions): Promise<CategoryOutcome> {
  const {
    provider,
    category,
    target,
    index,
    existing,
    batchSize = 15,
    maxRounds = 6,
    maxLength = RULES.TARGET_MAX_LENGTH,
    onLog = () => {},
  } = opts;

  const brief = BRIEFS[category];
  // Per-category validator relaxations live in the brief, next to the voice
  // that justifies them — see CategoryBrief.commonWordFloor.
  const validateOpts = {
    index,
    maxLength,
    ...(brief.commonWordFloor !== undefined ? { commonWordFloor: brief.commonWordFloor } : {}),
    ...(brief.maxUncommonWords !== undefined ? { maxUncommonWords: brief.maxUncommonWords } : {}),
  };
  const accepted: CorpusEntry[] = [];
  const rejected: RejectedEntry[] = [];
  const seenThisRun = [...existing];
  let rounds = 0;
  let produced = 0;

  while (accepted.length < target && rounds < maxRounds) {
    rounds++;
    // Over-ask: the validator is supposed to have something to reject.
    const ask = Math.min(batchSize, Math.max(6, Math.ceil((target - accepted.length) * 1.6)));
    const prompt = buildPrompt({ category, count: ask, existing: seenThisRun });

    let raw: string;
    try {
      raw = await provider.generate(prompt, {
        system: SYSTEM_PROMPT,
        maxTokens: 1200 + ask * 140,
        temperature: 1.0,
      });
    } catch (err) {
      onLog(`[${category}] round ${rounds}: provider failed — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const items = parseItems(raw);
    if (!items || items.length === 0) {
      const preview = raw.replace(/\s+/g, ' ').slice(0, 160);
      onLog(`[${category}] round ${rounds}: unparseable reply (${raw.length} chars) — retrying. Head: ${preview}`);
      continue;
    }
    produced += items.length;

    let took = 0;
    for (const item of items) {
      const candidate: Candidate = {
        raw: item.text,
        hint: item.hint,
        category,
        source: brief.source,
        rightsTier: brief.rightsTier,
        ...(brief.rightsNote ? { rightsNote: brief.rightsNote } : {}),
        provider: provider.name,
      };
      const result = validateCandidate(candidate, validateOpts);
      if (result.ok) {
        const entry = makeEntry(candidate, result);
        accepted.push(entry);
        // Add immediately so later batches dedupe against it.
        index.add(entry.text);
        seenThisRun.push(entry.text);
        took++;
      } else {
        rejected.push(makeRejection(candidate, result));
      }
    }
    // Every item in the batch is validated, including any past the target —
    // they were already paid for, and throwing them away would also throw away
    // the rejection data the review queue exists to collect.
    onLog(
      `[${category}] round ${rounds}: ${items.length} produced, ${took} accepted, ${items.length - took} rejected (${accepted.length}/${target})`,
    );
  }

  return { category, accepted, rejected, rounds, produced };
}

/** Runs tasks with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
