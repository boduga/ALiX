# M0.35 — Runtime Replay Execution Design

> **One-liner:** M0.35 executes selected replay chains through a bounded replay executor using dry-run and sandbox modes, while preserving PolicyGate enforcement and full trace auditability.

> **Capstone of the trace trilogy (M0.32 visible → M0.33 inspectable → M0.34 previewable → M0.35 executable).**

---

## 1. Problem

M0.34 built `buildReplayPreview()` — it classifies chain steps into replay actions (would-check-policy, would-run-tool, would-require-approval, etc.) and assesses replayability. But it never *executes* anything.

The gap: a user sees a trace, sees it's replayable, and has no way to actually replay it.

M0.35 closes that gap with a hard safety boundary: replay executes only under controlled modes that never modify real state, never bypass policy, and always emit audit events.

---

## 2. Goals

1. **ReplayPlan:** Construct an executable plan from a ReplayPreview — identify tool calls, args, policy decisions, and approval status for each step.
2. **ReplayExecutor:** Execute the plan step by step, respecting safety mode.
3. **PolicyGate re-check:** Every tool step goes through PolicyGate before execution. Replay does not bypass policy.
4. **Args hash validation:** Each step's args hash must match the original trace, or the step is blocked.
5. **Dry-run mode:** File writes produce diff output without touching disk. Shell commands show what would run without executing.
6. **Sandbox mode (shell):** Shell commands run in a temp directory — real execution, isolated side effects.
7. **Network blocked:** `mcp.*`, `web_search`, `web_fetch`, `delegate` are blocked in both modes for M0.35.
8. **replay.* events:** Every replay action emits typed events visible in the Trace timeline.
9. **TUI integration:** `/replay selected --dry-run`, `/replay selected --sandbox`, and `x` keyboard shortcut with confirmation.
10. **Tests:** Prove dry-run never writes files, sandbox writes to isolated temp, denied approvals block replay, args hash mismatch blocks replay.

---

## 3. Non-goals

- **Approved-live execution** (`approved-live` mode) — deferred to M0.36. In M0.35, approvals are rechecked but "ask" results block the step rather than creating new pending approvals.
- **Multi-step approval workflows** — if a chain has multiple approval points, each is evaluated independently but all must be either pre-approved or denied.
- **Visual diff rendering** — dry-run file writes show the content as text output, not as side-by-side diff. Visual diff is a TUI concern that can be layered later.
- **Replay of MCP tool calls** — MCP tools require server connectivity that may involve live side effects. Blocked in both M0.35 modes.
- **Network sandboxing beyond blocking** — no container/network namespace isolation. Just deny by default.
- **Persistent replay history** — replay results appear in the session trace but are not persisted as separate sessions.

---

## 4. Replay safety model

```
Replay mode          PolicyGate    State mutation   Network     Shell execution
───────────────      ──────────    ──────────────   ─────────   ───────────────
dry-run              re-checked    simulated only   blocked     simulated only
sandbox              re-checked    temp-isolated    blocked     real execution
approved-live (M0.36) re-checked  real             allowed     real execution
```

**Rules that never change:**
- Every tool step re-checks PolicyGate. Replay is not a bypass mechanism.
- Args hash must match the original trace event's hash, or the step is blocked.
- Replay always emits `replay.*` events for every step attempt and outcome.
- Replay output is clearly marked as replay output (not original execution output).

### Args hash validation

The replay plan extracts args from the original trace event. It recomputes `hashArgs(args)` and compares it to the stored hash. If they don't match, the step is blocked — the trace data may be corrupt or tampered with.

### Approval re-check

For steps that originally required approval, the ReplayExecutor:
1. Looks up the approval record by `approvalId`
2. If the approval was granted: allows execution (but still re-checks PolicyGate for current policy)
3. If the approval was denied: blocks the step
4. If the approval is pending: blocks the step (user hasn't decided)
5. If PolicyGate now denies a previously-approved capability: blocks the step (policy changed)

---

## 5. ReplayPlan model

**File:** `src/runtime/replay-plan.ts` (NEW)

```typescript
export type ReplayMode = "dry-run" | "sandbox";

export type ReplayPlanStep = {
  index: number;
  traceId: string;
  eventType: string;
  replayAction: ReplayAction;       // from replay-preview.ts
  toolName?: string;
  args?: Record<string, unknown>;
  argsHash?: string;
  status: "ready" | "blocked" | "skipped";
  blockReason?: string;
};

export type ReplayPlan = {
  mode: ReplayMode;
  sessionId?: string;
  steps: ReplayPlanStep[];
  toolCount: number;                 // how many tool steps are in the chain
  blockedSteps: number;              // how many steps are blocked
  executable: boolean;               // at least one step can execute
  reason?: string;                   // if not executable, why
  approvals: Array<{
    approvalId: string;
    status: string;
    recheckPassed: boolean;
  }>;
  warnings: string[];
};
```

**Builder function:**

```typescript
export function buildReplayPlan(
  preview: ReplayPreview,
  allEvents: TraceEvent[],
  mode: ReplayMode,
): ReplayPlan
```

The builder:
1. Gets the chain events from the preview's `traceChainContext` result
2. For each chain event, extracts the tool call from `rawEvent.payload`
3. Checks if the step is a tool step (would-run-tool, would-reuse-approval)
4. For tool steps, extracts args and recomputes argsHash
5. Checks approval status from events (approval.resolved)
6. Marks blocked: argsHash mismatch, denied approval, network tool in dry-run/sandbox, missing payload
7. Returns the plan with executable=true if at least one step is "ready"

---

## 6. ReplayExecutor flow

**File:** `src/runtime/replay-executor.ts` (NEW)

```
buildReplayPlan(preview, events, mode)
       │
       ▼
ReplayPlan ─── executable=false? ───→ return early with reason
       │
       ▼
ReplayExecutor.execute(plan)
       │
       ├── emit replay.plan.created
       ├── emit replay.started
       │
       ▼
   For each step:
       │
       ├── 1. Check: step.status === "ready"?  → else skip/block
       ├── 2. Check: argsHash matches?          → else block
       ├── 3. Check: PolicyGate for this step   → else block
       ├── 4. Execute via dry-run/sandbox router
       │        emit replay.step.started
       │        emit replay.step.completed / .skipped / .blocked
       │
       ▼
   emit replay.completed or replay.failed
       │
       ▼
   Return ReplayResult
```

**Core class:**

```typescript
export class ReplayExecutor {
  constructor(
    private config: AlixConfig,
    private eventLog: EventLog,
    private cwd: string,
    private mode: ReplayMode,
  ) {}

  async execute(plan: ReplayPlan): Promise<ReplayResult>
}
```

The executor creates a `ReplayContext` with:
- A dry-run-wrapped `FileToolRouter` (reads pass through, writes produce output without writing)
- A sandbox-wrapped `ShellToolRouter` (real execution in temp dir)
- A blocking wrapper for MCP/Web/Delegate
- No `PatchToolRouter` (patch.apply is dry-run only — show what would be applied)

**ReplayResult:**

```typescript
export type ReplayResult = {
  mode: ReplayMode;
  plan: ReplayPlan;
  steps: ReplayStepResult[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  toolCallCount: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
};

export type ReplayStepResult = {
  index: number;
  traceId: string;
  action: ReplayAction;
  status: "completed" | "blocked" | "skipped" | "failed";
  toolName?: string;
  output?: string;
  outputSize?: number;
  durationMs?: number;
  blockReason?: string;
  error?: string;
};
```

---

## 7. Tool-specific replay behavior

### Dry-run mode (default)

| Tool | Behavior |
|------|----------|
| `file.read` | Execute normally. Read-only, safe. |
| `file.exists` | Execute normally. Read-only, safe. |
| `dir.search` | Execute normally. Read-only, safe. |
| `file.create` | **Simulate.** Return `"[DRY-RUN] Would create: <path>\n<content>"` as output. Do not write. |
| `file.delete` | **Simulate.** Return `"[DRY-RUN] Would delete: <path>"` as output. Do not delete. |
| `shell.run` | **Simulate.** Return `"[DRY-RUN] Would run: <command>"` as output. Do not execute. |
| `patch.apply` | **Simulate.** Return `"[DRY-RUN] Would apply patch to <file(s)>"` with patch text. Do not apply. |
| `mcp.*` | **Blocked.** Return error: `"MCP tools are not available in dry-run mode"`. |
| `web_search` | **Blocked.** Return error. |
| `web_fetch` | **Blocked.** Return error. |
| `delegate` | **Blocked.** Return error. |

### Sandbox mode (shell only)

| Tool | Behavior |
|------|----------|
| `file.read` | Execute normally. |
| `file.exists` | Execute normally. |
| `dir.search` | Execute normally. |
| `file.create` | Same as dry-run — simulated. File writes are dry-run by default in both modes. |
| `file.delete` | Same as dry-run — simulated. |
| `shell.run` | **Execute in temp sandbox.** The command runs in an isolated temp directory (`os.tmpdir()`/alix-replay-XXXXX). Shell state (cwd, files) is isolated. Output returned normally. Temp dir cleaned up after execution. |
| `patch.apply` | Same as dry-run — simulated. |
| `mcp.*` | **Blocked.** Same as dry-run. |
| `web_search` | **Blocked.** |
| `web_fetch` | **Blocked.** |
| `delegate` | **Blocked.** |

### Sandbox temp directory implementation

For sandbox shell execution:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Create temp sandbox
const sandboxDir = mkdtempSync(join(tmpdir(), "alix-replay-"));

try {
  // Execute command with cwd = sandboxDir
  const result = await runCommand({ command, cwd: sandboxDir, timeoutMs });
  return result;
} finally {
  // Clean up
  rmSync(sandboxDir, { recursive: true, force: true });
}
```

---

## 8. Policy and approval handling

### PolicyGate integration

Before each tool step executes, the ReplayExecutor calls `PolicyGate.evaluateToolCall()` with:
- `sessionMode: "ask"` — replay never bypasses policy
- `source: "replay"` — a new source value so policy can distinguish replay from original execution

The `source` field needs to be added to `ToolPolicyRequest`:
```typescript
source: "tool" | "graph" | "daemon" | "tui" | "replay";
```

### Approval handling per mode

| Scenario | Replay behavior |
|----------|-----------------|
| Step had no approval in original trace | Re-check PolicyGate. If policy allows, execute. If policy asks, block (no approval prompt in M0.35). |
| Step had approval that was granted | Verify approval record still exists and was approved. Re-check PolicyGate (policy may have changed). If both pass, execute. |
| Step had approval that was denied | Block. |
| Step had pending approval | Block. |
| New approval created during replay | Not in M0.35 scope. Steps requiring new approvals are blocked. |

---

## 9. TUI UX

### Commands

```
/replay selected --dry-run         Replay the selected trace chain in dry-run mode
/replay selected --sandbox         Replay with sandboxed shell execution
/replay <traceId> --dry-run        Replay a specific trace chain by ID
```

### Keyboard shortcuts

When trace detail is open and mode is "replay":
```
x    execute replay (with confirmation for sandbox mode)
```

### Confirmation flow

```
Replay selected chain in dry-run mode? type: replay yes
```

For sandbox mode:
```
Replay selected chain in sandbox mode? (shell runs in isolated dir) type: replay yes
```

### Result display

After replay completes, the result is shown in the drilldown panel as a new mode:

```
── Replay Result ─────────────────────
  Mode: dry-run
  Steps: 3 total, 2 completed, 0 blocked, 0 failed
  Duration: 142ms

  Chain:
  ✔ 1. would-check-policy   policy: shell.run   12ms
  ✔ 2. would-run-tool       shell.run started    130ms
       [DRY-RUN] Would run: ls -la

  Keys: r=rerun  s=summary  esc=close
```

### Trace event bridge

Replay events appear in the Trace timeline automatically via `toTraceEvent()` in `trace-events.ts`. No separate bridge needed — they go through the same EventLog append path.

---

## 10. Event model

### replay.* events

**File:** `src/events/types.ts` (MODIFY)

```typescript
export const REPLAY_EVENT_TYPES = {
  PLAN_CREATED: "replay.plan.created",
  STARTED: "replay.started",
  STEP_STARTED: "replay.step.started",
  STEP_COMPLETED: "replay.step.completed",
  STEP_SKIPPED: "replay.step.skipped",
  STEP_BLOCKED: "replay.step.blocked",
  COMPLETED: "replay.completed",
  FAILED: "replay.failed",
} as const;

export type ReplayPlanCreatedPayload = {
  mode: ReplayMode;
  stepCount: number;
  toolCount: number;
  blockedSteps: number;
};

export type ReplayStartedPayload = {
  mode: ReplayMode;
  sessionId: string;
};

export type ReplayStepPayload = {
  stepIndex: number;
  traceId: string;
  action: ReplayAction;
  toolName?: string;
  status?: "completed" | "skipped" | "blocked" | "failed";
  outputPreview?: string;
  blockReason?: string;
  error?: string;
  durationMs?: number;
};

export type ReplayCompletedPayload = {
  mode: ReplayMode;
  stepCount: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  totalDurationMs: number;
};

export type ReplayFailedPayload = {
  mode: ReplayMode;
  reason: string;
  stepIndex?: number;
};
```

### TraceEvent integration

Add `"replay"` to `TraceSourceType`:

```typescript
export type TraceSourceType =
  | "policy" | "approval" | "continuation"
  | "tool" | "task" | "session" | "daemon" | "runtime"
  | "replay";
```

Add replay event mapping in `toTraceEvent()`:

```typescript
// Replay lifecycle
if (type.startsWith("replay.")) {
  const p = payload as any;
  return {
    id, timestamp: ts, rawEvent,
    sourceType: "replay",
    eventType: type,
    label: `replay ${type.replace("replay.", "")}`,
    status: type.includes("blocked") || type.includes("failed") ? "failed" : "success",
    detail: p.reason || p.blockReason || "",
    sessionId: p.sessionId,
  };
}
```

---

## 11. TUI keyboard shortcut

In `src/cli/commands/tui.ts`, when detail is open and mode is "replay":

```typescript
if (task.toLowerCase() === "x") {
  // Execute replay
  const mode = store.getState().traceSelection.detailMode;
  if (mode === "replay") {
    const selected = store.getSelectedTraceEvent();
    if (selected) {
      tui.appendOutput("Replay selected chain in dry-run mode? type: replay yes\n", false);
      // ... confirmation + execution
    }
  }
}
```

The confirmation uses a two-step prompt: user types `replay yes` to confirm. This prevents accidental execution.

---

## 12. Test plan

**New files:**
- `tests/runtime/replay-plan.test.ts` — plan building
- `tests/runtime/replay-executor.test.ts` — execution
- `tests/tui/replay-execution-detail.test.ts` — TUI result rendering

**ReplayPlan tests:**
1. Builds plan from tool chain preview
2. Marks network tools as blocked in dry-run mode
3. Marks denied approval chain as blocked
4. Marks args hash mismatch as blocked
5. Detects blocked steps from preview feedback

**ReplayExecutor tests:**
1. Executes dry-run file.read (reads pass through)
2. Executes dry-run file.create (simulated, no file written)
3. Executes dry-run shell.run (simulated, no command run)
4. Executes sandbox shell.run (real execution in temp dir)
5. Blocked step is skipped, not executed
6. PolicyGate deny blocks the step
7. Args hash mismatch blocks the step
8. Network tools return blocked in both modes
9. Replay events are emitted through EventLog
10. Temp sandbox dir is cleaned up after execution
11. Large replay outputs are truncated safely

**TUI tests:**
1. Replay result renders mode, step count, outcomes
2. Dry-run mode label in output
3. Blocked steps show block reason
4. Warning banner for replay vs original execution distinction

---

## 13. Files

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-plan.ts` | **NEW** | ReplayPlan type + builder |
| `src/runtime/replay-executor.ts` | **NEW** | ReplayExecutor class + wrappers |
| `src/runtime/replay-preview.ts` | MODIFY | Export traceChainContext for plan builder |
| `src/events/types.ts` | MODIFY | Add `REPLAY_EVENT_TYPES`, `Replay*Payload`, replay source |
| `src/runtime/trace-events.ts` | MODIFY | Add `"replay"` to TraceSourceType, add replay mapping in `toTraceEvent()` |
| `src/policy/policy-gate.ts` | MODIFY | Add `"replay"` to `ToolPolicyRequest.source` type |
| `src/tui/trace-detail.ts` | MODIFY | Add `renderReplayResult()` for execution output |
| `src/tui/panel-renderer.ts` | MODIFY | Add `"replay-result"` detail mode, wire execution |
| `src/tui/store.ts` | MODIFY | Add replay state (latest result, executing flag) |
| `src/cli/commands/tui.ts` | MODIFY | Add `x` shortcut, `/replay` command, confirmation flow |
| `tests/runtime/replay-plan.test.ts` | **NEW** | Plan building tests |
| `tests/runtime/replay-executor.test.ts` | **NEW** | Execution tests |
| `tests/tui/replay-execution-detail.test.ts` | **NEW** | Result rendering tests |

---

## 14. Acceptance criteria

1. `/replay selected --dry-run` builds a plan and executes it without side effects
2. File reads in dry-run mode produce real output; file writes produce `[DRY-RUN]` output
3. Shell commands in dry-run mode show `[DRY-RUN] Would run:` without executing
4. Shell commands in sandbox mode execute in an isolated temp directory
5. Network tools (`mcp.*`, `web_search`, `web_fetch`, `delegate`) are blocked in both modes
6. PolicyGate re-check blocks steps where current policy denies the capability
7. Args hash mismatch blocks individual steps
8. Denied approval chains remain blocked
9. `replay.*` events appear in the Trace timeline
10. Replay results are clearly marked as replay output (not original execution)
11. `x` key with confirmation triggers replay from the drilldown panel
12. Temp sandbox directory is cleaned up after each sandbox execution
13. All existing tests continue to pass (390+ tests, no regressions)
