/**
 * Vertex AI fallback, via the `assetforge` CLI already on PATH with
 * service-account auth configured. Used when INFINITY is down or its output
 * quality drops: `--provider vertex`.
 *
 * Shells out rather than adding an SDK dependency — corpus-gen deliberately
 * carries no HTTP client beyond fetch.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, ProviderError, withRetries, type GenerateOptions, type Provider } from './types.js';

export const VERTEX_FAST_MODEL = 'gemini-3.5-flash';
/** The cheapest option, for bulk runs. */
export const VERTEX_CHEAP_MODEL = 'gemini-3.1-flash-lite';

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new ProviderError(`${cmd} failed: ${err.message}\n${stderr}`, true));
      else resolve({ stdout, stderr });
    });
  });
}

export class VertexProvider implements Provider {
  readonly name = 'vertex';

  /** `model` undefined means assetforge's `--fast` model. */
  constructor(private readonly model?: string) {}

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    const { system, timeoutMs = DEFAULTS.timeoutMs, retries = DEFAULTS.retries } = opts;

    return withRetries(
      'vertex.generate',
      retries,
      async () => {
        const dir = await mkdtemp(join(tmpdir(), 'phrasey-corpus-'));
        const out = join(dir, 'out.txt');
        try {
          const args = [
            'chat',
            prompt,
            '-o',
            out,
            ...(this.model ? ['--model', this.model] : ['--fast']),
            ...(system ? ['--system', system] : []),
          ];
          await run('assetforge', args, timeoutMs);
          const text = (await readFile(out, 'utf8')).trim();
          if (!text) throw new ProviderError('assetforge returned an empty file', true);
          return text;
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      },
      (attempt, err) => {
        console.warn(`  [vertex] attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)} — retrying`);
      },
    );
  }
}
