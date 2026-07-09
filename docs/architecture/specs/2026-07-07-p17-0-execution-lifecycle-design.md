# P17.0 — Governance Action Execution & Review Lifecycle Design Spec

**Status:** Design — ready for implementation
**Phase:** P17 — Governance Action Execution & Review Lifecycle
**Builds on:** P14 (Auditability), P15 (Observability), P16 (Safe Response & Remediation)

## 1. Purpose

P17 turns accepted remediation proposals into explicit, audited, operator-approved execution workflows.

P16 made ALiX safely actionable by producing remediation proposals without crossing enforcement boundaries. P17 defines what happens after an operator accepts one of those proposals.

Core goal: accepted remediation must become executable only through a reviewable lifecycle, approval gate, audited execution recording, and read-only reporting surface.

## 2. Hard Boundary

No autonomous execution, no direct policy mutation, no unreviewed remediation, no hidden side effects, no direct audit emitter imports, no punitive/operator-ranking behavior, no bypass around audited stores.

Every execution-related action must be: approved, auditable, explainable, deterministic, reversible where possible, traceable to originating remediation proposal.

## 3. Scope

**In scope:** remediation lifecycle state transitions, accepted remediation → execution plan conversion, execution approval gate, execution attempt/result recording, rollback/revert metadata, read-only execution reporting, deterministic validation, audit-safe persistence.

**Out of scope:** autonomous execution, policy mutation, direct production enforcement, automatic rollback execution, ML-driven remediation selection, operator performance ranking, external side effects without explicit approval.

## 4. Lifecycle states

open → accepted → resolved/superseded
open → dismissed/superseded

### 4.1 State definitions

| State | Description | Terminal? |
|-------|-------------|-----------|
| open | Awaiting operator decision | No |
| accepted | Operator accepted as worth pursuing (≠ executed) | No |
| dismissed | Operator explicitly rejected | Yes |
| resolved | Terminal successful outcome | Yes |
| superseded | Replaced by newer/more accurate proposal | Yes |

### 4.2 Allowed transitions

- open → accepted (accept remediation)
- open → dismissed (dismiss remediation)
- open → superseded (superseded by newer)
- accepted → resolved (execution completed or condition resolved)
- accepted → superseded (replaced)

Invalid: dismissed → accepted, resolved → accepted, superseded → resolved, open → resolved, executed without approval.

## 5. Execution plan model

Accepted remediation proposals convert into execution plans.

### 5.1 Plan shape

```typescript
interface GovernanceExecutionPlan {
  planId: string;
  remediationId: string;
  sourceProposalId: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "executed" | "failed" | "reverted" | "superseded";
  title: string;
  summary: string;
  proposedActions: GovernanceExecutionAction[];
  riskLevel: "low" | "medium" | "high";
  requiresRollbackPlan: boolean;
  rollbackPlan: GovernanceRollbackPlan | null;
  createdAt: string;
  createdBy: "system";
  approvedAt: string | null;
  approvedBy: string | null;
  executionAttemptIds: string[];
  auditRefs: string[];
}
```

### 5.2 Action shape

```typescript
interface GovernanceExecutionAction {
  actionId: string;
  kind: "config_change" | "queue_update" | "store_update" | "report_generation" | "manual_instruction" | "external_action_placeholder";
  description: string;
  target: { type: string; id: string | null };
  expectedEffect: string;
  mutationRequired: boolean;
  externalSideEffect: boolean;
  approvalRequired: true;
  reversible: boolean;
  rollbackHint: string | null;
}
```

### 5.3 Rollback plan shape

```typescript
interface GovernanceRollbackPlan {
  rollbackId: string;
  summary: string;
  reversibleActions: string[];
  nonReversibleActions: string[];
  operatorInstructions: string[];
  riskNotes: string[];
}
```

## 6. Approval gate

Accept remediation ≠ approve execution. Two separate gates.

### 6.1 Approval states

pending_approval → approved | rejected

### 6.2 Approval record

```typescript
interface GovernanceExecutionApproval {
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

### 6.3 Approval rules

Plan must: belong to accepted remediation, have ≥1 explicit action, every mutation marked mutationRequired, every external side effect marked externalSideEffect, rollback metadata present when required, operator rationale provided.

## 7. Execution recording

Records attempts and results. Does not require autonomous execution — may be manually triggered.

### 7.1 Attempt shape

```typescript
interface GovernanceExecutionAttempt {
  attemptId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  status: "started" | "succeeded" | "failed" | "partial" | "reverted";
  startedAt: string;
  completedAt: string | null;
  executedBy: string;
  actionResults: GovernanceExecutionActionResult[];
  failureReason: string | null;
  revertAttemptId: string | null;
  auditRefs: string[];
}
```

### 7.2 Action result shape

```typescript
interface GovernanceExecutionActionResult {
  actionId: string;
  status: "succeeded" | "failed" | "skipped" | "manual_required";
  summary: string;
  evidenceRefs: string[];
}
```

## 8. Audit requirements

Must use existing audited stores. No direct audit emitter imports from CLI handlers, lifecycle modules, report modules, or execution modules.

Pattern: domain → validated result → audited store method → audit event produced by decorator/store boundary.

## 9. Implementation slices

| Slice | Deliverable |
|-------|-------------|
| P17.1 | Remediation lifecycle transitions (state machine + CLI + tests) |
| P17.2 | Accepted action execution plans |
| P17.3 | Execution approval gate |
| P17.4 | Audited execution recorder |
| P17.5 | Execution report |

## 10. Required invariants

1. Accepted ≠ execution approval.
2. No execution without approval.
3. No lifecycle transition skips validation.
4. Terminal states are terminal.
5. Reports read-only.
6. CLI handlers do not directly emit audit events.
7. Execution plans explicit before approval.
8. Mutating/external actions clearly marked.
9. Rollback metadata required when risk demands it.
10. No operator ranking/scoring/punitive inference.

## 11. Acceptance

P17.0 complete when: lifecycle states defined, execution plan model defined, approval gate model defined, execution recording model defined, rollback/revert model defined, audit boundary explicit, reporting surface specified, implementation slices clear, hard boundary preserved.
