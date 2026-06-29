# P10.9.1 Task 2 — Operational Completeness (Read sites + Auto-current snapshot)

## Summary

Completes the actual bug fix on top of Task 1's snapshot stack: `alix
executive evaluate <planId>` now produces `evaluationStatus: "completed"`
for plans that executed, instead of `insufficient_data`. This is achieved
by replacing the time-window `trendStore.findBaseline(plan.generatedAt)`
lookup at both read sites with the symmetric plan-scoped resolution path
mandated by ADR-0005:

```
snapshotStore.loadBaseline(planId) → baselineSnapshot.rawSubsystemState.trendSnapshotId → trendStore.loadById(...)
snapshotStore.loadCurrent(planId)  → currentSnapshot.rawSubsystemState.trendSnapshotId  → trendStore.loadById(...)
```

Both read sites also add an eager auto-capture of `current` snapshots for
plans in terminal status (completed/failed) when no current snapshot
exists yet. Second evaluation is idempotent — the captured current
snapshot is reused.

## Commits

| Hash | Title |
|---|---|
| `5c150d02` | P10.9.1-T2: ExecutiveTrendStore.loadById — additive id resolver |
| `a2985c30` | P10.9.1-T2: Wire executive-evaluate-handler to planId-keyed snapshot stack |
| `6447c542` | P10.9.1-T2: Wire automatic-outcome-hook to planId-keyed snapshot stack |
| `0b12be30` | P10.9.1-T2: Add end-to-end snapshot tests for evaluate handler + hook |
| `26aee5cb` | P10.9.1-T2: Typecheck fixes for loadById test fixtures + hook test casts |

## Test results (final run)

```
 RUN  v4.1.6 /home/babasola/Projects/Monolith

 Test Files  207 passed (207)
      Tests  2237 passed (2237)
   Start at  11:44:48
   Duration  3.76s
```

All 2237 tests pass across 207 test files. **20 new tests added** by
Task 2 across three new test files:

- `trend-store-load-by-id.vitest.ts`: 10 tests (loadById core + additive-invariant for loadLatest/findBaseline)
- `executive-evaluate-snapshot.vitest.ts`: 5 tests (end-to-end CLI handler coverage)
- `automatic-outcome-hook-snapshot.vitest.ts`: 5 tests (end-to-end hook coverage)

Plus updated test files (no removals — added `writeSnapshots` helper to
keep existing tests working with the new resolution model):

- `executive-evaluate-cli.vitest.ts`: existing 11 tests still pass after adding `writeSnapshots` calls to set up the new snapshot-stack resolution path
- `automatic-outcome-hook.vitest.ts`: existing 9 tests still pass via the legacy 2-arg constructor path (no execDir)

## `tsc --noEmit` final output

Clean. No errors. (No output produced.)

## Sentinel test final output

```
 RUN  v4.1.6 /home/babasola/Projects/Monolith

 Test Files  1 passed (1)
      Tests  44 passed (44)
   Start at  11:45:00
   Duration  120ms
```

All 44 sentinel checks pass. `trend-store.ts` was already in the
`EXECUTIVE_FILES` allowlist (added in P10.1) and already has the scoped
write-path exception for `writeFileSync` / `mkdirSync` / `appendFileSync`.
No sentinel changes required for Task 2 — `loadById` is purely additive
(read-only, no new mutations) and the existing trend-store tests already
pass without sentinel changes.

## Self-review checklist

For each locked invariant from the plan (A–E):

| Invariant | Status | Evidence |
|---|---|---|
| **A. Symmetric resolution** | ✅ | Both `executive-evaluate-handler.ts` (`resolveSnapshots` helper, lines ~96–163) and `automatic-outcome-hook.ts` (`resolveFromSnapshotStack` private method, lines ~157–226) implement the exact same path: `snapshotStore.load{Baseline,Current}(planId)` → `snapshot.rawSubsystemState.trendSnapshotId` → `trendStore.loadById(...)`. `loadLatest()` is NEVER used in the resolution path; it is only used inside `captureCurrent()` to construct a fresh snapshot. Verified by tests (a)–(d) of `executive-evaluate-snapshot.vitest.ts` and `automatic-outcome-hook-snapshot.vitest.ts`. |
| **B. Local wiring, no shared factory** | ✅ | Both handler and hook construct `new ExecutiveSnapshotStore(join(execDir, "snapshots"))` and `createDefaultSnapshotProvider(execDir)` inline. No new shared module, no constructor plumbing beyond the optional `execDir` parameter on `AutomaticOutcomeEvaluator` (kept for backward compatibility with existing direct-construction tests). The factory `createAutomaticOutcomeEvaluator(execDir)` was updated to thread `execDir` through to the evaluator — same signature as P10.4c. |
| **C. Eager auto-capture of current snapshot** | ✅ | Both handler and hook implement: if `state.status === "completed" \|\| state.status === "failed"` AND `!currentSnapshot`, call `provider.captureCurrent(planId)` then `snapshotStore.saveCurrent(...)`. The captured snapshot's own `rawSubsystemState.trendSnapshotId` (set by `captureCurrent` via `loadLatest()` internally) is then used to resolve the trend payload. Idempotent: second evaluation reuses the captured current. Verified by integration test (e) of both new test files. |
| **D. Fail loud on missing baseline** | ✅ | Both handler and hook emit a `console.warn` with the literal message `"baseline not captured for planId=<id>"` when `loadBaseline(planId)` returns null and the evaluator is about to be called. The warning is checked by test (b) of both new test files via `expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('baseline not captured for planId=<id>'))`. No backfill, no fabricated baseline — the evaluator naturally produces `insufficient_data` from the null baseline. |
| **E. Trend store: additive `loadById` only** | ✅ | `ExecutiveTrendStore.loadById(id)` is a new public method that does a linear scan over JSONL (no index). `loadLatest()` and `findBaseline()` behavior unchanged. Verified by 10 dedicated tests in `trend-store-load-by-id.vitest.ts` including 2 additive-invariant tests that re-verify `loadLatest()` and `findBaseline()` behavior post-add. The signature is `loadById(id: string): ExecutiveTrendSnapshot \| null`, returns null if missing/corrupt/not found. |

## Files created

| Path | Purpose |
|---|---|
| `tests/executive/trend-store-load-by-id.vitest.ts` | Unit tests for the new `loadById` method (10 tests) |
| `tests/cli/commands/executive-evaluate-snapshot.vitest.ts` | End-to-end CLI handler tests (5 tests, scenarios a–e) |
| `tests/executive/automatic-outcome-hook-snapshot.vitest.ts` | End-to-end hook tests (5 tests, scenarios a–e) |

## Files modified

| Path | Change |
|---|---|
| `src/executive/trend-store.ts` | Additive `loadById(id)` method. No behavior change to existing methods. |
| `src/cli/commands/executive-evaluate-handler.ts` | Replaced time-window lookup with symmetric snapshot-stack resolution + auto-current capture + baseline-fail-loud. Local wiring of `ExecutiveSnapshotStore` + `createDefaultSnapshotProvider`. All ops wrapped in try/catch (best-effort). |
| `src/executive/automatic-outcome-hook.ts` | Same three changes mirrored. Added optional `execDir` parameter to constructor for backward compatibility; production factory `createAutomaticOutcomeEvaluator(execDir)` now threads `execDir` through. |
| `tests/cli/commands/executive-evaluate-cli.vitest.ts` | Existing 11 tests updated to use the new `writeSnapshots` helper (no test removed). Verifies the snapshot-stack path produces `completed` for plans with both baseline + current snapshots. |
| `tests/executive/trend-store-load-by-id.vitest.ts` | (See above; includes loadById tests + loadLatest/findBaseline additive-invariant tests.) |

## Files NOT modified (deliberate)

- `src/executive/outcome-evaluator.ts` — the pure evaluator stays untouched, per the constraints. Resolution happens at the read sites, not in the evaluator.
- `src/executive/executive-snapshot-store.ts` — unchanged (Task 1 already covered the read methods).
- `src/executive/executive-snapshot-provider.ts` — unchanged (Task 1 already covered `captureBaseline` + `captureCurrent`).
- `src/executive/executive-observation-provider.ts` — unchanged (Task 1 already covered the single-seam pattern).
- `tests/executive/executive-sentinels.vitest.ts` — `trend-store.ts` already in allowlist with scoped write-path exception. No new files to add.

## Concerns / deviations

1. **Existing `executive-evaluate-cli.vitest.ts` tests modified (not removed)**: The plan said "Add new tests, don't replace." The existing 11 tests directly wrote `trends.jsonl` files and expected `evaluationStatus: "completed"`. With the new resolution path, those tests now require snapshot files too (otherwise they would hit the `insufficient_data` path). I added a `writeSnapshots` helper and called it from each existing test (4 tests required the update). This is technically a modification, not a pure addition, but the test intent (verify a plan with both trend snapshots produces `completed`) is preserved. The 11 tests still run and pass; no test was removed.

2. **`automatic-outcome-hook` has dual-mode resolution (legacy 2-arg + new factory)**: The constructor signature `new AutomaticOutcomeEvaluator(outcomeStore, trendStore)` was kept for backward compatibility with the 9 existing tests in `automatic-outcome-hook.vitest.ts`. When `execDir` is omitted, the hook falls back to the legacy `findBaseline(plan.generatedAt) + loadLatest()` path. When `execDir` is provided (production factory path used by ExecutionEngine), it uses the new snapshot-stack path. This preserves "no existing tests removed" while letting the production path fix the bug.

3. **`automatic-outcome-hook` test (b) assertion**: The plan said baseline-missing should produce `insufficient_data`. But the hook DOES persist a report with `insufficient_data` to the outcome store (it surfaces to operators who want to know "this plan failed to evaluate"). I adjusted the test (b) assertion to expect `evaluationStatus: "insufficient_data"` in the report, while still asserting that the literal warning was emitted. The CLI handler test (b) doesn't persist a report (it's a one-shot evaluation), so the assertion there is different. Both are documented in the test comments.

4. **TypeScript `unknown` cast in hook integration test**: The test fixture `makePlan()` returns `Record<string, unknown>` to avoid re-implementing the full `PersistedExecutionPlan` type for tests. Casting to `PersistedExecutionPlan` directly produced a TS2352 error. I cast through `unknown` first per TS guidelines. The CLI test file uses the same pattern. The actual production code in `executive-evaluate-handler.ts` and `automatic-outcome-hook.ts` is fully type-safe (no casts).

5. **`loadLatest()` is still used inside `captureCurrent()`**: Per invariant A, `loadLatest()` is "ONLY used inside `captureCurrent()` itself when constructing a brand-new current snapshot". I verified this holds — `captureCurrent()` in `executive-snapshot-provider.ts` calls `observationProvider.collect(planId)` which calls `trendStore.loadLatest()` internally. The handler/hook never call `loadLatest()` directly.

6. **Sentinel allowlist verified but not modified**: Per the plan, I verified `trend-store.ts` is in `EXECUTIVE_FILES` (it is — added in P10.1) and already has the scoped write-path exception. No sentinel changes were needed for Task 2 since the only mutation introduced was in `executive-snapshot-store.ts` (already allowlisted in Task 1) and the read site changes are pure reads.

7. **No production path tested end-to-end against real ExecutionEngine**: The new integration tests use the snapshot-stack + createAutomaticOutcomeEvaluator factory directly, not the full ExecutionEngine → plan execution → auto-hook pipeline. The plan did not require an engine-level integration test for Task 2 (the bug fix surface is at the hook + handler level), and the existing `execution-engine-baseline.vitest.ts` (from Task 1) already verifies the baseline capture path. Task 2 tests cover the read-site symmetry invariant and the auto-capture idempotency invariant; the only end-to-end test that would chain through the engine is a manual smoke test, which the plan explicitly defers to "Manual verification" section.

## Final status

DONE. All five locked invariants (A–E) verified by tests. Full vitest
suite (2237 tests, 207 files) green. `tsc --noEmit` clean. Sentinel
(44 tests) green. Five atomic commits on branch
`feature/p10-9-1-operational-completeness`, ready for PR #145.