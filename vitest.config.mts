import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run TypeScript vitest files only (not node:test files)
    include: ['tests/**/*.vitest.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      enabled: false,
    },
  },
  onConsoleLog: () => {},
});