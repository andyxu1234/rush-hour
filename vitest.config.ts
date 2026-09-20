import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@rush-hour/core': r('./packages/core/src/index.ts'),
      '@rush-hour/render': r('./packages/render/src/index.ts'),
      '@rush-hour/platform': r('./packages/platform/src/index.ts'),
      '@rush-hour/app-bootstrap': r('./packages/app-bootstrap/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'e2e-unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
