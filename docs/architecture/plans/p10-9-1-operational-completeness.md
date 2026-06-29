# P10.9.1 — Operational Completeness: Auto-Baseline Snapshot

> **Status:** Implementation plan — Tasks 1+2 of the P10.9.1 stabilization slice.
> **Slice goal:** Make the executive lifecycle self-guiding and executable without hidden prerequisites.
> **Hard boundary:** May guide the operator through the existing lifecycle. May not prioritize strategic work (P11 territory), rank subsystems for investment, or create DecisionCandidates.

## Architectural invariants (locked by the layered purity policy)

- The execution engine **never knows about reports.** It only knows how to ask for a snapshot.
- The snapshot store **stores**. The snapshot provider **gathers**. Same separation as `EffectivenessOutcome` + `RecommendationReportStore`.
- A snapshot is the **immutable record of what the executive system observed**, not a re-derived analytics report. Store references to source reports; never duplicate derived metrics into the snapshot body.
- Baseline snapshots are **write-once, never mutate**. Historical truth. Current snapshots are **replaceable**. Same audit discipline as the P8.5a.0 evidence chain.

## Root cause (confirmed by reading)

Three observations from a real-session transcript exposed that "No baseline snapshot found" is structural:

1. `outcome-evaluator.ts` is pure, accepts `baseline: ExecutiveTrendSnapshot | null` correctly.
2. `executive-evaluate-handler.ts:92–95` and `automatic-outcome-hook.ts:87–88` both call `trendStore.findBaseline(plan.generatedAt)` — a **time-window lookup of trend snapshots**, not a plan-scoped lookup.
3. No code anywhere captures a per-plan baseline. Trend snapshots and plan-scoped snapshots are different concepts. The planner has been looking for data that has never been written.

## Scope: this plan covers only Task 1 + Task 2

| Task | What | Files |
|---|---|---|
| 1 | Snapshot store + provider, immutable baseline on first step execution, planId-keyed | `executive-snapshot-store.ts`, `executive-snapshot-provider.ts`, hook into `execution-engine.ts` |
| 2 | Auto-current snapshot on evaluate, planId-keyed; rewrite both call sites to planId lookups | `executive-evaluate-handler.ts`, `automatic-outcome-hook.ts` |

Tasks 3+ (lifecycle state, `next`, help polish) ship in follow-up plans.

---

## Type design

### Single type for both kinds — `captureKind` discriminator

```ts
export type ExecutiveSnapshotCaptureKind = "baseline" | "current";
export type ExecutiveSnapshotCaptureReason =
  | "execution-start"   // captured on first step of plan execution
  | "evaluation"        // captured lazily by evaluate handler
  | "manual"            // future: explicitly captured by operator
  | "recovery";         // future: re-captured after failure recovery

export interface ExecutivePlanSnapshot {
  // Versioning + provenance (read by anything loading the snapshot years from now)
  metadata: {
    snapshotVersion: 1;
    alixVersion: string;              // from package.json
    executiveEngineVersion: string;   // version of the engine that captured this
    createdBy: "ExecutionEngine" | "EvaluationHandler" | "Provider";
    reason: ExecutiveSnapshotCaptureReason;  // WHY this snapshot was taken
  };

  // Addressability — REQUIRED for planId-keyed lookups
  planId: string;
  capturedAt: string;            // ISO 8601; captured at execution-engine entry, not save time
  captureKind: ExecutiveSnapshotCaptureKind;

  // What was actually observed. References, not derived metrics.
  rawSubsystemState: {
    trendSnapshotId?: string;            // ref to ExecutiveTrendStore entry
    outcomeReportIds: string[];          // refs to recent reports in OutcomeReportStore
    recommendationReportId?: string;     // optional — present if dashboard was run recently
    effectivenessReportId?: string;      // optional
    correlationReportId?: string;        // optional
  };

  // Snapshot-scoped identifier for the file-naming seam
  id: string;                     // `<planId>-baseline` or `<planId>-current`
}
```

### Why not store derived metrics

Store references to the analytics reports; the snapshot is the immutable audit record of what the system observed at plan-start time, not a second analytics report that drifts. Comparison happens at evaluation by joining the snapshot's references with currently-loaded analytics. This matches how P8.5a.0 evidence chains store event references rather than re-derive outcomes.

### File naming convention

- `.alix/executive/snapshots/<planId>-baseline.json`
- `.alix/executive/snapshots/<planId>-current.json`

`id` field on the snapshot matches the file's basename (without `.json`) so the snapshot references itself consistently.

### Immutability

- Baseline: `saveBaseline(...)` writes once, then throws `BaselineAlreadyCapturedError` on subsequent calls. Use existsSync-equivalent guard before write.
- Current: `saveCurrent(...)` overwrites. Evaluation may re-run; current is a moving target.

---

## Provider design

### Single abstraction — `ExecutiveSnapshotProvider`

```ts
export interface ExecutiveSnapshotProvider {
  /** Captures immutable baseline state for a plan at execution start. Called ONCE per plan lifetime. */
  captureBaseline(planId: string): Promise<ExecutivePlanSnapshot>;

  /** Captures replaceable current state, typically before evaluation. Called multiple times. */
  captureCurrent(planId: string): Promise<ExecutivePlanSnapshot>;
}
```

**Default implementation** lives in `src/executive/executive-snapshot-provider.ts`. It is **pure assembly** — it composes an `ExecutivePlanSnapshot` from an injected observation provider. It depends on:
- `ExecutiveObservationProvider` (the seam that discovers report references)
- A captured-at timestamp source

The provider itself **does not depend on stores directly**. That dependency is delegated to `ExecutiveObservationProvider`. This prevents the snapshot provider from gradually accumulating orchestration responsibilities. Adding `captureForecast()` or `captureSimulation()` later means adding a method here that composes a different observation — never reaching into stores directly.

### Observation seam — `ExecutiveObservationProvider`

```ts
/**
 * The single seam between the snapshot assembly layer and the storage /
 * report layers. Collecting observations is NOT a snapshot responsibility —
 * it's an "ask the executive system what's currently visible" responsibility.
 */
export interface ExecutiveObservationProvider {
  /**
   * Returns a structured observation of the current executive state for
   * the given plan. Returns a fresh observation every call (no caching).
   */
  collect(planId: string): Promise<ExecutiveObservation>;
}

export interface ExecutiveObservation {
  collectedAt: string;
  trendSnapshotId?: string;
  recentOutcomeReportIds: string[];
  latestRecommendationReportId?: string;
  latestEffectivenessReportId?: string;
  latestCorrelationReportId?: string;
}
```

**Default implementation** lives in `src/executive/executive-observation-provider.ts`. It owns the dependency on:
- `ExecutiveTrendStore`
- `OutcomeReportStore`
- `RecommendationReportStore`
- `EffectivenessStore` (or equivalent)
- `SubsystemCorrelationStore` (or equivalent)

This is the **only** file in the snapshot stack that knows how to look up these stores. Future kinds (forecast, simulation, replay) extend `ExecutiveObservationProvider` rather than adding new search logic to the snapshot layer.

**Why two methods, not one `capture(kind)`:** the immutability contract differs between baseline and current (baseline throws on duplicate, current overwrites). Splitting into two methods makes that explicit at the call site. Adding `captureForecast()` or `captureSimulation()` later follows the same pattern without breaking existing callers.

---

## Store design

### File: `src/executive/executive-snapshot-store.ts`

```ts
export class BaselineAlreadyCapturedError extends Error {
  constructor(public readonly planId: string) {
    super(`Baseline already captured for plan ${planId} — baselines are immutable`);
    this.name = "BaselineAlreadyCapturedError";
  }
}

export class ExecutiveSnapshotStore {
  constructor(private readonly dir: string) {}

  // Idempotent + atomic write (mirrors PlanStore pattern with .tmp suffix)
  saveBaseline(snapshot: ExecutivePlanSnapshot): Promise<void>;

  // Replaceable + atomic write
  saveCurrent(snapshot: ExecutivePlanSnapshot): Promise<void>;

  // PlanId-keyed lookups
  loadBaseline(planId: string): Promise<ExecutivePlanSnapshot | null>;
  loadCurrent(planId: string): Promise<ExecutivePlanSnapshot | null>;

  // Idempotency gate used by ExecutionEngine
  hasBaseline(planId: string): Promise<boolean>;

  // Audit helper (used by ExecutiveLifecycleState in Task 3)
  list(): Promise<ExecutivePlanSnapshot[]>;  // empty list if dir missing
}
```

**Atomic-write pattern:** identical to `PlanStore`. Write to `<file>.tmp`, then `rename`. If a partial file exists on disk, `loadX` returns null (the legacy `outcome-store.ts` and `plan-store.ts` test conventions cover this).

### Required tests (in `tests/executive/executive-snapshot-store.vitest.ts`)

- `saveBaseline` → `loadBaseline` round-trip preserves all fields including metadata
- `saveBaseline` idempotency: second `saveBaseline` for the same planId throws `BaselineAlreadyCapturedError`
- `saveCurrent` is replaceable: second `saveCurrent` succeeds and `loadCurrent` returns the latest
- `hasBaseline` returns false for missing file, true after save, remains true after `saveCurrent` (orthogonality)
- Atomic-write integrity test: simulate partially-written `.tmp` file, expect `loadBaseline` to return null rather than corrupted JSON
- Concurrent saves (same planId, parallel writes) — last writer wins for current; baseline throws for the second writer
- File naming: verify both `<planId>-baseline.json` and `<planId>-current.json` are written to the configured directory

---

## Engine hook

### Change to `ExecutionEngine.executeStepInternal`

**Constructor additions** (with backward-compatible defaults):
```ts
constructor(
  ...,
  private readonly snapshotStore: ExecutiveSnapshotStore = new ExecutiveSnapshotStore(join(execDir, "snapshots")),
  private readonly snapshotProvider: ExecutiveSnapshotProvider = createDefaultSnapshotProvider(execDir),
) {}
```

(Note: `execDir` needs to be threaded through. Cleanest path: add `execDir: string` to existing constructor signature or read from a shared config. Discuss with implementer — small wiring change but architectural: the engine now has a "where it lives on disk" concept, which it didn't before. This is acceptable: the engine already writes plan outcomes via the outcome hook, so it already implicitly owns storage.)

**At the start of `executeStepInternal`** (before line 147 `in_progress` mutation):
```ts
if (!await this.snapshotStore.hasBaseline(planId)) {
  const baseline = await this.snapshotProvider.captureBaseline(planId);
  await this.snapshotStore.saveBaseline(baseline);
}
```

**Idempotency property:** `hasBaseline` is the gate. The save happens exactly once per `(planId)` lifetime. Re-running `runStep` or `runReadySteps` is a no-op for baseline capture.

**Why first step execution, not plan start?**
Plan start is intent; first step execution is the mutation boundary.
- Plans created but never run → no baseline (correct: nothing to compare against)
- Plans that have only no-op read-only steps → still get baseline (correct: read-only steps can be auditing actions, plan participants need a before-state)
- Plans that error on first step → baseline captured (correct: failure recovery needs it)

The engine comment block should document this reasoning explicitly so a future implementer doesn't move the hook to `startPlan` "for symmetry."

### Engine integration tests (`tests/executive/execution-engine-baseline.vitest.ts`)

- Fresh plan → `runStep` → assert `<planId>-baseline.json` exists on disk with correct `captureKind`, `snapshotVersion: 1`, and `rawSubsystemState` populated from injected mocks
- Idempotency: `runStep` called twice → baseline file unchanged (one save, no second write attempt)
- Snapshot content: trendSnapshotId, outcomeReportIds etc. match the provider's response
- Failing step → baseline captured (error path doesn't bypass the gate)
- Provider that throws → engine completes step anyway, baseline file is not created (graceful degradation; mirror outcome-hook's best-effort pattern)

---

## Sentinel updates

Add these files to executive purity sentinel `EXECUTIVE_FILES` allowlist:
- `src/executive/executive-snapshot-store.ts`
- `src/executive/executive-snapshot-provider.ts`
- `src/executive/executive-observation-provider.ts`

Same precedent as P10.4b.

## ADR-0005 reference

This plan implements [ADR-0005: Plan-Scoped Snapshots Are Immutable Observations, Not Analytics](../adrs/ADR-0005-plan-scoped-snapshots.md). The implementer MUST read the ADR before starting — it codifies the five immutability rules, the layering invariants, and the "forbidden without new ADR" list. Any deviation from ADR-0005 in implementation requires a new ADR, not a silent change.

---

## Task 2 — Read sites and auto-current on evaluate

### `executive-evaluate-handler.ts:91–95`

**Replace** the time-window trend lookup with planId-keyed snapshot store reads:
```ts
const snapshotStore = new ExecutiveSnapshotStore(snapshotsDir);
const provider = createDefaultSnapshotProvider(execDir);

let baseline: ExecutivePlanSnapshot | null = null;
try { baseline = await snapshotStore.loadBaseline(planId); } catch (e) { /* fail-soft */ }

let current: ExecutivePlanSnapshot | null = null;
try { current = await snapshotStore.loadCurrent(planId); } catch (e) { /* fail-soft */ }

// Auto-capture current lazily if missing — same idempotent pattern as baseline
if (plan && state && (state.status === "completed" || state.status === "failed")) {
  if (!current) {
    current = await provider.captureCurrent(planId);
    await snapshotStore.saveCurrent(current);
  }
}
```

**On missing baseline still:** report `insufficient_data` as today — the baseline MUST already exist by engine invariant, so this is a structural error worth surfacing.

### `automatic-outcome-hook.ts:87–89`

Same replacement. The hook now gets a `current` snapshot lazily if one isn't on disk.

### Director factory

`createAutomaticOutcomeEvaluator(executiveDir)` also constructs `ExecutiveSnapshotStore(join(executiveDir, "snapshots"))` and a default provider.

---

## Out of scope (deferred to Tasks 3+)

- `ExecutiveLifecycleState` model + `alix executive next`
- `--help` normalization + alias suggestions (`trends → learn`, etc.)
- Any P10.10 Executive Signal work (waits for operational friction per methodology)
- Any P11 planning work

---

## Success criteria

- `tsc` clean
- 2165+ tests pass (current + new, all green)
- Sentinel tests pass for the two new files
- Manual verification: run `cockpit` → plan a step → first `runStep` produces `<planId>-baseline.json` with `captureKind: "baseline"` and populated `rawSubsystemState`
- Manual verification: `evaluate <planId>` auto-captures `<planId>-current.json` and produces `evaluationStatus: "completed"` instead of `insufficient_data`
- All existing tests pass — no regressions

---

## Why this is one stabilization slice, not P11

`evaluate` producing `insufficient_data` is not a planning problem. It's a usability problem caused by an implicit prerequisite. Filling it doesn't require any new intelligence — it requires making existing state capture automatic. P10.9.1 turns "executive operator must remember to take a baseline" into "executive operator runs a plan."

P10.10 waits for actual operator friction. P11 waits for normalized inputs from P10.10. Both are downstream of running the system daily and observing what it asks for next.

---

## Layered architecture (locked)

```
ExecutionEngine
        │
        ▼
ExecutiveSnapshotProvider (pure assembly; capture only)
        │
        ▼
ExecutiveObservationProvider (only layer that knows stores)
        │
        ▼
[TrendStore, OutcomeReportStore, Recommendation/Effectiveness/Correlation stores]
        │
        ▼
ExecutivePlanSnapshot { baseline | current }
        │
        ▼
ExecutiveSnapshotStore (atomic write, immutable baseline)
        │
        ▼
OutcomeEvaluator (joins baseline snapshot ref with current analytics)
        │
        ▼
OutcomeReport
        │
        ▼
Learning
```

The execution engine never knows about reports. The snapshot provider never knows about stores. The store never knows about analytics. The observation provider is the single seam where storage is touched. Each layer's purity compounds.

**Architectural principle (lock beside P10 purity rules):**

> *"A snapshot is the immutable record of what the executive system observed, not a re-derived analytics report."*

This statement prevents years of accidental drift. If someone later proposes embedding derived metrics into snapshots, the answer is this principle — not a re-debate.
