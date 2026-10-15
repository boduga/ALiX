# M0.78g.1 — Model-Assisted Replanning

**Status:** Draft
**Updated:** 2026-06-17 (post-review — corrected model boundary, approval integration, worker references, and application semantics)

**Boundary:** Deterministic system detects a trigger. Model proposes a typed `PlanRevisionDraft`. ALiX validates, simulates, analyzes impact/policy/ownership, gates approval, and applies atomically. The model never mutates a coordination run directly.

---

## Core Architectural Principles

1. **Model is advisory, not authoritative.** The model proposes; ALiX decides. Risk, approval requirements, capability assignment, and ownership changes are derived by ALiX, never accepted from the model as declarations.
2. **No direct run mutation.** The model returns a typed `PlanRevisionDraft`. ALiX validates, simulates, analyzes, gates, and applies via `updateRunWithRevisionCheck` CAS.
3. **Worker history is preserved.** Workers are never spliced from the array. Completed/failed workers retain their execution history, findings, and lineage. Only `pending`/`ready`/`blocked` workers may be cancelled.
4. **Proposal lifecycle is durable.** From `proposed` through `applied` or `failed`, the proposal is persisted to disk with full fingerprinting for audit.
5. **Security reset for replacement workers.** No inherited approvals, leases, authorization, or execution state.

## Core Flow

```
Deterministic trigger detects condition
→ Service loads run + captures planRevision
→ BuildBoundedReplanContext (token-budgeted, run-filtered)
→ ModelReplanAdapter calls ModelAdapter.complete() with structured output schema
→ Parse response text into PlanRevisionDraft (runtime validation always)
→ ReplanValidator checks structural integrity
→ ReplanSimulator builds complete proposed DAG
→ ReplanImpactAnalyzer evaluates risk, policy, ownership (from real state)
→ ReplanProposalStore persists proposal
→ ReplanApprovalGate routes high-risk revisions to human approval
→ Reload run + proposal, revalidate fingerprints
→ ConsumeApproved atomically
→ ReplanApplier applies via CAS (updateRunWithRevisionCheck)
→ Fresh authorization for added/modified workers
→ Persist outcome
```

No model call occurs while a run lock is held.

---

## PlanRevisionDraft (Model Output)

```typescript
interface PlanRevisionDraft {
  triggerKind: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  workersToAdd: DraftWorkerSpec[];
  workersToReplace: DraftWorkerReplaceSpec[];
  workersToCancel: string[];         // only pending/ready/blocked workers
  workersToModify: DraftWorkerModifySpec[];
  dependencyRewiring: DependencyRewire[];
  expectedBenefit: string;
  confidence: number;                 // 0–1, advisory only
  unresolvedConcerns: string[];
}

interface TriggerEvidence {
  workerId: string;
  findingIds: string[];
  conflictIds: string[];
  reason: string;
}

interface DraftWorkerSpec {
  draftWorkerId: string;              // stable ref used in dependencies
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  dependencies: string[];             // can reference draftWorkerId or existing durable IDs
  verificationRequirements: string[];
}

interface DraftWorkerReplaceSpec {
  targetWorkerId: string;
  replacement: DraftWorkerSpec;
  reason: string;
}

interface DraftWorkerModifySpec {
  workerId: string;
  goalPrompt?: string;
  dependencies?: string[];
}

interface DependencyRewire {
  dependentWorkerRef: string;         // existing or draft worker whose deps are rewired
  removeDependencyRef: string;        // dep to remove
  addDependencyRef: string;           // dep to add
  reason: string;
}
```

Note: The model does NOT declare `riskLevel`, `approvalMode`, `capabilityChanges`, `ownershipChanges`, `agentId`, or `ownershipScopes`. These are all derived by ALiX deterministically.

---

## Proposal Lifecycle (ReplanProposalStore)

Statuses: `proposed` → `invalid` | `awaiting_approval` | `approved` → `applying` → `applied` | `failed` | `superseded`

Persisted at: `.alix/coordination/replans/<runId>/<proposalId>.json`

Contents per proposal:
- Expected plan revision (for CAS)
- Trigger and evidence
- Draft full content (PlanRevisionDraft)
- Draft fingerprint (deterministic hash)
- Validation result
- Simulated graph
- Impact analysis
- Impact fingerprint
- Approval ID (if approval required)
- Provider, model, usage metadata
- Timestamps (created, updated, applied)
- Error (if failed)

---

## Types

### DraftWorkerSpec (Revised)
```typescript
type DraftWorkerSpec = {
  draftWorkerId: string;              // stable local ref for model's dependency references
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  dependencies: string[];             // existing durable ID or draftWorkerId
  verificationRequirements: string[];
};
```

### DependencyRewire (Revised)
```typescript
type DependencyRewire = {
  dependentWorkerRef: string;         // worker whose dependencies list is rewired
  removeDependencyRef: string;        // reference to remove from dependencies
  addDependencyRef: string;           // reference to add
  reason: string;
};
```

Automatic rewiring: when a worker is replaced, all downstream workers' dependencies pointing to the old worker are rewritten to the new replacement ID, unless an explicit validated override exists in `dependencyRewiring`.

### ProposalRecord
```typescript
interface ProposalRecord {
  id: string;
  runId: string;
  status: ProposalStatus;
  expectedPlanRevision: number;
  trigger: PlanTriggerKind;
  evidence: TriggerEvidence;
  draft: PlanRevisionDraft;
  draftFingerprint: string;
  validationResult?: ValidationResult;
  simulatedGraph?: SimulatedGraph;
  impactAnalysis?: ImpactAnalysis;
  impactFingerprint?: string;
  approvalId?: string;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  error?: string;
}

type ProposalStatus =
  | "proposed" | "invalid" | "awaiting_approval"
  | "approved" | "denied"
  | "applying" | "applied" | "failed" | "superseded";
```

### SimulatedGraph
```typescript
interface SimulatedGraph {
  workers: SimulatedWorker[];
  edges: Array<{ from: string; to: string }>;
  idMap: Map<string, string>;          // draftWorkerId → provisional durable ID
}

interface SimulatedWorker {
  id: string;                          // provisional durable ID
  draftWorkerId?: string;              // original draft ref (if from model)
  taskLabel: string;
  dependencies: string[];
  status: "draft" | "existing" | "replacement" | "removed" | "modified";
}
```

### ImpactAnalysis (Revised — ALiX-derived)
```typescript
interface ImpactAnalysis {
  riskLevel: "low" | "medium" | "high" | "critical";
  agentsAssigned: Array<{ draftWorkerId: string; agentId: string }>;
  capabilitiesAdded: string[];
  capabilitiesRemoved: string[];
  ownershipChanges: OwnershipImpact[];
  activeLeaseConflicts: OwnershipConflict[];
  protectedScopeViolations: string[];
  policyDecisions: PolicyDecision[];
  requiresApproval: boolean;
  summary: string;
}

interface OwnershipImpact {
  scope: string;
  currentOwner: string | null;
  proposedOwner: string;
  severity: "info" | "warning" | "blocking";
}

interface PolicyDecision {
  workerRef: string;
  decision: "allow" | "ask" | "deny";
  reason: string;
}
```

---

## Triggers (initial)

| Trigger | Condition | Context Included |
|---------|-----------|-----------------|
| high-criticality conflict unresolved | Conflict detected, status != resolved | Conflict details, both worker reports, evidence |
| new finding invalidates plan assumption | Finding with `invalidatesAssumption: true` | Finding, affected workers, original plan assumptions |
| worker exhausts retries | Worker.attempt >= Worker.maxAttempts | Failed worker, retry history, partial output |
| aggregate outcome incomplete/partial | Run result is `partial` or has failed workers | Per-worker outcomes, aggregated results |
| verification discovers missing work | Verification check returns `missing: true` | Verification report, discovered gaps |

---

## Sub-Milestones (Revised)

### M0.78g.1a — Proposal Schema, Types, and Proposal Store
- Define `PlanRevisionDraft`, `DraftWorkerSpec`, `DependencyRewire`, `ProposalRecord`, `SimulatedGraph`, `ImpactAnalysis`
- Create `ReplanProposalStore` with durable persistence, atomic writes
- Add to `coordination-types.ts` or new `replan-types.ts`
- Tests: valid draft constructs, proposal CRUD, fingerprinting, atomic write safety

### M0.78g.1b — Bounded Untrusted Replan Context
- Extend `CollaborationContextBuilder.buildReplanContext()` → add run-specific filtering, current-attempt findings, aggregate results, dependency graph, hard context budget, sensitive-data redaction, context fingerprint, untrusted-content boundaries
- Missing run returns explicit error (not empty context)
- Tests: budget enforcement, redaction, missing run, fingerprint stability

### M0.78g.1c — ModelAdapter-Based Proposal Generation
- `ModelReplanAdapter` accepts `ModelAdapter` (ALiX's real abstraction)
- Calls `ModelAdapter.complete()` with `NormalizedRequest.structuredOutputSchema`
- Tools disabled (empty tool list)
- Runtime JSON parsing + validation (even when provider claims structured output)
- `AbortSignal`/timeout support, bounded input/output, injected sleep for retry tests
- Provider/model/usage evidence collected
- No retry for deterministic schema errors (syntax error, wrong shape — fail fast)
- Retry with backoff for transient errors (timeout, network)
- Tests: structured output success, JSON fallback, timeout, abort, retry behavior, schema error (no retry), prompt injection treated as data

### M0.78g.1d — Runtime Validator and Graph Simulator
- `ReplanValidator` — structural checks: required fields, no duplicate draft IDs, dependency refs resolve within draft+existing, known trigger kind
- `ReplanSimulator` — build complete proposed graph:
  - Map draftWorkerId → provisional durable ID
  - Detect: unknown refs, duplicate draft IDs, self-dependencies, duplicate deps, cycles crossing old+new, dangling deps after cancellation, invalid replacement rewiring, incompatible ops on one worker, excessive graph expansion
  - Output: `SimulatedGraph` with exact ID map passed unchanged to CAS applier
- Tests: all graph error conditions, valid graphs, mixed draft+existing deps, automatic dep rewiring on replacement

### M0.78g.1e — Deterministic Assignment and Impact Analysis
- Reuse `CollaborativePlanner.matchCapabilities()` with controlled alias registry
- Select eligible agent per new/replacement worker
- Compile real ownership claims via `OwnershipRegistry.listActive()` / `findConflictsByPattern()`
- Query active leases
- Evaluate policy for each new/replacement worker
- Calculate risk from effective per-worker risk (model hints cannot lower system risk)
- Determine approval requirements (model hints cannot bypass policy)
- Build complete `ImpactAnalysis`
- Tests: capability matching works, no eligible agent handled, fresh ownership conflict detected, model risk hint ignored when too low, model approval hint cannot bypass policy

### M0.78g.1f — Atomic Approval Reuse and Exact Approval Gate
- Implement `requestFresh()` and `requestOrReusePending()` on ApprovalStore
- `requestOrReusePending()`: lookup + insert under same lock (atomic, no check-then-create race)
- `ReplanApprovalGate` binds to: run ID, expected plan revision, draft fingerprint, impact fingerprint, policy revision, capability = `coordination.plan.revise`
- Before apply: call `consumeApproved()` atomically
- Statuses: uses real `denied` (not `rejected`)
- Tests: fresh approval, reuse pending, consumed exactly once, stale proposal rejected after plan revision advance, denial blocks apply

### M0.78g.1g — History-Preserving CAS Applier
- Never splice workers — use `supersededByWorkerId` / `replacementForWorkerId` lineage
- Only cancel `pending`/`ready`/`blocked` workers (throw on running/completed/failed)
- Every replacement gets fresh execution state: `status: "pending"`, `attempt: 0`, no approvalId, no authorizationEvidence, no leases, no executionOwnerId, no resultRef, no error, no timestamps
- Automatic downstream dep rewiring for replacements (unless explicit validated override)
- Apply rewiring from `DependencyRewire[]`
- Throw in CAS callback on missing workers (never silently skip — no partial commit)
- CAS conflict returns `applied: false` with error
- Tests: replacement preserves failed worker, running/completed removal rejected, history+lineage preserved, auto rewiring, CAS conflict no mutation, empty draft applied

### M0.78g.1h — Model-Assisted Orchestration Service
- `ModelAssistedReplanService` owns the full workflow
- Flow: load run + capture revision → build bounded context → request proposal → validate → simulate → analyze impact → persist proposal → request approval if required → reload run/proposal → revalidate fingerprints → consumeApproved → apply CAS → persist outcome
- No model call while run lock held
- Run never stranded in `replanning` after: model timeout, invalid output, approval denial, CAS conflict. Proposal lifecycle separate until successful application.
- Mechanical fallback (M0.78g `CollaborativePlanner.replan()`) remains when no model configured
- Tests: full happy-path flow, model timeout recovers, invalid output recovers, approval denial recovers, CAS conflict recovers, no-model fallback

### M0.78g.1i — CLI, TUI, Inspector, Observability, and Adversarial Tests
- Model-assisted revisions surfaced in `alix coordination inspect`
- Proposal status visible (proposed, awaiting_approval, applied, failed, etc.)
- Adversarial tests:
  - structured-output vs JSON fallback
  - prompt-injection content treated as data (not executed)
  - timeout, abort, retry behavior
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

---

## Files Modified/Created

| File | Action | Task |
|------|--------|------|
| `src/coordination/kernel/replan-types.ts` | CREATE | 1a |
| `src/coordination/kernel/replan-proposal-store.ts` | CREATE | 1a |
| `src/coordination/kernel/collaboration-context-builder.ts` | MODIFY | 1b |
| `src/coordination/kernel/model-replan-adapter.ts` | CREATE | 1c |
| `src/coordination/kernel/replan-validator.ts` | CREATE | 1d |
| `src/coordination/kernel/replan-simulator.ts` | CREATE | 1d |
| `src/coordination/kernel/replan-impact-analyzer.ts` | CREATE | 1e |
| `src/coordination/kernel/replan-approval-gate.ts` | CREATE | 1f |
| `src/coordination/kernel/replan-applier.ts` | CREATE | 1g |
| `src/coordination/kernel/model-assisted-replan-service.ts` | CREATE | 1h |
| `src/coordination/kernel/approval-store.ts` | MODIFY | 1f (requestFresh/requestOrReusePending) |
| `src/coordination/kernel/coordination-types.ts` | MODIFY (minor) | 1a |
| `tests/kernel/replan-proposal-store.test.ts` | CREATE | 1a |
| `tests/kernel/model-replan-adapter.test.ts` | CREATE | 1c |
| `tests/kernel/replan-validator.test.ts` | CREATE | 1d |
| `tests/kernel/replan-simulator.test.ts` | CREATE | 1d |
| `tests/kernel/replan-impact-analyzer.test.ts` | CREATE | 1e |
| `tests/kernel/replan-approval-gate.test.ts` | CREATE | 1f |
| `tests/kernel/replan-applier.test.ts` | CREATE | 1g |
| `tests/kernel/model-assisted-replan-service.test.ts` | CREATE | 1h |
| `tests/kernel/replan-adversarial.test.ts` | CREATE | 1i |
