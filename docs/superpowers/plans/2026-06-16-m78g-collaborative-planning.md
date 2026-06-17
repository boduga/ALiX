# M0.78g — Collaborative Planning and Replanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multi-agent collaborative plan construction and mid-execution replanning driven by worker results, findings, and conflicts.

**Architecture:** Add a `CollaborativePlanner` layer over the existing `CoordinationPlanner` that supports capability-matching during initial planning, and a `replan()` method triggered by the scheduler after worker failure. All new types extend `coordination-types.ts`. The existing single-shot planner remains the fallback when the collaborative layer is not configured.

**Tech Stack:** TypeScript, Node `node:test`, `node:assert/strict`, existing `CoordinationStore` (with its `updateRun` lock-based atomics), `CoordinationPlanner`, `CollaborationStore`, `CoordinationScheduler`

## Global Constraints

- All new tests must use `node:test` + `node:assert/strict` — no vitest, no chai
- Stateful kernel tests use `mkdtempSync` + `rmSync`
- TUI panels must not import runtime stores
- HTTP routes must not mutate state
- The system must work without the collaborative layer (graceful fallback)
- Replaced workers remain `"failed"` (never changed to `"cancelled"`)
- All plan revisions are atomic: dependency rewrites + replacement worker + revision history + status transition in one `updateRun` call
- Replanning errors are never silently caught — always logged/audited with safe status recovery
- Substring capability matching is forbidden — use exact normalized IDs with a controlled alias registry

---

## File Structure (New + Modified)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/coordination-types.ts` | MODIFY | Add `"replanning"` status, `PlanningRound`/`PlanRevision`/`PlanDiffEntry`/lineage types, extend `CoordinationRun` and `WorkerAssignment` |
| `src/kernel/collaborative-planner.ts` | CREATE | `CollaborativePlanner` class: `plan()` with capability matching, `replan()` with atomic replacement and dependency rewiring |
| `src/kernel/coordination-store.ts` | MODIFY | Add `updateRunWithRevisionCheck()` for atomic replanning with expected planRevision |
| `src/kernel/coordination-scheduler.ts` | MODIFY | Add mid-execution replan trigger, `"replanning"` tick guard, logged/audited error handling |
| `src/kernel/collaboration-context-builder.ts` | MODIFY | Add `buildReplanContext()` for feeding replanner with worker results |
| `tests/kernel/collaborative-planner.test.ts` | CREATE | Plan/bid/replan tests |
| `tests/kernel/coordination-store-replan.test.ts` | CREATE | Store method tests |
| `tests/kernel/coordination-scheduler-replan.test.ts` | CREATE | Scheduler trigger tests |
| `tests/kernel/collaboration-context-builder-replan.test.ts` | CREATE | Replan context tests |

---

## Task 1: Extend coordination types for planning, replanning, and worker lineage

**Files:**
- Modify: `src/kernel/coordination-types.ts`

**Changes:**

1. Add `"replanning"` to `CoordinationRunStatus`:

```typescript
export type CoordinationRunStatus =
  | "planning" | "running" | "replanning" | "blocked" | "completed" | "failed";
```

2. Add new types:

```typescript
export type PlanTriggerKind =
  | "worker_failed" | "worker_completed" | "conflict_detected"
  | "manual";

export interface PlanDiffEntry {
  workerId: string;
  change: "added" | "removed" | "modified";
  taskLabel?: string;
  goalPrompt?: string;
  reason: string;
}

export interface PlanRevision {
  revisionNumber: number;
  timestamp: string;
  reason: string;
  triggerKind: PlanTriggerKind;
  triggerWorkerId?: string;
  conflictIds?: string[];
  diff: PlanDiffEntry[];
}

export interface PlanningProposal {
  id: string;
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  ownershipClaims: WorkerOwnershipClaim[];
  dependencies: string[];
  riskLevel?: string;
  approvalMode?: string;
}

export interface PlanningBid {
  id: string;
  proposalId: string;
  agentId: string;
  matchedCapabilities: string[];
  unmatchedCapabilities: string[];
  confidence: number;        // matched / (matched + unmatched), 0 if no caps
  createdAt: string;
}

export interface PlanningAcceptance {
  proposalId: string;
  agentId: string;
  assignedWorkerId: string;
}

export interface PlanningRound {
  id: string;
  coordinationRunId: string;
  roundNumber: number;
  status: "draft" | "bidding" | "finalized" | "failed";
  proposals: PlanningProposal[];
  bids: PlanningBid[];
  acceptances: PlanningAcceptance[];
  createdAt: string;
  updatedAt: string;
}
```

3. Add lineage fields to `WorkerAssignment`:

```typescript
export interface WorkerAssignment {
  // ... all existing fields ...

  /** If this worker was created as a replacement, which failed worker it replaces */
  replacementForWorkerId?: string;

  /** If this worker failed and was replaced, which worker replaced it */
  supersededByWorkerId?: string;
}
```

4. Extend `CoordinationRun`:

```typescript
export interface CoordinationRun {
  // ... all existing fields ...

  planRevision: number;

  /** Optional audit trail of plan revisions. Most recent at end. */
  revisionHistory?: PlanRevision[];

  /** Optional planning rounds from collaborative planning. */
  planningRounds?: PlanningRound[];
}
```

5. Update `createCoordinationRun()` to set `planRevision: 0`.

6. Update `recomputeRunStatus()` to preserve `"replanning"`:

```typescript
export function recomputeRunStatus(run: CoordinationRun): CoordinationRunStatus {
  if (run.status === "replanning") return "replanning";
  // ... existing logic unchanged ...
}
```

**Tests:**
- `createCoordinationRun()` sets `planRevision: 0`
- `recomputeRunStatus()` preserves `"replanning"` status (insert worker in replanning run, call recompute, verify it stays replanning)
- `WorkerAssignment` with `replacementForWorkerId` field is constructible
- `PlanDiffEntry`/`PlanRevision` structs are constructible

---

## Task 2: Add atomic store primitive with planRevision check

**Files:**
- Modify: `src/kernel/coordination-store.ts`

**Changes:**

Add an overload of `updateRun` that takes an optional `expectedPlanRevision` guard:

```typescript
/**
 * Update a run with an expected planRevision guard.
 * When expectedPlanRevision is provided, the mutate callback is
 * only invoked if the run's planRevision matches. If it doesn't
 * match, returns null (caller should retry or abort).
 *
 * This is the atomic primitive for replanning: the entire revision
 * (replacement worker + dependency rewires + revision history +
 * status transition) happens in one lock-serialized call.
 */
async updateRunWithRevisionCheck(
  runId: string,
  expectedPlanRevision: number,
  mutate: (run: CoordinationRun) => void | Promise<void>,
): Promise<CoordinationRun | null> {
  const lock = new CoordinationRunLock(this.cwd, runId);
  const acquired = await lock.acquire();
  if (!acquired) return null;
  try {
    const run = await this.load(runId);
    if (!run) return null;
    // CAS guard: reject if planRevision has advanced
    if ((run as any).planRevision !== expectedPlanRevision) return null;
    await mutate(run);
    // Cast to any to avoid TS error on new field during migration
    (run as any).planRevision = ((run as any).planRevision ?? 0) + 1;
    run.updatedAt = new Date().toISOString();
    const path = this.runPath(runId);
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, JSON.stringify(run, null, 2), "utf-8");
    await renameFile(tmpPath, path);
    return run;
  } finally {
    lock.release();
  }
}
```

Note: This method intentionally does NOT call `recomputeRunStatus()` — the caller (replan) sets the status explicitly (`"replanning"` → `"running"`). This avoids the replanning-guard issue in `recomputeRunStatus`.

**Tests (new: `tests/kernel/coordination-store-replan.test.ts`):**
- `updateRunWithRevisionCheck` applies mutate when revision matches
- `updateRunWithRevisionCheck` returns null when revision does not match
- `updateRunWithRevisionCheck` increments planRevision after apply
- Concurrent calls with same expectedRevision: only one succeeds (simulate by running two in sequence with stale ref)
- Existing `updateRun` still works unchanged

---

## Task 3: Capability matching with exact normalized IDs

**Files:**
- Create: `src/kernel/collaborative-planner.ts` (this task: static utility + type exports)

**Changes:**

```typescript
/**
 * Controlled capability alias registry.
 * Maps aliases to canonical capability IDs.
 * All comparisons use normalized canonical forms.
 */
const CAPABILITY_ALIASES: Record<string, string> = {
  "read": "filesystem.read",
  "write": "filesystem.write",
  "filesystem_read": "filesystem.read",
  "filesystem_write": "filesystem.write",
  "filesystem.read": "filesystem.read",
  "filesystem.write": "filesystem.write",
};

function normalizeCapability(cap: string): string {
  const key = cap.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
  return CAPABILITY_ALIASES[key] ?? key;
}

/**
 * Match required capabilities against an agent's capabilities
 * using exact canonical ID matching.
 *
 * Returns the matched and unmatched arrays, plus a score [0, 1]
 * where 1 = all required capabilities matched.
 *
 * Never uses substring matching — only exact canonical ID equality.
 */
export function matchCapabilities(
  required: string[],
  agentCapabilities: string[],
): { matched: string[]; unmatched: string[]; score: number } {
  const agentNormalized = new Set(agentCapabilities.map(normalizeCapability));
  const matched = required.filter(r => agentNormalized.has(normalizeCapability(r)));
  const unmatched = required.filter(r => !agentNormalized.has(normalizeCapability(r)));
  const total = required.length + unmatched.length; // denominator: all unique
  const score = required.length === 0 ? 0 : matched.length / required.length;
  return { matched, unmatched, score };
}

export interface CapabilityRegistry {
  [agentId: string]: string[];
}
```

**Tests:**
- Exact match: `matchCapabilities(["filesystem.read"], ["filesystem.read"])` → `{ matched: ["filesystem.read"], unmatched: [], score: 1 }`
- Canonical alias match: `matchCapabilities(["read"], ["filesystem.read"])` → matched via alias
- No match returns everything unmatched, score 0
- Partial match returns correct ratio
- Substring is NOT a match: `matchCapabilities(["filesystem"], ["filesystem.read"])` → unmatched (no exact canonical match)
- Empty required returns score 0
- Case insensitivity works

---

## Task 4: Collaborative planning (initial plan construction with capability matching)

**Files:**
- Modify: `src/kernel/collaborative-planner.ts` (this task: `CollaborativePlanner` class + `plan()` method)

**Exported types:**

```typescript
export interface CollaborativePlannerOptions {
  agentPool: string[];
  agentCapabilities?: CapabilityRegistry;
  enableBidding?: boolean;   // default true
}

export interface CollaborativePlanResult {
  run: CoordinationRun | null;
  planningRounds: PlanningRound[];
  valid: boolean;
  errors: string[];
}
```

- [ ] **Step 1: Write tests for `plan()`**

Tests:
- Happy path: base planner returns valid graph → collaborative plan with proposals
- Bidding round creates proposals from draft workers
- Best-matching agent is selected for each proposal (uses `matchCapabilities` score)
- Round-robin fallback when bidding is disabled
- Empty agent pool falls back to coordinator
- Invalid base plan returns errors immediately
- `planningRounds` populated and attached to run

- [ ] **Step 2: Implement `CollaborativePlanner` class with `plan()`**

```typescript
export class CollaborativePlanner {
  constructor(
    private basePlanner: CoordinationPlanner,
    private store: CoordinationStore,
    private options: CollaborativePlannerOptions,
  ) {}

  async plan(
    goal: string,
    coordinatorAgentId: string,
    sessionId: string,
  ): Promise<CollaborativePlanResult> {
    // 1. Base planner for initial TaskGraph decomposition
    const base = await this.basePlanner.plan(goal, coordinatorAgentId, sessionId);
    if (!base.valid || !base.run) {
      return { run: null, planningRounds: [], valid: false, errors: base.errors };
    }

    const run = base.run;
    (run as any).planRevision = 0;

    // 2. Create PlanningRound with proposals from draft workers
    const round = this.buildRound(run);

    // 3. Collect bids from agent pool (if enabled)
    if (this.options.enableBidding && this.options.agentPool.length > 0) {
      this.collectBids(round);
    }

    // 4. Assign agents based on bids or round-robin fallback
    const assigned = this.assignAgents(round, coordinatorAgentId);

    // 5. Write agent IDs back to workers
    for (const [proposalId, agentId] of assigned) {
      const worker = run.workers.find(
        w => w.id === proposalId.replace("proposal_", "")
      );
      if (worker) worker.agentId = agentId;
    }

    // 6. Attach planning round to run and persist
    (run as any).planningRounds = [round];
    (run as any).planRevision = 0;

    return { run, planningRounds: [round], valid: true, errors: [] };
  }
}
```

Helper methods:

```typescript
private buildRound(run: CoordinationRun): PlanningRound {
  const proposals: PlanningProposal[] = run.workers.map(w => ({
    id: `proposal_${w.id}`,
    taskLabel: w.taskLabel,
    goalPrompt: w.goalPrompt,
    requiredCapabilities: w.requiredCapabilities,
    ownershipClaims: w.ownershipClaims,
    dependencies: w.dependencies,
    riskLevel: w.riskLevel,
    approvalMode: w.approvalMode,
  }));
  // ...
}

private collectBids(round: PlanningRound): void { /* ... */ }
private assignAgents(round: PlanningRound, fallbackAgent: string): Map<string, string> { /* ... */ }
```

- [ ] **Step 3: Run tests — pass**
- [ ] **Step 4: Commit**

---

## Task 5: Replanning — atomic replacement with dependency rewiring

**Files:**
- Modify: `src/kernel/collaborative-planner.ts`

**ReplanContext and ReplanResult:**

```typescript
export interface ReplanContext {
  triggeredBy: PlanTriggerKind;
  workerId: string;
}

export interface ReplanResult {
  run: CoordinationRun | null;
  revision: PlanRevision | null;
  applied: boolean;
  errors: string[];
}
```

### Algorithm (all inside one `updateRunWithRevisionCheck` call)

When a worker fails with exhausted retries, the replan does ALL of the following atomically:

1. **Find dependent workers.** Any `WorkerAssignment.dependencies` that includes `failedWorkerId` gets that entry replaced with `replacementWorkerId`.

2. **Create replacement worker** with same `taskLabel`, `goalPrompt`, `requiredCapabilities`, `ownershipClaims`, `dependencies` (already rewritten), `riskLevel`, `approvalMode`. The replacement gets:
   - `replacementForWorkerId: failedWorkerId`
   - Fresh `attempt: 0` (clean retry budget)
   - `status: "ready"`
   - NO `authorizationEvidence`, NO `approvalId` (fresh auth, not inherited)
   - NO `leaseIds`, NO `ownershipClaims` with existing leases (fresh ownership)

3. **Mark failed worker** as `supersededByWorkerId: replacementWorkerId`. Its status stays `"failed"` — unchanged.

4. **Build PlanRevision** with `diff` entries for the removed failed worker, the added replacement, and each modified downstream worker.

5. **Increment planRevision.**

6. **Transition run status** from `"replanning"` back to `"running"` (or recompute from workers).

- [ ] **Step 1: Write failing tests for `replan()` (replace_worker kind)**

```typescript
describe("replan — replace_worker", () => {
  it("creates replacement worker with same task and goal", async () => { /* ... */ });
  it("rewires downstream dependencies to replacement ID", async () => { /* ... */ });
  it("preserves failed worker status as 'failed'", async () => { /* ... */ });
  it("sets replacementForWorkerId on replacement", async () => { /* ... */ });
  it("sets supersededByWorkerId on original", async () => { /* ... */ });
  it("does not inherit authorizationEvidence", async () => { /* ... */ });
  it("does not inherit leaseIds or approvalId", async () => { /* ... */ });
  it("replacement gets fresh attempt=0", async () => { /* ... */ });
  it("increments planRevision", async () => { /* ... */ });
  it("appends to revisionHistory", async () => { /* ... */ });
  it("no-op when worker not found", async () => { /* ... */ });
  it("no-op when attempt < maxAttempts", async () => { /* ... */ });
  it("atomic — fails if planRevision changed since load", async () => { /* ... */ });
  it("builds PlanDiff with added/removed/modified entries", async () => { /* ... */ });
});
```

- [ ] **Step 2: Implement `classifyReplanKind()`**

```typescript
private classifyReplanKind(context: ReplanContext, run: CoordinationRun):
  { kind: "replace_worker" | "resolve_conflict" | "add_work" | "re_decompose"; targetWorkerIds: string[] } {
  if (context.triggeredBy === "worker_failed") {
    const w = run.workers.find(x => x.id === context.workerId);
    if (w && w.attempt >= w.maxAttempts) {
      return { kind: "replace_worker", targetWorkerIds: [context.workerId] };
    }
  }
  // conflict_detected, worker_completed → stubbed (task 8)
  return { kind: "replace_worker", targetWorkerIds: [] };
}
```

- [ ] **Step 3: Implement `replaceWorker()` and `replan()`**

```typescript
async replan(runId: string, context: ReplanContext): Promise<ReplanResult> {
  const run = await this.store.load(runId);
  if (!run) return { run: null, revision: null, applied: false, errors: ["Run not found"] };

  const { kind, targetWorkerIds } = this.classifyReplanKind(context, run);
  if (targetWorkerIds.length === 0) {
    return { run, revision: null, applied: false, errors: [] };
  }

  // Only replace_worker is implemented; others return stubbed
  if (kind !== "replace_worker") {
    return { run: null, revision: null, applied: false, errors: [`${kind} deferred to M0.78g.1`] };
  }

  // Atomic replan: use expected = run.planRevision
  const expectedRev = (run as any).planRevision ?? 0;

  const updated = await (this.store as any).updateRunWithRevisionCheck(
    runId,
    expectedRev,
    (r: CoordinationRun & { planRevision: number }) => {
      const failedId = targetWorkerIds[0];
      const failed = r.workers.find(w => w.id === failedId);
      if (!failed) return;

      // 1. Create replacement
      const replId = `worker_${Date.now()}_repl`;
      const replacement = createWorkerAssignment({
        coordinationRunId: runId,
        agentId: this.pickReplacementAgent(failed.agentId),
        taskLabel: failed.taskLabel,
        goalPrompt: failed.goalPrompt,
        dependencies: failed.dependencies, // original — will be rewritten below if needed
        ownershipScopes: failed.ownershipScopes,
        requiredCapabilities: failed.requiredCapabilities,
        ownershipClaims: [],   // fresh — no inherited leases
        riskLevel: failed.riskLevel,
        approvalMode: failed.approvalMode,
        status: "ready",
        attempt: 0,            // clean retry budget
        maxAttempts: failed.maxAttempts,
        id: replId,
      });
      (replacement as any).replacementForWorkerId = failedId;

      // 2. Rewire downstream dependencies: any worker whose dependencies
      //    include the failed ID now points to the replacement ID
      const downstreamModified: string[] = [];
      for (const w of r.workers) {
        const idx = w.dependencies.indexOf(failedId);
        if (idx !== -1) {
          w.dependencies[idx] = replId;
          downstreamModified.push(w.id);
        }
      }

      // 3. Mark the failed worker as superseded (status stays "failed")
      (failed as any).supersededByWorkerId = replId;

      // 4. Add replacement to run
      r.workers.push(replacement);

      // 5. Build PlanRevision
      const diff: PlanDiffEntry[] = [
        { workerId: failedId, change: "removed", taskLabel: failed.taskLabel, reason: "Failed worker replaced" },
        { workerId: replId, change: "added", taskLabel: failed.taskLabel, goalPrompt: failed.goalPrompt, reason: "Replacement worker" },
        ...downstreamModified.map(dwId => ({ workerId: dwId, change: "modified" as const, reason: "Dependencies rewired" })),
      ];
      const revision: PlanRevision = {
        revisionNumber: r.planRevision + 1,
        timestamp: new Date().toISOString(),
        reason: `Worker ${failedId} failed after ${failed.attempt} attempts → replaced by ${replId}`,
        triggerKind: context.triggeredBy,
        triggerWorkerId: context.workerId,
        diff,
      };
      r.revisionHistory = [...(r.revisionHistory ?? []), revision];

      // 6. Set status back to running (recomputeRunStatus not called)
      r.status = "running";
    },
  );

  if (updated) {
    return { run: updated, revision: (updated.revisionHistory?.slice(-1)[0]) ?? null, applied: true, errors: [] };
  }
  // CAS failure — planRevision advanced since load
  return { run: null, revision: null, applied: false, errors: ["planRevision conflict — concurrent replan in progress"] };
}
```

Note: The CAS guard means only one concurrent replan wins. The loser gets `applied: false` with a clear conflict error.

- [ ] **Step 4: Implement `pickReplacementAgent()`**

```typescript
private pickReplacementAgent(failedAgentId: string): string {
  const pool = this.options.agentPool;
  if (!pool || pool.length <= 1) return failedAgentId; // no alternative
  const idx = pool.indexOf(failedAgentId);
  // Round-robin to the next agent in the pool
  return pool[(idx + 1) % pool.length];
}
```

- [ ] **Step 5: Run tests — pass**
- [ ] **Step 6: Commit**

---

## Task 6: Scheduler integration — mid-execution replanning with logged error handling

**Files:**
- Modify: `src/kernel/coordination-scheduler.ts`

- [ ] **Step 1: Write failing tests (new: `tests/kernel/coordination-scheduler-replan.test.ts`)**

Tests:
- Scheduler invokes replanner after worker exhausts retries
- Scheduler does NOT invoke replanner when retries remain
- Scheduler does NOT invoke replanner when no replanner configured (no-op)
- Scheduler does NOT invoke replanner on completed run
- Tick loop skips dispatch during "replanning" status
- **Replan failure (applied=false, CAS conflict, thrown error) logs to audit/console and restores run from "replanning" to safe status**
- **Concurrent completions: only one replan succeeds (CAS guard)**

- [ ] **Step 2: Add `replanner` to deps and `enableMidExecutionReplanning` to options**

```typescript
export interface CoordinationSchedulerDeps {
  // ... existing deps ...
  replanner?: CollaborativePlanner;
}

export interface SchedulerOptions {
  // ... existing options ...
  enableMidExecutionReplanning?: boolean;
}
```

- [ ] **Step 3: Add `"replanning"` guard in `tick()`**

```typescript
if (run.status === "completed" || run.status === "failed" || run.status === "replanning") {
  return noTick(runId, run.status);
}
```

- [ ] **Step 4: Implement `maybeReplanAfterWorkerCompletion()`**

```typescript
private async maybeReplanAfterWorkerCompletion(
  runId: string,
  workerId: string,
  outcome: "success" | "failure",
): Promise<void> {
  if (!this.deps.replanner || !this.options.enableMidExecutionReplanning) return;

  const run = await this.deps.store.load(runId);
  if (!run || run.status === "completed" || run.status === "failed") return;

  const worker = run.workers.find(w => w.id === workerId);
  if (!worker) return;

  // Only trigger on failure with exhausted retries
  if (outcome !== "failure" || worker.attempt < worker.maxAttempts) return;

  // Set replanning status — prevents concurrent dispatch
  await this.deps.store.updateRun(runId, (r) => { r.status = "replanning"; });

  try {
    const result = await this.deps.replanner.replan(runId, {
      triggeredBy: "worker_failed",
      workerId,
    });

    if (!result.applied) {
      // Replan did not apply (CAS conflict or no action needed).
      // Restore run status to recomputed value.
      await this.deps.store.updateRun(runId, (r) => { r.status = recomputeRunStatus(r); });

      if (result.errors.length > 0) {
        console.error(`[coordination] replan failed for ${runId}: ${result.errors.join("; ")}`);
        this.deps.auditStore?.append({
          action: "replan.failed",
          actor: "scheduler",
          details: { runId, workerId, errors: result.errors },
        }).catch(() => {});
      }
    }
    // If applied, replan() already set status to "running" inside the atomic transaction
  } catch (err) {
    // Unexpected error in replanner — do not silently swallow
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[coordination] replan threw for ${runId}: ${msg}`);
    this.deps.auditStore?.append({
      action: "replan.error",
      actor: "scheduler",
      details: { runId, workerId, error: msg },
    }).catch(() => {});
    // Restore run from replanning to a safe recomputed status
    await this.deps.store.updateRun(runId, (r) => { r.status = recomputeRunStatus(r); });
  }
}
```

- [ ] **Step 5: Wire into `executeWorker()`**

After successful completion and after failed-with-exhausted-retries:

```typescript
// In executeWorker(), after worker outcome is determined:
if (outcome === "failure" && worker.attempt >= worker.maxAttempts) {
  // ... existing failure handling ...
  this.maybeReplanAfterWorkerCompletion(runId, workerId, "failure").catch(
    (err) => console.error(`[coordination] replan unhandled error: ${err}`)
  );
}
```

The catch handler logs to console — never swallows silently.

- [ ] **Step 6: Run tests — pass**
- [ ] **Step 7: Commit**

---

## Task 7: Context builder replan support

**Files:**
- Modify: `src/kernel/collaboration-context-builder.ts`

- [ ] **Step 1: Write failing tests (new: `tests/kernel/collaboration-context-builder-replan.test.ts`)**

Tests:
- Returns completed workers from run with status
- Returns active conflicts
- Returns recent findings
- Handles empty run gracefully

- [ ] **Step 2: Add `buildReplanContext()` method**

```typescript
async buildReplanContext(runId: string): Promise<{
  completedWorkers: Array<{ workerId: string; taskLabel: string; outcome: string; attempt: number }>;
  activeConflicts: FindingConflict[];
  recentFindings: SharedFinding[];
}> {
  const run = await this.coordinationStore.load(runId);
  if (!run) return { completedWorkers: [], activeConflicts: [], recentFindings: [] };

  return {
    completedWorkers: run.workers
      .filter(w => w.status === "completed" || w.status === "failed")
      .map(w => ({ workerId: w.id, taskLabel: w.taskLabel, outcome: w.status, attempt: w.attempt })),
    activeConflicts: await this.collabStore.queryConflicts({ statuses: ["detected", "under_review"] }),
    recentFindings: await this.collabStore.queryFindings({ limit: 20 }),
  };
}
```

- [ ] **Step 3: Run tests — pass**
- [ ] **Step 4: Commit**

---

## Task 8: Explicit deferred classification stubs

**Files:**
- Modify: `src/kernel/collaborative-planner.ts`

The classification infrastructure detects `conflict_detected` and `worker_completed` with signal findings, but the actual replan actions for these triggers are deferred to M0.78g.1 (model-assisted replanning).

- [ ] **Step 1: Write tests for stub behavior**

Tests:
- `classifyReplanKind` with `conflict_detected` correctly classifies as `"resolve_conflict"`
- `classifyReplanKind` with `worker_completed` and suggestive findings classifies as `"add_work"`
- `replan()` returns `applied: false` with `"deferred to M0.78g.1"` for these kinds

- [ ] **Step 2: Update `classifyReplanKind()` with stubs**

```typescript
private classifyReplanKind(context: ReplanContext, run: CoordinationRun):
  { kind: "replace_worker" | "resolve_conflict" | "add_work" | "re_decompose"; targetWorkerIds: string[] } {
  if (context.triggeredBy === "worker_failed") {
    const w = run.workers.find(x => x.id === context.workerId);
    if (w && w.attempt >= w.maxAttempts) {
      return { kind: "replace_worker", targetWorkerIds: [context.workerId] };
    }
  }
  // classifyReplanKind is classification-only.
  // The replan() method returns applied=false for these — the
  // model-assisted replan logic is deferred to M0.78g.1.
  if (context.triggeredBy === "conflict_detected") {
    return { kind: "resolve_conflict", targetWorkerIds: context.workerId ? [context.workerId] : [] };
  }
  if (context.triggeredBy === "worker_completed") {
    return { kind: "add_work", targetWorkerIds: [] };
  }
  return { kind: "replace_worker", targetWorkerIds: [] };
}
```

- [ ] **Step 3: Add stub branches in `replan()` accepting deferred classifications**

```typescript
if (kind !== "replace_worker") {
  return {
    run: null, revision: null, applied: false,
    errors: [
      `${kind} requires model-assisted replanning — deferred to M0.78g.1`,
    ],
  };
}
```

- [ ] **Step 4: Run tests — pass**
- [ ] **Step 5: Commit**

---

## Task 9: Integration and full-suite verification

- [ ] **Step 1: Run `npm run build`** — zero TypeScript errors
- [ ] **Step 2: Run `npm run test:node:ci`** — all 2779+ existing tests green
- [ ] **Step 3: Verify individual new test files**

```bash
node --test tests/kernel/coordination-store-replan.test.ts
node --test tests/kernel/collaborative-planner.test.ts
node --test tests/kernel/coordination-scheduler-replan.test.ts
node --test tests/kernel/collaboration-context-builder-replan.test.ts
```

- [ ] **Step 4: Graceful fallback test** — instantiate `CoordinationScheduler` without `replanner` dep, run existing scheduler tests, confirm no regression
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(coordination): M0.78g collaborative planning and replanning"
```

---

## Verification

1. **`npm run build`** — zero TypeScript errors
2. **`npm run test:node:ci`** — all 2779+ existing tests green
3. **New replan tests** — all 20+ tests in 4 new test files green:
   - Store atomics: CAS guard, revision increment, concurrent conflict
   - Replacement worker: same task/goal, fresh attempt/leases/auth, dependency rewiring, lineage fields
   - Scheduler: exhausted retries triggers replan, mid-retry skips, replanning status guards dispatch, error recovery
   - Context builder: empty/partial/completed runs
4. **Graceful fallback** — scheduler without replanner passes existing tests unchanged
5. **Audit trail** — plan revisions document every replacement with diff and reason

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-m78g-collaborative-planning.md`.

Recommended execution: Subagent-Driven Development — dispatch a fresh subagent per task (Tasks 1→9 in order), with specification review and code-quality review between each task.
