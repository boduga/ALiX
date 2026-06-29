# ADR-0005: Plan-Scoped Snapshots Are Immutable Observations, Not Analytics

**Status:** Accepted (2026-06-29)

**Scope:** P10.9.1 Operational Completeness stabilization slice; binds P10, P10.10, P11, and beyond.

**Related:** ADR-0003 (layered purity), ADR-0004 (protected type files).

### Status History

```
Proposed   →   Accepted   →   [Superseded — not yet reached]
   2026-06-29    2026-06-29
```

This ADR enters the canon at "Accepted." Any future superseding ADR must reference ADR-0005 and explain the displacement.

## Context

The Executive intelligence stack (P10.6 → P10.9) computes and persists trend snapshots keyed by time. When a real operator transcript surfaced a lifecycle bug — `evaluate <planId>` returning `insufficient_data` for plans that had actually executed — the investigation revealed the structure of the failure:

1. `OutcomeEvaluator` accepts `baseline: ExecutiveTrendSnapshot | null` correctly.
2. Two call sites (`executive-evaluate-handler.ts:92–95`, `automatic-outcome-hook.ts:87–88`) resolve baseline + current via `trendStore.findBaseline(plan.generatedAt)` — a **time-window lookup**, not a plan-scoped lookup.
3. No code anywhere captures a per-plan baseline. The data simply doesn't exist where the lookup searches.
4. The conceptual bug: trend snapshots (time-series analytics) and plan snapshots (per-execution observations) are different things. Using the former to answer a plan-scoped question produces silent zero-results.

A new snapshot layer is required to support plan-scoped evaluation. Several design questions arise that, if resolved by ad-hoc implementation, will produce years of future drift.

> **Architectural Insight**
>
> **Trend snapshots and plan-scoped snapshots are different things. Using the former to answer a plan-scoped question produces silent zero-results.**
>
> This is the root cause the ADR exists to prevent. The ExecutiveTrendStore (a time-series cache) and the upcoming ExecutiveSnapshotStore (a per-plan audit log) coexist but answer different questions. Crossing the seam — using one to answer the other's query — is the failure mode this ADR permanently rules out.

## Non-Goals

This ADR does **not** define:

- **Lifecycle guidance** (`alix executive next` — Task 3 of P10.9.1).
- **Operator priority / planning signals** (P10.10 Executive Signal Layer).
- **Executive Planning** (P11 — DecisionCandidate generation, prioritization, scheduling).
- **Snapshot retention policy.** No automatic pruning in scope. Baselines are write-once; growth is bounded by plan volume, expected to remain small.
- **Snapshot compression or archival.** Baseline files are ~1 KB JSON; this concern is deferred until measurable.
- **Cross-plan snapshot comparison.** A future "compare two plans' baselines" query would be a new snapshot kind (`comparison`), not a violation of this ADR.
- **Snapshot signing or external audit.** Adds dependency surface; defer until an external audit requirement appears.

## Decision

Plan-scoped snapshots are governed by **five immutable rules**:

| # | Rule | Rationale |
|---|------|-----------|
| 1 | **Baselines are captured once.** Subsequent `saveBaseline(...)` for the same `planId` throws `BaselineAlreadyCapturedError`. | A baseline that can be silently overwritten is a bug waiting to bite at audit time. |
| 2 | **Baselines are immutable.** Successful capture is the final state. Recovery requires operator action: explicit delete or new plan. | The baseline is historical truth. Historical truth is never rewritten. Same audit discipline as P8.5a.0 evidence chains. |
| 3 | **Current snapshots are replaceable.** Evaluation may re-run; current is a moving target of system state. | Asymmetry reflects semantic difference between "what was true when we started" and "what is true right now." |
| 4 | **Snapshots store observations and report references, never derived analytics.** The snapshot body holds `trendSnapshotId`, `outcomeReportIds`, etc. — refs, not scores. | Derived metrics duplicated into snapshots drift from the canonical reports over time. The snapshot is the immutable record of **what the executive system observed**, not what it computed about the observation. |
| 5 | **Evaluation joins snapshots with analytics at compare time, not at capture time.** Comparison happens by joining the snapshot's references with currently-loaded analytics reports. | Analytics evolve; snapshots are frozen. Joining at compare time prevents embedding time-sensitive derived metrics into the historical record. |

### Architectural Principle

> **"A snapshot is the immutable record of what the executive system observed, not a re-derived analytics report."**

This statement ships as a permanent architectural rule, beside the P10 purity rules, to prevent years of accidental drift.

### Layered Architecture

```
ExecutionEngine
        │
        ▼
ExecutiveSnapshotProvider      ← pure assembly; capture only
        │
        ▼
ExecutiveObservationProvider    ← only layer that knows stores
        │
        ▼
[TrendStore, OutcomeReportStore,
 Recommendation/Effectiveness/Correlation stores]
        │
        ▼
ExecutivePlanSnapshot { baseline | current }
        │
        ▼
ExecutiveSnapshotStore          ← atomic write; immutable baseline
        │
        ▼
OutcomeEvaluator                ← joins snapshot refs with new analytics
        │
        ▼
OutcomeReport → Learning
```

The `ExecutiveObservationProvider` is the **single seam** between snapshot assembly and storage. Future snapshot kinds (forecast, simulation, replay) extend this seam rather than adding new search logic to the snapshot layer.

### Type Sketch

```ts
export type ExecutiveSnapshotCaptureKind = "baseline" | "current";
export type ExecutiveSnapshotCaptureReason =
  | "execution-start"
  | "evaluation"
  | "manual"
  | "recovery";

export interface ExecutivePlanSnapshot {
  metadata: {
    snapshotVersion: 1;
    alixVersion: string;
    executiveEngineVersion: string;
    createdBy: "ExecutionEngine" | "EvaluationHandler" | "Provider";
    reason: ExecutiveSnapshotCaptureReason;
  };
  planId: string;
  capturedAt: string;
  captureKind: ExecutiveSnapshotCaptureKind;
  rawSubsystemState: {
    trendSnapshotId?: string;
    outcomeReportIds: string[];
    recommendationReportId?: string;
    effectivenessReportId?: string;
    correlationReportId?: string;
  };
  id: string;  // `<planId>-baseline` or `<planId>-current`
}
```

## Consequences

### Positive

- One class of drift bug is permanently eliminated: snapshots can never disagree with the analytics reports they reference.
- A single seam (`ExecutiveObservationProvider`) prevents the snapshot layer from slowly absorbing orchestration responsibilities.
- The immutability contract for baselines carries forward naturally to future snapshot kinds (`forecast`, `simulation`, `recovery`) — they too become historical records.
- A future "what would have happened if we had captured sooner?" debugging query becomes mechanical: read the snapshot's refs, then load the analytics that were current at `capturedAt`.

### Negative

- **More files.** Three new modules (`ExecutiveSnapshotStore`, `ExecutiveSnapshotProvider`, `ExecutiveObservationProvider`) plus tests. Three is the *minimum* needed to honor the layer separation; conflating any two would re-introduce the drift class.
- **Storage grows linearly with plans.** Each plan persists one baseline file (~1 KB JSON) and zero or one current file. No pruning is in scope — defer to a future stabilization slice when growth becomes meaningful.
- **Capture is now a state-mutating step.** P10.9.1 introduces the first disk-write that the execution engine performs. The engine acquires "writes at execution time" as a conceptual responsibility. This is acceptable because (a) the writes are idempotent, (b) the engine already invokes the outcome hook which writes, and (c) the alternative — operators remembering to take a snapshot — is exactly the lifecycle bug being fixed.

### Neutral

- Existing `ExecutiveTrendStore` (`trends.jsonl`) is unaffected. Time-series analytics and plan-scoped snapshots coexist.
- Existing `OutcomeReportStore` semantics unchanged. Snapshot rules govern a new sibling directory.

## Forbidden Without New ADR

Per ADR-0004's 3-class mutation taxonomy, the following require a new ADR rather than a silent change:

- Storing derived analytics (effectiveness rates, correlation scores, operator response rates) inside a `ExecutivePlanSnapshot` body.
- Allowing `saveBaseline` to overwrite.
- Removing the `ExecutiveObservationProvider` seam.
- Adding snapshot kinds outside the `ExecutiveSnapshotCaptureKind` union.

**Plus, captured by this ADR specifically:**

- **Snapshots must not be queried by timestamp when a plan identifier is available.** This is the original root cause: `findBaseline(plan.generatedAt)` quietly returned `null`, producing `insufficient_data` for plans that *had* executed. The mere existence of `trendStore.findBaseline(...)` answering a plan-scoped question is the failure shape. Any future lookup by `planId` must route through `ExecutiveSnapshotStore.loadBaseline(planId)`, never through a time-window trend scan.

By encoding this prohibition, the ADR makes a class of regression mechanically identifiable: a future code review can flag any `findBaseline(plan.X)` pattern as an ADR-0005 violation without needing context.

## Reasoning Backbone (the executive architecture in one paragraph)

This ADR is one of three canonical rules governing the executive subsystem:

1. **ADR-0003** — Layered purity: lower layers do not reach upward into higher-layer analytics.
2. **ADR-0004** — Protected type files: contracts evolve deliberately, not incidentally.
3. **ADR-0005** *(this ADR)* — Observations are immutable; analytics are derived.

Together they produce a single governing philosophy:

> *Reports are stable contracts. Layers don't recompute lower layers. Observations are immutable; analytics are derived.*

These rules will continue to apply through P10.10, P11, and later strategic-planning layers. Any future ADR that appears to relax or contradict them should be reviewed as if it were proposing to undo the canon.

## References

- `docs/architecture/plans/p10-9-1-operational-completeness.md` — implementation plan
- `src/executive/executive-snapshot-store.ts` — store (immutable baseline)
- `src/executive/executive-snapshot-provider.ts` — provider (pure assembly)
- `src/executive/executive-observation-provider.ts` — observation seam (only store-aware layer)
- `src/executive/execution-engine.ts` — calls provider at first step execution
- P8.5a.0 evidence chain implementation — precedent for write-once immutability
