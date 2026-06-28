# M0.77c — Ownership-Aware Worker Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Execute tasks in order and track every checkbox.
>
> **Status:** Implementation-ready after repository/API alignment  
> **Target branch:** `feat/m077c-ownership-aware-worker-scheduler`  
> **Builds on:** M0.75 Ownership Registry, M0.76.2 Unified Execution Authorization, M0.77a Coordination Data Model, M0.77b Coordination Planner

---

## 1. Goal

Execute validated coordination workers safely, deterministically, recoverably, and with bounded concurrency.

The scheduler must:

1. Load a persisted `CoordinationRun`.
2. Normalize records written by earlier coordination milestones.
3. Reconcile stale running workers.
4. Propagate dependency failures transitively.
5. Resume approval-blocked workers after approval resolution.
6. Determine dependency-ready workers.
7. Authorize every declared capability.
8. Fail closed when capability metadata is absent.
9. Atomically reserve all ownership claims for mutating workers.
10. Persist worker running state before execution starts.
11. Execute through an injectable, cancellable executor.
12. Persist success and failure results atomically.
13. Apply structured retry policy.
14. Renew and release leases safely.
15. Prevent concurrent state-update loss.
16. Support foreground and daemon hosting.
17. Emit events, audit records, and scheduler metrics.
18. Never rely on events for scheduler correctness.

**Authoritative dispatch condition:**

```
dependency-ready
+ authorization allowed
+ ownership acquired
+ concurrency slot available
+ retry budget available
= dispatchable
```

---

## 2. Architecture

### 2.1 Pull-based scheduler core

```
scheduler.tick(runId)
```

performs one reconciliation-and-dispatch cycle. The scheduler does not own an infinite internal timer.

### 2.2 Callers own cadence

```
CLI foreground       → runUntilIdle()
Daemon               → tickAll() on bounded timer
Inspector/admin      → tick()
Recovery             → reconcile() then tick()
Tests                → direct deterministic invocation
```

### 2.3 Correctness source

Periodic reconciliation is authoritative. Events and completion callbacks improve responsiveness but are never correctness dependencies.

### 2.4 Default concurrency

```
maxConcurrency = 1;
```

Hard cap: `MAX_COORDINATION_CONCURRENCY = 8;`

---

## 3. Non-goals

M0.77c does not implement: distributed scheduling, cross-host migration, speculative execution, dynamic DAG mutation, worker-to-worker messaging, distributed consensus, preemptive scheduling, result synthesis, adaptive priority queues, policy rewriting, event-bus-driven correctness.

---

## 4. Repository API alignment

The implementation must use the current ALiX APIs.

### 4.1 OwnershipRegistry

Current batch API:
```
acquireMany(requests: AcquireRequest[]): Promise<AcquireResult[]>;
```

Result shape:
```
type AcquireResult = {
  acquired: boolean;
  record?: OwnershipRecord;
  conflict?: { reason: string; conflictingRecords: OwnershipRecord[]; };
};
```

Current lease operations:
```
release(id: string): Promise<boolean>;
renew(id: string, ttlMs?: number): Promise<boolean>;
```

Do not use fictional fields such as `success` or `recordId`.

### 4.2 CoordinationStore

The current store uses `load → mutate → full overwrite` and does not support concurrent writers. All mutating operations must be migrated to a per-run lock and atomic write.

### 4.3 ExecutionAuthorization

Authorization requires `cwd`, `sessionMode`, `sessionId`, `capability`, `source`, `agentId`, `nodeId`, `graphId`. The scheduler requires workspace and config dependencies.

---

## 5. Core invariants

- **Durable state before execution:** authorize → acquire ownership → persist running state → execute
- **Ownership is all-or-nothing:** partial claim acquisition is rolled back immediately
- **Every run mutation is lock-safe:** parallel completions cannot overwrite each other
- **Authorization fails closed:** any denied → terminal denial; else any approval → approval block; else all allowed → dispatchable. Empty capabilities are not allowed.
- **Retry waits remain schedulable:** retryable workers return to `status: "pending"`, `blockReason: undefined`
- **Lease cleanup is unconditional:** release runs in `finally`
- **Foreground execution always terminates:** completed, failed, awaiting approval, terminally blocked, idle threshold, or timeout

---

## 6. File structure

### Modify
```
src/kernel/coordination-types.ts
src/kernel/coordination-planner.ts
src/kernel/coordination-store.ts
src/cli.ts
daemon composition/startup file
docs/user-manual.md
README.md
```

### Create
```
src/kernel/coordination-run-lock.ts
src/kernel/ownership-claim-compiler.ts
src/kernel/coordination-ownership.ts
src/kernel/coordination-result-store.ts
src/kernel/coordination-reconciliation.ts
src/kernel/coordination-authorization.ts
src/kernel/worker-executor.ts
src/kernel/coordination-scheduler.ts
src/daemon/coordination-scheduler-service.ts
src/cli/commands/coordination.ts
```

### Tests
```
tests/kernel/coordination-run-lock.test.ts
tests/kernel/ownership-claim-compiler.test.ts
tests/kernel/coordination-ownership.test.ts
tests/kernel/coordination-store-concurrency.test.ts
tests/kernel/coordination-result-store.test.ts
tests/kernel/coordination-reconciliation.test.ts
tests/kernel/coordination-authorization.test.ts
tests/kernel/coordination-scheduler.test.ts
tests/daemon/coordination-scheduler-service.test.ts
tests/cli/coordination.test.ts
tests/integration/coordination-scheduler.integration.test.ts
```

---

## M0.77c.1 — Scheduler metadata and backward compatibility

**Files:** Modify `src/kernel/coordination-types.ts`, Modify `src/kernel/coordination-store.ts`

- [ ] **Step 1: Add scheduler types to coordination-types.ts**

```typescript
export type WorkerBlockReason =
  | "approval_required" | "authorization_denied" | "ownership_conflict"
  | "dependency_failed" | "orphaned" | "concurrency_limit"
  | "execution_failed" | "lease_lost" | "cancelled";

export type WorkerFailureKind =
  | "transient_provider" | "timeout" | "authorization_denied"
  | "approval_required" | "ownership_conflict" | "execution_error"
  | "orphaned" | "dependency_failed" | "lease_lost" | "cancelled";

export type WorkerOwnershipClaim = {
  path: string;
  recursive: boolean;
  sourcePattern?: string;
};

export type WorkerCapabilityDecision = {
  capability: string;
  status: "allowed" | "denied" | "approval_required";
  policyRuleId?: string;
  approvalId?: string;
  reason?: string;
};

export type WorkerAuthorizationEvidence = {
  evaluatedAt: string;
  policyRevision?: number;
  decisions: WorkerCapabilityDecision[];
};
```

- [ ] **Step 2: Extend WorkerAssignment interface**

Add after existing fields:
```typescript
  sourceNodeId?: string;
  requiredCapabilities: string[];
  riskLevel?: string;
  approvalMode?: string;
  attempt: number;
  maxAttempts: number;
  planOrder?: number;
  nextAttemptAt?: string;
  ownershipClaims: WorkerOwnershipClaim[];
  leaseIds?: string[];
  executionOwnerId?: string;
  lastHeartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockReason?: WorkerBlockReason;
  failureKind?: WorkerFailureKind;
  approvalId?: string;
  authorizationEvidence?: WorkerAuthorizationEvidence;
```

- [ ] **Step 3: Extend createWorkerAssignment options**

```typescript
  requiredCapabilities?: string[];
  riskLevel?: string;
  approvalMode?: string;
  sourceNodeId?: string;
  attempt?: number;
  maxAttempts?: number;
  planOrder?: number;
  nextAttemptAt?: string;
  ownershipClaims?: WorkerOwnershipClaim[];
  leaseIds?: string[];
  executionOwnerId?: string;
  lastHeartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockReason?: WorkerBlockReason;
  failureKind?: WorkerFailureKind;
  approvalId?: string;
  authorizationEvidence?: WorkerAuthorizationEvidence;
```

Defaults:
```typescript
  requiredCapabilities: opts.requiredCapabilities ?? [],
  attempt: opts.attempt ?? 0,
  maxAttempts: opts.maxAttempts ?? 3,
  ownershipClaims: opts.ownershipClaims ?? [],
```

- [ ] **Step 4: Add normalizeWorkerAssignment to coordination-store.ts**

```typescript
export function normalizeWorkerAssignment(worker: WorkerAssignment): WorkerAssignment {
  return {
    ...worker,
    requiredCapabilities: worker.requiredCapabilities ?? [],
    attempt: worker.attempt ?? 0,
    maxAttempts: worker.maxAttempts ?? 3,
    ownershipClaims: worker.ownershipClaims ?? [],
  };
}
```

Call `normalizeWorkerAssignment` on every worker inside `load()` and `list()`.

- [ ] **Step 5: Write tests**

Test that old M0.77a workers load with defaults, old M0.77b workers load with defaults, new fields round-trip, no existing coordination fixture breaks.

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add src/kernel/coordination-types.ts src/kernel/coordination-store.ts tests/kernel/coordination-types.test.ts
git commit -m "feat(coordination): add scheduler metadata and record normalization"
```

---

## M0.77c.2 — Ownership claim compiler

**Files:** Create `src/kernel/ownership-claim-compiler.ts`, Create `tests/kernel/ownership-claim-compiler.test.ts`

- [ ] **Step 1: Create the compiler**

```typescript
export type OwnershipClaimCompileResult = {
  claims: WorkerOwnershipClaim[];
  warnings: string[];
};

export function compileOwnershipClaims(patterns: string[]): OwnershipClaimCompileResult;
```

Conversion rules:
```
src/**                → path=src, recursive=true
docs/**               → path=docs, recursive=true
package.json          → path=package.json, recursive=false
README.md             → path=README.md, recursive=false
.github/**            → path=.github, recursive=true
**                    → path=., recursive=true
Dockerfile*           → path=., recursive=true
docker-compose*.yml   → path=., recursive=true
unsupported wildcard  → nearest safe parent or .
```

Security: reject absolute paths, `../` traversal, tilde paths, empty paths, NUL characters. Unsafe source patterns must not silently become empty claims.

- [ ] **Step 2: Write tests**

Required: `src/**`, plain file, `**`, wildcard widening, multiple patterns, deduplication, traversal rejected, absolute path rejected, empty list remains empty for confirmed read-only worker.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/ownership-claim-compiler.test.js
git add src/kernel/ownership-claim-compiler.ts tests/kernel/ownership-claim-compiler.test.ts
git commit -m "feat(coordination): add conservative ownership claim compiler"
```

---

## M0.77c.3 — Planner migration

**Files:** Modify `src/kernel/coordination-planner.ts`, Modify planner tests

- [ ] **Step 1: Use the real claim compiler**

Import `compileOwnershipClaims` from `./ownership-claim-compiler.js`. Do not commit a stub that produces empty claims.

After DAG validation, build a topological order map:
```typescript
const planOrderByNode = new Map(dagResult.topologicalOrder.map((nodeId, index) => [nodeId, index]));
```

For every worker:
```typescript
const claimResult = compileOwnershipClaims(ownershipScopes);

createWorkerAssignment({
  // existing fields
  sourceNodeId: node.id,
  requiredCapabilities: node.requiredCapabilities ?? [],
  riskLevel: node.riskLevel,
  approvalMode: node.approvalMode,
  attempt: 0,
  maxAttempts: 3,
  planOrder: planOrderByNode.get(node.id),
  ownershipClaims: claimResult.claims,
});
```

- [ ] **Step 2: Write tests**

Topological `planOrder`, claims populated, read-only worker claims empty, unknown write produces workspace claim, warnings do not discard claims.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-planner.test.js
git add src/kernel/coordination-planner.ts tests/kernel/coordination-planner.test.ts
git commit -m "feat(coordination): populate scheduler metadata during planning"
```

---

## M0.77c.4 — Per-run lock and atomic CoordinationStore

**Files:** Create `src/kernel/coordination-run-lock.ts`, Modify `src/kernel/coordination-store.ts`, Create lock and concurrency tests

- [ ] **Step 1: Create coordination-run-lock.ts**

Lock directory: `<cwd>/.alix/coordination/locks/<runId>.lock`. Use atomic directory creation.

Lock metadata:
```typescript
export type CoordinationLockMetadata = {
  pid: number;
  token: string;
  acquiredAt: string;
};
```

Stale recovery: a lock is recoverable only when age > stale threshold AND recorded PID is not alive. Token-safe release: release only when stored token matches the lock instance token.

- [ ] **Step 2: Add updateRun and patchWorker to CoordinationStore**

```typescript
async updateRun(runId: string, mutate: (run: CoordinationRun) => void | Promise<void>): Promise<CoordinationRun | null>;
```

Atomic write: `<runId>.json.tmp.<token>` → rename → `<runId>.json`.

Worker patch type:
```typescript
export type WorkerPatch = Partial<Pick<WorkerAssignment,
  | "status" | "resultRef" | "error" | "attempt" | "blockReason"
  | "failureKind" | "approvalId" | "startedAt" | "completedAt"
  | "lastHeartbeatAt" | "leaseIds" | "executionOwnerId"
  | "authorizationEvidence" | "nextAttemptAt"
>>;
```

`patchWorker()` must reject missing worker, update `worker.updatedAt`, use `updateRun()`, never permit changing worker ID or run ownership.

Store both `cwd` and `baseDir` — do not pass `baseDir` to a lock constructor expecting workspace cwd.

- [ ] **Step 3: Migrate every mutating method**

`save`, `delete`, `addWorker`, `updateWorkerStatus` — all must be lock-safe.

- [ ] **Step 4: Write tests**

Acquire/release, second acquisition blocked, different run IDs concurrent, dead owner stale recovery, active owner lock not deleted, token mismatch cannot release, concurrent completions preserve both updates, atomic file never exposes truncated JSON, all existing mutating methods remain green.

- [ ] **Step 5: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-run-lock.test.js dist/tests/kernel/coordination-store-concurrency.test.js
git add src/kernel/coordination-run-lock.ts src/kernel/coordination-store.ts tests/kernel/coordination-run-lock.test.ts tests/kernel/coordination-store-concurrency.test.ts
git commit -m "feat(coordination): add lock-safe atomic run persistence"
```

---

## M0.77c.5 — OwnershipRegistry adapter

**Files:** Create `src/kernel/coordination-ownership.ts`, Create `tests/kernel/coordination-ownership.test.ts`

- [ ] **Step 1: Create the adapter**

```typescript
export type WorkerOwnershipAcquireResult =
  | { acquired: true; leaseIds: string[] }
  | { acquired: false; reason: string; conflictingLeaseIds: string[] };
```

Safe claim conversion: resolve root, check traversal via `relative`, reject if outside workspace.

Correct result handling using actual `AcquireResult` fields:
```typescript
for (const result of results) {
  if (result.acquired && result.record) {
    leaseIds.push(result.record.id);
  } else {
    conflicts.push(result.conflict?.reason ?? "Unknown ownership conflict");
    for (const record of result.conflict?.conflictingRecords ?? []) {
      conflictingLeaseIds.push(record.id);
    }
  }
}
```

Defensive rollback: if any request fails, release every lease returned as acquired, report rollback failures, return `acquired: false`.

Release helper: respect boolean return (`if (await registry.release(id))`). Renewal helper: respect boolean return (`if (await registry.renew(id, ttlMs))`).

- [ ] **Step 2: Write tests (use a real fake registry, not placeholders)**

Empty claims are no-op acquired, successful batch returns lease IDs, conflict returns conflict IDs, partial result rolls back, invalid claim fails closed, release false is reported failed, renewal false is reported failed, read-only worker does not call registry.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-ownership.test.js
git add src/kernel/coordination-ownership.ts tests/kernel/coordination-ownership.test.ts
git commit -m "feat(coordination): add ownership lease adapter"
```

---

## M0.77c.6 — Result store and executor contract

**Files:** Create `src/kernel/coordination-result-store.ts`, Create `src/kernel/worker-executor.ts`, Create tests

- [ ] **Step 1: Create coordination-result-store.ts**

```typescript
export type CoordinationWorkerResultRecord = {
  schemaVersion: "1.0";
  runId: string;
  workerId: string;
  agentId: string;
  attempt: number;
  outcome: "success" | "failure";
  summary?: string;
  outputPath?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
  startedAt?: string;
  completedAt: string;
};
```

Atomic write: `<workerId>.json.tmp.<token>` → rename → `<workerId>.json`. Return relative ref `.alix/coordination/results/<workerId>.json`.

- [ ] **Step 2: Create worker-executor.ts**

```typescript
export interface CoordinationWorkerExecutor {
  execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult>;
}
```

Do not use `eventLog: null as any`. Build a proper runtime context through existing run APIs. The production executor must either propagate `AbortSignal` through `runTask()` or explicitly document that only injected executors support cancellation until `runTask()` is upgraded.

- [ ] **Step 3: Write tests**

Success result persistence, failure result persistence, atomic overwrite, relative ref, no temp file remains, executor success, executor failure result, abort behavior for injected executor.

- [ ] **Step 4: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-result-store.test.js
git add src/kernel/coordination-result-store.ts src/kernel/worker-executor.ts tests/kernel/coordination-result-store.test.ts tests/kernel/worker-executor.test.ts
git commit -m "feat(coordination): add worker executor contract and result store"
```

---

## M0.77c.7 — Reconciliation engine

**Files:** Create `src/kernel/coordination-reconciliation.ts`, Create tests

- [ ] **Step 1: Create the reconciliation module**

```typescript
export async function reconcileCoordinationRun(
  deps: ReconciliationDeps,
  runId: string,
): Promise<ReconciliationResult>;
```

Orphan detection: a worker is orphaned when `status === "running"` AND stale heartbeat (age > `orphanThresholdMs`) AND not locally active (`executionOwnerId !== daemonInstanceId` or not in `activeExecutionIds`). Orphan recovery must abort local execution if present, release worker leases, clear lease IDs, mark failed, set `blockReason: "orphaned"`, `failureKind: "orphaned"`.

Transitive dependency propagation: use a fixpoint loop inside one locked update. For each pending worker whose deps include a failed/cancelled/dependency-blocked worker, mark blocked with `blockReason: "dependency_failed"`.

Approval recovery: inject an `ApprovalResolver` interface. When approved, set `status = "pending"`, clear blockReason/approvalId/error/authorizationEvidence. Attempt unchanged.

Ownership conflict recovery: pending ownership-conflict workers remain retryable. Clear stale error before a new authorization/acquisition attempt.

- [ ] **Step 2: Write tests**

Stale no-owner worker orphaned, stale different-owner worker orphaned, locally active worker not orphaned, fresh heartbeat untouched, orphan releases leases, dependency blocking is transitive, approval resolution resumes worker, unresolved approval remains blocked, reconciliation is idempotent.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-reconciliation.test.js
git add src/kernel/coordination-reconciliation.ts tests/kernel/coordination-reconciliation.test.ts
git commit -m "feat(coordination): add restart-safe reconciliation"
```

---

## M0.77c.8 — Authorization aggregation

**Files:** Create `src/kernel/coordination-authorization.ts`, Create tests

- [ ] **Step 1: Create the authorization module**

```typescript
export type WorkerAuthorizationResult =
  | { status: "allowed"; evidence: WorkerAuthorizationEvidence; }
  | { status: "denied"; evidence: WorkerAuthorizationEvidence; reason: string; }
  | { status: "approval_required"; evidence: WorkerAuthorizationEvidence; approvalId: string; reason: string; };
```

Rules: evaluate every capability, empty list is denied, any denial wins, otherwise approval required wins, otherwise allowed, persist evidence, no attempt increment.

- [ ] **Step 2: Write tests**

All allowed, one denied, one approval required, empty list denied, evidence includes every capability, approval ID retained, evaluation order deterministic.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-authorization.test.js
git add src/kernel/coordination-authorization.ts tests/kernel/coordination-authorization.test.ts
git commit -m "feat(coordination): add per-capability authorization aggregation"
```

---

## M0.77c.9 — CoordinationScheduler

**Files:** Create `src/kernel/coordination-scheduler.ts`, Create tests

- [ ] **Step 1: Create the scheduler class**

```typescript
export type SchedulerOptions = {
  maxConcurrency?: number;
  ownershipTtlMs?: number;
  ownershipRenewIntervalMs?: number;
  orphanThresholdMs?: number;
  maxDispatchPerTick?: number;
};

export type CoordinationSchedulerDeps = {
  cwd: string;
  daemonInstanceId: string;
  configProvider: () => Promise<AlixConfig>;
  store: CoordinationStore;
  authorization: ExecutionAuthorization;
  approvalResolver: ApprovalResolver;
  ownershipRegistry: OwnershipRegistry;
  executor: CoordinationWorkerExecutor;
  eventLog?: EventLog;
  auditStore?: AuditStore;
  metrics?: CoordinationMetrics;
  clock?: Clock;
};
```

Active execution map:
```typescript
private readonly activeExecutions = new Map<string, {
  workerId: string; runId: string;
  controller: AbortController;
  promise: Promise<void>;
}>();
```

Retryable readiness:
```typescript
function isRetryablePendingWorker(worker: WorkerAssignment, now: Date): boolean {
  if (worker.status !== "pending") return false;
  if (worker.nextAttemptAt && Date.parse(worker.nextAttemptAt) > now.getTime()) return false;
  return worker.blockReason === undefined || worker.blockReason === "ownership_conflict" || worker.blockReason === "concurrency_limit";
}
```

Execution retries must clear `blockReason`.

Tick pipeline:
1. Load run
2. Return immediately for terminal status
3. Reconcile
4. Reload
5. Count running workers
6. Calculate available slots
7. Find dependency-ready retryable workers
8. Sort by planOrder → createdAt → id
9. Authorize
10. Handle denial/approval
11. Acquire ownership
12. Persist running state
13. Dispatch tracked execution
14. Reload final state
15. Recalculate counts
16. Emit event/audit/metrics
17. Return tick summary

Correct execution-result handling: only success becomes completed.

Structured retry policy:
- Retryable: `transient_provider`, `timeout`, `execution_error`
- Non-retryable: `authorization_denied`, `dependency_failed`, `orphaned`, `lease_lost`, `cancelled`

Retry scheduling: `status = "pending"`, `blockReason = undefined`, `failureKind = result.failureKind`, `error = result.error`, `nextAttemptAt = computeBackoff(...)`. Attempts increment only when execution is persisted as running.

Completion: persist result → patch completed → set completedAt → set resultRef → release leases → clear lease IDs → emit event/audit/metrics.

Tick summary recalculates `activeRunning`, `availableSlots`, `runStatus` after dispatch and state transitions.

- [ ] **Step 2: Write tests**

Default concurrency one, cap at eight, bounded dispatch, deterministic order, denied terminal, approval blocked, empty capabilities denied, ownership conflict remains retryable, persistence failure releases leases, failure outcome not completed, retryable failure returns pending without blocking reason, max attempts terminal, success result persisted, completion releases leases, final counts are not stale, no duplicate dispatch, concurrent executions do not lose updates.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/kernel/coordination-scheduler.test.js
git add src/kernel/coordination-scheduler.ts tests/kernel/coordination-scheduler.test.ts
git commit -m "feat(coordination): add bounded ownership-aware scheduler"
```

---

## M0.77c.10 — runUntilIdle()

**Files:** Add to `src/kernel/coordination-scheduler.ts`

- [ ] **Step 1: Add the method**

```typescript
export type RunUntilIdleOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxIdleTicks?: number;
};
```

Active worker rule: do not increment idle count while active executions exist. Use `Promise.race` on active execution promises + sleep to wake on completion.

Stop reasons: `"completed" | "failed" | "awaiting_approval" | "blocked" | "idle" | "timeout"`.

- [ ] **Step 2: Write tests**

Success, failure, approval wait, terminal block, idle threshold, timeout, does not exit idle while worker active, active completion wakes loop, no infinite loop.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/coordination-scheduler.ts tests/kernel/coordination-scheduler.test.ts
git commit -m "feat(coordination): add terminating foreground scheduler loop"
```

---

## M0.77c.11 — Lease renewal and heartbeat

**Files:** Add to `src/kernel/coordination-scheduler.ts`

- [ ] **Step 1: Add scheduler methods**

```
renewActiveLeases(): Promise<void>;
heartbeatActiveWorkers(): Promise<void>;
cancelRun(runId: string): Promise<void>;
shutdown(): Promise<void>;
```

Lease renewal failure: when any lease renewal fails, abort execution, mark failed with `blockReason: "lease_lost"`, `failureKind: "lease_lost"`, clear lease IDs, emit event/audit/metric.

Heartbeat interval: recommended 15 seconds. Do not write per token.

- [ ] **Step 2: Write tests**

Successful renewal, boolean false treated as failure, renewal failure aborts execution, heartbeat updates worker, shutdown aborts active workers, cancellation marks workers cancelled, lease IDs cleared.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/coordination-scheduler.ts tests/kernel/coordination-scheduler.test.ts
git commit -m "feat(coordination): add heartbeats lease renewal and cancellation"
```

---

## M0.77c.12 — Daemon hosting

**Files:** Create `src/daemon/coordination-scheduler-service.ts`, Integrate daemon composition

- [ ] **Step 1: Create the service**

The service should call scheduler methods rather than directly implement ownership logic:
```
scheduler.tick(run.id);
scheduler.renewActiveLeases();
scheduler.heartbeatActiveWorkers();
scheduler.shutdown();
```

Non-overlapping timers with safe catch:
```typescript
private tickInProgress = false;
this.pollTimer = setInterval(() => {
  void this.tickAll().catch(error => this.handleError(error));
}, interval);
```

Fair run order: oldest-updated first (not newest first).

Scan states: `planning`, `running`, `blocked` only when resolvable. Skip terminal runs.

- [ ] **Step 2: Write tests**

No overlapping ticks, no overlapping renewals, oldest run first, terminal runs skipped, timer rejection handled, shutdown clears timers, shutdown calls scheduler shutdown, restart reconciliation idempotent.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/daemon/coordination-scheduler-service.test.js
git add src/daemon/coordination-scheduler-service.ts daemon-composition-file tests/daemon/coordination-scheduler-service.test.ts
git commit -m "feat(daemon): host coordination scheduling and lease renewal"
```

---

## M0.77c.13 — CLI

**Files:** Create `src/cli/commands/coordination.ts`, Modify `src/cli.ts`

- [ ] **Step 1: Create CLI handler**

Commands:
```
alix coordination run "<goal>"
alix coordination run "<goal>" --daemon
alix coordination run "<goal>" --max-concurrency 2
alix coordination tick <run-id>
alix coordination resume <run-id>
alix coordination status <run-id>
alix coordination cancel <run-id>
```

Behavior:
- **run:** plan → persist → foreground `runUntilIdle` → print stop reason
- **run --daemon:** verify daemon → plan → persist → notify daemon → print run ID
- **tick:** one scheduler cycle
- **resume:** reconcile → tick
- **status:** print run status, worker counts, approval IDs, ownership conflicts, active executions, last update
- **cancel:** abort active workers, release leases, mark pending/running workers cancelled, recompute run status

- [ ] **Step 2: Write tests**

Command parsing, missing arguments, foreground success, approval wait exit, daemon missing error, tick summary, status summary, cancel semantics, JSON output if supported.

- [ ] **Step 3: Build and commit**

```bash
npm run build && node --test dist/tests/cli/coordination.test.js
git add src/cli/commands/coordination.ts src/cli.ts tests/cli/coordination.test.ts
git commit -m "feat(cli): add coordination scheduler commands"
```

---

## M0.77c.14 — Events, audit, and metrics

- [ ] **Step 1: Add event emission**

Events:
```
coordination.run.started
coordination.worker.ready
coordination.worker.authorization_required
coordination.worker.denied
coordination.worker.ownership_conflict
coordination.worker.dispatched
coordination.worker.heartbeat
coordination.worker.completed
coordination.worker.failed
coordination.worker.retry_scheduled
coordination.worker.orphaned
coordination.worker.lease_lost
coordination.run.blocked
coordination.run.completed
coordination.tick.completed
```

Required event identity: `{ coordinationRunId, workerId?, agentId?, sessionId, taskGraphId?, timestamp }`.

- [ ] **Step 2: Add audit records**

Record: authorization aggregation reference, ownership acquisition, dispatch, completion/failure, retry decision, orphan recovery, lease loss, operator cancellation, run completion. Do not duplicate the detailed policy audit already emitted by `ExecutionAuthorization`.

- [ ] **Step 3: Add metrics**

```
coordination_runs_active
coordination_workers_pending
coordination_workers_running
coordination_workers_blocked
coordination_workers_completed_total
coordination_workers_failed_total
coordination_dispatch_total
coordination_dispatch_latency_ms
coordination_tick_duration_ms
coordination_tick_no_progress_total
coordination_authorization_denied_total
coordination_approval_wait_total
coordination_ownership_conflict_total
coordination_lease_renew_failure_total
coordination_orphan_recovery_total
coordination_worker_duration_ms
coordination_retry_total
coordination_queue_depth
```

Avoid high-cardinality external labels by default.

- [ ] **Step 4: Commit**

```bash
git add <scheduler/event/audit/metrics files> <relevant tests>
git commit -m "feat(observability): add coordination events audit and metrics"
```

---

## M0.77c.15 — Integration tests and documentation

**Files:** Create `tests/integration/coordination-scheduler.integration.test.ts`, Update docs

- [ ] **Step 1: Create integration test**

Pipeline: prebuilt graph → planner → persisted run → authorization → ownership → tick → fake executor → result persistence → completed run. No real LLM or daemon required.

Additional scenarios: two independent workers at concurrency two, ownership conflict serializes execution, approval block then resume, daemon restart orphan recovery, concurrent completions preserve state, retry then success, lease renewal failure.

- [ ] **Step 2: Update documentation**

Update `docs/user-manual.md`, `README.md`, `docs/architecture/runtime-spine.md`, `docs/demo-script.md` with: coordination run workflow, daemon mode, approval continuation, ownership conflicts, status and cancellation, result files, scheduler metrics.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/coordination-scheduler.integration.test.ts docs/user-manual.md README.md docs/architecture/runtime-spine.md docs/demo-script.md
git commit -m "docs(coordination): document ownership-aware scheduling"
```

---

## Test matrix

### Store and lock
- [ ] lock acquire/release
- [ ] lock contention
- [ ] dead PID stale recovery
- [ ] live PID not recovered
- [ ] token-safe release
- [ ] concurrent completions safe
- [ ] atomic JSON save
- [ ] all store mutations lock-safe

### Ownership
- [ ] batch success
- [ ] conflict all-or-none
- [ ] partial rollback
- [ ] invalid claim fail closed
- [ ] release false reported
- [ ] renew false reported
- [ ] read-only no-op

### Authorization
- [ ] all allowed
- [ ] denied wins
- [ ] approval wins after no denial
- [ ] empty denied
- [ ] evidence complete
- [ ] approval ID retained

### Reconciliation
- [ ] stale missing-owner orphaned
- [ ] stale foreign-owner orphaned
- [ ] local active preserved
- [ ] fresh heartbeat preserved
- [ ] orphan releases leases
- [ ] dependency propagation transitive
- [ ] approval resumes
- [ ] unresolved approval remains blocked
- [ ] idempotent

### Scheduler
- [ ] default concurrency one
- [ ] cap eight
- [ ] deterministic dispatch
- [ ] bounded per tick
- [ ] denial terminal
- [ ] approval blocked
- [ ] ownership conflict retryable
- [ ] failure outcome not completed
- [ ] retry clears block reason
- [ ] max attempts terminal
- [ ] state persisted before executor start
- [ ] persistence failure releases leases
- [ ] result persisted
- [ ] leases always released
- [ ] final counts recalculated
- [ ] no duplicate dispatch

### Foreground loop
- [ ] completed
- [ ] failed
- [ ] awaiting approval
- [ ] terminal blocked
- [ ] idle
- [ ] timeout
- [ ] active execution prevents idle exit
- [ ] no infinite loop

### Daemon
- [ ] ticks do not overlap
- [ ] renewals do not overlap
- [ ] oldest first
- [ ] terminal skipped
- [ ] timer errors handled
- [ ] shutdown cancels
- [ ] restart reconciliation

---

## Acceptance criteria

M0.77c is complete when:

- Every persisted worker is backward-compatible
- Every run mutation is lock-safe
- No parallel completion can lose state
- Ownership acquisition is all-or-none
- Ownership adapter uses actual `AcquireResult` fields
- Invalid claims fail closed
- Release and renewal boolean failures are respected
- Planner order uses DAG topological order
- Authorization evaluates every capability
- Empty capabilities are denied
- Policy denial is terminal
- Approval blocks store approval ID
- Approval resolution resumes without consuming attempt
- Ownership conflict workers remain schedulable
- Retryable execution failures remain schedulable
- Failure outcomes are never marked completed
- Orphan recovery releases leases
- Dependency failure propagation is transitive
- Running state is persisted before executor start
- Every execution exit releases leases
- `runUntilIdle` never exits idle while work is active
- `runUntilIdle` always terminates
- Daemon timers cannot overlap
- Timer promise rejections are handled
- Lease renewal failure cancels execution
- Result writes are atomic
- Events, audit, and metrics are emitted
- No placeholder tests remain
- No real LLM is required by unit tests
- Full existing suite remains green

---

## Verification

```bash
npm run build

node --test dist/tests/kernel/coordination-run-lock.test.js
node --test dist/tests/kernel/ownership-claim-compiler.test.js
node --test dist/tests/kernel/coordination-ownership.test.js
node --test dist/tests/kernel/coordination-store-concurrency.test.js
node --test dist/tests/kernel/coordination-result-store.test.js
node --test dist/tests/kernel/coordination-reconciliation.test.js
node --test dist/tests/kernel/coordination-authorization.test.js
node --test dist/tests/kernel/coordination-scheduler.test.js
node --test dist/tests/daemon/coordination-scheduler-service.test.js
node --test dist/tests/cli/coordination.test.js
node --test dist/tests/integration/coordination-scheduler.integration.test.js

npm run test:node:ci
npm run test:integration
```

---

## Suggested commits (in order)

```
feat(coordination): add scheduler metadata and record normalization
feat(coordination): add conservative ownership claim compiler
feat(coordination): populate scheduler metadata during planning
feat(coordination): add lock-safe atomic run persistence
feat(coordination): add ownership lease adapter
feat(coordination): add worker executor contract and result store
feat(coordination): add restart-safe reconciliation
feat(coordination): add per-capability authorization aggregation
feat(coordination): add bounded ownership-aware scheduler
feat(coordination): add terminating foreground scheduler loop
feat(coordination): add heartbeats lease renewal and cancellation
feat(daemon): host coordination scheduling and lease renewal
feat(cli): add coordination scheduler commands
feat(observability): add coordination events audit and metrics
docs(coordination): document ownership-aware scheduling
```

---

## Branch, PR, and tag

```bash
git switch -c feat/m077c-ownership-aware-worker-scheduler
```

PR title: `feat(coordination): add M0.77c ownership-aware worker scheduler`

Tag after merge: `m0.77c-worker-scheduler-baseline`
