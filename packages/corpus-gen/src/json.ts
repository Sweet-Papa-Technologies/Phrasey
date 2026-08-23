/**
 * Pulling JSON out of model output. Models wrap arrays in markdown fences, add
 * a sentence of preamble, or trail off mid-array when the budget runs out — all
 * of which are recoverable, and none of which should look like "zero results".
 */

export interface RawItem {
  text?: unknown;
  hint?: unknown;
  phrase?: unknown;
  [k: string]: unknown;
}

/**
 * Every plausible JSON array in the reply, in order.
 *
 * Reasoning models sometimes emit their whole think-aloud into `content` and
 * put the array at the end, and that prose can itself contain a stray `[`. So
 * rather than trusting the first bracket, this returns every balanced
 * candidate and lets the caller pick the one that actually parses.
 */
export function extractJsonArrays(raw: string): string[] {
  let s = raw.trim();

  // ```json ... ```  /  ``` ... ```
  const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence?.[1]) s = fence[1].trim();

  // Some reasoning models leak a <think> block into content.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const out: string[] = [];
  for (let start = s.indexOf('['); start !== -1; start = s.indexOf('[', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i] as string;
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          out.push(s.slice(start, i + 1));
          break;
        }
      }
    }
  }

  // Truncated output: close the array after the last complete object.
  const lastOpen = s.lastIndexOf('[');
  const lastObj = s.lastIndexOf('}');
  if (lastOpen !== -1 && lastObj > lastOpen) out.push(`${s.slice(lastOpen, lastObj + 1)}]`);

  return out;
}

/** The first balanced JSON array in the reply, fences and prose stripped. */
export function extractJsonArray(raw: string): string | null {
  return extractJsonArrays(raw)[0] ?? null;
}

/** Parses a model reply into `{text, hint}` pairs. Unparseable -> null. */
export function parseItems(raw: string): { text: string; hint: string }[] | null {
  let best: { text: string; hint: string }[] | null = null;

  for (const jsonText of extractJsonArrays(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // One salvage pass: drop trailing commas, then move on to the next candidate.
      try {
        parsed = JSON.parse(jsonText.replace(/,\s*([\]}])/g, '$1'));
      } catch {
        continue;
      }
    }
    if (!Array.isArray(parsed)) continue;

    const out: { text: string; hint: string }[] = [];
    for (const el of parsed) {
      if (typeof el === 'string') {
        out.push({ text: el, hint: '' });
        continue;
      }
      if (!el || typeof el !== 'object') continue;
      const row = el as RawItem;
      const text = typeof row.text === 'string' ? row.text : typeof row.phrase === 'string' ? row.phrase : null;
      const hint = typeof row.hint === 'string' ? row.hint : '';
      if (text && text.trim()) out.push({ text: text.trim(), hint: hint.trim() });
    }
    // Keep the richest candidate: prose before the real array can contain a
    // short decoy list, and the real payload is the longer one.
    if (out.length > 0 && (!best || out.length > best.length)) best = out;
  }

  return best;
}
