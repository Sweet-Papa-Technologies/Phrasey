import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The soak test drives 200 full matches through the reducer.
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        // The simulator is a developer tool, not a rules module (§14 M1 scopes
        // the >90% bar to the rules).
        'src/sim/**',
        // Test scaffolding and inline fixtures.
        'src/testing/**',
        'src/**/*.test.ts',
        // Pure re-export barrels and type-only modules.
        'src/index.ts',
        'src/cards/index.ts',
        'src/cards/types.ts',
        'src/cards/interruptTypes.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
