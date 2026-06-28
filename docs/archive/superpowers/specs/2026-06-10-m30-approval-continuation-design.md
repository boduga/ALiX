# M0.30: Approval UX & Continuation — Design Spec

**Status:** ✅ Completed (M0.30)
**Builds on:** M0.29 (PolicyGate unification)

---

## Problem

PolicyGate now returns `ask` decisions, but those decisions have no user-facing resolution path:

- `ask` in ToolExecutor → logs "Approval required" → returns `denied` to caller — **dead end**
- `ask` in RuntimeGate → creates pending approval → returns `needs_approval` — **no way to approve from the TUI**
- Approvals live silently in `.alix/approvals/approvals.json` — **invisible to the user**

Without a resolution path, "ask" is just "deny with extra steps."

## Solution

Three layers, one milestone:

```
PolicyGate returns ask
  ↓
ToolExecutor / RuntimeGate pauses execution
  ↓
ApprovalStore records pending approval
  ↓
TUI displays pending approval
  ↓
User runs /approve <id> or /deny <id>
  ↓
ContinuationManager resumes or cancels blocked work
```

### Layer 1: Approval display

When a tool is blocked with `ask`, the TUI surfaces a structured message:

```
Approval required

ID:       approval_abc123
Capability: shell.mutating
Tool:     shell.run
Reason:   Command 'rm' requires approval
Command:  rm -rf dist

Run:
  /approve approval_abc123
  /deny approval_abc123
```

### Layer 2: Approval commands (TUI)

A new `ApprovalManager` in `src/tui/approval-manager.ts`, following the same pattern as `WorkspaceManager`:

| Command | Action |
|---------|--------|
| `/approvals` | List all pending approvals |
| `/approve <id>` | Mark approval approved → trigger continuation |
| `/deny <id>` | Mark approval denied |

TUI loop order becomes:

```
workspaceManager.tryHandleCommand(input)
approvalManager.tryHandleCommand(input)
normal task submission
```

### Layer 3: Continuation records

When PolicyGate returns `ask`, the caller persists a continuation record — enough context to resume the blocked operation automatically on approval.

```typescript
type PendingContinuation = {
  approvalId: string;
  kind: "tool" | "capability";
  sessionId: string;
  cwd: string;
  toolCall?: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    argsHash: string;
    capability: string;
  };
  createdAt: string;
};
```

### ContinuationManager

`src/runtime/continuation-manager.ts`

On `/approve <id>`:

1. Verify approval status is `approved`
2. Look up `PendingContinuation` by `approvalId`
3. Verify integrity: same tool, same argsHash, same cwd, same approval id
4. Re-execute the blocked tool call via ToolExecutor
5. Return the result to the TUI

### Safety: argsHash binding

Approval is bound to the original request hash. The continuation record stores `argsHash` (existing `hashArgs()` from executor.ts). On resume, recompute and compare: if the hash changed, deny even if approval is approved. Prevents approval-for-swap attacks.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PolicyGate                        │
│  evaluateToolCall() → allow | ask | deny              │
└──────────────────┬──────────────────────────────────┘
                   │ ask
                   ▼
┌─────────────────────────────────────────────────────┐
│              ToolExecutor / RuntimeGate               │
│  1. Create continuation record                        │
│  2. Create approval via ApprovalStore                  │
│  3. Return ask to caller                               │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│           TUI / Daemon output channel                 │
│  Display: "Approval required — run /approve <id>"     │
└──────────────────┬──────────────────────────────────┘
                   │ /approve <id>
                   ▼
┌─────────────────────────────────────────────────────┐
│              ContinuationManager                      │
│  1. Mark approval approved in ApprovalStore           │
│  2. Lookup PendingContinuation by approvalId          │
│  3. Verify argsHash still matches                     │
│  4. Re-execute tool call via ToolExecutor              │
│  5. Return result                                      │
└─────────────────────────────────────────────────────┘
```

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tui/approval-manager.ts` | Create | `/approvals`, `/approve`, `/deny` commands |
| `src/runtime/continuation-manager.ts` | Create | Resume blocked tool calls on approval |
| `src/runtime/continuation-store.ts` | Create | Persist PendingContinuation records |
| `src/cli/commands/tui.ts` | Modify | Wire ApprovalManager into TUI loop |
| `src/tools/executor.ts` | Modify | Create continuation on `ask`, call manager on resume |
| `src/policy/runtime-gate.ts` | Modify | Create continuation on `ask` |
| `tests/tui/approval-manager.test.ts` | Create | Approval command tests |
| `tests/runtime/continuation-manager.test.ts` | Create | Resume and safety tests |

## Acceptance criteria

1. `ask` decision creates pending approval + continuation record
2. TUI displays pending approval ID with /approve /deny instructions
3. `/approvals` lists pending approvals
4. `/deny <id>` marks approval denied and does not resume
5. `/approve <id>` marks approval approved
6. Approved tool call resumes exactly once (idempotent)
7. Reused approval does not create duplicate pending approvals
8. Approval cannot be reused if args/cwd changed (argsHash mismatch)
9. Daemon mode and no-daemon mode both surface approval state
