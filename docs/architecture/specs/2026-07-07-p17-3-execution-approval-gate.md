# P17.3 — Execution Approval Gate

**Date:** 2026-07-07
**Status:** Design
**Parent:** P17.0
**Depends on:** P17.2 (Execution Plans)

## Purpose

Require explicit operator approval before any execution attempt can be recorded. Pure module — no execution, no mutation.

## Core functions

```typescript
export function approveExecutionPlan(
  plan: GovernanceExecutionPlan,
  operatorId: string,
  rationale: string,
  approvedActionIds: string[],
  options?: { now?: string },
): GovernanceExecutionApproval

export function rejectExecutionPlan(
  plan: GovernanceExecutionPlan,
  operatorId: string,
  rationale: string,
  options?: { now?: string },
): GovernanceExecutionApproval
```

## Types

```typescript
export interface GovernanceExecutionApproval {
  approvalId: string;
  planId: string;
  remediationId: string;
  decision: "approved" | "rejected";
  rationale: string;
  operatorId: string;
  createdAt: string;
  approvedActionIds: string[];
  auditRefs: string[];
}
```

## Validation rules

- Plan must be in `draft` status. Rejected/executed/failed/reverted/superseded plans cannot be approved or rejected. (`pending_approval` deferred to persistence/CLI slice if introduced later.)
- `operatorId` required (non-empty).
- `rationale` required (non-empty).
- For approve: every `approvedActionId` must map to a `proposedAction.actionId` in the plan. Empty list rejected.
- Deterministic `approvalId`.

## Determinism

- `approvalId = sha256(["p17.3", planId, decision, operatorId, createdAt, ...[...approvedActionIds].sort()].join("|")).slice(0, 16)`
- Sort on a copy — do NOT mutate caller's array.

## Invariant

Approval authorizes a plan for future execution recording. Does not perform execution. Rejected plans cannot be executed later.

## Files

| File | Change |
|------|--------|
| `src/governance/execution-approval.ts` | New |
| `tests/governance/execution-approval.test.ts` | New |

## Non-goals

No execution, no mutation, no store writes, no audit imports.
