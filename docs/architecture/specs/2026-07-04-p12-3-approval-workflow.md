# P12.3 — Approval Workflow Design Spec

**Date:** 2026-07-04
**Status:** Implementation-ready.

## Purpose

Given policy + risk, determine what approval gates are required and manage their state. P12.3 answers **"Does this need approval, and who approved what?"**

## Key Invariant

**Gate-state machine, not storage layer.** No ledger writes, no persistence, no P11 orchestration coupling.

- P12.1 decides: `allow | deny | requires_approval`
- P12.2 decides: `low | medium | high | critical`
- P12.3 decides: approval gate state ← YOU ARE HERE
- P12.4 records the evidence

## Types

```typescript
export type ApprovalGateName =
  | "proposal"
  | "file_scope"
  | "verification"
  | "pr"
  | "merge";

export type ApprovalGateStatus =
  | "pending"
  | "approved"
  | "denied";

export interface ApprovalGate {
  gate: ApprovalGateName;
  status: ApprovalGateStatus;
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}

export interface ApprovalWorkflowInput {
  policyDecision: "allow" | "deny" | "requires_approval";
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface ApprovalWorkflowResult {
  required: boolean;
  gates: ApprovalGate[];
  reason: string;
}
```

## Gate Rules (P12.0 defaults)

| Gate | When Required | Default Status |
|------|---------------|----------------|
| `proposal` | risk >= medium | pending |
| `file_scope` | risk >= high | pending |
| `verification` | risk >= low | pending |
| `pr` | risk >= low | pending (always draft) |
| `merge` | always required | pending (never autonomous) |

## Policy Interaction

| policyDecision | Effect on workflow |
|----------------|-------------------|
| `deny` | `required: false`, no gates, reason: "Blocked by policy" |
| `allow` | Normal gate rules based on risk level |
| `requires_approval` | All gates included regardless of risk level — full human oversight chain |

## Functions

```typescript
buildApprovalWorkflow(input: ApprovalWorkflowInput): ApprovalWorkflowResult        // pure/deterministic
approveGate(result: ApprovalWorkflowResult, gate: ApprovalGateName, approvedBy: string, approvedAt?: string): ApprovalWorkflowResult
denyGate(result: ApprovalWorkflowResult, gate: ApprovalGateName, reason?: string): ApprovalWorkflowResult
isWorkflowApproved(result: ApprovalWorkflowResult): boolean                         // pure/deterministic
```

`buildApprovalWorkflow` and `isWorkflowApproved` are pure — same input always produces same output.
`approveGate` and `denyGate` are state transitions: deterministic except for the caller-supplied timestamp. Callers supply `approvedAt`; when omitted, no timestamp field is set on the gate.

## Edge Cases

| Case | Behaviour |
|------|-----------|
| `deny` policy | `required: false`, gates empty, reason: "Blocked by policy" |
| `allow` + low risk | gates: verification, pr, merge |
| `allow` + medium risk | adds proposal gate |
| `allow` + high risk | adds file_scope gate |
| `requires_approval` + low risk | all 5 gates present (proposal, file_scope, verification, pr, merge) |
| `approveGate` on already-approved gate | no-op (returns same state) |
| `approveGate` on unknown gate | no-op (returns same state) |
| `merge` gate | cannot be auto-approved via `approveGate` |
| `isWorkflowApproved` on empty gates | false |
| `isWorkflowApproved` all approved | true |

## Merge Gate Invariant

The `merge` gate cannot be approved by `approveGate()`. It represents the invariant that merges are never autonomous. Only manual operator action (future P12.6) can change it.

**Consequence for `isWorkflowApproved`:** Because `merge` is always `pending` in automated flows, `isWorkflowApproved()` will return `false` for any workflow that includes `merge`. This is intentional — full automated approval is never possible; human action is always required before merge.

## Files

- `src/governance/approval-workflow.ts` — Types + pure functions
- `tests/governance/approval-workflow.test.ts` — Unit tests (node:test)
- `src/cli/commands/governance.ts` — Add `approval` subcommand

## Merge Criteria

```bash
pnpm build && pnpm typecheck && node --test dist/tests/governance/approval-workflow.test.js && pnpm test:vitest
```
