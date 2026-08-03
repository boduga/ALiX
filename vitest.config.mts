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
    // CI hang fix: vitest 4's default `forks` pool intermittently fails to
    // spawn workers on constrained runners (Node 24 — vitest#8968/#8861),
    // hanging the whole run at 0 output (seen: 6h cancel on GitHub ubuntu).
    // fileParallelism:false runs test files serially, so only one fork worker
    // is ever alive — the documented stabilization. Local full suite stays
    // green (~70s vs ~11s parallel). Do NOT switch to `threads`: 9 files are
    // fork-isolation-dependent and fail under threads.
    fileParallelism: false,
  },
  onConsoleLog: () => {},
});