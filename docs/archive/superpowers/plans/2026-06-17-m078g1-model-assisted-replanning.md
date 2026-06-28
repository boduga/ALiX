# M0.78g.1 — Model-Assisted Replanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable model-assisted replanning where the model proposes a typed `PlanRevisionDraft` and ALiX validates, simulates, analyzes impact/policy/ownership, gates approval, and applies atomically via CAS. The model never mutates a coordination run directly.

**Architecture:** Nine sequential slices. The model is advisory — it proposes draft revisions using stable `draftWorkerId` references. ALiX validates DAG integrity via a graph simulator, derives risk/capability/ownership deterministically, preserves worker history, and applies via the existing `updateRunWithRevisionCheck` CAS guard. A durable proposal store and orchestration service own the full workflow.

**Tech Stack:** TypeScript, Node `node:test`, existing `CoordinationStore`, `ModelAdapter`, `CollaborativePlanner`, `CollaborationStore`, `OwnershipRegistry`, `ApprovalStore`

## Global Constraints

- All new tests use `node:test` + `node:assert/strict` — no vitest, no chai
- Stateful kernel tests use `mkdtempSync` + `rmSync`
- Worker history is preserved — never splice workers from the array
- The model never mutates a run — only returns `PlanRevisionDraft`
- All run mutations use `updateRunWithRevisionCheck` CAS guard
- Risk, capability assignment, ownership, and approval requirements are derived by ALiX, not accepted from the model
- No model call occurs while a run lock is held
- Replanning proposal lifecycle is separate from run state — a failed proposal never strands a run in `replanning`
- The system must work without model-assisted replanning configured (mechanical fallback from M0.78g)
- 2900+ existing tests must pass after every task

---

## File Structure

| File | Action | Task |
|------|--------|------|
| `src/kernel/replan-types.ts` | CREATE | 1a |
| `src/kernel/replan-proposal-store.ts` | CREATE | 1a |
| `src/kernel/collaboration-context-builder.ts` | MODIFY | 1b |
| `src/kernel/model-replan-adapter.ts` | CREATE | 1c |
| `src/kernel/replan-validator.ts` | CREATE | 1d |
| `src/kernel/replan-simulator.ts` | CREATE | 1d |
| `src/kernel/replan-impact-analyzer.ts` | CREATE | 1e |
| `src/kernel/replan-approval-gate.ts` | CREATE | 1f |
| `src/kernel/approval-store.ts` | MODIFY | 1f |
| `src/kernel/replan-applier.ts` | CREATE | 1g |
| `src/kernel/model-assisted-replan-service.ts` | CREATE | 1h |
| `tests/kernel/replan-proposal-store.test.ts` | CREATE | 1a |
| `tests/kernel/model-replan-adapter.test.ts` | CREATE | 1c |
| `tests/kernel/replan-validator.test.ts` | CREATE | 1d |
| `tests/kernel/replan-simulator.test.ts` | CREATE | 1d |
| `tests/kernel/replan-impact-analyzer.test.ts` | CREATE | 1e |
| `tests/kernel/replan-approval-gate.test.ts` | CREATE | 1f |
| `tests/kernel/replan-applier.test.ts` | CREATE | 1g |
| `tests/kernel/model-assisted-replan-service.test.ts` | CREATE | 1h |
| `tests/kernel/replan-adversarial.test.ts` | CREATE | 1i |

---

### Task 1a: Proposal Schema, Types, and Proposal Store

**Files:**
- Create: `src/kernel/replan-types.ts`
- Create: `src/kernel/replan-proposal-store.ts`
- Test: `tests/kernel/replan-proposal-store.test.ts`

**Interfaces:**
- Consumes: existing `PlanTriggerKind`, `WorkerAssignment`, `CoordinationRun`
- Produces: `PlanRevisionDraft`, `DraftWorkerSpec`, `DraftWorkerReplaceSpec`, `DraftWorkerModifySpec`, `DependencyRewire`, `TriggerEvidence`, `ProposalRecord`, `ProposalStatus`, `SimulatedGraph`, `SimulatedWorker`, `ValidationResult`, `ImpactAnalysis`, `OwnershipImpact`, `PolicyDecision`

Key types (from spec):

```typescript
// PlanRevisionDraft — model output (advisory, not authoritative)
interface PlanRevisionDraft {
  triggerKind: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  workersToAdd: DraftWorkerSpec[];
  workersToReplace: DraftWorkerReplaceSpec[];
  workersToCancel: string[];          // only pending/ready/blocked
  workersToModify: DraftWorkerModifySpec[];
  dependencyRewiring: DependencyRewire[];
  expectedBenefit: string;
  confidence: number;
  unresolvedConcerns: string[];
}

// DraftWorkerSpec uses stable draftWorkerId for dep references
type DraftWorkerSpec = {
  draftWorkerId: string;
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  dependencies: string[];
  verificationRequirements: string[];
};

// DependencyRevire uses explicit dependent worker refs
type DependencyRewire = {
  dependentWorkerRef: string;
  removeDependencyRef: string;
  addDependencyRef: string;
  reason: string;
};

// Proposal lifecycle
type ProposalStatus =
  | "proposed" | "invalid" | "awaiting_approval"
  | "approved" | "denied"
  | "applying" | "applied" | "failed" | "superseded";
```

The proposal store persists at `.alix/coordination/replans/<runId>/<proposalId>.json` using atomic temp-file + rename writes. It contains the full proposal record with expected plan revision, draft fingerprint, validation results, impact fingerprint, approval ID, provider/model/usage metadata, and timestamps.

- [ ] **Step 1: Write `src/kernel/replan-types.ts`** with all types
- [ ] **Step 2: Write `src/kernel/replan-proposal-store.ts`** with CRUD, fingerprinting
- [ ] **Step 3: Write tests** — valid draft constructs, proposal CRUD, fingerprinting, atomic write safety
- [ ] **Step 4: Build and run tests**
- [ ] **Step 5: Commit**

---

### Task 1b: Bounded Untrusted Replan Context

**Files:**
- Modify: `src/kernel/collaboration-context-builder.ts`
- Test: extend existing context-builder-replan test

Extend `CollaborationContextBuilder.buildReplanContext()` to add:
- Run-specific filtering (only this run's workers, findings, conflicts)
- Current-attempt findings per worker
- Aggregate result + issues
- Dependency graph (topological order of worker IDs)
- Hard context budget (token cap to prevent model over-consumption)
- Sensitive-data redaction (strip paths, user-identifying content)
- Context fingerprint (deterministic hash for revalidation)
- Untrusted-content boundaries (model input is treated as untrusted data)

Missing run returns explicit error (not empty context).

- [ ] **Step 1: Write tests** — budget enforcement, redaction, missing run error, fingerprint stability
- [ ] **Step 2: Implement extended context building**
- [ ] **Step 3: Build and run tests**
- [ ] **Step 4: Commit**

---

### Task 1c: ModelAdapter-Based Proposal Generation

**Files:**
- Create: `src/kernel/model-replan-adapter.ts`
- Test: `tests/kernel/model-replan-adapter.test.ts`

Uses ALiX's real `ModelAdapter.complete()` with `NormalizedRequest.structuredOutputSchema`. Tools disabled (empty tool list). Always runs runtime JSON parsing + validation even when provider claims structured-output support.

```typescript
class ModelReplanAdapter {
  constructor(private modelAdapter: ModelAdapter, private options?: ReplanAdapterOptions) {}

  async proposeRevision(context: string): Promise<PlanRevisionDraft> {
    const request: NormalizedRequest = {
      systemPrompt: this.buildSystemPrompt(),
      messages: [{ role: "user", content: context }],
      structuredOutputSchema: REVISION_DRAFT_SCHEMA,
      tools: [],        // disabled — text-only with structured output
      abortSignal: this.options?.signal,
      maxTokens: this.options?.maxTokens ?? 4000,
    };

    const response = await this.modelAdapter.complete(request);
    const draft = this.parseAndValidate(response.text);
    // Collect provider/model/usage evidence
    return draft;
  }
}
```

Key behaviors:
- Retry with exponential backoff for transient errors (timeout, network)
- No retry for deterministic schema errors (syntax error, wrong shape — fail fast)
- `AbortSignal`/timeout support
- Bounded input (context capped by budget) and output (maxTokens)
- Injected sleep function for testable retry timing
- Prompt-injection content in response treated as data, not executed

- [ ] **Step 1: Write tests** — structured output success, JSON fallback, timeout, abort, retry behavior, schema error (no retry), prompt injection treated as data
- [ ] **Step 2: Implement `ModelReplanAdapter`**
- [ ] **Step 3: Build and run tests**
- [ ] **Step 4: Commit**

---

### Task 1d: Runtime Validator and Graph Simulator

**Files:**
- Create: `src/kernel/replan-validator.ts`
- Create: `src/kernel/replan-simulator.ts`
- Tests: `tests/kernel/replan-validator.test.ts`, `tests/kernel/replan-simulator.test.ts`

**ReplanValidator** — checks:
- Required fields present (triggerKind, triggerEvidence)
- No duplicate draftWorkerId values in draft
- All dependency references (draftWorkerId or durable IDs) resolvable within draft+existing workers
- Known trigger kind
- `workersToCancel` references only existing workers
- `workersToModify` references only existing workers
- `workersToReplace` targetWorkerId exists

**ReplanSimulator** — builds complete proposed graph:
- Maps each `draftWorkerId` to a deterministic provisional durable ID
- Detects:
  - Unknown existing or draft references in dependency arrays
  - Duplicate draft worker IDs
  - Self-dependencies
  - Duplicate dependencies
  - Cycles crossing old and new workers
  - Dangling dependencies after cancellation
  - Invalid replacement rewiring
  - Incompatible operations on one worker (e.g., both replace and modify)
  - Excessive graph expansion (configurable limit)
- Applies automatic dependency rewiring for replacements (downstream deps from replaced worker → replacement, unless explicit validated override exists in `dependencyRewiring`)
- Output: `SimulatedGraph` with exact ID map passed unchanged to CAS applier

```typescript
interface SimulatedGraph {
  workers: SimulatedWorker[];
  edges: Array<{ from: string; to: string }>;
  idMap: Record<string, string>;  // draftWorkerId → provisional durable ID
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

- [ ] **Step 1: Write tests for ReplanValidator** — all structural checks
- [ ] **Step 2: Write tests for ReplanSimulator** — all graph error conditions, valid graphs, mixed draft+existing deps, auto rewiring
- [ ] **Step 3: Implement both classes**
- [ ] **Step 4: Build and run all tests**
- [ ] **Step 5: Commit**

---

### Task 1e: Deterministic Assignment and Impact Analysis

**Files:**
- Create: `src/kernel/replan-impact-analyzer.ts`
- Test: `tests/kernel/replan-impact-analyzer.test.ts`

Reuses `CollaborativePlanner.matchCapabilities()` with controlled alias registry:
- Normalize each new/replacement worker's required capabilities
- Select eligible agent from pool (best match score, round-robin fallback)
- Never create a worker with `agentId: ""`

Query real ownership state via `OwnershipRegistry.listActive()` / `findConflictsByPattern()`:
- Compile ownership claims for new workers
- Detect active lease conflicts between proposed and existing owners
- Flag protected scope violations

Evaluate policy via existing `PolicyEngine` for each new/replacement worker:
- Collect policy decisions (allow/ask/deny)
- Flag policy violations

Calculate risk from effective per-worker risk:
- Model hints (confidence, expectedBenefit) cannot lower system risk
- Model approval hints cannot bypass policy

Build complete `ImpactAnalysis`:
- riskLevel, agentsAssigned, capabilitiesAdded/Removed, ownershipChanges, activeLeaseConflicts, protectedScopeViolations, policyDecisions, requiresApproval, summary

- [ ] **Step 1: Write tests** — capability matching, no eligible agent, fresh ownership conflict, model risk hint ignored, model approval hint cannot bypass policy
- [ ] **Step 2: Implement `ReplanImpactAnalyzer`**
- [ ] **Step 3: Build and run tests**
- [ ] **Step 4: Commit**

---

### Task 1f: Atomic Approval Reuse and Exact Approval Gate

**Files:**
- Create: `src/kernel/replan-approval-gate.ts`
- Modify: `src/kernel/approval-store.ts` (add `requestFresh()` and `requestOrReusePending()`)
- Test: `tests/kernel/replan-approval-gate.test.ts`

**ApprovalStore additions:**

```typescript
// requestFresh — always creates a new approval bound
async requestFresh(params: FreshApprovalParams): Promise<ApprovalBound>;

// requestOrReusePending — atomic lookup + insert under same lock
// Eliminates the check-then-create race that requestBound() leaves to callers
async requestOrReusePending(params: FreshApprovalParams): Promise<ApprovalBound>;
```

**ReplanApprovalGate:**
- Binds to: run ID, expected plan revision, draft fingerprint, impact fingerprint, policy revision, capability = `coordination.plan.revise`
- Low-risk revisions: auto-approved
- Medium/high/critical: routes to approval via `requestOrReusePending()`
- Before apply: reload proposal and run, revalidate fingerprints against current state, call `consumeApproved()` atomically
- Uses real status `denied` (not `rejected`)

- [ ] **Step 1: Write tests** — fresh approval, reuse pending, consumed exactly once, stale proposal rejected after plan revision advance, denial blocks apply
- [ ] **Step 2: Implement `requestFresh()` and `requestOrReusePending()` on ApprovalStore**
- [ ] **Step 3: Implement `ReplanApprovalGate`**
- [ ] **Step 4: Build and run tests**
- [ ] **Step 5: Commit**

---

### Task 1g: History-Preserving CAS Applier

**Files:**
- Create: `src/kernel/replan-applier.ts`
- Test: `tests/kernel/replan-applier.test.ts`

Rules:
- Never splice workers — use `supersededByWorkerId` / `replacementForWorkerId` lineage
- Only cancel `pending`/`ready`/`blocked` workers (throw on running/completed/failed)
- Every replacement gets fresh execution state:
  ```
  status: "pending";
  attempt: 0;
  approvalId: undefined;
  authorizationEvidence: undefined;
  leaseIds: [];
  executionOwnerId: undefined;
  resultRef: undefined;
  error: undefined;
  startedAt: undefined;
  completedAt: undefined;
  lastHeartbeatAt: undefined;
  ```
- Automatic downstream dep rewiring for replacements (unless explicit override exists in `dependencyRewiring`)
- Apply rewiring from `DependencyRewire[]`
- Throw in CAS callback on missing workers (never silently skip — no partial commit)
- CAS conflict returns `applied: false` with error
- Uses `SimulatedGraph.idMap` directly (exact mapping passed from simulator, unchanged)

- [ ] **Step 1: Write tests** — replacement preserves failed worker, running/completed removal rejected, history+lineage preserved, auto rewiring, CAS conflict no mutation, empty draft applied, security reset verified
- [ ] **Step 2: Implement `ReplanApplier`**
- [ ] **Step 3: Build and run tests**
- [ ] **Step 4: Commit**

---

### Task 1h: Model-Assisted Orchestration Service

**Files:**
- Create: `src/kernel/model-assisted-replan-service.ts`
- Test: `tests/kernel/model-assisted-replan-service.test.ts`

`ModelAssistedReplanService` owns the full workflow:

```
1. Load run, capture its planRevision
2. BuildBoundedReplanContext (via CollaborationContextBuilder)
3. Call ModelReplanAdapter.proposeRevision()
4. Validate via ReplanValidator
5. Simulate via ReplanSimulator
6. Analyze impact via ReplanImpactAnalyzer
7. Persist proposal to ReplanProposalStore
8. If approval required: ReplanApprovalGate.evaluate()
9. Reload run + proposal
10. Revalidate fingerprints (draft + impact) against current state
11. ConsumeApproved() if approval was required
12. Apply via ReplanApplier (CAS)
13. Persist outcome
```

Key behaviors:
- No model call while run lock is held
- Run never stranded in `replanning` after: model timeout, invalid output, approval denial, CAS conflict
- Failed proposals are persisted with error state (run remains in `running` or `blocked`)
- Mechanical fallback (M0.78g `CollaborativePlanner.replan()`) remains when no model configured

- [ ] **Step 1: Write tests** — full happy-path flow, model timeout recovers, invalid output recovers, approval denial recovers, CAS conflict recovers, no-model fallback
- [ ] **Step 2: Implement `ModelAssistedReplanService`**
- [ ] **Step 3: Wire into `CoordinationScheduler` as optional upgrade path over mechanical replan**
- [ ] **Step 4: Build and run all tests**
- [ ] **Step 5: Run full suite (`npm run test:node:ci`)**
- [ ] **Step 6: Commit**

---

### Task 1i: CLI, TUI, Inspector, Observability, and Adversarial Tests

**Files:**
- Test: `tests/kernel/replan-adversarial.test.ts`
- Modify: CLI inspect command(s) to surface model-assisted replan data

Observability additions:
- Model-assisted revisions surfaced in `alix coordination inspect`
- Proposal status visible (proposed, awaiting_approval, applied, failed, etc.)
- Diff between previous and new worker sets

Adversarial tests:
- structured-output vs JSON fallback variants
- prompt-injection content treated as data (not executed)
- timeout, abort, and retry behavior
- duplicate draft worker IDs
- task-label collisions
- cycles crossing existing and draft workers
- automatic replacement dependency rewiring
- model risk hint cannot lower system risk
- model approval hint cannot bypass policy
- no eligible agent
- fresh active ownership conflict
- atomic requestOrReusePending
- approval consumed exactly once
- stale proposal after plan revision advances
- running/completed worker removal rejected
- failed worker history and lineage preserved
- approval, leases, and authorization not inherited
- CAS conflict performs no mutation
- no model configured → mechanical fallback remains
- failed proposal never strands run in replanning

- [ ] **Step 1: Write adversarial tests**
- [ ] **Step 2: Verify CLI inspect output includes replan data**
- [ ] **Step 3: Run full suite**

```bash
npm run build
npm run test:node:ci
npm run test:vitest
```

- [ ] **Step 4: Commit**

---

## Verification

1. **`npm run build`** — clean TypeScript build
2. **`npm run test:node:ci`** — 2900+ tests, 0 failures
3. **`npm run test:vitest`** — both vitest files pass
4. **Integration test** — full trigger → context → proposal → validate → simulate → impact → approve → apply flow passes
5. **Adversarial tests** — all edge case and security tests pass
6. **Mechanical fallback** — existing replan works without model adapter configured
7. **Worker history** — no workers spliced, lineage preserved
8. **No run stranding** — failed proposals leave run in a safe status
