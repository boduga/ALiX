# M0.77e — Result Aggregation and Failure Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute tasks in order and track every checkbox.
>
> **Target branch:** `feat/m077e-result-aggregation`
> **Builds on:** M0.77a–M0.77d.1

**Goal:** Add deterministic run-level aggregation, structured failure propagation, atomic aggregate persistence with source-fingerprint freshness, optional safe model synthesis, and human/machine-readable result visibility.

**Architecture:** A `ResultAggregator` loads each worker's result via `resultRef`, validates integrity, computes counts/timing/outcome. A source fingerprint (hash of execution-relevant worker state) determines aggregate freshness — not `run.updatedAt` (which would cause instant staleness). A `CoordinationAggregateStore` persists the summary atomically. A `CoordinationCompletionService` ties it together with optional `RunSynthesizer`. Failure provenance is tracked as structured data during reconciliation. A `CoordinationFinalizationLock` prevents race conditions. Finalization runs from every terminal scheduler path, not only `runUntilIdle()`.

**Tech Stack:** TypeScript, existing `CoordinationStore`, `CoordinationResultStore`, `CoordinationRun`, `WorkerAssignment`.

---

## File structure

### Modify
- `src/kernel/coordination-types.ts` — add `failureProvenance`, aggregate fields, outcome, `CoordinationRunOutcome`
- `src/kernel/coordination-store.ts` — add `failureProvenance` to `WorkerPatch`, add `attachAggregate()`, typed `patchWorker()`, normalize new fields
- `src/kernel/coordination-reconciliation.ts` — structured failure provenance (include dependency-blocked sources, merge multiples)
- `src/kernel/coordination-result-store.ts` — `loadByRef()` returning structured `ResultLoadResult`, `loadByRun()`, validation, requiresResultRecord()
- `src/kernel/coordination-scheduler.ts` — `maybeFinalizeRun()` called from every terminal path, optional `completionService` dep
- `src/cli/commands/coordination.ts` — add `results` command, upgrade `status` with freshness/outcome
- `src/events/types.ts` — event type constants

### Create
- `src/kernel/coordination-result-types.ts` — `RunResultSummary`, `FailureChain`, `CoordinationRunOutcome`, `AggregationIssue`, `WorkerResultSummary`, `ResultLoadResult`
- `src/kernel/coordination-aggregation-fingerprint.ts` — `computeAggregationSourceFingerprint()` (hashes execution-relevant worker state, not `updatedAt`)
- `src/kernel/coordination-failure-chain.ts` — `buildFailureChains()` (reverse graph, transitive closure, depth, deterministic sort)
- `src/kernel/coordination-result-aggregator.ts` — `ResultAggregator` with `aggregate()` and `aggregateAndPersist()`
- `src/kernel/coordination-aggregate-store.ts` — `CoordinationAggregateStore` at `.alix/coordination/results/runs/<runId>.json`
- `src/kernel/coordination-finalization-lock.ts` — per-run finalization lock (same pattern as `CoordinationRunLock`)
- `src/kernel/coordination-run-synthesizer.ts` — `RunSynthesizer` interface + `ModelRunSynthesizer`
- `src/kernel/coordination-completion-service.ts` — `CoordinationCompletionService` with `finalize()` (race-safe, idempotent)

### Tests
- `tests/kernel/coordination-result-store.test.ts` — updated with loadByRef and validation
- `tests/kernel/coordination-failure-chain.test.ts`
- `tests/kernel/coordination-result-aggregator.test.ts`
- `tests/kernel/coordination-aggregate-store.test.ts`
- `tests/kernel/coordination-run-synthesizer.test.ts`
- `tests/kernel/coordination-completion-service.test.ts`
- `tests/kernel/coordination-aggregation-fingerprint.test.ts`
- `tests/kernel/coordination-finalization-lock.test.ts`
- `tests/cli/coordination-results.test.ts`
- `tests/integration/coordination-results.integration.test.ts`

---

## M0.77e.1 — Types, outcome, and source fingerprint

**Files:** Create `src/kernel/coordination-result-types.ts`, `src/kernel/coordination-aggregation-fingerprint.ts`
Modify `src/kernel/coordination-types.ts`, `src/kernel/coordination-store.ts`

### Step 1: Create result types

```typescript
// src/kernel/coordination-result-types.ts
export type CoordinationRunOutcome =
  | "success" | "partial_success" | "failure"
  | "cancelled" | "blocked" | "incomplete";

export type AggregationIssueCode =
  | "missing_result" | "corrupt_result" | "run_mismatch"
  | "worker_mismatch" | "attempt_mismatch" | "invalid_timestamp"
  | "invalid_result_status" | "stale_aggregate" | "invalid_failure_provenance";

export type AggregationIssue = { code: AggregationIssueCode; workerId?: string; message: string };

export type WorkerFailureProvenance = {
  directCauseWorkerIds: string[];
  rootCauseWorkerIds: string[];
  propagatedAt: string;
};

export type WorkerResultSummary = {
  workerId: string; taskLabel: string; goalPrompt: string; agentId: string;
  planOrder?: number; status: WorkerStatus; attempt: number; maxAttempts: number;
  outcome?: "success" | "failure"; summary?: string; error?: string;
  failureKind?: WorkerFailureKind; blockReason?: WorkerBlockReason;
  failureProvenance?: WorkerFailureProvenance;
  startedAt?: string; completedAt?: string; durationMs?: number; resultRef?: string;
};

export type FailureChain = {
  rootWorkerId: string; rootTaskLabel: string;
  rootFailureKind?: WorkerFailureKind; rootError?: string;
  directDependents: string[]; allAffectedWorkers: string[];
  depthByWorker: Record<string, number>;
};

export type RunResultCounts = {
  workers: number; completed: number; failed: number; blocked: number;
  cancelled: number; pending: number; running: number;
  successfulResults: number; failedResults: number; missingResults: number;
};

export type RunResultSummary = {
  schemaVersion: "1.0";
  runId: string; rootGoal: string;
  status: CoordinationRunStatus; outcome: CoordinationRunOutcome;
  generatedAt: string;
  sourceFingerprint: string;
  sourceRunUpdatedAt: string;
  complete: boolean;
  issues: AggregationIssue[];
  counts: RunResultCounts;
  workerResults: WorkerResultSummary[];
  failureChains: FailureChain[];
  timing: { startedAt?: string; completedAt?: string; wallClockDurationMs?: number; totalWorkerDurationMs?: number; };
  aggregateRef?: string;
  finalSummary?: string;
  synthesis: { status: "not_requested" | "completed" | "failed"; provider?: string; model?: string; generatedAt?: string; error?: string; };
};

export type ResultLoadResult =
  | { status: "ok"; record: CoordinationWorkerResultRecord }
  | { status: "missing"; message: string }
  | { status: "corrupt"; message: string }
  | { status: "invalid_ref"; message: string }
  | { status: "invalid_record"; message: string };
```

### Step 2: Create source fingerprint

```typescript
// src/kernel/coordination-aggregation-fingerprint.ts
import { createHash } from "node:crypto";
import type { CoordinationRun } from "./coordination-types.js";

export function computeAggregationSourceFingerprint(run: CoordinationRun): string {
  const relevant = {
    runId: run.id,
    rootGoal: run.rootGoal,
    status: run.status,
    workers: run.workers.map(w => ({
      id: w.id, status: w.status, attempt: w.attempt,
      resultRef: w.resultRef, error: w.error,
      failureKind: w.failureKind, blockReason: w.blockReason,
      completedAt: w.completedAt, updatedAt: w.updatedAt,
      failureProvenance: w.failureProvenance,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const canonical = JSON.stringify(relevant, Object.keys(relevant).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
```

### Step 3: Extend coordination-types.ts

Add `failureProvenance?: WorkerFailureProvenance` to `WorkerAssignment`.
Add `aggregateResultRef?: string`, `aggregateGeneratedAt?: string`, `aggregateSourceFingerprint?: string`, `outcome?: CoordinationRunOutcome` to `CoordinationRun`.

### Step 4: Update coordination-store.ts

Add `failureProvenance` to `WorkerPatch`. Replace `patch: Record<string, unknown>` with `patch: WorkerPatch`. Add `attachAggregate()`:

```typescript
async attachAggregate(runId: string, metadata: {
  aggregateResultRef: string;
  aggregateGeneratedAt: string;
  aggregateSourceFingerprint: string;
  outcome: CoordinationRunOutcome;
}): Promise<CoordinationRun | null> {
  return this.updateRun(runId, (run) => {
    run.aggregateResultRef = metadata.aggregateResultRef;
    run.aggregateGeneratedAt = metadata.aggregateGeneratedAt;
    run.aggregateSourceFingerprint = metadata.aggregateSourceFingerprint;
    run.outcome = metadata.outcome;
  });
}
```

Update `normalizeWorkerAssignment` to include `failureProvenance`.

### Step 5: Build and commit

```bash
npm run build
git add src/kernel/coordination-result-types.ts src/kernel/coordination-aggregation-fingerprint.ts src/kernel/coordination-types.ts src/kernel/coordination-store.ts
git commit -m "feat(coordination): add run result and outcome types"
```

---

## M0.77e.2 — Structured failure provenance

**Files:** Modify `src/kernel/coordination-reconciliation.ts`

In the dependency failure propagation fixpoint loop, when a worker is blocked by failed dependencies:

```typescript
const failedDeps = worker.dependencies
  .map(id => currentRun.workers.find(w => w.id === id))
  .filter(w => w && (
    w.status === "failed" || w.status === "cancelled" ||
    (w.status === "blocked" && w.blockReason === "dependency_failed")
  ));

if (failedDeps.length > 0) {
  const directCauseWorkerIds = [...new Set(failedDeps.map(d => d!.id))];
  const rootCauseWorkerIds = [...new Set(
    failedDeps.flatMap(d => d!.failureProvenance?.rootCauseWorkerIds ?? [d!.id])
  )];
  worker.failureProvenance = {
    directCauseWorkerIds: directCauseWorkerIds.sort(),
    rootCauseWorkerIds: rootCauseWorkerIds.sort(),
    propagatedAt: new Date().toISOString(),
  };
}
```

Also persist the patch through the store:
```typescript
await deps.store.patchWorker(runId, worker.id, {
  status: "blocked",
  blockReason: "dependency_failed" as any,
  error: `Dependency ${failedDeps[0]!.id} failed`,
  failureProvenance: worker.failureProvenance,
});
```

### Commit

```bash
npm run build
git add src/kernel/coordination-reconciliation.ts
git commit -m "feat(coordination): persist structured failure provenance"
```

---

## M0.77e.3 — Result integrity

**Files:** Modify `src/kernel/coordination-result-store.ts`

### Step 1: Add `loadByRef()`

```typescript
async loadByRef(resultRef: string): Promise<ResultLoadResult> {
  // 1. Reject absolute paths
  if (resultRef.startsWith("/")) {
    return { status: "invalid_ref", message: "Absolute paths not allowed" };
  }
  // 2. Resolve and verify containment
  const resolved = join(this.baseDir, resultRef);
  const rel = relative(this.baseDir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel) || !rel.endsWith(".json")) {
    return { status: "invalid_ref", message: "Reference outside result directory or invalid format" };
  }
  // 3. Reject aggregate runs/ paths
  if (rel.startsWith("runs/")) {
    return { status: "invalid_ref", message: "Cannot load aggregate as worker result" };
  }
  // 4. Load and validate
  if (!existsSync(resolved)) {
    return { status: "missing", message: `Result not found: ${resultRef}` };
  }
  try {
    const raw = await readFile(resolved, "utf-8");
    const parsed = JSON.parse(raw);
    if (!validateWorkerResultRecord(parsed)) {
      return { status: "invalid_record", message: "Result record failed validation" };
    }
    return { status: "ok", record: parsed };
  } catch (e) {
    return { status: "corrupt", message: `Failed to parse result: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

### Step 2: Add validation guard

```typescript
export function validateWorkerResultRecord(value: unknown): value is CoordinationWorkerResultRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return r.schemaVersion === "1.0"
    && typeof r.runId === "string"
    && typeof r.workerId === "string"
    && typeof r.agentId === "string"
    && typeof r.attempt === "number"
    && (r.outcome === "success" || r.outcome === "failure")
    && typeof r.completedAt === "string";
}
```

### Step 3: Add `requiresResultRecord()`

```typescript
export function requiresResultRecord(worker: WorkerAssignment): boolean {
  return worker.status === "completed"
    || (worker.status === "failed"
        && (worker.failureKind === "execution_error"
            || worker.failureKind === "timeout"
            || worker.failureKind === "transient_provider"
            || !worker.failureKind)); // executed failures
}
```

### Commit

```bash
npm run build
git add src/kernel/coordination-result-store.ts
git commit -m "feat(coordination): validate worker result references"
```

---

## M0.77e.4 — Failure-chain builder

**Files:** Create `src/kernel/coordination-failure-chain.ts`

```typescript
import type { CoordinationRun, WorkerAssignment } from "./coordination-types.js";
import type { FailureChain } from "./coordination-result-types.js";

export function buildFailureChains(run: CoordinationRun): FailureChain[] {
  // 1. Build reverse dependency graph
  const dependents = new Map<string, string[]>();
  for (const w of run.workers) {
    for (const dep of w.dependencies) {
      const list = dependents.get(dep) ?? [];
      list.push(w.id);
      dependents.set(dep, list);
    }
  }

  // 2. Find root failures (failed/cancelled workers that are not dependency-blocked)
  const rootFailures = run.workers.filter(w =>
    w.status === "failed" || w.status === "cancelled"
  ).filter(w =>
    w.blockReason !== "dependency_failed"
  );

  // 3. For each root, compute transitive closure via BFS
  const chains: FailureChain[] = [];
  for (const root of rootFailures) {
    const visited = new Set<string>();
    const queue = [root.id];
    const depthByWorker: Record<string, number> = { [root.id]: 0 };

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const deps = dependents.get(id) ?? [];
      for (const dId of deps) {
        depthByWorker[dId] = (depthByWorker[id] ?? 0) + 1;
        queue.push(dId);
      }
    }

    const allAffected = [...visited].filter(id => id !== root.id);
    const directDependents = (dependents.get(root.id) ?? []).slice();

    chains.push({
      rootWorkerId: root.id,
      rootTaskLabel: root.taskLabel,
      rootFailureKind: root.failureKind,
      rootError: root.error,
      directDependents: directDependents.sort(),
      allAffectedWorkers: allAffected.sort(),
      depthByWorker,
    });
  }

  // 4. Sort deterministically
  const orderBy = new Map(run.workers.map((w, i) => [w.id, i]));
  chains.sort((a, b) =>
    (orderBy.get(a.rootWorkerId) ?? 0) - (orderBy.get(b.rootWorkerId) ?? 0)
  );

  return chains;
}
```

### Commit

```bash
npm run build && node --test dist/tests/kernel/coordination-failure-chain.test.js
git add src/kernel/coordination-failure-chain.ts tests/kernel/coordination-failure-chain.test.ts
git commit -m "feat(coordination): add transitive failure-chain builder"
```

---

## M0.77e.5 — Deterministic aggregation

**Files:** Create `src/kernel/coordination-result-aggregator.ts`

```typescript
export class ResultAggregator {
  constructor(
    private resultStore: CoordinationResultStore,
    private aggregateStore: CoordinationAggregateStore,
  ) {}

  async aggregate(run: CoordinationRun): Promise<RunResultSummary> {
    // For each worker: copy state, compute durationMs, load result via resultRef
    // Validate: runId/workerId/attempt match, outcome consistency
    // Record issues for missing/corrupt/mismatch
    // Compute counts from worker statuses + validated result outcomes
    // Compute timing: earliest start → latest completion
    // Compute completeness: every requiresResultRecord() worker has valid result
    // Compute outcome
    // Build failure chains
  }

  async aggregateAndPersist(run: CoordinationRun): Promise<RunResultSummary> {
    const summary = await this.aggregate(run);
    summary.aggregateRef = await this.aggregateStore.persist(summary);
    return summary;
  }
}
```

Outcome rules:
- `complete: false` → `incomplete`
- all completed + all success results → `success`
- some success + terminal failures → `partial_success`
- no success + failures → `failure`
- all terminal cancelled → `cancelled`
- blocked with no success → `blocked`

### Commit

```bash
npm run build
git add src/kernel/coordination-result-aggregator.ts
git commit -m "feat(coordination): add deterministic run result aggregator"
```

---

## M0.77e.6 — Aggregate store and finalization lock

**Files:** Create `src/kernel/coordination-aggregate-store.ts`, `src/kernel/coordination-finalization-lock.ts`

`CoordinationAggregateStore`: persists at `.alix/coordination/results/runs/<runId>.json`. Atomic write via temp+rename. `persist(summary)` and `load(runId)`. `load()` validates via `validateRunResultSummary()`.

`CoordinationFinalizationLock`: lock at `.alix/coordination/results/runs/<runId>.lock`. Same pattern as `CoordinationRunLock` — atomic mkdir, stale PID recovery, token-safe release.

### Commit

```bash
npm run build
git add src/kernel/coordination-aggregate-store.ts src/kernel/coordination-finalization-lock.ts
git commit -m "feat(coordination): add atomic aggregate result store and finalization lock"
```

---

## M0.77e.7 — Completion service

**Files:** Create `src/kernel/coordination-completion-service.ts`

```typescript
export type CoordinationCompletionServiceDeps = {
  coordinationStore: CoordinationStore;
  resultAggregator: ResultAggregator;
  aggregateStore: CoordinationAggregateStore;
  fingerprint: typeof computeAggregationSourceFingerprint;
  synthesizer?: RunSynthesizer;
  clock?: Clock;
};

export class CoordinationCompletionService {
  async finalize(runId: string, options?: { synthesize?: boolean; signal?: AbortSignal }): Promise<RunResultSummary> {
    const lock = new CoordinationFinalizationLock(this.deps.coordinationStore["cwd"], runId);
    if (!(await lock.acquire())) throw new Error("Could not acquire finalization lock");
    try {
      const run = await this.deps.coordinationStore.load(runId);
      if (!run) throw new Error("Run not found");

      // Compute source fingerprint
      const fingerprint = this.deps.fingerprint(run);

      // Check for fresh aggregate
      if (run.aggregateSourceFingerprint === fingerprint && run.aggregateResultRef) {
        const existing = await this.deps.aggregateStore.load(runId);
        if (existing) return existing;
      }

      // Aggregate
      const summary = await this.deps.resultAggregator.aggregate(run);

      // Persist aggregate
      const ref = await this.deps.aggregateStore.persist(summary);
      summary.aggregateRef = ref;

      // Optional synthesis
      if (options?.synthesize && this.deps.synthesizer) {
        try {
          const input: RunSynthesisInput = { /* ... */ };
          summary.finalSummary = await this.deps.synthesizer.synthesize(input, options.signal);
          summary.synthesis = { status: "completed", generatedAt: new Date().toISOString() };
        } catch (e) {
          summary.synthesis = { status: "failed", error: String(e), generatedAt: new Date().toISOString() };
        }
      }

      // Attach metadata to run
      await this.deps.coordinationStore.attachAggregate(runId, {
        aggregateResultRef: ref,
        aggregateGeneratedAt: summary.generatedAt,
        aggregateSourceFingerprint: fingerprint,
        outcome: summary.outcome,
      });

      return summary;
    } finally { lock.release(); }
  }
}
```

### Commit

```bash
npm run build
git add src/kernel/coordination-completion-service.ts
git commit -m "feat(coordination): add race-safe terminal completion service"
```

---

## M0.77e.8 — Optional synthesis

**Files:** Create `src/kernel/coordination-run-synthesizer.ts`

```typescript
export interface RunSynthesisInput {
  runId: string;
  rootGoal: string;
  workerResults: WorkerResultSummary[];
}

export interface RunSynthesizer {
  synthesize(input: RunSynthesisInput, signal?: AbortSignal): Promise<string>;
}
```

`ModelRunSynthesizer`: calls configured model with tools disabled, bounded input/output tokens, worker output delimited as untrusted data, failure non-fatal, records provider/model.

### Commit

```bash
npm run build
git add src/kernel/coordination-run-synthesizer.ts
git commit -m "feat(coordination): add optional safe model synthesis"
```

---

## M0.77e.9 — Terminal integration

**Files:** Modify `src/kernel/coordination-scheduler.ts`

Add optional `completionService` to `CoordinationSchedulerDeps`. Add `maybeFinalizeRun()`:

```typescript
private async maybeFinalizeRun(runId: string): Promise<void> {
  if (!this.deps.completionService) return;
  const run = await this.deps.store.load(runId);
  if (!run || (run.status !== "completed" && run.status !== "failed")) return;
  await this.deps.completionService.finalize(runId).catch(() => {});
}
```

Call `maybeFinalizeRun()` after:
- `tick()` releases (run becomes terminal)  
- `executeWorker()` completes (last worker finishes)
- `cancelRun()` finishes (run becomes cancelled/terminal)

### Commit

```bash
npm run build
git add src/kernel/coordination-scheduler.ts
git commit -m "feat(coordination): finalize terminal runs from every scheduler path"
```

---

## M0.77e.10 — CLI and observability

**Files:** Modify `src/cli/commands/coordination.ts`, `src/events/types.ts`

### CLI

```
alix coordination status <run-id> [--json]
  — shows live state, aggregate freshness, outcome

alix coordination results <run-id> [--json] [--refresh] [--synthesize]
  — missing aggregate → generate
  — fresh aggregate → load
  — stale aggregate → auto-refresh
  --refresh → force regenerate
  --synthesize → request model synthesis
```

### Events

Add `APPROVAL_EVENT_TYPES` or a new `COORDINATION_EVENT_TYPES`:
```typescript
export const COORDINATION_EVENT_TYPES = {
  AGGREGATE_STARTED: "coordination.aggregate.started",
  AGGREGATE_COMPLETED: "coordination.aggregate.completed",
  AGGREGATE_FAILED: "coordination.aggregate.failed",
  AGGREGATE_STALE: "coordination.aggregate.stale",
  SYNTHESIS_STARTED: "coordination.synthesis.started",
  SYNTHESIS_COMPLETED: "coordination.synthesis.completed",
  SYNTHESIS_FAILED: "coordination.synthesis.failed",
  FAILURE_PROPAGATED: "coordination.failure.propagated",
} as const;
```

### Commit

```bash
npm run build
git add src/cli/commands/coordination.ts src/events/types.ts
git commit -m "feat(cli): add coordination results and JSON output"
```

---

## Verification

```bash
npm run build

node --test dist/tests/kernel/coordination-result-store.test.js
node --test dist/tests/kernel/coordination-failure-chain.test.js
node --test dist/tests/kernel/coordination-result-aggregator.test.js
node --test dist/tests/kernel/coordination-aggregate-store.test.js
node --test dist/tests/kernel/coordination-run-synthesizer.test.js
node --test dist/tests/kernel/coordination-completion-service.test.js
node --test dist/tests/kernel/coordination-aggregation-fingerprint.test.js
node --test dist/tests/kernel/coordination-finalization-lock.test.js
node --test dist/tests/cli/coordination-results.test.js
node --test dist/tests/integration/coordination-results.integration.test.js

npm run test:node:ci
```

---

## Suggested commits (in order)

```
feat(coordination): add run result and outcome types
feat(coordination): add aggregate source fingerprint
refactor(coordination): type aggregate and provenance store updates
feat(coordination): persist structured failure provenance
feat(coordination): validate worker result references
feat(coordination): add transitive failure-chain builder
feat(coordination): add deterministic run result aggregator
feat(coordination): add atomic aggregate result store and finalization lock
feat(coordination): add race-safe terminal completion service
feat(coordination): add optional safe model synthesis
feat(coordination): finalize terminal runs from every scheduler path
feat(cli): add coordination results and JSON output
feat(observability): add aggregation events audit and metrics
test(coordination): add result integrity and failure propagation coverage
docs(coordination): document run results and synthesis
```
