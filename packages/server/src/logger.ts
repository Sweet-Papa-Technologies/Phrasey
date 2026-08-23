/**
 * Structured logging (§11: "Never log puzzle text, display names, or anything
 * player-identifying").
 *
 * The redaction paths below are a backstop, not the policy. The policy is that
 * call sites log ids and event kinds, never `name`, `text`, `answer`, `hint`
 * or `guess`. `logger.test.ts` asserts the backstop actually fires.
 */
import { pino, type Logger } from 'pino';

/** Field names that must never reach a log sink, wherever they appear. */
export const REDACTED_KEYS = [
  'name',
  'displayName',
  'playerName',
  'text',
  'answer',
  'guess',
  'hint',
  'puzzleText',
  'category',
  'accessibleText',
  'email',
] as const;

function redactPaths(): string[] {
  const paths: string[] = [];
  for (const k of REDACTED_KEYS) {
    paths.push(k, `*.${k}`, `*.*.${k}`, `*[*].${k}`);
  }
  return paths;
}

export function createLogger(opts: { level: string; pretty: boolean }): Logger {
  return pino({
    level: opts.level,
    base: { svc: 'phrasey-server' },
    redact: { paths: redactPaths(), censor: '[redacted]' },
    ...(opts.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } } }
      : {}),
  });
}

export type { Logger };
