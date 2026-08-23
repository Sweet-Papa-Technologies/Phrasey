import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The integration suite stands up real servers and plays real rounds.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Socket servers bind ports; running files in parallel makes port reuse and
    // fake-timer bleed much harder to reason about than the seconds it saves.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      FIRESTORE_ENABLED: '0',
      LEAK_GUARD: '1',
      DEBUG_INVARIANTS: '1',
    },
  },
});
