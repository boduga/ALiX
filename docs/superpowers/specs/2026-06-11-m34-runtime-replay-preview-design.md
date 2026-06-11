# M0.34: Runtime Replay Preview — Design Spec

**Status:** Draft
**Builds on:** M0.33 (Runtime Trace Drilldown)

---

## Problem

M0.33 made trace events inspectable — users can see raw payloads, linked entities, and chain context. But the trace still answers *what happened*, not *what would happen if we replayed it*.

A user looking at a completed tool call cannot tell:
- Would this tool call succeed if replayed?
- Does this approval chain still resolve?
- What policy decisions gate this chain?
- Is the raw data sufficient to reconstruct execution?

M0.34 answers these questions **without executing anything**.

## Goals

1. Add a `replay` detail mode to the trace drilldown
2. Reconstruct the replayable chain from `traceChainContext()`
3. Label each step with its replay action type
4. Assess replayability (can this chain be reconstructed from available data?)
5. Show safety boundaries: policy decisions, approvals, continuations, tool calls
6. Display warnings about missing data or blocked paths
7. **Never execute a tool call, run a command, or change state**

## Non-goals

- No tool call execution
- No shell commands
- No file changes
- No approval resolution
- No actual replay — M0.35 covers that

## Sequencing

```
M0.32  visible
M0.33  inspectable
M0.34  previewable    ← this
M0.35  replayable
```

## Replay preview model

```typescript
// src/runtime/replay-preview.ts

export type ReplayAction =
  | "context-only"           // informational, not re-executable
  | "would-check-policy"     // policy decision — would re-evaluate
  | "would-require-approval" // approval gating — would need user approval
  | "would-reuse-approval"   // already resolved — would be skipped
  | "would-run-tool"         // would execute a tool call
  | "would-skip";            // blocked or not applicable

export type ReplayStepStatus =
  | "safe"
  | "blocked"
  | "requires-approval"
  | "not-replayable";

export type ReplayPreviewStep = {
  index: number;
  traceId: string;
  eventType: string;
  sourceType: TraceSourceType;
  timestamp: string;
  label: string;
  replayAction: ReplayAction;
  status: ReplayStepStatus;
  detail?: string;
};

export type ReplayPreview = {
  selectedTraceId: string;
  sessionId?: string;
  replayable: boolean;
  reason?: string;
  chain: ReplayPreviewStep[];
  boundaries: {
    policyDecisionIds: string[];
    approvalIds: string[];
    continuationIds: string[];
    toolCallIds: string[];
  };
  warnings: string[];
};
```

## Replayability rules

A chain is **replayable** when all tool call steps have:
- Non-empty `rawEvent` payload (source data is available)
- `toolCallId` present
- `toolName` present
- Not blocked by a denied approval

A chain is **not replayable** when:
- No tool call exists in the chain (nothing to replay)
- A denied approval blocks the chain
- Tool call `rawEvent` payload is missing
- Tool call args are missing from the raw event

A chain can be **previewable** even if not replayable — the preview shows *why* it's blocked.

## Mapping trace events to replay steps

| Event type | Replay action | Status |
|-----------|---------------|--------|
| `policy.decision` (allow) | `would-check-policy` | `safe` |
| `policy.decision` (deny) | `would-check-policy` | `blocked` |
| `approval.created` | `would-require-approval` | `requires-approval` |
| `approval.reused` | `would-reuse-approval` | `safe` |
| `approval.resolved` (approved) | `context-only` | `safe` |
| `approval.resolved` (denied) | `context-only` | `not-replayable` |
| `approval.resumed` | `would-reuse-approval` | `safe` |
| `continuation.created` | `context-only` | `safe` |
| `continuation.consumed` | `would-run-tool` | `safe`* |
| `tool.started` | `would-run-tool` | `safe`* |
| `tool.completed` | `context-only` | `safe` |
| `tool.failed` | `context-only` | `safe` |
| Other | `context-only` | `safe` |

\* Tool steps are marked `not-replayable` if `rawEvent` payload is missing tool args.

## Keyboard control

Add `p` as the fifth detail mode toggle (alongside `j`/`l`/`c`/`s`):

```
p = replay preview
```

When the trace panel is active and detail is open, `p` switches to replay mode.

## Replay preview rendering

```
── Replay Preview ─────────────────────
Selected: tool.completed  shell.run

Replayable: ✓ yes

Chain:
  1. policy.decision      would-check-policy       ● allow
  2. tool.started         would-run-tool            ▶ shell.run
  3. tool.completed       context-only              ✔ original result

Boundaries:
  Policy:      policy_abc
  ToolCall:    tc_001

Warnings:
  Preview only. No execution will occur.
  p=preview  j=json  l=links  c=chain  s=summary
```

For an approval-gated chain:

```
── Replay Preview ─────────────────────
Selected: tool.completed  file.write

Replayable: ⚠ requires approval

Chain:
  1. policy.decision       would-require-approval   ○ shell.run
  2. approval.created      context-only              ○ pending
  3. approval.resolved     would-reuse-approval      ● approved
  4. continuation.consumed would-run-tool            ▶ file.write
  5. tool.completed        context-only              ✔ done

Boundaries:
  Policy:      policy_abc
  Approval:    approval_001 (resolved)
  ToolCall:    tc_002
```

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/replay-preview.ts` | Create | `ReplayPreview`, `ReplayPreviewStep`, `ReplayAction`, `buildReplayPreview()` |
| `src/tui/trace-detail.ts` | Modify | Add `renderTraceReplay()` renderer |
| `src/tui/store.ts` | Modify (minor) | No changes needed — `"replay"` is already a valid `TraceDetailMode` via the union? Check if it's in the type. |
| `src/cli/commands/tui.ts` | Modify | Add `p` keyboard shortcut for replay mode |
| `tests/runtime/replay-preview.test.ts` | Create | Reconstruction tests |
| `tests/tui/replay-preview-detail.test.ts` | Create | Rendering tests |

## Acceptance criteria

1. Trace detail mode includes `replay` option
2. `p` keyboard shortcut switches to replay mode
3. Selected trace event produces a `ReplayPreview`
4. Preview reconstructs chain from `traceChainContext()`
5. Tool call steps marked `would-run-tool`
6. Policy steps marked `would-check-policy`
7. Approval steps marked `would-require-approval` / `would-reuse-approval`
8. Denied approval chain marked `not-replayable`
9. Preview clearly states no execution will occur
10. Tests cover: normal tool chain, approval chain, denied approval, missing raw payload
