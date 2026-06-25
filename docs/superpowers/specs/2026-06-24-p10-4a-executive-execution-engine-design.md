# P10.4a — Executive Execution Engine Design Spec

> **Status:** Draft design spec
> **Consumes:** P10.3 `ExecutionPlan` (immutable)
> **Produces:** Plan persistence + step-state machine + execution engine
> **Risk:** LOW-MEDIUM — first executive phase that writes to disk; does NOT mutate system state

## Overview

P10.4a is the fifth layer of the executive intelligence stack:

```
P10.0  Health         (measurement)
P10.1  Priority       (prioritization)
P9.6   Investigations (operator work queue)
P10.2  Objectives     (strategy — what to achieve)
P10.3  Plans          (planning — how to achieve it)
P10.4a Execution      (orchestration — durable plan state + step execution)  ← this spec
P10.4b Execution      (proposal/governance bridge — mutation dispatch)      ← future
P10.5  Review         (closed-loop evaluation)                              ← future
```

**Architectural boundary:** P10.4a owns **plan persistence + step execution state**, NOT mutation. It writes to its own evidence stream and its own disk paths; it never invokes `AgentCardApplier`, `SkillApplier`, `GovernanceChangeApplier`, `RevertApplier`, or `ProposalStore.save`. Mutation steps are classified as `waiting_for_bridge` and only P10.4b will dispatch them into the existing P5/P9 proposal lifecycle.

**P10.4a is the orchestrator.** P10.4b is the bridge. They are deliberately separate phases.

## Constitutional laws (binding for the entire P10 series)

1. **Recommend ≠ Decide** — P10.4a executes READ-ONLY steps directly but does NOT decide whether mutations should happen. `investigation` and `mutation` StepBehavior classes are explicitly labeled `waiting_for_bridge` — no silent dispatch.
2. **Learning ≠ Mutation** — P10.4a evidence is observable but does not trigger any adaptation proposal.
3. **No auto-approve / no auto-apply** — `PlanApprovalGate` requires explicit operator invocation. `runReadySteps` only runs after explicit `start`.
4. **Executive ≠ Mutation framework** — P5–P9 own mutations; P10 owns orchestration.

---

## StepBehavior taxonomy (locks the 12 ExecutionStepAction kinds into 3 classes)

| # | ExecutionStepAction | Behavior | P10.4a behavior |
|---|---|---|---|
| 1 | `diagnose_root_cause` | `read-only` | execute + evidence |
| 2 | `create_remediation_proposal` | `mutation` | intent → `waiting_for_bridge` |
| 3 | `apply_remediation` | `mutation` | intent → `waiting_for_bridge` |
| 4 | `triage_investigations` | `investigation` | intent → `waiting_for_bridge` |
| 5 | `assign_investigation_ownership` | `investigation` | intent → `waiting_for_bridge` |
| 6 | `resolve_investigations` | `investigation` | intent → `waiting_for_bridge` |
| 7 | `audit_metrics` | `read-only` | execute + evidence |
| 8 | `identify_optimization_targets` | `read-only` | execute + evidence |
| 9 | `implement_improvements` | `mutation` | intent → `waiting_for_bridge` |
| 10 | `schedule_health_check` | `read-only` | execute + evidence |
| 11 | `review_baseline_metrics` | `read-only` | execute + evidence |
| 12 | `update_documentation` | `read-only` | execute + evidence |

Three classes are stable even though P10.4a treats `investigation` and `mutation` identically at runtime. Distinguishing them now prevents a type rewrite when P10.4b (mutation bridge) and the future investigation bridge land.

---

## Architecture

```
P10.2  Decide what matters
        ↓
P10.3  Build execution plan (immutable)
        ↓
P10.4a Orchestrate plan execution ← THIS SPEC
        │
        ├─ PlanStore              immutable plan.json
        ├─ ExecutionStateStore    mutable state + transition history
        ├─ PlanApprovalGate       lightweight whole-plan validator
        ├─ ExecutionEngine        scheduler (nextRunnable, dependsOn check)
        ├─ StepRunner             per-behavior execution (rich result)
        ├─ StepBehavior map       read-only | investigation | mutation
        └─ Evidence writer        step_executed / step_intent_recorded / etc.
```

### Components in detail

**PlanStore** — persists immutable `ExecutionPlan` content. Append-once.
**ExecutionStateStore** — persists mutable execution state. Single canonical `stepStates` map keyed by step ID.
**PlanApprovalGate** — validates the whole plan is approvable (state status === draft, approval status === pending, plan has ≥1 step). Records approval into `ExecutionStateStore.approval`. Does NOT inspect step actions or DAG.
**ExecutionEngine** — scheduler. Computes `nextRunnableSteps` (DAG-respecting), drives `runStep`, drives plan status transitions.
**StepRunner** — per-behavior execution. Returns rich `StepRunnerResult` (outcome, durationMs, summary, generatedArtifacts[], evidenceIds[], warnings[]).

---

## File structure

```
src/executive/
  ├─ planning-engine.ts                 (existing — P10.3)
  ├─ plan-store.ts                      NEW: append-once plan persistence
  ├─ execution-state-store.ts           NEW: mutable state + transition history
  ├─ plan-approval-gate.ts              NEW: lightweight whole-plan validator
  ├─ execution-engine.ts                NEW: scheduler
  ├─ step-runner.ts                     NEW: per-behavior execution
  ├─ step-behavior.ts                   NEW: StepBehavior type + STEP_BEHAVIOR map
  └─ executive-plan-types.ts            NEW: types + correlation IDs

src/cli/commands/
  └─ executive.ts                       MODIFY: add plan subcommand dispatcher

src/events/types.ts                     MODIFY: add 9 P10.4a evidence events
src/events/event-log.ts                 MODIFY: register new event types

tests/executive/
  ├─ plan-store.vitest.ts               NEW
  ├─ execution-state-store.vitest.ts    NEW
  ├─ plan-approval-gate.vitest.ts       NEW
  ├─ execution-engine.vitest.ts         NEW
  ├─ step-runner.vitest.ts              NEW
  └─ executive-sentinels.vitest.ts      MODIFY: scope expanded to include 4 new files

tests/cli/commands/executive-plan-cli.vitest.ts   NEW
```

---

## Data shapes

### `PersistedExecutionPlan` (immutable; plan.json)

The immutable plan MUST NOT contain operational lifecycle. All execution state (status, approval, transitions, timestamps) belongs in `PlanExecutionState`. The persisted plan is the P10.3 `ExecutionPlan` shape (steps, dependencies, objectives, planner metadata) plus a content hash.

```typescript
interface PersistedExecutionPlan extends ExecutionPlan {
  /** SHA-256 of the canonical JSON content; integrity check on read. */
  contentHash: string;
}
```

**Removed from persisted shape:** `planStatus` (P10.3 had this for "draft | ready | blocked"; in P10.4a it is fully derived from `PlanExecutionState.status` plus step runtime status). P10.4a's persistence layer never stores `planStatus`; if the P10.3 shape needs the field for in-memory display, derive it on read.

Stored at `.alix/executive/plans/<planId>.json`. Content is byte-identical to P10.3 output. Hash is computed at write time and re-verified on load.

### `PlanExecutionState` (mutable; plan-state.json)

```typescript
type PlanStatus =
  | "draft"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

type ApprovalStatus = "pending" | "approved" | "rejected";

interface PlanExecutionState {
  planId: string;                       // FK to plan.json

  /** Top-level operational status. Transitions are explicit. */
  status: PlanStatus;

  /** Approval metadata. Embedding inside execution state because approval
   *  is execution metadata, not immutable plan content. */
  approval: {
    status: ApprovalStatus;
    approvedBy?: string;
    approvedAt?: string;
    rejectedBy?: string;
    rejectedAt?: string;
    rejectionReason?: string;
  };

  /** Single canonical source of truth for step runtime state.
   *  Replaces redundant parallel arrays. */
  stepStates: Record<StepId, StepRuntimeState>;

  /** Full history of plan-level status transitions (append-only). */
  planTransitions: PlanTransition[];

  timestamps: {
    createdAt: string;
    approvedAt?: string;
    runningAt?: string;
    completedAt?: string;
    failedAt?: string;
    blockedAt?: string;
    cancelledAt?: string;
  };

  /** Most recent executionId (one executionId = one runReadySteps() call). */
  lastExecutionId?: string;
}

interface StepRuntimeState {
  status: StepRuntimeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  evidenceIds: string[];
  summary?: string;
  generatedArtifacts: GeneratedArtifactRef[];
  warnings: string[];
  /** Which executionId run last touched this step. */
  lastExecutionId?: string;
}

interface GeneratedArtifactRef {
  type: "proposal" | "report" | "investigation" | "document" | "evidence" | "other";
  id: string;
  /** Optional URI for artifacts that live outside ALiX (GitHub issue,
   *  markdown file, PDF, etc.). Reserved now so P10.5 / future phases can
   *  surface external artifacts without another interface change. */
  uri?: string;
}

type StepRuntimeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "waiting_for_bridge"                // ← investigation + mutation steps in P10.4a
  | "failed";                           // P10.4a: type-only, unreachable
```

**Derived queries (no parallel storage):**
- `completedSteps` = `Object.values(stepStates).filter(s => s.status === "completed").map(s => s.id)`
- `waitingForBridgeSteps` = same pattern
- `blockedSteps` = same pattern
- `inProgressSteps` = same pattern

One canonical source of truth is always better than four synchronized collections.

### `PlanTransition` (append-only history)

```typescript
interface PlanTransition {
  /** Monotonically increasing sequence number. Starts at 1, increments per transition.
   *  Makes replay deterministic even if timestamps collide (e.g., batched updates). */
  sequence: number;
  from: PlanStatus;
  to: PlanStatus;
  at: string;
  /** executionId of the run that triggered this transition. */
  executionId?: string;
  reason?: string;
}
```

`sequence` is the canonical ordering key for transitions, not `at`. Consumers sorting transitions MUST sort by `sequence`.

---

## Store APIs

### PlanStore (immutable)

```typescript
class PlanStore {
  /** Save a P10.3 ExecutionPlan as immutable plan.json. */
  save(plan: ExecutionPlan): Promise<PersistedExecutionPlan>;

  /** Load plan.json by id. Verifies contentHash. Throws if tampered. */
  load(planId: string): Promise<PersistedExecutionPlan>;

  /** List all saved plans (newest first). */
  list(): Promise<PersistedExecutionPlan[]>;
}
```

### ExecutionStateStore (mutable)

```typescript
class ExecutionStateStore {
  /** Initialize state for a freshly-saved plan. */
  init(planId: string): Promise<PlanExecutionState>;

  /** Load current state. */
  load(planId: string): Promise<PlanExecutionState>;

  /** Atomically update state. Validates status transition + transition history.
   *  Returns the new state.
   *
   *  INVARIANT: the `mutator` callback MUST NOT modify `planTransitions[]`
   *  directly. Only the store appends transitions (with monotonically
   *  increasing `sequence`). Two implementations writing to the history
   *  array would double-record events and break replay determinism.
   *  Mutators MAY update `stepStates`, `approval`, `status`, and `timestamps`. */
  update(
    planId: string,
    transition: Omit<PlanTransition, "at">,
    mutator: (s: PlanExecutionState) => PlanExecutionState,
  ): Promise<PlanExecutionState>;
}
```

Atomic write: write to `plan-state.json.tmp` then rename.

**Startup consistency invariant:** When `ExecutionEngine` or any other consumer loads a plan, it MUST verify `state.planId === plan.id`. If they differ (e.g., orphaned state file, manual copy), fail closed. This prevents orphaned execution state from driving a different plan.

### PlanApprovalGate (lightweight validator)

```typescript
class PlanApprovalGate {
  constructor(
    private planStore: PlanStore,
    private stateStore: ExecutionStateStore,
    private writer: EvidenceEventWriter,
  );

  approve(planId: string, by: string): Promise<PlanExecutionState>;
  reject(planId: string, by: string, reason: string): Promise<PlanExecutionState>;
}
```

**Validations performed by `approve()`:**
- Plan exists in `PlanStore`
- Current state `status === "draft"` AND `approval.status === "pending"`
- Plan has at least 1 step (`PersistedExecutionPlan.steps.length > 0`) — empty plans are kept in `blocked` and cannot be approved. This replaces any reference to a removed `planStatus` field; the empty-steps check IS the blocked-plan check.

**What `PlanApprovalGate` does NOT do:**
- Inspect step actions or behavior classes
- Validate dependency DAG
- Check objective scores / risk levels
- Decide which steps to run

Those are `ExecutionEngine` and `StepRunner` responsibilities.

### ExecutionEngine (scheduler)

```typescript
class ExecutionEngine {
  constructor(
    private planStore: PlanStore,
    private stateStore: ExecutionStateStore,
    private runner: StepRunner,
    private writer: EvidenceEventWriter,
  );

  /** Start a plan (draft → approved → running). Called once. */
  startPlan(planId: string, by: string): Promise<PlanExecutionState>;

  /** Returns step IDs whose dependsOn are all completed AND status === "pending". */
  nextRunnableSteps(planId: string): Promise<string[]>;

  /** Run one step. Throws if not runnable. Generates fresh executionId. */
  runStep(planId: string, stepId: string): Promise<StepExecutionResult>;

  /** Run all currently runnable steps sequentially.
   *  Generates ONE fresh executionId shared by all steps in the batch.
   *
   *  Scheduling policy (P10.4a):
   *    1. nextRunnableSteps() — initial pure DAG query
   *    2. Sort by stepNumber ascending (display ordering, deterministic)
   *    3. Execute ONE step at a time
   *    4. Persist state after every step (atomic write)
   *    5. AFTER each completed step: RECOMPUTE nextRunnableSteps()
   *       — a step that was blocked by an earlier completed dep may now
   *       be runnable, and newly completed steps may unblock downstream work
   *    6. Continue until no runnable steps remain OR a step fails/blocks
   *    7. Return array of StepExecutionResult for the entire batch
   *
   *  Future (P10.6 or later) may introduce parallel scheduling without
   *  changing the StepRunner interface. */
  runReadySteps(planId: string): Promise<StepExecutionResult[]>;
}

interface StepExecutionResult {
  stepId: string;
  status: StepRuntimeStatus;
  durationMs: number;
  evidenceIds: string[];
  executionId: string;
}
```

### StepRunner (per-behavior)

```typescript
class StepRunner {
  constructor(private writer: EvidenceEventWriter);

  /** Execute a single step according to its behavior class. */
  execute(step: ExecutionStep, executionId: string): Promise<StepRunnerResult>;
  // Caller (ExecutionEngine) generates the executionId and passes it in.
}

interface StepRunnerResult {
  /** What happened. For P10.4a: "executed" | "intent_recorded". */
  outcome: "executed" | "intent_recorded";

  durationMs: number;
  summary?: string;
  generatedArtifacts: GeneratedArtifactRef[];
  evidenceIds: string[];
  warnings: string[];

  /** Whether this step is retryable. P10.4a: always false (no failure path yet).
   *  P10.4c will populate this. The field is reserved now to avoid interface churn. */
  retryable: boolean;

  /** New runtime status for the step. */
  newStepStatus: StepRuntimeStatus;
}
```

**P10.4a behavior per `StepBehavior`:**

| Behavior | `outcome` | `newStepStatus` | Evidence |
|---|---|---|---|
| `read-only` | `executed` | `completed` | `executive_step_executed` |
| `investigation` | `intent_recorded` | `waiting_for_bridge` | `executive_step_intent_recorded` |
| `mutation` | `intent_recorded` | `waiting_for_bridge` | `executive_step_intent_recorded` |

P10.4a `read-only` execution is itself a thin layer: it records what the step would do + its evidence, then marks the step completed. No real diagnostic or audit logic ships in P10.4a — that is deliberate. P10.4a's job is to prove orchestration works; P10.4b adds the proposal bridge, and P10.5 evaluates actual outcomes.

---

## Correlation IDs

Every evidence event emitted by P10.4a carries:

```typescript
interface ExecutiveCorrelation {
  planId: string;
  stepId?: string;          // omitted for plan-level events
  executionId: string;      // one executionId = one runReadySteps() invocation
}
```

`executionId` is generated when **any** step-execution entry point is called: `runReadySteps()`, `runStep()`, and the per-step work inside `startPlan()` (if it triggers initial step execution). Each entry point invocation generates ONE fresh `executionId` (UUID v4). All evidence events emitted during that invocation — including step events and any resulting plan-level events — share the same `executionId`. This is essential for retry tracing and for reconstructing "which run touched which steps."

### Constitutional invariant (P10.4a)

**Only `ExecutionEngine` may generate `executionId`.** All downstream code (`StepRunner`, `PlanApprovalGate` if it emits evidence, evidence writer helpers) receives the `executionId` as a parameter. This is a binding ownership rule — like `Recommend≠Decide` and `Learning≠Mutation` — and guarantees one scheduler invocation = one correlation context. P10.4a's purity sentinel enforces this: `StepRunner` and `PlanApprovalGate` MUST NOT contain `randomUUID`, `Math.random`, or any other id-generation primitive.

### Step ID immutability

**Step IDs are immutable after persistence.** They are treated as primary keys. The following MUST all reference step IDs and never mutate them:
- `dependsOn` arrays on other steps
- `StepRuntimeState.lastExecutionId`
- Evidence events (`executive_step_*`)
- `GeneratedArtifactRef.id` (when an artifact is associated with a step)
- `PlanTransition.lastUpdatedStepId`

P10.4a's persistence layer does not provide any API to rename a step. A future renumbering feature (if ever added) would require a migration that rewrites all references atomically — out of scope for P10.4a.

---

## Plan lifecycle

```
              ┌──────────┐
              │  draft   │  ← persisted but never approved
              └─────┬────┘
                    │  approve plan
                    ▼
              ┌──────────┐
              │ approved │  ← PlanApprovalGate
              └─────┬────┘
                    │  start plan (one-shot)
                    ▼
              ┌──────────┐
              │ running  │  ← ExecutionEngine active
              └─────┬────┘
             ┌──────┼──────┬─────────┐
             ▼      ▼      ▼         ▼
        ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
        │completed│ │ failed │ │blocked │ │cancelled│
        └────────┘ └────────┘ └────────┘ └────────┘
```

**Plan status transitions:**
- `draft → approved` (PlanApprovalGate.approve)
- `approved → running` (ExecutionEngine.startPlan, one-shot)
- `running → completed` (all steps in terminal state)
- `running → failed` (P10.4a: type-only, unreachable)
- `running → blocked` (a step enters blocked state due to dependency failure)
- `running → cancelled` (operator cancellation — P10.4a: type-only, reachable in CLI stub)
- Any → `cancelled` (operator, future phase)

---

## Step lifecycle

```
pending → in_progress → completed           (read-only steps)
pending → in_progress → waiting_for_bridge  (investigation + mutation steps)
pending → in_progress → blocked            (deps failed)
pending → in_progress → failed              (P10.4a: type-only, unreachable)
```

`in_progress` is transient — a single `runStep()` call flips step through `in_progress` to its terminal status in one atomic update.

---

## Evidence events (P10.4a-specific)

| Event | Payload | When |
|---|---|---|
| `executive_plan_saved` | `{ planId, contentHash, stepCount }` | Plan persisted to store |
| `executive_plan_approved` | `{ planId, approvedBy, executionId }` | PlanApprovalGate.approve |
| `executive_plan_rejected` | `{ planId, rejectedBy, reason, executionId }` | PlanApprovalGate.reject |
| `executive_plan_started` | `{ planId, runnableStepCount, executionId }` | Engine.startPlan |
| `executive_step_executed` | `{ planId, stepId, action, durationMs, summary, executionId }` | StepRunner ran a read-only step |
| `executive_step_intent_recorded` | `{ planId, stepId, action, behaviorClass, executionId }` | StepRunner recorded intent for non-read-only |
| `executive_step_blocked` | `{ planId, stepId, blockedBy, executionId }` | Dependency failed |
| `executive_plan_completed` | `{ planId, totalDurationMs, executionId }` | All steps terminal |
| `executive_plan_failed` | `{ planId, reason, executionId }` | (P10.4a: unreachable, type exists) |

All 9 events registered in `src/events/types.ts` and `src/events/event-log.ts`. Every event carries the `ExecutiveCorrelation` fields.

---

## CLI surface

```bash
# Persist a plan from the current dashboard (calls buildExecutionPlan internally)
alix executive plan save [--window N]

# List saved plans (most recent first)
alix executive plan list [--status draft|approved|completed|...]

# Show plan details + execution state + step statuses
alix executive plan show <planId>

# Plan-level approval gate (single human gate)
alix executive plan approve <planId>
alix executive plan reject <planId> --reason "<text>"

# Start a plan (approved → running, one-shot)
alix executive executive plan start <planId>

# Run ready steps (idempotent — picks up where left off, generates new executionId)
alix executive plan run <planId>

# Show single step result
alix executive plan step <planId> <stepId>

# Resume an interrupted plan (P10.4a: aliases `run`; reserved for P10.4c interruption support)
alix executive plan resume <planId>
```

**Two-gate model preserved:**
- Plan approval: P10.4a's `PlanApprovalGate`
- Step-level mutation approval: P10.4b will use existing `AdaptationProposal` → `ApprovalGate` flow

P10.4a does NOT add any step-level approval.

---

## Sentinel & invariants

### P10.4a purity sentinel (extends P10 sentinel)

New forbidden symbols in P10.4a files:

```typescript
const FORBIDDEN_IN_P10_4A = [
  // Mutation machinery — never called by P10.4a
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
  "InvestigationRecommendationGenerator",   // future bridge target
  "InvestigationStore",                     // future bridge target
  // Step-level approval machinery — P10.4a only approves whole plans
  // Both abstract and concrete names are forbidden so future renames don't
  // accidentally bypass the sentinel.
  "ApprovalGate",
  "ProposalApprovalGate",
  ".approve(", ".apply(", ".reject(",
  // Outcome-recording / mutation evidence — P10.4a does not record outcomes
  "recordAdaptationApproved",
  "recordAdaptationApplied",
  "recordAdaptationRejected",
  "recordAdaptationFailed",
  "recordRevertApplied",
  "recordRevertFailed",
];
```

### PlanStore file I/O scope

PlanStore is the FIRST P10 file that writes to disk. Sentinel allows `writeFileSync`, `renameSync`, `readFileSync`, `mkdirSync` ONLY within `.alix/executive/plans/`. A scoped path check in the sentinel fails if any P10.4a file writes outside that directory.

### Constitutional invariants (binding)

- Recommend≠Decide — P10.4a executes READ-ONLY steps directly; investigation/mutation steps are `waiting_for_bridge`. No silent dispatch.
- Learning≠Mutation — P10.4a evidence is observable but does not trigger adaptation.
- No auto-approve / no auto-apply — `PlanApprovalGate` requires explicit operator invocation.
- Executive≠Mutation framework — P5–P9 own mutations; P10 owns orchestration.

---

## Testing strategy

| File | Tests | Coverage |
|---|---|---|
| `tests/executive/plan-store.vitest.ts` | 8 | Save/load, contentHash integrity, list ordering, tampered-file detection |
| `tests/executive/execution-state-store.vitest.ts` | 10 | init/load/update atomicity, status transition validation, stepStates canonical map, planTransitions append-only |
| `tests/executive/plan-approval-gate.vitest.ts` | 7 | Approve draft, reject non-draft, empty plan blocked, blocked plan rejected, evidence emission, no step inspection |
| `tests/executive/execution-engine.vitest.ts` | 14 | nextRunnable respects DAG, runStep updates state atomically, dependsOn enforcement, blocked dependency propagation, startPlan one-shot, runReadySteps batched executionId |
| `tests/executive/step-runner.vitest.ts` | 9 | read-only executes + evidence, investigation/mutation → waiting_for_bridge + evidence, no applier calls, rich result shape |
| `tests/executive/executive-sentinels.vitest.ts` | +5 tests | P10.4a files have no mutation paths, PlanStore file I/O scoped |
| `tests/cli/commands/executive-plan-cli.vitest.ts` | 12 | All 6 subcommands + edge cases |

**Total: ~65 new tests.**

---

## Out of scope (deferred to other phases)

| Feature | Belongs to |
|---|---|
| Step → AdaptationProposal/GovernanceProposal bridge | **P10.4b** |
| Investigation → P9.6 InvestigationRecommendation bridge | Future P10.x |
| Real diagnostic/audit logic for read-only steps | **P10.4b+** or later |
| Failure recovery / retry policies | **P10.4c** |
| Outcome evaluation | **P10.5** |
| Plan cancellation CLI | Future (type exists in P10.4a, no UI) |

---

## Open design notes (for review)

1. **Plan JSON-L index vs filesystem listing.** PlanStore uses `readdirSync` over `.alix/executive/plans/` to list plans. A JSONL index would be faster at scale but adds a consistency surface. For P10.4a, filesystem listing is sufficient. Reconsider if plan count grows beyond ~10k.

2. **ExecutionStateStore atomicity.** The atomic write pattern (write tmp + rename) is the same one SnapshotStore uses. If PlanStore + ExecutionStateStore need cross-store consistency, P10.4a should ensure plan.json and plan-state.json writes are not interleaved with state updates from concurrent processes. For P10.4a's single-process model, this is not a concern.

3. **PlanId determinism.** PlanId comes from P10.3's `planId()` (timestamp + window). For testing, allow an override (e.g., `save(plan, { id: "plan-test-1" })`). The store must accept both deterministic and timestamp-based IDs.

4. **`waiting_for_bridge` semantics.** When P10.4b ships, mutation steps will leave `waiting_for_bridge` and become `in_progress` → `completed` via the proposal lifecycle. The investigation bridge is independent and may land later. P10.4a must not encode any assumption about which bridge lands first.

5. **One execution engine, multiple concurrent plans.** P10.4a assumes single-process, single-thread per `runReadySteps()`. Future distributed execution would need a lock per plan. Document this as a known limitation.

6. **Future `BehaviorRunner` hierarchy (P10.4c+).** When the read-only execution logic grows sophisticated (real diagnostics, real audits, real doc updates), it may become worthwhile to split `StepRunner` into:
   ```
   StepRunner
     ├─ ReadOnlyRunner        (audits, diagnostics, scheduled checks)
     ├─ InvestigationRunner   (P9.6 bridge; future)
     └─ MutationRunner        (P10.4b bridge; Proposal → Approval → Apply)
   ```
   The current `StepRunner` interface is forward-compatible with this split — the only change is internal dispatch. NOT planned for P10.4a.