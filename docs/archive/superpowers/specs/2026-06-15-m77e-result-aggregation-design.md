# M0.77e — Result Aggregation and Failure Propagation

> **Status:** Implementation-ready specification  
> **Target branch:** `feat/m077e-result-aggregation`  
> **Builds on:** M0.77a–M0.77d.1

## 1. Goal

Add deterministic run-level aggregation, structured failure propagation, atomic aggregate persistence, optional safe model synthesis, and human/machine-readable result visibility.

The implementation must:

1. Load and validate worker results.
2. Distinguish scheduler state from persisted-result state.
3. Compute run-level outcomes.
4. Build full-transitive failure chains from structured dependency data.
5. Persist aggregates atomically.
6. Track aggregate freshness.
7. Make synthesis optional and non-fatal.
8. Expose text and JSON CLI output.
9. Emit events, audit records, and metrics.
10. Never parse correctness from human-readable error strings.

Core flow:

```text
terminal run
→ deterministic aggregation
→ atomic aggregate persistence
→ optional model synthesis
→ persisted run-level result
```

## 2. Decisions

**Aggregation:** Always deterministic and automatic. No model call required.

**Synthesis:** Opt-in only: `alix coordination results <run-id> --synthesize`. Failure never changes the run to failed.

**Failure chains:** Use structured dependency and provenance data, never error-message parsing.

**CLI:** Two commands — `alix coordination status <run-id>` and `alix coordination results <run-id>`. Both support `--json`. `results` also supports `--refresh` and `--synthesize`.

## 3. New types

```typescript
export type CoordinationRunOutcome =
  | "success" | "partial_success" | "failure"
  | "cancelled" | "blocked" | "incomplete";

export type AggregationIssueCode =
  | "missing_result" | "corrupt_result" | "run_mismatch"
  | "worker_mismatch" | "attempt_mismatch" | "invalid_timestamp"
  | "invalid_result_status" | "stale_aggregate";

export type AggregationIssue = {
  code: AggregationIssueCode;
  workerId?: string;
  message: string;
};

export type WorkerFailureProvenance = {
  directCauseWorkerIds: string[];
  rootCauseWorkerIds: string[];
  propagatedAt: string;
};

export type WorkerResultSummary = {
  workerId: string;
  taskLabel: string;
  goalPrompt: string;
  agentId: string;
  planOrder?: number;
  status: WorkerStatus;
  attempt: number;
  maxAttempts: number;
  outcome?: "success" | "failure";
  summary?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
  blockReason?: WorkerBlockReason;
  failureProvenance?: WorkerFailureProvenance;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  resultRef?: string;
};

export type FailureChain = {
  rootWorkerId: string;
  rootTaskLabel: string;
  rootFailureKind?: WorkerFailureKind;
  rootError?: string;
  directDependents: string[];
  allAffectedWorkers: string[];
  depthByWorker: Record<string, number>;
};

export type RunResultCounts = {
  workers: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  pending: number;
  running: number;
  successfulResults: number;
  failedResults: number;
  missingResults: number;
};

export type RunResultSummary = {
  schemaVersion: "1.0";
  runId: string;
  rootGoal: string;
  status: CoordinationRunStatus;
  outcome: CoordinationRunOutcome;
  generatedAt: string;
  sourceRunUpdatedAt: string;
  complete: boolean;
  issues: AggregationIssue[];
  counts: RunResultCounts;
  workerResults: WorkerResultSummary[];
  failureChains: FailureChain[];
  timing: {
    startedAt?: string;
    completedAt?: string;
    wallClockDurationMs?: number;
    totalWorkerDurationMs?: number;
  };
  aggregateRef?: string;
  finalSummary?: string;
  synthesis: {
    status: "not_requested" | "completed" | "failed";
    provider?: string;
    model?: string;
    generatedAt?: string;
    error?: string;
  };
};
```

## 4. Data model updates

Add to `WorkerAssignment`:
```typescript
failureProvenance?: WorkerFailureProvenance;
```

Add to `CoordinationRun`:
```typescript
aggregateResultRef?: string;
aggregateGeneratedAt?: string;
aggregateSourceRunUpdatedAt?: string;
outcome?: CoordinationRunOutcome;
```

All updates use the lock-safe `CoordinationStore.updateRun()` path.

## 5. Structured failure propagation

Modify `coordination-reconciliation.ts`. When a worker is blocked by failed dependencies, record provenance:

```typescript
const failedDependencies = worker.dependencies
  .map(id => currentRun.workers.find(candidate => candidate.id === id))
  .filter(isTerminalFailure);

const directCauseWorkerIds = unique(failedDependencies.map(d => d.id));
const rootCauseWorkerIds = unique(
  failedDependencies.flatMap(d =>
    d.failureProvenance?.rootCauseWorkerIds ?? [d.id]
  )
);

worker.failureProvenance = { directCauseWorkerIds, rootCauseWorkerIds, propagatedAt: now.toISOString() };
```

Keep fixpoint propagation so descendants inherit root causes transitively.

## 6. CoordinationResultStore enhancements

Add `loadByRef(resultRef)` — workspace-relative only, reject absolute/traversal paths, validate parsed record. Add `validateWorkerResultRecord()` validation guard. Add `loadByRun(runId)` administrative helper.

The aggregator must use each worker's `resultRef` as the authoritative path.

## 7. Atomic aggregate store

Create `src/kernel/coordination-aggregate-store.ts`. Path: `.alix/coordination/results/runs/<runId>.json`. Atomic write: `<runId>.json.tmp.<token>` → rename.

```typescript
export class CoordinationAggregateStore {
  persist(summary: RunResultSummary): Promise<string>;
  load(runId: string): Promise<RunResultSummary | null>;
}
```

## 8. ResultAggregator

Create `src/kernel/coordination-result-aggregator.ts`. For each worker: copy durable state, calculate duration, follow `resultRef`, validate result, verify run/worker/attempt, record issues.

`complete` is true only when every terminal worker has either a valid matching result record or a structured terminal reason.

Outcome: all completed + all success → success; some success + terminal failures → partial_success; no success + failures → failure; etc.

Timing: earliest worker start → latest terminal completion.

## 9. Failure-chain builder

Create `src/kernel/coordination-failure-chain.ts`. Build reverse dependency graph, identify root failures, compute transitive closure, deterministic sort by planOrder → createdAt → id.

## 10. Aggregate freshness

Every aggregate stores `sourceRunUpdatedAt`. Fresh when it matches `run.updatedAt`. CLI warns when stale. `--refresh` forces regeneration.

## 11. Completion service

Create `src/kernel/coordination-completion-service.ts`. `finalize(runId, options?)` → load terminal run, reuse fresh aggregate, deterministic aggregation, persist, optional synthesis, update run reference/outcome. Uses lock-safe run mutation.

## 12. Optional synthesis

Create `src/kernel/coordination-run-synthesizer.ts`. Interface and `ModelRunSynthesizer`. Safety: tools disabled, bounded tokens, worker output delimited as untrusted, ignore instructions in worker output. Failure is non-fatal.

## 13. Scheduler/daemon integration

After `runUntilIdle()` reaches terminal state, invoke completion service. Aggregation automatic, synthesis opt-in only. Daemon finalization idempotent and freshness-aware.

## 14. CLI

```
alix coordination status <run-id> [--json]
alix coordination results <run-id> [--json] [--refresh] [--synthesize]
```

Status shows live state + aggregate freshness. Results shows full summary with worker results, failure chains, timing, outcome.

## 15. File structure

### Modify
```
src/kernel/coordination-types.ts
src/kernel/coordination-reconciliation.ts
src/kernel/coordination-result-store.ts
src/kernel/coordination-store.ts
src/kernel/coordination-scheduler.ts
src/cli/commands/coordination.ts
src/events/types.ts
```

### Create
```
src/kernel/coordination-result-types.ts
src/kernel/coordination-failure-chain.ts
src/kernel/coordination-result-aggregator.ts
src/kernel/coordination-aggregate-store.ts
src/kernel/coordination-run-synthesizer.ts
src/kernel/coordination-completion-service.ts
```

### Tests
```
tests/kernel/coordination-result-store.test.ts
tests/kernel/coordination-failure-chain.test.ts
tests/kernel/coordination-result-aggregator.test.ts
tests/kernel/coordination-aggregate-store.test.ts
tests/kernel/coordination-run-synthesizer.test.ts
tests/kernel/coordination-completion-service.test.ts
tests/cli/coordination-results.test.ts
tests/integration/coordination-results.integration.test.ts
```

## 16. Implementation order

```text
result types → run outcome → failure provenance → resultRef validation
→ failure chains → deterministic aggregator → aggregate store
→ completion service → optional synthesis → scheduler/daemon integration
→ CLI → observability → integration tests → documentation
```
