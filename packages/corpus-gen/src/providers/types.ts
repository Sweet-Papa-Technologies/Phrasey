/** The whole surface corpus-gen needs from a text model. */
export interface GenerateOptions {
  /** Steering instruction sent as the system message. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Per-attempt timeout in ms. INFINITY is slow; default generously. */
  timeoutMs?: number;
  /** Attempts including the first. */
  retries?: number;
}

export interface Provider {
  readonly name: string;
  /** Returns raw model text. Throws if every attempt fails. */
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
}

export const DEFAULTS = {
  maxTokens: 3000,
  temperature: 1.0,
  timeoutMs: 300_000,
  retries: 3,
} as const;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff with jitter, shared by both providers. */
export async function withRetries<T>(
  label: string,
  attempts: number,
  fn: (attempt: number) => Promise<T>,
  onRetry?: (attempt: number, err: unknown) => void,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (err instanceof ProviderError && !err.retryable) throw err;
      if (attempt === attempts) break;
      onRetry?.(attempt, err);
      const backoff = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      await sleep(backoff + Math.random() * 1_000);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(last)}`);
}
