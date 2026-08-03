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
    // CI hang mitigation: the linux `unit` job's vitest run was silently
    // hanging 6h on GitHub's ubuntu runner with no output. Root-caused via a
    // cancelled run's log: vitest progressed through test files then stalled
    // at a worker-load boundary (last logged: init-live.vitest.ts, next file
    // reflection.vitest.ts never starts; testTimeout does NOT fire, so it's a
    // fork worker-load deadlock, not a test body). The suite REQUIRES the
    // `forks` pool — threads/vmThreads break 9 fork-isolation-dependent files.
    //
    // Defense in depth:
    // - maxWorkers:2 — caps concurrent fork workers, the vitest-4 Node-24
    //   stabilization (vitest#8968/#8861) without the fileParallelism:false
    //   serial churn that maximized worker spawns.
    // - testTimeout:10000 — a genuinely stalling test now FAILS after 10s with
    //   its name instead of blocking the pool forever.
    // The CI workflow also caps the Vitest step at timeout-minutes:15, so any
    // residual stall fails fast with captured output instead of the 6h silence.
    maxWorkers: 2,
    testTimeout: 10000,
  },
  onConsoleLog: () => {},
});