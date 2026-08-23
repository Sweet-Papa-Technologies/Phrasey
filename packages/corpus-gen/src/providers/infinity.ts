/**
 * A local llama.cpp box running Qwen 3.8 27B, OpenAI-compatible, no auth.
 * Plain fetch, no SDK.
 *
 * The address is deliberately NOT hardcoded: this is a public repo, and the
 * endpoint is an unauthenticated model server on somebody's LAN. Set
 * `PHRASEY_INFINITY_URL` (see .env.example). Without it the provider points at
 * localhost, which fails fast and obviously rather than quietly reaching for a
 * host that is not yours.
 *
 * Qwen is a reasoning model: it emits `reasoning_content` before `content`. A
 * response can therefore come back with a full reasoning trace and an EMPTY
 * `content` when the token budget runs out — `finish_reason: "length"`. That is
 * a retryable failure, not zero results, and this client treats it as one.
 */
import { DEFAULTS, ProviderError, withRetries, type GenerateOptions, type Provider } from './types.js';

export const INFINITY_BASE_URL = process.env.PHRASEY_INFINITY_URL ?? 'http://127.0.0.1:8080/v1';
export const INFINITY_MODEL = process.env.PHRASEY_INFINITY_MODEL ?? 'Qwen3.8-27B';

interface ChatChoice {
  finish_reason?: string;
  message?: { content?: string | null; reasoning_content?: string | null };
}
interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string };
}

export class InfinityProvider implements Provider {
  readonly name = 'infinity';

  constructor(
    private readonly baseUrl: string = INFINITY_BASE_URL,
    private readonly model: string = INFINITY_MODEL,
  ) {}

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    const {
      system,
      maxTokens = DEFAULTS.maxTokens,
      temperature = DEFAULTS.temperature,
      timeoutMs = DEFAULTS.timeoutMs,
      retries = DEFAULTS.retries,
    } = opts;

    return withRetries(
      'infinity.generate',
      retries,
      async (attempt) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model: this.model,
              temperature,
              // Give the reasoning trace room. Too small a budget returns
              // finish_reason "length" with an empty content string.
              max_tokens: Math.max(1500, maxTokens) + (attempt - 1) * 1000,
              messages: [
                ...(system ? [{ role: 'system', content: system }] : []),
                { role: 'user', content: prompt },
              ],
            }),
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            // 4xx other than 429 will not fix themselves on a retry.
            const retryable = res.status === 429 || res.status >= 500;
            throw new ProviderError(`HTTP ${res.status}: ${body.slice(0, 300)}`, retryable);
          }

          const json = (await res.json()) as ChatResponse;
          if (json.error?.message) throw new ProviderError(json.error.message, true);

          const choice = json.choices?.[0];
          const content = (choice?.message?.content ?? '').trim();
          if (!content) {
            const reasoned = (choice?.message?.reasoning_content ?? '').length;
            throw new ProviderError(
              `empty content (finish_reason=${choice?.finish_reason ?? 'none'}, reasoning_content=${reasoned} chars) — token budget too small`,
              true,
            );
          }
          return content;
        } finally {
          clearTimeout(timer);
        }
      },
      (attempt, err) => {
        console.warn(`  [infinity] attempt ${attempt} failed: ${errMsg(err)} — retrying`);
      },
    );
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
