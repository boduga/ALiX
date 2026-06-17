# M0.78g.1 — Model-Assisted Replanning

**Status:** Draft

**Boundary:** The model proposes a typed `PlanRevisionDraft`. ALiX validates, analyzes risk/ownership, gates approval, and applies atomically. The model never mutates a coordination run directly.

---

## Core Flow

```
Deterministic trigger detects condition
→ ReplanContextBuilder assembles context + evidence
→ ModelAdapter constructs prompt, calls model, returns PlanRevisionDraft
→ Validator checks structural integrity + DAG correctness
→ ImpactAnalyzer evaluates risk, policy compliance, ownership changes
→ ApprovalGate routes high-risk revisions to human approval
→ CAS apply: updateRunWithRevisionCheck
→ Fresh authorization for added/modified workers
→ Observability: revision visible in inspect output
```

## PlanRevisionDraft (Model Output)

```typescript
interface PlanRevisionDraft {
  triggerKind: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  workersToAdd: WorkerSpec[];
  workersToReplace: WorkerReplaceSpec[];
  workersToRemove: string[];
  workersToModify: WorkerModifySpec[];
  dependencyRewiring: DependencyRewire[];
  capabilityChanges: CapabilityChange[];
  ownershipChanges: OwnershipChange[];
  expectedBenefit: string;
  confidence: number;           // 0–1
  unresolvedConflicts: string[];
  verificationRequirements: string[];
}

interface TriggerEvidence {
  workerId: string;
  findingIds: string[];
  conflictIds: string[];
  reason: string;
}

interface WorkerSpec {
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  dependencies: string[];
  ownershipScopes: string[];
  riskLevel: RiskLevel;
  approvalMode?: string;
}

interface WorkerReplaceSpec {
  targetWorkerId: string;
  replacement: WorkerSpec;
  reason: string;
}

interface WorkerModifySpec {
  workerId: string;
  goalPrompt?: string;
  dependencies?: string[];
  ownershipScopes?: string[];
}

interface DependencyRewire {
  fromWorkerId: string;
  toWorkerId: string;
}

interface CapabilityChange {
  agentId: string;
  addedCapabilities?: string[];
  removedCapabilities?: string[];
}

interface OwnershipChange {
  scope: string;
  previousOwner: string;
  newOwner: string;
}
```

## Triggers (initial)

| Trigger | Condition | Context Included |
|---------|-----------|-----------------|
| high-criticality conflict unresolved | Conflict detected, status != resolved | Conflict details, both worker reports, evidence |
| new finding invalidates plan assumption | Finding with `invalidatesAssumption: true` | Finding, affected workers, original plan assumptions |
| worker exhausts retries | Worker.attempt >= Worker.maxAttempts | Failed worker, retry history, partial output |
| aggregate outcome incomplete/partial | Run result is `partial` or has failed workers | Per-worker outcomes, aggregated results |
| verification discovers missing work | Verification check returns `missing: true` | Verification report, discovered gaps |

## Sub-Milestones

### M0.78g.1a — Revision Proposal Schema
- Define `PlanRevisionDraft` and all supporting types
- Add to `coordination-types.ts`
- Tests: valid draft constructs, field validation, defaults

### M0.78g.1b — Replanning Context Builder
- `buildModelReplanContext(runId, trigger)` — assembles run state, completed workers, active conflicts, recent findings
- Token budgets: cap context to avoid over-consumption
- Tests: returns correct structure per trigger type, respects budget

### M0.78g.1c — Model Proposal Adapter
- `ModelReplanAdapter` — constructs prompt from context, calls model, parses `PlanRevisionDraft`
- Uses existing provider abstraction (no new model infra)
- Schema-based output parsing (JSON schema for structured output)
- Tests: adapter produces valid draft from context mock, handles model error gracefully

### M0.78g.1d — Structural and DAG Validation
- `ReplanValidator` — validates draft structure, DAG integrity
- Checks: no cycles in rewired deps, all referenced workers exist, no duplicate IDs, capability requirements resolvable
- Returns `ValidationResult { valid, errors[], warnings[] }`
- Tests: empty draft, cycle detection, missing worker reference, capability resolution

### M0.78g.1e — Risk, Policy, and Ownership Impact Analysis
- `ReplanImpactAnalyzer` — evaluates blast radius of proposed revision
- Risk level calculation (combined from added/changed workers)
- Policy compliance check (approval modes, scope boundaries)
- Ownership impact (which scopes change owners, any conflicts)
- Returns `ImpactAnalysis { riskLevel, policyCompliant, ownershipConflicts[], requiresApproval }`
- Tests: high-risk revision detected, policy violation flagged, ownership conflict detected

### M0.78g.1f — Approval Gating
- `ReplanApprovalGate` — routes high-risk revisions to human approval
- Auto-approves low-risk revisions (`riskLevel: low`)
- Routes medium/high to approval flow via existing `requestBound`
- Tests: low-risk auto-approved, high-risk requires approval, approval timeout handling

### M0.78g.1g — Atomic Application and Rollback
- `ReplanApplier` — applies validated, approved draft to run
- Creates replacement workers, rewires deps, builds `PlanRevision`
- Uses `updateRunWithRevisionCheck` CAS guard
- Rollback: creates pre-apply snapshot, restores on failure
- Tests: successful apply, CAS conflict, rollback restores original state, multiple adds and removes

### M0.78g.1h — Observability and Operator Visibility
- Revisions surfaced in `alix coordination inspect`
- PlanRevisionDraft details visible before/after apply
- Tests: inspect output includes revision history from model-assisted replan

### M0.78g.1i — Adversarial and Integration Tests
- Integration test: full flow trigger → context → proposal → validate → impact → apply
- Adversarial tests: invalid drafts (cycle, missing worker, duplicate ID), model timeout, approval reject, CAS conflict in flight
- All 2902+ existing tests still pass

---

## Files Modified/Created

| File | Action | Responsible Milestone |
|------|--------|----------------------|
| `src/kernel/coordination-types.ts` | MODIFY | 1a — add PlanRevisionDraft and supporting types |
| `src/kernel/collaborative-planner.ts` | MODIFY | 1c, 1d, 1e, 1f, 1g — add model replan path |
| `src/kernel/collaboration-context-builder.ts` | MODIFY | 1b — add buildModelReplanContext |
| `src/kernel/replan-validator.ts` | CREATE | 1d |
| `src/kernel/replan-impact-analyzer.ts` | CREATE | 1e |
| `src/kernel/replan-approval-gate.ts` | CREATE | 1f |
| `src/kernel/replan-applier.ts` | CREATE | 1g |
| `src/kernel/model-replan-adapter.ts` | CREATE | 1c |
| `tests/kernel/replan-validator.test.ts` | CREATE | 1d |
| `tests/kernel/replan-impact-analyzer.test.ts` | CREATE | 1e |
| `tests/kernel/replan-approval-gate.test.ts` | CREATE | 1f |
| `tests/kernel/replan-applier.test.ts` | CREATE | 1g |
| `tests/kernel/model-replan-adapter.test.ts` | CREATE | 1c |
| `tests/kernel/replan-integration.test.ts` | CREATE | 1i |
