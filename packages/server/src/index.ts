/**
 * Entrypoint. `packages/server/dist/index.js` — the Dockerfile's CMD.
 */
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const log = createLogger({ level: cfg.logLevel, pretty: cfg.nodeEnv === 'development' });

const app = await buildApp({ cfg, log });

try {
  await app.listen();
} catch (err) {
  log.error({ err: String(err) }, 'failed to listen');
  process.exit(1);
}

let closing = false;
const shutdown = (signal: string): void => {
  if (closing) return;
  closing = true;
  log.info({ signal }, 'shutting down');
  // Snapshot every live room before the process goes away (§6.2), then exit.
  const timer = setTimeout(() => process.exit(0), 10_000);
  timer.unref();
  app
    .close()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      log.error({ err: String(err) }, 'shutdown failed');
      process.exit(1);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => log.error({ reason: String(reason) }, 'unhandled rejection'));
