import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'node',
    // UI test files opt into a DOM with a `// @vitest-environment jsdom` first line.
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
