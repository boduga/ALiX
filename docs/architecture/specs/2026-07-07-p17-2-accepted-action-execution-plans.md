# P17.2 — Accepted Action Execution Plans

**Date:** 2026-07-07
**Status:** Design
**Parent:** P17.0 — Governance Action Execution & Review Lifecycle
**Depends on:** P17.1 (Remediation Lifecycle Transitions)

## Purpose

Convert accepted remediation proposals into explicit, reviewable execution plans. No execution, no approval gate, no mutation.

## Core function

```typescript
export function createExecutionPlanFromRemediation(
  remediation: GovernanceRemediationProposal & { status: "accepted" },
  options?: { now?: string },
): GovernanceExecutionPlan
```

Throws unless `remediation.status === "accepted"`. Non-accepted proposals (open/dismissed/resolved/superseded) cannot produce execution plans.

## Types

```typescript
export interface GovernanceExecutionPlan {
  planId: string;
  remediationId: string;
  sourceProposalId: string;
  status: "draft";
  title: string;
  summary: string;
  proposedActions: GovernanceExecutionAction[];
  riskLevel: "low" | "medium" | "high";
  requiresRollbackPlan: boolean;
  rollbackPlan: GovernanceRollbackPlan | null;
  createdAt: string;
  createdBy: "system";
  approvedAt: null;
  approvedBy: null;
  executionAttemptIds: [];
  auditRefs: string[];
}

export interface GovernanceExecutionAction {
  actionId: string;
  kind: "investigate_anomaly" | "review_policy" | "update_config" | "manual_action";
  description: string;
  target: { type: string; id: string | null };
  expectedEffect: string;
  mutationRequired: boolean;
  externalSideEffect: boolean;
  approvalRequired: true;
  reversible: boolean;
  rollbackHint: string | null;
}

export interface GovernanceRollbackPlan {
  rollbackId: string;
  summary: string;
  reversibleActions: string[];
  nonReversibleActions: string[];
  operatorInstructions: string[];
  riskNotes: string[];
}
```

## Determinism

- `planId = sha256(["p17.2", remediation.proposalId, remediation.responseKind, createdAt].join("|")).slice(0, 16)`
- Sort actions by actionId asc.

## Invariant

An execution plan is not permission to execute. It is a reviewable object for the approval gate (P17.3).

## Files

| File | Change |
|------|--------|
| `src/governance/execution-plans.ts` | New |
| `tests/governance/execution-plans.test.ts` | New |

## Non-goals

No execution, no approval gate, no mutation, no store writes, no audit imports.
