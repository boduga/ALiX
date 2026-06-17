# M0.77c — Ownership-Aware Worker Scheduler

> **Status:** Implementation-ready specification  
> **Target branch:** `feat/m077c-ownership-aware-worker-scheduler`  
> **Builds on:** M0.75 Ownership Registry, M0.76.2 Unified Execution Authorization, M0.77a Coordination Data Model, M0.77b Coordination Planner  
> **Primary goal:** Execute validated coordination workers safely, deterministically, recoverably, and with bounded concurrency.

---

## 1. Goal

Add a production-safe ownership-aware worker scheduler to ALiX.

The scheduler must:

1. Load a persisted `CoordinationRun`.
2. Reconcile stale or orphaned work.
3. Propagate dependency failures.
4. Determine which workers are dependency-ready.
5. Authorize each worker capability through `ExecutionAuthorization`.
6. Atomically reserve ownership for mutating workers.
7. Persist running state before execution starts.
8. Execute workers through an injectable executor.
9. Persist results atomically.
10. Release or renew ownership leases safely.
11. Support bounded concurrency.
12. Recover after daemon or process restarts.
13. Expose deterministic foreground, daemon, CLI, audit, event, and metrics behavior.
14. Never depend on an event bus for correctness.

The authoritative dispatch equation is:

```
dependency-ready
+ authorization allowed
+ ownership acquired
+ concurrency slot available
+ retry budget available
= dispatchable
```

---

## 2. Architectural decision

### 2.1 Scheduler core

Use a **pull-based scheduler core**.

```
CoordinationScheduler.tick(runId)
```

performs one reconciliation and dispatch cycle.

The scheduler itself does not own an infinite timer.

### 2.2 Hosts

Different callers own cadence:

```
CLI foreground       → runUntilIdle()
Daemon               → periodic tickAll()
Inspector action     → tick()
Recovery operation   → reconcile() then tick()
Tests                → deterministic direct calls
```

### 2.3 Correctness source

Periodic reconciliation is the source of truth.

Completion callbacks and events improve responsiveness and observability, but missed events must never prevent recovery.

### 2.4 Default concurrency

```ts
maxConcurrency = 1
```

Hard cap:

```ts
MAX_COORDINATION_CONCURRENCY = 8;
```

Validated with:

```ts
Math.min(Math.max(options.maxConcurrency ?? 1, 1), MAX_COORDINATION_CONCURRENCY);
```

---

## 3. Non-goals

M0.77c does not introduce:

- a distributed scheduler
- a general event-driven scheduling bus
- cross-host worker migration
- distributed consensus
- preemptive execution
- automatic policy rewriting
- sophisticated priority queues
- dynamic graph mutation during execution
- speculative execution
- worker-to-worker messaging
- result synthesis across workers

Those belong in later coordination milestones.

---

## 4. Current repository constraints

### 4.1 OwnershipRegistry

The current registry accepts:

```ts
acquireMany(reqs: AcquireRequest[]): Promise<AcquireResult[]>
```

Each request contains:

```ts
type AcquireRequest = {
  agentId: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
  taskId?: string;
  sessionId?: string;
  ttlMs?: number;
  reason?: string;
};
```

The scheduler must not call a fictional object-shaped `acquireMany({ scopes: ... })` API.

### 4.2 Ownership scopes

The current durable ownership scope is structured:

```ts
type PathScope = {
  kind: "path";
  root: string;
  recursive: boolean;
};
```

M0.77b worker glob strings are useful display metadata, but they are not directly accepted by `OwnershipRegistry`.

### 4.3 Lease operations

The current registry exposes:

```ts
release(id: string): Promise<boolean>;
renew(id: string, ttlMs?: number): Promise<boolean>;
```

It does not currently expose `releaseMany()` or `renewMany()`.

### 4.4 CoordinationStore concurrency

The current store uses full-file overwrite and is not safe for concurrent writes to the same run.

M0.77c must introduce lock-protected atomic run mutation before allowing parallel worker completions.

### 4.5 Authorization

`ExecutionAuthorization.evaluate()` requires a concrete request containing `cwd`, `sessionMode`, `sessionId`, `capability`, `source`, `agentId`, `nodeId`, `graphId`. The scheduler therefore needs a config provider and workspace context.

---

## 5. Core invariants

### 5.1 Persistence before execution

```
authorize
→ acquire ownership
→ persist worker running state
→ execute
```

A worker must never begin execution before its running state and lease IDs are durably stored.

### 5.2 Atomic ownership

A mutating worker acquires all claims or none. Partial lease acquisition must never survive.

### 5.3 Lock-safe updates

All run mutations must occur under a per-run lock. Parallel completions must not overwrite one another.

### 5.4 Fail-closed authorization

```
any denied                → worker denied
else any approval needed  → worker awaiting approval
else all allowed          → worker allowed
```

Missing capability metadata is not permission.

### 5.5 Deterministic order

Ready workers are sorted by: `planOrder` → `createdAt` → `id`.

### 5.6 Retry accounting

Only real execution attempts increment `attempt`. Waiting for approval, ownership, dependencies, or concurrency does not consume retry budget.

### 5.7 Lease cleanup

Lease release occurs in `finally`.

### 5.8 Foreground termination

`runUntilIdle()` must always terminate by completion, failure, approval wait, blocked state, idle limit, or timeout.

---

## 6. Data model updates

### 6.1 Worker block reason

```ts
export type WorkerBlockReason =
  | "approval_required"
  | "authorization_denied"
  | "ownership_conflict"
  | "dependency_failed"
  | "orphaned"
  | "concurrency_limit"
  | "execution_failed"
  | "lease_lost"
  | "cancelled";
```

### 6.2 Worker failure kind

```ts
export type WorkerFailureKind =
  | "transient_provider"
  | "timeout"
  | "authorization_denied"
  | "approval_required"
  | "ownership_conflict"
  | "execution_error"
  | "orphaned"
  | "dependency_failed"
  | "lease_lost"
  | "cancelled";
```

### 6.3 Portable ownership claim

```ts
export type WorkerOwnershipClaim = {
  /** Workspace-relative path without leading slash. */
  path: string;
  /** Whether descendants are included. */
  recursive: boolean;
  /** Original planner/display scope. */
  sourcePattern?: string;
};
```

Examples:

```ts
{ path: "src", recursive: true, sourcePattern: "src/**" }
{ path: "package.json", recursive: false, sourcePattern: "package.json" }
{ path: ".", recursive: true, sourcePattern: "Dockerfile*" }
```

### 6.4 Authorization evidence

```ts
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

### 6.5 WorkerAssignment extensions

```ts
export interface WorkerAssignment {
  // Existing M0.77a/M0.77b fields remain.

  sourceNodeId?: string;
  requiredCapabilities: string[];
  riskLevel?: string;
  approvalMode?: string;

  attempt: number;
  maxAttempts: number;
  planOrder?: number;

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
}
```

### 6.6 Defaults

`createWorkerAssignment()` must default to: `requiredCapabilities: []`, `attempt: 0`, `maxAttempts: 3`, `ownershipClaims: []`.

### 6.7 Planner migration

Update M0.77b `CoordinationPlanner` so each worker receives:

```ts
sourceNodeId: node.id,
requiredCapabilities: node.requiredCapabilities ?? [],
riskLevel: node.riskLevel,
approvalMode: node.approvalMode,
attempt: 0,
maxAttempts: 3,
planOrder: topological index,
ownershipClaims: compileOwnershipClaims(ownershipScopes),
```

Keep existing `ownershipScopes: string[]` for display and compatibility.

---

## 7. Ownership claim compilation

### 7.1 New file

Create `src/kernel/ownership-claim-compiler.ts`.

### 7.2 Contract

```ts
export type OwnershipClaimCompileResult = {
  claims: WorkerOwnershipClaim[];
  warnings: string[];
};

export function compileOwnershipClaims(
  patterns: string[],
): OwnershipClaimCompileResult;
```

### 7.3 Conservative conversion rules

```
src/**                 → { path: "src", recursive: true }
docs/**                → { path: "docs", recursive: true }
package.json           → { path: "package.json", recursive: false }
README.md              → { path: "README.md", recursive: false }
.github/**             → { path: ".github", recursive: true }
terraform/**           → { path: "terraform", recursive: true }
helm/**                → { path: "helm", recursive: true }
**                     → { path: ".", recursive: true }
Dockerfile*            → { path: ".", recursive: true }
docker-compose*.yml    → { path: ".", recursive: true }
compose*.yaml          → { path: ".", recursive: true }
unsupported wildcard   → nearest safe parent, otherwise "."
```

Unrepresentable wildcard patterns fail closed by widening scope. This may reduce concurrency, but it must not under-protect the workspace.

### 7.4 Runtime conversion

```ts
export function toOwnershipScope(claim: WorkerOwnershipClaim, cwd: string): OwnershipScope {
  return { kind: "path", root: resolve(cwd, claim.path), recursive: claim.recursive };
}
```

Validate that the resolved root remains inside `cwd`. Reject traversal such as `../`, `../../etc`, absolute paths, tilde paths.

---

## 8. Lock-safe CoordinationStore

### 8.1 New lock

Create `src/kernel/coordination-run-lock.ts`. Follow the existing ownership lock pattern.

Lock location: `.alix/coordination/locks/<runId>.lock`

Requirements: configurable timeout, stale lock detection, always release in `finally`, no process-global mutex assumptions, works across CLI and daemon processes.

### 8.2 Atomic save

Update run persistence to: `<runId>.json.tmp` → rename → `<runId>.json`.

### 8.3 Generic mutation API

```ts
async updateRun(
  runId: string,
  mutate: (run: CoordinationRun) => void | Promise<void>,
): Promise<CoordinationRun | null>;
```

Internal sequence: acquire run lock → reload latest run → apply mutation → recompute status when requested → write temp → rename → release lock → return latest persisted run.

### 8.4 Worker patch type

```ts
export type WorkerPatch = Partial<Pick<WorkerAssignment,
  | "status" | "resultRef" | "error" | "attempt"
  | "blockReason" | "failureKind" | "approvalId"
  | "startedAt" | "completedAt" | "lastHeartbeatAt"
  | "leaseIds" | "executionOwnerId" | "authorizationEvidence"
>>;
```

### 8.5 Targeted operations

```ts
patchWorker(runId, workerId, patch): Promise<CoordinationRun | null>;
markWorkerRunning(...): Promise<CoordinationRun | null>;
completeWorker(...): Promise<CoordinationRun | null>;
failWorker(...): Promise<CoordinationRun | null>;
blockWorker(...): Promise<CoordinationRun | null>;
heartbeatWorker(...): Promise<CoordinationRun | null>;
```

All targeted methods must use `updateRun()`.

### 8.6 Concurrency safety test

Required test: two workers complete concurrently; both final statuses survive; neither update is lost.

---

## 9. Ownership adapter

### 9.1 New file

Create `src/kernel/coordination-ownership.ts`.

### 9.2 Acquire result

```ts
export type WorkerOwnershipAcquireResult =
  | { acquired: true; leaseIds: string[] }
  | { acquired: false; reason: string; conflictingLeaseIds: string[] };
```

### 9.3 Atomic acquire

```ts
export async function acquireWorkerOwnership(
  registry: OwnershipRegistry,
  run: CoordinationRun,
  worker: WorkerAssignment,
  cwd: string,
  ttlMs: number,
): Promise<WorkerOwnershipAcquireResult>;
```

Behavior: empty claims → acquired with `leaseIds: []`; convert every portable claim into `OwnershipScope`; create `AcquireRequest[]`; use `worker.id` as `taskId`, `worker.agentId` as `agentId`, `run.sessionId`; request `exclusive-write`; call `registry.acquireMany(reqs)`; require every result to be acquired; collect all record IDs; on unexpected partial success, release any acquired records immediately and return failure.

### 9.4 Release helper

```ts
export async function releaseWorkerOwnership(
  registry: OwnershipRegistry,
  leaseIds: string[],
): Promise<{ released: string[]; failed: string[] }>;
```

### 9.5 Renewal helper

```ts
export async function renewWorkerOwnership(
  registry: OwnershipRegistry,
  leaseIds: string[],
  ttlMs: number,
): Promise<{ renewed: string[]; failed: string[] }>;
```

Renew deterministically in lease ID order. A renewal failure is a scheduler safety event.

---

## 10. Scheduler API

### 10.1 Constants

```ts
export const MAX_COORDINATION_CONCURRENCY = 8;
export const DEFAULT_OWNERSHIP_TTL_MS = 30 * 60_000;
export const DEFAULT_OWNERSHIP_RENEW_INTERVAL_MS = 5 * 60_000;
export const DEFAULT_ORPHAN_THRESHOLD_MS = 90_000;
export const DEFAULT_MAX_DISPATCH_PER_TICK = 5;
export const DEFAULT_RUN_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_MAX_IDLE_TICKS = 5;
export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
```

### 10.2 Options

```ts
export type SchedulerOptions = {
  maxConcurrency?: number;
  ownershipTtlMs?: number;
  ownershipRenewIntervalMs?: number;
  orphanThresholdMs?: number;
  maxDispatchPerTick?: number;
};
```

### 10.3 Clock

```ts
export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}
```

### 10.4 Dependencies

```ts
export type CoordinationSchedulerDeps = {
  cwd: string;
  daemonInstanceId: string;
  configProvider: () => Promise<AlixConfig>;
  store: CoordinationStore;
  authorization: ExecutionAuthorization;
  ownershipRegistry: OwnershipRegistry;
  executor: CoordinationWorkerExecutor;
  eventLog?: EventLog;
  auditStore?: AuditStore;
  clock?: Clock;
};
```

### 10.5 Tick result

```ts
export type SchedulerTickResult = {
  runId: string;
  examined: number;
  ready: number;
  dispatched: string[];
  awaitingApproval: string[];
  denied: string[];
  ownershipConflicts: string[];
  dependencyBlocked: string[];
  recoveredOrphans: string[];
  activeRunning: number;
  availableSlots: number;
  runStatus: CoordinationRunStatus;
  progressMade: boolean;
};
```

### 10.6 Reconciliation result

```ts
export type ReconciliationResult = {
  runId: string;
  orphaned: string[];
  dependencyBlocked: string[];
  approvalResumed: string[];
  status: CoordinationRunStatus;
};
```

### 10.7 Foreground result

```ts
export type SchedulerStopReason =
  | "completed" | "failed" | "awaiting_approval"
  | "blocked" | "idle" | "timeout";

export type SchedulerRunResult = {
  runId: string;
  finalStatus: CoordinationRunStatus;
  stopReason: SchedulerStopReason;
  cycles: number;
  dispatched: number;
  failed: number;
  durationMs: number;
};
```

### 10.8 Foreground options

```ts
export type RunUntilIdleOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxIdleTicks?: number;
};
```

---

## 11. Worker executor

### 11.1 Contract

```ts
export type WorkerExecutionContext = {
  run: CoordinationRun;
  sessionId: string;
  cwd: string;
  config: AlixConfig;
};

export type WorkerExecutionResult = {
  outcome: "success" | "failure";
  summary?: string;
  outputPath?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
};

export interface CoordinationWorkerExecutor {
  execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult>;
}
```

### 11.2 Active execution tracking

```ts
type ActiveExecution = {
  workerId: string;
  runId: string;
  controller: AbortController;
  promise: Promise<void>;
};
```

Scheduler maintains `private activeExecutions = new Map<string, ActiveExecution>()`.

### 11.3 Cancellation reasons

Abort execution when: operator cancels run, scheduler shuts down, ownership renewal fails, worker is marked orphaned locally, daemon stops, run is deleted, execution timeout is reached.

---

## 12. Authorization aggregation

### 12.1 Per-capability evaluation

For every capability, call `authorization.evaluate()` with a unique `requestId` per capability, combining `run.id`, `worker.id`, `capability`, and `worker.attempt`.

### 12.2 Empty capabilities

Empty capability lists fail closed. They must not be treated as allowed. The worker is denied with reason "worker has no declared capabilities". This forces planner output quality and prevents silent execution.

### 12.3 Aggregation

```
any denied           → terminal failed, authorization_denied
else any approval    → blocked, approval_required
else                 → allowed
```

### 12.4 Evidence persistence

Persist all capability decisions before continuing. Approval-required workers store the relevant approval ID.

### 12.5 Re-evaluation rules

Re-evaluate when: no evidence exists, attempt changes, policy revision changes, approval resolution changes, evidence TTL expires, operator explicitly resumes.

---

## 13. Reconciliation

### 13.1 Method

```ts
async reconcile(runId: string): Promise<ReconciliationResult>;
```

### 13.2 Orphan recovery

A worker is orphaned when: `status = running` AND heartbeat older than `orphanThreshold` AND `executionOwnerId` is absent or differs from current live owner.

Fresh heartbeat: leave running. Stale heartbeat: abort local execution if present, release leases, mark failed with `blockReason: "orphaned"`.

### 13.3 Dependency failure propagation

For each pending worker: any dependency failed/cancelled/blocked-terminal → `blocked` with `blockReason: "dependency_failed"`. Store the failed dependency ID in the error message.

### 13.4 Approval recovery

For each blocked approval worker: load `approvalId`, check if approval is now granted. If granted: clear `blockReason`, clear transient error, set `status = "pending"`, preserve attempt, force authorization re-evaluation.

### 13.5 Ownership conflict recovery

Ownership conflict workers remain `pending`. Clear stale conflict text before retrying.

---

## 14. Tick pipeline

### 14.1 Method

```ts
async tick(runId: string): Promise<SchedulerTickResult>;
```

### 14.2 Pipeline

1. Load run.
2. Reject terminal runs.
3. Reconcile run.
4. Reload latest run.
5. Count active running workers.
6. Calculate available slots.
7. Find dependency-ready pending workers.
8. Sort by `planOrder` → `createdAt` → `id`.
9. Apply `maxDispatchPerTick`.
10. For each candidate:
    a. Verify retry budget.
    b. Authorize all capabilities.
    c. Persist denied/approval state if applicable.
    d. Acquire all ownership claims.
    e. Persist running state with leases and heartbeat.
    f. Emit dispatched event.
    g. Start tracked execution.
11. Reload and recompute run state.
12. Emit tick summary.
13. Return detailed result.

### 14.3 Available slots

```ts
const availableSlots = Math.max(0, maxConcurrency - activeRunning);
```

### 14.4 Dispatch ordering

```ts
ready.sort((a, b) =>
  (a.planOrder ?? Number.MAX_SAFE_INTEGER) - (b.planOrder ?? Number.MAX_SAFE_INTEGER) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id)
);
```

### 14.5 State before execution

Patch atomically: `{ status: "running", startedAt: now, lastHeartbeatAt: now, executionOwnerId: daemonInstanceId, leaseIds, attempt: worker.attempt + 1, blockReason: undefined, error: undefined }`.

If this persistence fails: release all acquired leases, do not execute, report dispatch failure.

---

## 15. Execution completion

### 15.1 Success

Persist result → atomically patch worker completed → set `completedAt` → set `resultRef` → release leases → emit completed.

### 15.2 Failure

Classify failure. Retryable (`transient_provider`, `timeout`, `execution_error`) with `attempt < maxAttempts` → `status = "pending"`, `blockReason = "execution_failed"`. Otherwise → `status = "failed"`.

Non-retryable (`authorization_denied`, `dependency_failed`, `orphaned`, `lease_lost`, `cancelled`) become terminal according to policy.

### 15.3 Lease release

Always in `finally`. Clear persisted `leaseIds` after release.

---

## 16. Result persistence

### 16.1 New file

Create `src/kernel/coordination-result-store.ts`.

### 16.2 Location

`.alix/coordination/results/<workerId>.json`

### 16.3 Atomic write

`<workerId>.json.tmp` → rename → `<workerId>.json`.

### 16.4 Stored shape

```ts
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

### 16.5 Result reference

Persist workspace-relative ref: `.alix/coordination/results/<workerId>.json`.

---

## 17. Heartbeats and lease renewal

### 17.1 Worker heartbeat

While executing, update `lastHeartbeatAt` at a bounded interval (recommended 15 seconds). Do not write on every streamed token.

### 17.2 Lease renewal

Daemon renews active worker leases every `ownershipRenewIntervalMs`. For each running worker: read current `leaseIds`, renew sequentially. If any renewal fails: abort active execution, mark worker failed with `blockReason: "lease_lost"`, emit lease-lost event.

---

## 18. runUntilIdle()

### 18.1 Method

```ts
async runUntilIdle(
  runId: string,
  options?: RunUntilIdleOptions,
): Promise<SchedulerRunResult>;
```

### 18.2 Termination conditions

Return when: run completed, run failed, approval is required and no other progress is possible, all remaining workers are terminally blocked, max idle ticks reached, timeout reached.

### 18.3 Idle handling

Track consecutive ticks with no progress. Progress includes: worker dispatched, worker completed, worker failed, worker resumed after approval, orphan recovered, dependency block propagated.

### 18.4 Stop reason

Always include `stopReason`. Never loop forever.

---

## 19. Daemon integration

### 19.1 New service

Create `src/daemon/coordination-scheduler-service.ts`.

### 19.2 Responsibilities

`tickAll()`, `renewActiveLeases()`, `shutdown()`, `cancelRun()`.

### 19.3 Polling

Default `coordinationPollIntervalMs = 1_000`.

### 19.4 Overlap guard

```ts
if (tickInProgress) return;
tickInProgress = true;
try { await tickAll(); } finally { tickInProgress = false; }
```

### 19.5 Scan states

Scan only `planning`, `running`, `blocked`. Blocked runs are only actionable when their reason can be resolved.

### 19.6 Fairness limits

`maxRunsPerCycle`, `maxDispatchPerTick`. Sort runs by `updatedAt` → `createdAt` → `id` to reduce starvation.

### 19.7 Shutdown

On daemon shutdown: stop timers, abort active executions, wait bounded grace period, flush final heartbeats, release owned leases where safe.

---

## 20. CLI

### 20.1 Commands

```
alix coordination run "<goal>"
alix coordination run "<goal>" --daemon
alix coordination run "<goal>" --max-concurrency 2
alix coordination tick <run-id>
alix coordination resume <run-id>
alix coordination status <run-id>
alix coordination cancel <run-id>
```

### 20.2 Foreground run

`alix coordination run "<goal>"`: plan → persist → schedule → wait until a defined stop reason → print summary → exit nonzero only for actual failure.

### 20.3 Daemon run

`alix coordination run "<goal>" --daemon`: verify daemon → plan and persist → notify daemon → return run ID immediately.

### 20.4 Tick

Administrative one-cycle operation.

### 20.5 Resume

`alix coordination resume <run-id>`: reconcile → clear resolvable blocks → tick.

### 20.6 Status output

```
Run: coord_...
Status: running
Workers: 2 completed, 1 running, 1 pending, 1 blocked
Awaiting approval: apr_...
Ownership conflicts: 1
Last update: ...
```

---

## 21. Events

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

Required payload identity: `{ coordinationRunId, workerId?, agentId?, sessionId, taskGraphId?, timestamp }`.

Events are outputs, not scheduler correctness inputs.

---

## 22. Audit

Audit at minimum: authorization result, ownership acquisition result, worker dispatch, worker completion/failure, retry decision, orphan recovery, lease loss, operator cancellation, run completion.

Avoid duplicate audit emission when `ExecutionAuthorization` already records the authorization decision. Scheduler audit should reference the authorization evidence rather than recreating policy decisions.

---

## 23. File structure

### Modify

```
src/kernel/coordination-types.ts
src/kernel/coordination-planner.ts
src/kernel/coordination-store.ts
src/cli.ts
```

### Create

```
src/kernel/coordination-run-lock.ts
src/kernel/ownership-claim-compiler.ts
src/kernel/coordination-ownership.ts
src/kernel/coordination-result-store.ts
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
tests/kernel/coordination-scheduler.test.ts
tests/kernel/coordination-result-store.test.ts
tests/daemon/coordination-scheduler-service.test.ts
tests/cli/coordination.test.ts
tests/integration/coordination-scheduler.integration.test.ts
```

---

## 24. Final implementation order

```
types
→ planner migration
→ run locking
→ atomic store mutation
→ ownership claim compilation
→ ownership adapter
→ reconciliation
→ authorization aggregation
→ dispatch
→ result persistence
→ retries
→ runUntilIdle
→ daemon host
→ CLI
→ integration tests
→ documentation
```

This order prevents the scheduler from depending on unsafe storage or incompatible ownership APIs during intermediate commits.
