# Known Flaky Tests

Intermittent gate failures, recorded with the evidence needed to decide whether
they are test defects or product defects. Append entries; do not rewrite
history. An entry with one occurrence is a *watch* item, not a licence to ignore
a red gate — re-run and confirm before concluding anything.

## Triage checklist

"Passes standalone" is evidence, not exoneration: a leftover *global* resource
can make an unrelated suite fail. Before filing an entry as a flake, walk this
list:

1. Re-run the failing file standalone, then the full suite again.
2. Inspect shared counters / module-level mutable state (call counters, caches).
3. Inspect temp directories and files — global namespaces like
   `os.tmpdir()` plus a shared prefix are a classic cross-suite collision.
4. Inspect stray processes, ports, and sockets left by earlier runs.
5. Inspect environment mutation (env vars set by a test and not restored).

Record which of these were checked and what they showed.

## Governance report — "store isolation — no .alix/ files created in cwd"

- **Test:** `tests/governance/governance-report.test.ts` → `store isolation — no .alix/ files created in cwd` (spawns the CLI; 10 000 ms per-test timeout)
- **Symptom:** `AssertionError: Expected exit 0, got 1` after ~10 014 ms — a timeout, not a wrong result
- **Frequency:** 1 of ~6 full parallel runs; one standalone run failed the same subtest, the next standalone run passed
- **Recurrence (2026-09-27, T2-f gates):** `pnpm test:node` → 8200 pass / 2 fail, both from this file (`--json mode returns parseable JSON`, `--output writes file to requested path`), each `Expected exit 0, got 1` at ~10 012–10 014 ms — the same spawn-budget timeout, different subtests
- **Parallel-only:** No — seen in a parallel full run *and* standalone, so treat it as load/timing sensitive rather than concurrency-specific
- **First observed:** 2026-09-27, during the tool-selection T2-d cleanup change set (tree at `38390f67`)
- **Standalone result:** `node --test --test-concurrency=1 dist/tests/governance/governance-report.test.js` → suite passes (~15 s and ~44 s for the two top-level cases)
- **Suspected cause:** a fixed 10 s child-process timeout on a spawned CLI under heavy load; child startup plus work exceeds the budget before a result is written
- **Measured cost of a spawn:** ~5.4 s standalone (`node --test --test-concurrency=1`, 18/18 pass), ~5.7–8.5 s inside `pnpm test:node`; the 10 s budget sits inside the load-induced spread
- **Fix applied:** the spawn budgets in `tests/governance/governance-report.test.ts` are now named constants — 20 s for the compiled `bin/alix.js` spawns, 30 s for the `npx tsx` spawns, with the two `describe` budgets raised to 300 s so the per-case budgets cannot outlive their suite. No assertion changed; a wrong result still fails, only the false-failure window moved.
- **Status:** resolved — a fixed short timeout on a spawned process is a false-failure generator; if this test times out again, treat it as a real hang and investigate the spawned CLI, not the budget

## TUI pinned-bottom rendered slice

- **Test:** `tests/tui/app-pinned-bottom.vitest.ts` → `new content while unpinned: end-to-end rendered slice stays identical`
- **Symptom:** `AssertionError: expected 119 to be greater than 119` at line 271 — `allLinesAfter.length` equals `allLinesBefore.length`, i.e. the appended `new 60`..`new 64` content had not reached the render slice when the assertion ran. No incorrect offset or slice comparison followed; the length precondition failed first.
- **Frequency:** 1 of 3 full parallel runs during the read-only tool-surface change set. Standalone: 3/3 pass. Second full run with the same tree: clean (6583 pass / 0 fail).
- **Parallel-only:** Yes — never reproduced standalone; the test drives `refresh()` through a sampled log collector, so the window is event-delivery timing under load.
- **First observed:** 2026-09-30, during the read-only tool-surface change set (tree at `f1f0e762` + working diff)
- **Standalone result:** `npx vitest run tests/tui/app-pinned-bottom.vitest.ts` → 17/17 pass, three consecutive runs
- **Baseline check:** the same full suite on the stashed (pre-change) tree passed, but the failing assertion is downstream of no file this change touches — `helpers.ts`, `agent-loop.ts`, `session/setup.ts`, `task-loop/main.ts`, `task-loop/predicates.ts` have no TUI render path.
- **Suspected cause:** the assertion samples render state immediately after appending + `refresh()`; under full-suite load the five appends and the refresh interleave differently than standalone. Unconfirmed.
- **Status:** watch — the change under test is not on this file's dependency path, and the gate was green on the repeat run. If it recurs twice, treat it as a real race in the pinned-bottom repaint and fix the test's await rather than the product.

## Observability telemetry + skills factory trace

- **Tests:** `tests/observability/security-telemetry.test.ts` (`redactPayload` called on each emission) and `tests/skills/factory-trace.test.ts`
- **Symptom:** strict-equality assertion failures (`expected 0`) in a shared `redactPayload` call counter and a factory-trace assertion
- **Frequency:** 1 of ~8 full parallel runs; no recurrence in the four full runs since
- **Parallel-only:** Unknown — observed in a parallel full run; both files pass standalone, and the following full runs were clean
- **First observed:** 2026-09-27, during the tool-selection T2-a change set (tree at `0a9d12e6`)
- **Standalone result:** both pass
- **Suspected cause:** shared module state (the `redactPayload` counter) interacting with parallel file execution order; unconfirmed
- **Status:** watch — do not treat as a product defect without a second occurrence
