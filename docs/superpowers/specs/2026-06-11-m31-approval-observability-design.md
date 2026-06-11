# M0.31: Approval Observability & Audit Trail — Design Spec

**Status:** Draft
**Builds on:** M0.29 (PolicyGate), M0.30 (Approval UX & Continuation)

---

## Problem

Approvals are functional but not visible enough. Users can run `/approve` and `/deny`, but the system lacks an obvious audit surface:

- No dashboard panel shows pending or resolved approvals
- Approval events are not emitted to the event log
- The runtime timeline/snapshot does not include approval state
- There is no traceable chain from policy decision → approval → continuation → resume

Without observability, approvals are a black box — they work, but you cannot inspect what happened or why.

## Goals

1. Show approvals in the TUI dashboard (pending + resolved)
2. Emit structured approval lifecycle events to the event log
3. Include approvals in runtime snapshot/timeline
4. Preserve linkage between policy decision, approval, continuation, and resumed tool call

Every approval should be traceable end-to-end:

```
policy.decision
  → approval.created
  → continuation.created
  → approval.resolved
  → approval.resumed (or approval.denied)
  → tool.started / tool.completed (or tool.failed)
```

## Non-goals

- No new approval semantics (`ask`/`allow`/`deny` unchanged)
- No multi-user approval workflow
- No remote dashboard
- No policy rule redesign
- No changes to PolicyGate or PolicyGateDecision

## Event model

New events emitted by ApprovalStore and ContinuationManager:

| Event | Emitter | Payload |
|-------|---------|---------|
| `approval.created` | `ApprovalStore.request()` | `approvalId`, `capability`, `reason`, `sessionId`, `graphId?`, `nodeId?` |
| `approval.reused` | `PolicyGate.handleAskDecision()` | `approvalId`, `capability`, `reason` (when findPending returns existing) |
| `approval.resolved` | `ApprovalStore.resolve()` | `approvalId`, `status: "approved" \| "denied"`, `decisionReason`, `resolvedAt` |
| `approval.resumed` | `ContinuationManager.resumeApproved()` | `approvalId`, `toolCallId`, `toolName`, `capability`, `argsHash` |
| `approval.resume.failed` | `ContinuationManager.resumeApproved()` | `approvalId`, `error`, `reason` |
| `continuation.created` | `ToolExecutor` (ask branch) | `approvalId`, `toolCallId`, `toolName`, `capability`, `argsHash` |
| `continuation.consumed` | `ContinuationManager.resumeApproved()` | `approvalId`, `toolCallId` |

The existing `policy.decision` event (already emitted by PolicyGate in M0.29) is the chain root.

## Dashboard model

A new **Approvals panel** in the TUI dashboard, accessible via tab navigation (same as existing panels).

### Pending approvals section

```
Approvals ─────────────────────────────────────
Pending:
  approval_abc123  shell.run  Command 'rm' requires approval
  created: 12:34:56  /approve or /deny
  approval_def456  file.write  Path is protected
  created: 12:35:10  /approve or /deny
───────────────────────────────────────────────
```

### Resolved approvals section (last N)

```
Recent:
  approval_abc123  approved  12:35:00  resumed → tool completed
  approval_xyz789  denied    12:30:00  Reason: user rejected
```

### Dashboard state (TuiState)

```typescript
// Add to TuiState
approvals: {
  pending: Array<{
    id: string;
    capability?: string;
    reason: string;
    toolId?: string;
    createdAt: string;
  }>;
  resolved: Array<{
    id: string;
    capability?: string;
    status: "approved" | "denied";
    reason: string;
    createdAt: string;
    decidedAt?: string;
    resumed?: boolean;
    resumedTool?: string;
    resumedAt?: string;
  }>;
}
```

## Runtime snapshot integration

`buildRuntimeSnapshot()` already reads active session data. In M0.31 it also reads:

- `ApprovalStore.listPending()` → snapshot `approvals.pending`
- `ApprovalStore.list()` filtered by resolved → snapshot `approvals.resolved`
- `ContinuationStore.list()` → snapshot `continuations` (count + linked approvalIds)

The snapshot is consumed by `applySnapshotToStore()` to populate `TuiState.approvals`.

Panel rendering reads `store.getState().approvals` directly.

## Event log enrichment

Approval lifecycle events are appended to the same `EventLog` that already records `policy.decision`, `tool.*`, and `artifact.*` events. No new log infrastructure — just new event types.

The existing `ApprovalStore` constructor already accepts `auditStore` as an optional dependency, but does not emit to `EventLog`. For M0.31:

1. `ApprovalStore` gains an optional `EventLog` dep (in addition to or replacing `auditStore`)
2. `store.request()` emits `approval.created`
3. `store.resolve()` emits `approval.resolved`

This keeps the audit trail alongside the existing policy/tool event stream.

## Traceability chain

Each event in the chain carries enough context to link to the next:

```
policy.decision { toolCallId, capability, decision: "ask" }
  → approval.created { approvalId, capability, sessionId }
  → continuation.created { approvalId, toolCallId, toolName, argsHash }
  → approval.resolved { approvalId, status: "approved" }
  → approval.resumed { approvalId, toolCallId }
  → tool.started / tool.completed { toolCallId, toolName }
```

A viewer can start from `approval.created` and follow `approvalId` forward through the chain, or start from `tool.started` and follow `toolCallId` backward to the policy decision.

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/approvals/approval-store.ts` | Modify | Emit `approval.created` and `approval.resolved` events |
| `src/runtime/continuation-store.ts` | Modify | Emit `continuation.created` and `continuation.consumed` events (add EventLog dep) |
| `src/runtime/continuation-manager.ts` | Modify | Emit `approval.resumed` and `approval.resume.failed` events |
| `src/policy/policy-gate.ts` | Modify | Emit `approval.reused` event when reusing pending |
| `src/tui/store.ts` | Modify | Add `approvals` state shape with approval types |
| `src/tui/runtime-snapshot.ts` | Modify | Load approval + continuation state into snapshot |
| `src/tui/panel-renderer.ts` | Modify | Render approval panel (new panel type) |
| `src/tui/index.ts` | Modify (minor) | Wire panel cycle to include approval panel |
| `tests/runtime/approval-observability.test.ts` | Create | Event emission + traceability tests |
| `tests/tui/approval-panel.test.ts` | Create | Dashboard rendering tests |

## Acceptance criteria

1. `approval.created` event emitted when `ApprovalStore.request()` is called
2. `approval.resolved` event emitted when `ApprovalStore.resolve()` is called  
3. `approval.reused` event emitted when PolicyGate reuses a pending approval
4. `continuation.created` event emitted when ToolExecutor persists a continuation
5. `approval.resumed` event emitted when ContinuationManager successfully resumes
6. `approval.resume.failed` event emitted when resume fails (argsHash mismatch, etc.)
7. Runtime snapshot includes pending approvals and resolved approvals
8. TUI dashboard shows an Approvals panel with pending and recent resolved entries
9. Full traceability chain from policy.decision to tool.completed is reconstructible from events
10. No new approval semantics — all existing behavior unchanged
