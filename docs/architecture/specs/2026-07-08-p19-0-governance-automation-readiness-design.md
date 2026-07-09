# P19.0 — Governance Automation Readiness & Policy-Controlled Execution Design Spec

**Status:** Design — approved for implementation planning  
**Phase:** P19 — Governance Automation Readiness & Policy-Controlled Execution  
**Builds on:** P17 (Approved Execution Lifecycle), P18 (Governance Workbench & Lifecycle Operations)  
**Approach:** Derived readiness pipeline; pure functions; no persistence; no execution

## 1. Purpose

P19 determines what an already-approved P17 execution plan is ready for without executing it.

P17 established plan creation, explicit approval, and execution-outcome recording. P18 made that lifecycle visible to operators. P19 adds a deterministic readiness projection:

```text
approved P17 plan → classify → simulate → gate → report
```

Core goal: tell an operator whether an approved plan is blocked, manual-only, or safe to inspect through a semantic dry run while preserving every P17 and P18 boundary.

P19 does not grant execution authority. It does not make ALiX autonomous. “Policy-controlled execution” in P19 means policy-controlled readiness analysis only.

## 2. Architectural Decision

P19 uses a derived readiness pipeline rather than a readiness store or new lifecycle state.

### 2.1 Why projection

- Readiness is derived from current plan, approval, rollback, policy, and visibility facts.
- Recalculation cannot drift from persisted readiness state because no such state exists.
- P17 remains the sole approval lifecycle.
- P18 remains the operator visibility layer.
- Each stage stays deterministic, independently testable, and read-only.

### 2.2 Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| Persist readiness records | Introduces stale state, migrations, audit obligations, and a second lifecycle |
| Add readiness fields to P17 plans | Conflates approval records with derived execution constraints |
| Add an execution adapter | Crosses the P19 hard boundary into action |

## 3. Hard Boundary

P19 must not:

- execute actions;
- add autonomous or default execution;
- invoke shell, network, MCP, browser, or tool executors;
- mutate plans, approvals, remediations, policies, stores, files, or external systems;
- persist readiness assessments, simulations, gate decisions, or reports;
- perform external side effects;
- import direct audit emitters;
- create an approval path or bypass P17 approval;
- create an alternate visibility path or bypass P18 workbench correlation;
- authorize future controlled execution;
- rank, score, compare, or infer operator performance.

P19 may describe expected effects and future controlled-execution candidacy. Such descriptions are non-authoritative and cannot trigger action.

## 4. Scope

| Slice | Deliverable |
|---|---|
| P19.1 | Execution Readiness Classifier |
| P19.2 | Dry-Run Execution Simulator |
| P19.3 | Policy Gate Evaluator |
| P19.4 | Readiness Report and read-only CLI |
| P19.5 | Boundary verification, phase report, and checkpoint seal |

Out of scope: execution adapters, sandbox execution, automatic rollback, policy editing, plan transitions, approval transitions, workbench mutation, readiness persistence, UI controls, background jobs, and autonomous scheduling.

## 5. Shared Pipeline Contracts

P19 stages consume existing P17 objects and produce immutable values.

```typescript
interface ExecutionReadinessInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
}
```

Every stage validates:

1. `approval.decision === "approved"`;
2. `approval.planId === plan.planId`;
3. `approval.remediationId === plan.remediationId`;
4. `approvedActionIds` is non-empty;
5. every approved action ID exists in `plan.proposedActions`;
6. only approved actions participate in classification or simulation.

Rejected approvals, mismatched IDs, missing actions, and malformed timestamps produce typed validation errors. No stage repairs or mutates input.

## 6. P19.1 — Execution Readiness Classifier

### 6.1 Purpose

Derive an immutable readiness assessment from approved P17 plan facts.

```typescript
export function classifyExecutionReadiness(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  options?: { now?: string },
): ExecutionReadinessAssessment;
```

### 6.2 Types

```typescript
type ExecutionReadinessLevel =
  | "external_side_effecting"
  | "irreversible"
  | "reversible"
  | "dry_run_capable"
  | "manual_only";

interface ExecutionReadinessFacts {
  approvedActionCount: number;
  mutationRequired: boolean;
  reversible: boolean;
  externalSideEffect: boolean;
  rollbackPlanPresent: boolean;
  rollbackCoverageComplete: boolean;
  simulatorCoverageComplete: boolean;
}

interface ExecutionReadinessReason {
  code:
    | "external_side_effect"
    | "irreversible_action"
    | "reversible_mutation"
    | "semantic_simulation_supported"
    | "manual_action_required"
    | "rollback_plan_missing"
    | "rollback_coverage_incomplete";
  actionIds: string[];
  summary: string;
}

interface ExecutionReadinessAssessment {
  assessmentId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  readinessLevel: ExecutionReadinessLevel;
  facts: ExecutionReadinessFacts;
  reasons: ExecutionReadinessReason[];
  assessedAt: string;
}
```

`simulatorCoverageComplete` is determined from a closed, local capability table owned by the classifier/simulator contract. It is not tool discovery.
It is true only when every approved action can receive a `"simulated"` projection. An action that can only receive `"manual_required"` is not simulator-covered.

### 6.3 Readiness level precedence

This is readiness-level precedence, not risk precedence:

```text
external side effect
→ irreversible
→ reversible
→ dry-run-capable
→ manual-only
```

Rules apply to approved actions only:

| Level | Rule |
|---|---|
| `external_side_effecting` | Any approved action has `externalSideEffect === true` |
| `irreversible` | No external side effect; any approved action has `reversible === false` |
| `reversible` | No higher rule; at least one approved action requires mutation; all mutating approved actions are reversible |
| `dry_run_capable` | No higher rule; every approved action has semantic simulator coverage |
| `manual_only` | No higher rule applies |

This ordering is deterministic. It does not imply that higher entries are “riskier” in a general policy sense.

### 6.4 Rollback facts

`rollbackCoverageComplete` is true only when every approved reversible mutating action appears in `rollbackPlan.reversibleActions`. Missing or incomplete rollback metadata adds a reason but does not alter the precedence calculation. P19.3 uses that fact when evaluating policy.

### 6.5 Determinism

```text
assessmentId = sha256(
  "p19.1" | planId | approvalId | readinessLevel | assessedAt
).slice(0, 16)
```

Reasons and action IDs sort lexicographically. Caller arrays remain unchanged.

## 7. P19.2 — Dry-Run Execution Simulator

### 7.1 Purpose

Produce a semantic projection of expected effects for approved actions. A P19 dry run is analysis, not sandbox execution.

```typescript
export function simulateExecutionPlan(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  assessment: ExecutionReadinessAssessment,
  options?: { now?: string },
): DryRunSimulation;
```

### 7.2 Simulation capability

P19.2 uses a closed mapping over existing `ExecutionActionKind` values:

| Action kind | Semantic result |
|---|---|
| `investigate_anomaly` | Describe evidence collection, expected finding, and no-mutation preconditions |
| `review_policy` | Describe policy inspection and proposal output; never edit policy |
| `update_config` | Describe target/config effect, mutation risk, rollback coverage, and manual requirement |
| `manual_action` | Mark `manual_required`; preserve operator instructions |

Unknown future action kinds fail closed as `unsupported`. No dynamic tool lookup is allowed.

### 7.3 Types

```typescript
type DryRunActionStatus =
  | "simulated"
  | "manual_required"
  | "blocked"
  | "unsupported";

interface DryRunActionProjection {
  actionId: string;
  kind: ExecutionActionKind;
  status: DryRunActionStatus;
  target: { type: string; id: string | null };
  expectedEffect: string;
  preconditions: string[];
  risks: string[];
  rollbackNotes: string[];
}

interface DryRunSimulation {
  simulationId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  status: "complete" | "partial" | "blocked";
  actionProjections: DryRunActionProjection[];
  expectedEffects: string[];
  riskNotes: string[];
  rollbackNotes: string[];
  simulatedAt: string;
  explicitlyNonExecuting: true;
}
```

### 7.4 Status rules

- `blocked`: readiness level is `external_side_effecting` or `irreversible`.
- `partial`: one or more actions are `manual_required` or `unsupported`, with at least one `simulated`.
- `complete`: all approved actions are semantically simulated.

Blocked simulations describe why analysis stopped. They do not invoke any executor.

### 7.5 Determinism

```text
simulationId = sha256(
  "p19.2" | planId | approvalId | assessmentId | status | simulatedAt
).slice(0, 16)
```

Action projections sort by `actionId`. Notes are deduplicated and sorted.

## 8. P19.3 — Policy Gate Evaluator

### 8.1 Purpose

Evaluate readiness against immutable operator-provided policy. The gate decides which analysis or manual path is available; it never grants machine execution.

```typescript
export function evaluateReadinessGate(
  input: ReadinessGateInput,
): ReadinessGateDecision;
```

### 8.2 Policy

```typescript
interface ExecutionReadinessPolicy {
  policyId: string;
  allowSemanticDryRunFor: Array<"dry_run_capable" | "reversible">;
  requireCompleteRollbackForReversible: boolean;
  blockExternalSideEffects: true;
  blockIrreversibleActions: true;
  requireP18Visibility: true;
}
```

P19 accepts policy as input. It does not load, create, edit, persist, or apply policy.

### 8.3 P18 visibility evidence

```typescript
interface WorkbenchVisibilityEvidence {
  remediationId: string;
  planId: string;
  approvalId: string;
  lifecycleTrace: WorkbenchLifecycleTrace;
}
```

Visibility is valid only when the P18 trace contains non-gap proposal, plan, and approval hops matching the input IDs. A missing or mismatched trace fails closed. This makes P18 correlation part of eligibility rather than optional report decoration.

### 8.4 Gate input and output

```typescript
interface ReadinessGateInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
  assessment: ExecutionReadinessAssessment;
  simulation: DryRunSimulation | null;
  policy: ExecutionReadinessPolicy;
  visibility: WorkbenchVisibilityEvidence;
  options?: { now?: string };
}

type ReadinessDisposition =
  | "blocked"
  | "manual_only"
  | "dry_run_allowed";

interface ReadinessGateDecision {
  decisionId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string | null;
  policyId: string;
  disposition: ReadinessDisposition;
  reasonCodes: string[];
  futureControlledExecutionCandidate: boolean;
  controlledExecutionAuthorization: "not_available_in_p19";
  evaluatedAt: string;
}
```

### 8.5 Decision rules

Rules evaluate in order:

1. Invalid approval/plan/assessment correlation → throw typed validation error.
2. Invalid P18 visibility evidence → `blocked`.
3. `external_side_effecting` → `blocked`.
4. `irreversible` → `blocked`.
5. Reversible mutation with required but incomplete rollback coverage → `blocked`.
6. Level allowed by policy plus complete simulation → `dry_run_allowed`.
7. Otherwise → `manual_only`.

`futureControlledExecutionCandidate` may be true only when:

- level is `reversible`;
- rollback coverage is complete;
- simulation is complete;
- P18 visibility is valid;
- policy allows semantic dry run.

That flag is informational. `controlledExecutionAuthorization` is always `"not_available_in_p19"`.

## 9. P19.4 — Readiness Report and CLI

### 9.1 Purpose

Build a read-only operator report over assessments, simulations, and gate decisions while retaining the P17/P18 evidence chain.

```typescript
export function buildExecutionReadinessReport(
  input: ExecutionReadinessReportInput,
): ExecutionReadinessReport;
```

### 9.2 Report types

```typescript
interface ExecutionReadinessReportInput {
  assessments: ExecutionReadinessAssessment[];
  simulations: DryRunSimulation[];
  decisions: ReadinessGateDecision[];
  lifecycleTraces: WorkbenchLifecycleTrace[];
  options?: { since?: string; until?: string; now?: string };
}

interface ExecutionReadinessReportItem {
  remediationId: string;
  planId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string | null;
  decisionId: string | null;
  readinessLevel: ExecutionReadinessLevel;
  disposition: ReadinessDisposition | "not_evaluated";
  simulationStatus: DryRunSimulation["status"] | "not_simulated";
  p18TracePresent: boolean;
  futureControlledExecutionCandidate: boolean;
  controlledExecutionAuthorization: "not_available_in_p19";
  requiresAttention: boolean;
  reasonCodes: string[];
  updatedAt: string;
}

interface ExecutionReadinessReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totals: {
    blocked: number;
    manualOnly: number;
    dryRunAllowed: number;
    notEvaluated: number;
    externalSideEffecting: number;
    irreversible: number;
    reversible: number;
    dryRunCapable: number;
    missingP18Visibility: number;
    futureCandidates: number;
  };
  items: ExecutionReadinessReportItem[];
}
```

### 9.3 Report rules

- Join strictly by plan, remediation, approval, and derived artifact IDs.
- Missing or mismatched P18 traces set `p18TracePresent: false`, `requiresAttention: true`, and cannot produce `dry_run_allowed`.
- Items sort by: `requiresAttention` descending, disposition priority (`blocked`, `manual_only`, `dry_run_allowed`, `not_evaluated`), `updatedAt` ascending, `remediationId`, then `planId`.
- No operator identifiers appear in report items or sorting.
- Time filtering uses `[since, until)`. Default window is seven days.

### 9.4 CLI

P17 plans and approvals currently have pure domain modules but no persistent stores, and the P18 CLI therefore supplies empty plan and approval collections. P19 must not hide this limitation or introduce a readiness store to compensate.

Until a separately designed P17 persistence source exists, P19 CLI commands require a read-only input bundle:

```typescript
interface P19ReadinessInputBundle {
  workbench: GovernanceWorkbenchInput;
  policy: ExecutionReadinessPolicy;
}
```

The CLI reads this bundle from `--input <path>`, resolves plans and approvals from it, and calls the existing P18 lifecycle-trace builder itself. It must not accept caller-asserted `p18TracePresent: true` as visibility evidence.

Read-only commands:

```text
alix governance readiness classify <plan-id> --input <path> [--json]
alix governance readiness simulate <plan-id> --input <path> [--json]
alix governance readiness evaluate <plan-id> --input <path> [--json]
alix governance readiness report --input <path> [--json] [--since <iso>] [--until <iso>]
```

Each command:

- requires an existing approved P17 approval;
- reads caller-supplied existing records without persisting them;
- builds P18 lifecycle visibility evidence through existing P18 code;
- computes P19 artifacts in memory;
- prints text or JSON;
- performs no write, append, transition, audit emission, policy change, or execution.

`simulate` requires an explicit operator command. No startup hook, daemon job, background schedule, or default path may invoke it.

Missing `--input`, unreadable JSON, invalid bundle shape, absent plan/approval records, or incomplete P18 correlation fail closed. A future persistent P17 read source may replace the bundle loader without changing P19 domain functions.

## 10. P19.5 — Checkpoint and Seal

P19.5 produces:

- `docs/architecture/reports/p19-governance-automation-readiness-report.md`;
- `docs/architecture/checkpoints/2026-07-08-p19-governance-automation-readiness-complete.md`;
- final verification evidence;
- checkpoint tag `alix-p19-governance-automation-readiness-complete`.

The checkpoint records delivered behavior and confirms that no execution capability was introduced.

## 11. Sentinel Suite

Source sentinels must reject:

| Forbidden category | Examples |
|---|---|
| Execution imports | tool executor, shell pool, runtime executor, execution adapter |
| Tool use | shell, network, MCP, browser, fetch, subprocess invocation |
| Mutation calls | `.execute(`, `.apply(`, `.mutate(`, `.transition(` |
| Store writes | `.append(`, `.write(`, `.save(`, `.delete(` |
| Audit emitters | direct audit emitter imports or emission calls |
| Policy writes | policy mutation, policy persistence, policy installation |
| P17 bypass | readiness without matching approved approval and approved action IDs |
| P18 bypass | gate/report without matching lifecycle trace evidence |
| Operator ranking | ranking, leaderboard, performance score, punitive inference |

Sentinels complement behavioral tests; they do not replace them.

## 12. Error Handling

Each module defines a narrow typed error:

- `ReadinessClassificationError`;
- `DryRunSimulationError`;
- `ReadinessGateError`;
- `ReadinessReportError`.

Validation errors identify the mismatched entity and invariant. Errors never trigger fallback execution, persistence, or input repair. Unsupported future action kinds fail closed.

CLI errors return non-zero exit status and human-readable text; `--json` returns a stable error object with `code`, `message`, and relevant IDs.

## 13. File Plan

| Slice | Source | Tests |
|---|---|---|
| P19.1 | `src/governance/execution-readiness.ts` | `tests/governance/execution-readiness.test.ts` |
| P19.2 | `src/governance/dry-run-simulator.ts` | `tests/governance/dry-run-simulator.test.ts` |
| P19.3 | `src/governance/readiness-policy-gate.ts` | `tests/governance/readiness-policy-gate.test.ts` |
| P19.4 | `src/governance/execution-readiness-report.ts`; `src/cli/commands/governance.ts` | `tests/governance/execution-readiness-report.test.ts`; `tests/cli/governance-readiness-cli.test.ts` |
| P19.5 | phase report and checkpoint docs | boundary verification commands and document checks |

No P19 store file is permitted.

## 14. Required Tests

### P19.1

1. Reject non-approved approval.
2. Reject plan/approval ID mismatch.
3. Reject remediation ID mismatch.
4. Reject unknown approved action ID.
5. Classify external side effect before every lower level.
6. Classify irreversible before reversible.
7. Classify reversible mutation before dry-run-capable.
8. Classify fully supported non-mutating actions as dry-run-capable.
9. Classify unsupported/manual actions as manual-only.
10. Evaluate approved actions only.
11. Detect complete and incomplete rollback coverage.
12. Produce deterministic ID, reasons, and ordering.
13. Do not mutate input arrays or objects.

### P19.2

1. Simulate every supported action kind semantically.
2. Preserve expected effect and target.
3. Mark manual actions `manual_required`.
4. Fail closed for unknown future action kinds.
5. Block external-side-effecting assessment.
6. Block irreversible assessment.
7. Produce partial status for mixed supported/manual actions.
8. Produce complete status only when all approved actions simulate.
9. Include rollback notes for reversible mutation.
10. Produce deterministic ID and ordering.
11. Do not invoke tools, shell, network, stores, or mutation.
12. Do not mutate inputs.

### P19.3

1. Reject mismatched derived artifact IDs.
2. Block missing P18 trace.
3. Block mismatched P18 plan/approval hops.
4. Block external-side-effecting level.
5. Block irreversible level.
6. Block incomplete required rollback coverage.
7. Allow semantic dry run for policy-allowed, complete simulation.
8. Return manual-only when simulation is unsupported or incomplete.
9. Set future candidate only for fully qualified reversible plans.
10. Always return `controlledExecutionAuthorization: "not_available_in_p19"`.
11. Do not mutate policy or other inputs.

### P19.4

1. Empty input produces zero totals.
2. Join artifacts by all correlation IDs.
3. Count each readiness level and disposition.
4. Mark missing simulation as not simulated.
5. Mark missing decision as not evaluated.
6. Mark missing P18 trace as attention required.
7. Never report dry-run allowed without P18 visibility.
8. Use `[since, until)` filtering.
9. Use seven-day default window.
10. Sort deterministically.
11. Exclude operator ranking data.
12. Render text and JSON CLI outputs.
13. Return stable CLI errors.
14. Require `--input` while P17 plan/approval persistence is absent.
15. Derive visibility through P18 code rather than trusting a boolean.
16. CLI performs no mutation, writes, audit emission, or execution.

### P19.5

1. Run P19 unit and CLI suites.
2. Run full governance suite.
3. Run TypeScript build.
4. Run forbidden-import and forbidden-call sentinels.
5. Verify no readiness store exists.
6. Verify phase report and checkpoint contents.
7. Verify final tag only after green evidence.

## 15. Acceptance Criteria

P19 is complete when:

1. approved plans receive deterministic readiness assessments;
2. semantic dry runs describe effects without action;
3. policy gates fail closed and authorize no execution;
4. every eligible result requires P17 approval and P18 visibility;
5. readiness reports are read-only and operator-neutral;
6. no readiness persistence or alternate lifecycle exists;
7. sentinel and behavioral suites prove hard boundaries;
8. phase report and checkpoint seal the milestone.

## 16. Invariants

1. Approval is necessary but not execution authority.
2. Readiness is projection, never lifecycle state.
3. Simulation is description, never execution.
4. Gate disposition is analysis permission, never machine-action permission.
5. Future candidacy is informational, never authorization.
6. P17 owns approval.
7. P18 owns visibility.
8. P19 owns derived readiness analysis only.
