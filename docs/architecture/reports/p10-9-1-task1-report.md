# P10.9.1 Task 1 — Operational Completeness (Snapshot Stack)

## Summary

Implemented the plan-scoped snapshot stack per ADR-0005: an atomic-write
immutable baseline store, a pure assembly snapshot provider, and a
single-seam observation provider that wires the trend/outcome/recommendation
stores. The `ExecutionEngine` now captures an immutable baseline on the
first step execution (idempotent via `hasBaseline` gate), wrapped in
try/catch so a failing snapshot never blocks plan execution. This fixes
the `evaluate <planId>` returning `insufficient_data` bug because no
per-plan baseline was ever captured.

## Commits

| Hash | Title |
|---|---|
| `ceac5473` | P10.9.1-T1: ExecutiveSnapshotStore — atomic-write immutable baseline |
| `56b19193` | P10.9.1-T1: ExecutiveObservationProvider — single-seam store facade |
| `3d2179ce` | P10.9.1-T1: ExecutiveSnapshotProvider — pure assembly seam |
| `a87cf52f` | P10.9.1-T1: Wire ExecutionEngine baseline snapshot capture gate |
| `0069a780` | P10.9.1-T1: Extend executive purity sentinel for snapshot stack |

## Test results (final run)

```
 RUN  v4.1.6 /home/babasola/Projects/Monolith

 Test Files  32 passed (32)
      Tests  459 passed (459)
   Start at  08:53:49
   Duration  696ms
```

459 tests pass across 32 test files in `tests/executive/`. 49 new tests
across the five added test files (21 snapshot-store + 9 observation-
provider + 12 snapshot-provider + 7 engine-baseline). The sentinel
tests gained zero new test cases (only modified to register the new
files).

Per-file test counts:
- `executive-snapshot-store.vitest.ts`: 21 tests
- `executive-observation-provider.vitest.ts`: 9 tests
- `executive-snapshot-provider.vitest.ts`: 12 tests
- `execution-engine-baseline.vitest.ts`: 7 tests
- `executive-sentinels.vitest.ts`: 44 tests (3 new file-purity checks added)

## `tsc --noEmit` final output

Clean. No errors. (No output produced.)

## Sentinel test final output

```
 RUN  v4.1.6 /home/babasola/Projects/Monolith

 Test Files  1 passed (1)
      Tests  44 passed (44)
   Start at  08:53:54
   Duration  125ms
```

All 44 sentinel checks pass, including the three new file-purity
checks for the snapshot store, snapshot provider, and observation
provider files. The snapshot store's atomic-write primitives
(mkdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync)
are allowlisted via the existing scoped write-path exception (mirrors
PlanStore, OutcomeReportStore, RecommendationReportStore).

## Self-review checklist

For each major requirement in the plan:

| Requirement | Status | Evidence |
|---|---|---|
| **Atomic-write pattern** (mirrors `PlanStore`) | ✅ | `ExecutiveSnapshotStore.atomicWrite()` writes `<file>.tmp`, fsyncs, then renames. Verified by `executive-snapshot-store.vitest.ts` test "loadBaseline returns null when only a partial .tmp file exists". |
| **Immutability** (rule #1, #2 — `BaselineAlreadyCapturedError` on duplicate) | ✅ | `saveBaseline` calls `hasBaseline` first and throws on duplicate. Verified by tests "second saveBaseline for same planId throws BaselineAlreadyCapturedError" and "BaselineAlreadyCapturedError carries planId for operator diagnosis". |
| **Replaceable current** (rule #3) | ✅ | `saveCurrent` always overwrites (no existence check). Verified by test "saveCurrent is replaceable — second save succeeds and loadCurrent returns latest". |
| **Observation seam** (single seam) | ✅ | `ExecutiveObservationProvider` is the only file importing `ExecutiveTrendStore`, `OutcomeReportStore`, `RecommendationReportStore`. `ExecutiveSnapshotProvider` depends only on the observation abstraction. Verified by `executive-observation-provider.vitest.ts` test "exposes only collect(planId) — single-seam invariant". |
| **Engine hook placement** (before first `in_progress` mutation, try/catch) | ✅ | Gate is inserted after `stateStore.load` and before `stateStore.update(... in_progress)`. Wrapped in try/catch with `console.warn`. Verified by tests "provider throws → engine completes step anyway, no baseline file, warning logged" and "saveBaseline throws → engine completes step anyway, no baseline file, warning logged". |
| **list() helper** (audit helper, empty if dir missing, sorted newest-first) | ✅ | `ExecutiveSnapshotStore.list()` returns empty array when dir missing, sorted by `capturedAt` desc. Verified by tests "list() returns empty array when directory does not exist" and "list() returns all snapshots sorted by capturedAt newest first". |
| **Sentinel update** (3 new files added to EXECUTIVE_FILES) | ✅ | All three file paths present in `EXECUTIVE_FILES`. Verified by sentinel test suite (44/44 pass). The snapshot store's atomic-write primitives are allowlisted via the scoped write-path exception. |

## Concerns / deviations

**No deviations from the plan.** All five commits landed exactly the
files and behavior specified in the plan, ADR-0005, and the implementation
prompt. The executive purity sentinel had to be extended (added one file
to the atomic-write allowlist, mirroring the existing precedent for
PlanStore/OutcomeReportStore/RecommendationReportStore). This is a
test-only change scoped to a single line and does not modify any
forbidden structure.

One observation worth recording: the plan describes the
`createDefaultSnapshotProvider` constructor taking an `execDir` parameter,
but the existing `ExecutionEngine` constructor does not take an
`execDir` parameter — instead it hardcodes `.alix/executive` for the
outcome hook. I mirrored this pattern: the snapshot store/provider
defaults use `join(".alix", "executive", "snapshots")` and
`".alix/executive"` respectively. This is consistent with the P10.4c
precedent and is captured in the engine integration tests' backward-
compat case ("default constructor works without explicit snapshot args").

The implementation prompt asked for a `hasBaseline` gate inside the
engine with `try/catch` wrapping; both are in place. The
`BaselineAlreadyCapturedError` is thrown by the store (not the engine);
the engine never sees it because its idempotency gate is the
pre-check `if (!await this.snapshotStore.hasBaseline(planId))`.