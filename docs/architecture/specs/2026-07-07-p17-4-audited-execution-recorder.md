# P17.4 — Audited Execution Recorder

**Date:** 2026-07-07
**Status:** Design
**Parent:** P17.0
**Depends on:** P17.2 (Execution Plans), P17.3 (Execution Approval Gate)

## Purpose

Record execution attempts and outcomes only after an approved execution plan exists. Pure module + append-only JSONL store. No execution, no mutation, no audit emitter imports.

## Core invariant

```
Approved plan → record → no execution
```

P17.4 records approved execution outcomes. It does not perform execution.

## Hard boundary

- No autonomous execution
- No hidden mutation
- No external action
- No execution without approval
- No recording against rejected plans
- No direct audit emitter imports
- No bypass around audited stores

## Types

### ExecutionAttemptStatus

```
"started" | "succeeded" | "failed" | "partial" | "reverted"
```

### ExecutionActionResultStatus

```
"succeeded" | "failed" | "skipped" | "manual_required"
```

### GovernanceExecutionAttempt

```
{
  attemptId: string;           // deterministic sha256 hash (16 hex)
  planId: string;              // references GovernanceExecutionPlan
  remediationId: string;       // references GovernanceRemediationProposal
  approvalId: string;          // references GovernanceExecutionApproval
  status: ExecutionAttemptStatus;
  startedAt: string;           // ISO 8601
  completedAt: string | null;  // set when terminal, null when "started"
  executedBy: string;          // operator identifier
  actionResults: GovernanceExecutionActionResult[];
  failureReason: string | null;  // required for failed/partial/reverted
  revertAttemptId: string | null;
  auditRefs: string[];
}
```

### GovernanceExecutionActionResult

```
{
  actionId: string;
  status: ExecutionActionResultStatus;
  summary: string;
  evidenceRefs: string[];
}
```

## Validation rules

| Rule | Error |
|------|-------|
| `approval.decision` must be `"approved"` | `AttemptValidationError` |
| `planId` on approval must match `planId` on plan | `AttemptValidationError` |
| `executedBy` must be non-empty | `AttemptValidationError` |
| `status` must be a valid `ExecutionAttemptStatus` | `AttemptValidationError` |
| `failureReason` required when status is `failed`, `partial`, or `reverted` | `AttemptValidationError` |
| Every `actionResult.actionId` must exist in `plan.proposedActions` | `AttemptValidationError` |
| Every `actionResult.actionId` must exist in `approval.approvedActionIds` | `AttemptValidationError` |
| Each action result must be a valid object with required fields | `AttemptValidationError` |
| `revertAttemptId` must not be an empty string if provided | `AttemptValidationError` |

## Determinism

```
attemptId = sha256(["p17.4", planId, status, executedBy, startedAt].join("|"))
             .digest("hex").slice(0, 16)
```

Same inputs → same attemptId. Deterministic IDs via injectable timestamp (`options.now`).

## completedAt logic

| Status | completedAt |
|--------|------------|
| started | `null` |
| succeeded | `startedAt` |
| failed | `startedAt` |
| partial | `startedAt` |
| reverted | `startedAt` |

## Store

Append-only JSONL (`execution-attempts.jsonl`). Async I/O, newest-first reads, corrupt-line resilience.

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `append(attempt)` | `Promise<void>` | Append new attempt record |
| `list(limit?)` | `Promise<GovernanceExecutionAttempt[]>` | Newest-first, optional limit |
| `getById(attemptId)` | `Promise<GovernanceExecutionAttempt \| null>` | Find by attempt ID |
| `getByPlanId(planId)` | `Promise<GovernanceExecutionAttempt[]>` | All attempts for a plan |
| `getByApprovalId(approvalId)` | `Promise<GovernanceExecutionAttempt[]>` | All attempts linked to an approval |

## Files

| File | Change |
|------|--------|
| `src/governance/execution-recorder.ts` | New — pure module |
| `src/governance/execution-store.ts` | New — append-only JSONL store |
| `tests/governance/execution-recorder.test.ts` | New — 19 tests |
| `tests/governance/execution-store.test.ts` | New — 10 tests |

## Required tests

### Recorder (19 tests)

1. Approved plan → valid attempt record
2. Action results with evidence refs preserved
3. Rejected approval → throws
4. Plan/approval planId mismatch → throws
5. Empty executedBy → throws
6. Invalid status → throws
7. Failed without failureReason → throws
8. Partial without failureReason → throws
9. Failed with failureReason → allowed
10. Succeeded without failureReason → allowed
11. Action ID not in proposedActions → throws
12. Action ID not approved → throws
13. Deterministic attempt ID with same inputs
14. Different status → different attempt ID
15. Non-terminal status (started) → completedAt = null
16. Terminal status (succeeded) → completedAt set
17. revertAttemptId preserved when provided
18. Reverted without failureReason → throws
19. Action results match approved actions

### Store (10 tests)

1. Append and list single attempt
2. Append multiple, newest-first ordering
3. List with limit
4. getById found
5. getById not found
6. getByPlanId matches
7. getByPlanId no matches
8. getByApprovalId matches
9. getByApprovalId no matches
10. Empty store returns empty list

## Non-goals

No execution, no mutation, no approval changes, no plan status transitions, no direct audit emitter imports, no bypass around audited stores.
