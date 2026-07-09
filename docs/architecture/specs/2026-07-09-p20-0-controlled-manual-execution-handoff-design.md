# P20.0 — Controlled Manual Execution Handoff Design Spec

**Status:** Design — approved for implementation planning
**Phase:** P20 — Controlled Manual Execution Handoff
**Builds on:** P17 (Approved Execution Lifecycle), P18 (Governance Workbench), P19 (Automation Readiness Projection)
**Approach:** Operator handoff packages; evidence validation; post-action recording; no autonomous execution

## 1. Purpose

P20 turns readiness-approved plans into **explicit, human-readable operator handoff packages** for manual execution, with evidence capture and post-action recording.

P19 can tell an operator whether a plan is ready to act on. P20 makes it **actionable by that operator** — without ALiX executing anything itself.

The handoff package is the bridge between "we know this plan is safe to execute" and "a human executes it and records what happened."

```text
readiness-approved plan → handoff package → operator executes manually → evidence captured → execution recorded
```

## 2. Architectural Decision

P20 uses **explicit handoff packages** rather than automatic execution, inline execution adapters, or deferred execution queues.

### 2.1 Why handoff packages

- Handoff packages are immutable, human-readable documents — not execution triggers.
- The operator chooses whether and when to execute. ALiX never executes.
- Evidence capture is built into the package contract — no separate evidence flow.
- Post-action recording reuses the P17 execution recorder without modifying its approval gate.
- The handoff package is the artifact boundary: ALiX produces it; the operator consumes it.

### 2.2 Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| Add an execution queue | Queues imply automatic or scheduled execution, which P20 must not do |
| Embed execution in P19 gate | Crosses the no-execution boundary; conflates readiness with action |
| Add shell/network execution adapters | Violates the core invariant: ALiX must not execute actions |
| Use P17 execution recorder directly | Recorder requires an execution attempt — handoff precedes execution |
| Store handoff packages persistently | Creates a new store with migration and audit obligations |

## 3. Hard Boundary

P20 must not:

- execute actions autonomously or on a timer;
- invoke shell, network, MCP, browser, or tool executors;
- mutate plans, approvals, remediations, policies, stores, files, or external systems;
- perform external side effects;
- import direct audit emitters;
- create an approval path or bypass P17 approval;
- create an alternate visibility path that bypasses P18 workbench correlation;
- rank, score, compare, or infer operator performance;
- persist handoff packages beyond what the operator explicitly requests.

P20 may:

- produce immutable handoff package documents (text/JSON);
- validate evidence refs against known schemas;
- record completed manual actions through the P17 execution recorder;
- describe expected effects and operator instructions in the handoff package;
- surface pending, completed, failed, and evidence-missing handoffs in reports.

## 4. Scope

| Slice | Deliverable |
|---|---|
| P20.0 | Design spec and implementation plan |
| P20.1 | Handoff Package Builder |
| P20.2 | Evidence Capture Contract |
| P20.3 | Post-Handoff Recording Flow |
| P20.4 | Handoff Report / CLI |
| P20.5 | Checkpoint |

Out of scope: autonomous execution, shell/network/tool execution, policy mutation, execution adapters, execution queues, background jobs, deferred execution, scheduled execution, operator ranking, side-effect execution.

## 5. Handoff Package Contract

### 5.1 Handoff input

```typescript
interface HandoffInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
  assessment: ExecutionReadinessAssessment;
  simulation: DryRunSimulation;
  decision: ReadinessGateDecision;
  lifecycleTrace: WorkbenchLifecycleTrace;
  operatorInstructions?: string[];
}
```

### 5.2 Handoff package structure

```typescript
// HandoffPackage.status is always "pending" at creation.
// Derived report state (completed, failed, evidence_missing) is computed
// in P20.4 from the handoff, evidence validations, and execution attempts.
type HandoffStatus = "pending";

interface HandoffPackageAction {
  actionId: string;
  kind: ExecutionActionKind;
  description: string;
  target: { type: string; id: string | null };
  expectedEffect: string;
  operatorInstructions: string[];
  rollbackProcedure: string | null;
  evidenceRequired: boolean;
}

interface HandoffPackageEvidence {
  ref: string;
  label: string;
  required: boolean;
  capturedAt: string | null;
  capturedBy: string | null;
}

interface HandoffPackage {
  handoffId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string;
  decisionId: string;
  disposition: ReadinessDisposition;
  title: string;
  summary: string;
  actions: HandoffPackageAction[];
  evidence: HandoffPackageEvidence[];
  operatorInstructions: string[];
  riskNotes: string[];
  rollbackPlan: string[];
  status: HandoffStatus;
  generatedAt: string;
  generatedBy: string;
  executedAt: string | null;
  executedBy: string | null;
  evidenceCaptured: boolean;
  explicitlyManualOnly: true;
}
```

### 5.3 Determinism

```typescript
const handoffId = createHash("sha256")
  .update(["p20.1", planId, approvalId, assessmentId, generatedAt].join("|"))
  .digest("hex")
  .slice(0, 16);
```

## 6. P20.1 — Handoff Package Builder

### 6.1 Eligibility

`buildHandoffPackage` may only accept P19 gate decisions that meet ALL of:

- `decision.disposition === "manual_only"` or `"dry_run_allowed"`;
- `decision.controlledExecutionAuthorization === "not_available_in_p19"`;
- valid P17 approval correlation (`approval.decision === "approved"`, planId/remediationId match);
- valid P18 lifecycle trace correlation (non-gap proposal/plan/approval hops).

Blocked readiness decisions (`disposition === "blocked"`) cannot produce handoff packages. Calling `buildHandoffPackage` on a blocked decision throws a typed error.

### 6.2 Purpose

Convert an eligible readiness-approved plan into an explicit human-readable handoff package. No execution, no persistence, no side effects.

```typescript
export function buildHandoffPackage(
  input: HandoffInput,
  options?: { now?: string },
): HandoffPackage;
```

### 6.3 Builder rules

1. Validate eligibility (see §6.1). If disposition is `"blocked"`, throw a typed `HandoffBuilderError`.
2. Extract approved actions from the plan and approval.
3. Map each action to a `HandoffPackageAction` with operator instructions derived from:
   - The action's `description` and `expectedEffect`.
   - The simulator's projection preconditions and risks.
   - The action's `rollbackHint` and the plan's rollback plan.
4. Generate evidence requirements:
   - Each action that requires evidence (config mutation, external effect) gets an evidence ref.
   - Evidence refs use the format: `${handoffId}/${actionId}/evidence`.
5. Copy operator instructions from the plan's rollback plan and simulation notes.
6. Set `status: "pending"` — the package is immutable. Status is never mutated on the package object. Report state (completed, failed, evidence_missing) is derived by P20.4 from the handoff package, evidence validations, and execution attempts.
7. Set `executedAt: null`, `executedBy: null`, `evidenceCaptured: false`.
8. Set `explicitlyManualOnly: true` — ALiX never executes.
9. Sort actions by `actionId`. Deduplicate and sort notes and instructions.

## 7. P20.2 — Evidence Capture Contract

### 7.1 Purpose

Define required evidence refs and validation for completed manual actions.

```typescript
export function validateHandoffEvidence(
  handoff: HandoffPackage,
  evidence: Record<string, HandoffCaptureEvidence>,
): HandoffEvidenceValidation;
```

### 7.2 Evidence types

```typescript
interface HandoffCaptureEvidence {
  ref: string;
  capturedAt: string;
  capturedBy: string;
  description: string;
  payload: Record<string, unknown>;
}

interface HandoffEvidenceValidation {
  handoffId: string;
  totalRequired: number;
  totalCaptured: number;
  missingRefs: string[];
  valid: boolean;
}
```

### 7.3 Validation rules

1. Every required evidence ref in the handoff package must have a matching capture.
2. Matching is by `ref` string equality.
3. `capturedAt` must be a valid ISO 8601 timestamp. Invalid timestamps cause validation failure.
4. `capturedBy` must be a non-empty string. Empty or missing values cause validation failure.
5. Missing refs → `valid: false`, refs listed in `missingRefs`.
6. No validation of payload contents — operator attests to correctness.

## 8. P20.3 — Post-Handoff Recording Flow

### 8.1 Purpose

Record completed manual execution evidence back through the P17 execution recorder.

```typescript
export function recordHandoffExecution(
  handoff: HandoffPackage,
  evidence: Record<string, HandoffCaptureEvidence>,
  options?: { now?: string; recordedBy?: string },
): GovernanceExecutionAttempt;
```

### 8.2 Recording rules

1. Evidence must pass validation first — call `validateHandoffEvidence`.
2. If validation fails, throw a typed error.
3. Otherwise, construct a `GovernanceExecutionAttempt` with:
   - `status: "succeeded"` (operator confirmed completion).
   - `actionResults` containing the captured evidence refs.
   - `executedBy: recordedBy ?? "operator"`.
4. The function returns the execution attempt — it does not persist it. Persistence is the caller's responsibility.
5. `controlledExecutionAuthorization` remains `"not_available_in_p20"`.

## 9. P20.4 — Handoff Report / CLI

### 9.1 Purpose

Read-only operator view of pending, completed, failed, and evidence-missing handoffs.

```typescript
export function buildHandoffReport(
  handoffs: HandoffPackage[],
  options?: { since?: string; until?: string; now?: string },
): HandoffReport;
```

### 9.2 CLI commands

```text
alix governance handoff build <plan-id> --input <path> [--json]
alix governance handoff validate <handoff-id> --evidence <path> [--json]
alix governance handoff prepare-record <handoff-id> --input <path> --evidence <path> [--json]
alix governance handoff report --input <path> [--json] [--since <iso>] [--until <iso>]
```

All commands require `--input` and are read-only. Key behavior notes:

- **`prepare-record`** emits a `GovernanceExecutionAttempt` object to stdout (text or JSON). It does **not** call `ExecutionStore.append()` or any persistence method. The caller (operator or CI) decides whether to persist the object. This protects the invariant that P20's recording function is advisory and produces immutable artifacts, not side effects.
- **`validate`** performs in-memory validation only — no store writes.

## 10. P20.5 — Checkpoint

- Phase report: `docs/architecture/reports/p20-controlled-manual-execution-handoff-report.md`
- Checkpoint doc
- Tag: `alix-p20-controlled-manual-execution-handoff-complete`
- Verify: no autonomous execution, no shell/network/tool execution, no execution adapter

## 11. Required Tests (P20.1–P20.4)

### P20.1
1. Build handoff package with all action kinds.
2. Include operator instructions from simulation.
3. Include rollback procedures from plan.
4. Generate evidence refs for mutating actions.
5. Set `explicitlyManualOnly: true`.
6. Produce deterministic handoff ID.
7. Do not mutate inputs.

### P20.2
1. Valid evidence passes validation.
2. Missing evidence ref → `valid: false`.
3. Extra evidence refs are ignored.
4. Empty evidence → `valid: false`.

### P20.3
1. Record with valid evidence succeeds.
2. Record with missing evidence throws.
3. Produces execution attempt with `status: "succeeded"`.
4. Does not call `.append()` — caller persists.
5. `controlledExecutionAuthorization` is always `"not_available_in_p20"`.

### P20.4
1. Empty input produces zero totals.
2. Pending/completed/failed/evidence-missing counts correct.
3. Time-window filtering.
4. Deterministic sorting.
5. CLI requires `--input`.
6. CLI performs no mutation, writes, audit emission, or execution.

## 12. Acceptance Criteria

P20 complete when:
1. Readiness-approved plans can be converted to handoff packages.
2. Handoff packages contain explicit operator instructions and evidence requirements.
3. Evidence can be validated against the package contract.
4. Validated handoffs can be recorded through P17 execution recorder.
5. Reports surface pending/completed/failed/evidence-missing handoffs.
6. No autonomous execution capability exists.
7. No shell/network/tool execution exists.
8. No execution adapter exists.
9. All sentinel and behavioral tests pass.
10. CLI is read-only and requires `--input`.

## 13. Invariants

1. ALiX produces handoff packages; it never executes them.
2. `explicitlyManualOnly: true` on every handoff package.
3. `controlledExecutionAuthorization` always `"not_available_in_p20"`.
4. P17 approval is required for every handoff.
5. P18 visibility is required for every handoff.
6. No execution adapter, executor import, or tool invocation exists.
7. No store or persistence exists for handoff packages.
8. Operator ranking is never stored or surfaced.
