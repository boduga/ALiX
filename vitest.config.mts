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
    // CI hang fix: the vitest run was silently hanging 6h on the GitHub
    // ubuntu runner with no output. Root-caused via a cancelled run's log:
    // vitest progressed serially to tests/cli/reflection.vitest.ts then
    // stalled (0 further output). The file passes locally in 200ms — the hang
    // is CI-environment-specific (native better-sqlite3 fork under a
    // constrained runner). Defense in depth:
    // - fileParallelism:false — only one fork worker alive (vitest#8968/#8861
    //   Node-24 stabilization); serial run is ~70s locally vs ~11s parallel.
    //   Do NOT switch to `threads`: 9 files are fork-isolation-dependent.
    // - testTimeout:10000 — a stalling test now FAILS after 10s with its name
    //   in the output instead of silently blocking the pool forever. This turns
    //   the 6h silent hang into a fast, named failure we can act on.
    fileParallelism: false,
    testTimeout: 10000,
  },
  onConsoleLog: () => {},
});