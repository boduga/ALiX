# P17.5 — Execution Report

**Date:** 2026-07-07
**Status:** Design
**Parent:** P17.0
**Depends on:** P17.1 (Remediation Lifecycle), P17.2 (Execution Plans), P17.3 (Approval Gate), P17.4 (Execution Recorder)

## Purpose

Provide a read-only report of accepted, approved, executed, failed, reverted, unresolved, and superseded remediation execution lifecycle state.

The report answers:

```
Which remediation actions were accepted?
Which accepted remediations have execution plans?
Which plans were approved?
Which approved plans were executed?
Which executions failed, partially completed, reverted, or remain unresolved?
```

## Hard boundary

No execution. No mutation. No status transitions. No approval changes. No remediation changes. No audit event emission. No direct audit emitter imports. No operator ranking. No punitive inference.

## Inputs

```typescript
type GovernanceExecutionReportInput = {
  remediations: GovernanceRemediationProposal[];
  executionPlans: GovernanceExecutionPlan[];
  approvals: GovernanceExecutionApproval[];
  attempts: GovernanceExecutionAttempt[];
  options?: {
    since?: string;
    until?: string;
    now?: string;
  };
};
```

Time filtering uses half-open intervals: `[since, until)`. Default window is last 7 days. `windowStart` and `windowEnd` reflect the actual resolved window.

## Types

### GovernanceExecutionReport

```typescript
interface GovernanceExecutionReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totals: {
    accepted: number;
    planned: number;
    approved: number;
    rejected: number;
    executed: number;
    failed: number;
    partial: number;
    reverted: number;
    unresolved: number;
    superseded: number;
  };
  items: GovernanceExecutionReportItem[];
}
```

### GovernanceExecutionReportItem

`executionState` is **derived report-only lifecycle state**. It is computed from the plan's approval record and the latest execution attempt. It must never be written back to the `GovernanceExecutionPlan.status` field.

```typescript
interface GovernanceExecutionReportItem {
  remediationId: string;
  sourceProposalId: string | null;
  remediationStatus: "open" | "accepted" | "dismissed" | "resolved" | "superseded";
  planId: string | null;
  executionState:
    | "draft"
    | "approved"
    | "rejected"
    | "executed"
    | "failed"
    | "partial"
    | "reverted"
    | "superseded"
    | null;
  approvalId: string | null;
  approvalDecision: "approved" | "rejected" | null;
  latestAttemptId: string | null;
  latestAttemptStatus: "started" | "succeeded" | "failed" | "partial" | "reverted" | null;
  riskLevel: "low" | "medium" | "high" | null;
  unresolved: boolean;
  requiresAttention: boolean;
  summary: string;
  createdAt: string;
  updatedAt: string;
}
```

## Classification rules

Execution lifecycle totals count the **latest attempt per plan** within the report window, not all historical attempts. This avoids double-counting remediations with retries.

| Totals field | Count |
|---|---|
| `accepted` | Remediation proposals where `status === "accepted"` |
| `planned` | Accepted remediations with at least one execution plan |
| `approved` | Plans with an approval where `decision === "approved"` |
| `rejected` | Plans with an approval where `decision === "rejected"` |
| `executed` | Latest attempt per plan where `status === "succeeded"`, within window |
| `failed` | Latest attempt per plan where `status === "failed"`, within window |
| `partial` | Latest attempt per plan where `status === "partial"`, within window |
| `reverted` | Latest attempt per plan where `status === "reverted"`, within window |
| `unresolved` | Accepted remediation without terminal successful or terminal replacement outcome |
| `superseded` | Remediation proposals where `status === "superseded"` |

## Attention rules

`requiresAttention` should be true when:

```
- accepted remediation has no execution plan
- execution plan exists but has no approval
- approval exists but no execution attempt exists
- latest attempt is failed
- latest attempt is partial
- latest attempt is started but not completed
```

`requiresAttention` must not imply blame or operator quality.

## Sorting

Report items sort deterministically:

1. `requiresAttention` desc
2. `updatedAt` asc
3. `remediationId` asc
4. `planId` asc, nulls last

No sorting by operator ID, operator count, or operator performance.

## Files

| File | Change |
|------|--------|
| `src/governance/execution-report.ts` | New — pure report builder |
| `tests/governance/execution-report.test.ts` | New — tests |
| `src/cli/commands/governance.ts` | Modified — CLI handler |

## Required tests

1. Empty inputs produce zero totals
2. Accepted remediation without plan is unresolved
3. Accepted remediation with draft plan is planned + unresolved
4. Approved plan with no attempt requires attention
5. Succeeded attempt counts as executed
6. Failed attempt counts as failed + unresolved + requires attention
7. Partial attempt counts as partial + unresolved + requires attention
8. Reverted attempt counts as reverted
9. Rejected approval counts as rejected
10. Superseded remediation counts as superseded
11. Report uses `[since, until)` window
12. Default window is last 7 days
13. Report sorting is deterministic
14. Report does not rank operators
15. Report module has no store writes
16. Report module has no audit emitter imports

## Non-goals

No execution, no approval/rejection, no resolution, no superseding, no reversion, no mutation, no audit emitter imports.
