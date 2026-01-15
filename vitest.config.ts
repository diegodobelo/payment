import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Vitest 4: Run tests sequentially to avoid DB conflicts
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    // Use rules engine in tests (not AI) so we test actual decision logic
    env: {
      DECISION_ENGINE_MODE: 'rules',
    },
  },
});
