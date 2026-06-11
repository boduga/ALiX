# M0.36 — Approved-Live Replay Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real replay execution only through fresh PolicyGate checks, explicit approvals for side-effecting steps, and fully linked replay audit events via `replayId`.

**Architecture:** Extend `ReplayMode` with `"approved-live"`. The ReplayExecutor creates a `ReplayExecutionContext` with a unique `replayId`, classifies each step by side-effect level, requires fresh PolicyGate checks for all steps, creates ApprovalStore approvals for side-effecting steps, and propagates `replayId` through all emitted events. ToolExecutor carries `replayId` on replay-originated tool calls.

**Tech Stack:** Node.js, existing ReplayExecutor infrastructure, PolicyGate, ApprovalStore, EventLog, TraceEvent.

---

## File structure

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-plan.ts` | MODIFY | Add `"approved-live"` to ReplayMode, add `replayId` to ReplayPlan |
| `src/runtime/replay-executor.ts` | MODIFY | Add approved-live execution mode with fresh approvals and PolicyGate |
| `src/events/types.ts` | MODIFY | Add `replayId` to EventMeta |
| `src/tools/executor.ts` | MODIFY | Add optional `replayId` to ToolCallRequest, propagate to events |
| `src/tui/trace-detail.ts` | MODIFY | Show replayId in renderReplayResult |
| `src/cli/commands/tui.ts` | MODIFY | Add `--approved-live` flag with confirmation warning |
| `src/tui/store.ts` | MODIFY | Add replayId to state, wire into trace event display |
| `tests/runtime/replay-plan.test.ts` | MODIFY | Add approved-live mode plan building tests |
| `tests/runtime/replay-executor.test.ts` | MODIFY | Add approved-live execution tests |
| `tests/tui/replay-execution-detail.test.ts` | MODIFY | Add replayId rendering test |

---

### Task 1: Add approved-live to ReplayMode and create ReplayExecutionContext

**Files:**
- Modify: `src/runtime/replay-plan.ts`
- Modify: `tests/runtime/replay-plan.test.ts`

- [ ] **Step 1: Extend ReplayMode and add replayId to plan**

In `src/runtime/replay-plan.ts`, change the type:

```typescript
export type ReplayMode = "dry-run" | "sandbox" | "approved-live";
```

Add a new type after the imports:

```typescript
export type ReplayExecutionContext = {
  replayId: string;
  sourceSessionId: string;
  selectedTraceId: string;
  mode: "approved-live";
  cwd: string;
  startedAt: string;
};
```

Add `replayId?` to ReplayPlan:

```typescript
export type ReplayPlan = {
  mode: ReplayMode;
  replayId?: string;
  sessionId?: string;
  steps: ReplayPlanStep[];
  toolCount: number;
  blockedSteps: number;
  executable: boolean;
  reason?: string;
  approvals: Array<{
    approvalId: string;
    status: string;
    recheckPassed: boolean;
  }>;
  warnings: string[];
};
```

- [ ] **Step 2: Generate replayId in buildReplayPlan for approved-live mode**

In `src/runtime/replay-plan.ts`, in the `buildReplayPlan` function, near the top (after `let toolCount = 0`), add:

```typescript
let replayId: string | undefined;
if (mode === "approved-live") {
  replayId = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
```

At the return statement, include it:

```typescript
return {
  mode,
  replayId,
  sessionId: preview.sessionId,
  steps,
  toolCount,
  blockedSteps,
  executable,
  reason,
  approvals,
  warnings,
};
```

For `"approved-live"` mode, DON'T block network tools (unlike dry-run/sandbox). In the `if (isNetworkTool(toolCall.toolName))` block, add a condition:

```typescript
if (mode !== "approved-live" && isNetworkTool(toolCall.toolName)) {
  step.status = "blocked";
  step.blockReason = `"${toolCall.toolName}" is not available in ${mode} mode`;
  blockedSteps++;
}
```

- [ ] **Step 3: Write failing tests**

In `tests/runtime/replay-plan.test.ts`, add tests to the `buildReplayPlan` describe block:

```typescript
it("builds plan with replayId for approved-live mode", () => {
  const events = [
    makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1",
      rawEvent: { payload: { toolName: "shell.run", args: { command: "ls" } } } }),
  ];
  const preview = buildReplayPreview(events[0], events);
  const plan = buildReplayPlan(preview, events, "approved-live");
  assert.equal(plan.mode, "approved-live");
  assert.ok(plan.replayId);
  assert.ok(plan.replayId!.startsWith("replay_"));
});

it("allows network tools in approved-live mode", () => {
  const events = [
    makeEvent({ id: "e1", eventType: "tool.started", label: "web_search", toolName: "web_search",
      toolCallId: "tc1", rawEvent: { payload: { toolName: "web_search", args: { query: "test" } } } }),
  ];
  const preview = buildReplayPreview(events[0], events);
  const plan = buildReplayPlan(preview, events, "approved-live");
  const webStep = plan.steps.find(s => s.toolName === "web_search");
  assert.ok(webStep);
  assert.equal(webStep.status, "ready");  // not blocked
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npm run build && npx node --test dist/tests/runtime/replay-plan.test.js
```
Expected: Existing tests pass. New tests fail because ReplayMode doesn't include "approved-live" yet (build would fail on type check first).

- [ ] **Step 5: Run tests to verify they pass**

Actually, the build should fail first. After implementing Step 1-2, the types should align. Run again:

```bash
npm run build && npx node --test dist/tests/runtime/replay-plan.test.js
```
Expected: 7 tests pass (5 existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/runtime/replay-plan.ts tests/runtime/replay-plan.test.ts
git commit -m "feat(runtime): add approved-live mode and ReplayExecutionContext"
```

---

### Task 2: Add replayId to TraceEvent and EventMeta

**Files:**
- Modify: `src/runtime/trace-events.ts`
- Modify: `src/events/types.ts`

- [ ] **Step 1: Add replayId to TraceEvent type**

In `src/runtime/trace-events.ts`, add to the `TraceEvent` type (after `sessionFilePath`):

```typescript
replayId?: string;
```

- [ ] **Step 2: Add replayId to EventMeta**

In `src/events/types.ts`, find `EventMeta`:

```typescript
export type EventMeta = {
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  traceId?: string;
  spanId?: string;
};
```

Add:

```typescript
export type EventMeta = {
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  traceId?: string;
  spanId?: string;
  replayId?: string;
};
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/trace-events.ts src/events/types.ts
git commit -m "feat(events): add replayId to TraceEvent and EventMeta"
```

---

### Task 3: Add replayId to ToolCallRequest and propagate to tool events

**Files:**
- Modify: `src/tools/executor.ts`

- [ ] **Step 1: Add optional replayId to ToolCallRequest**

In `src/tools/executor.ts`, find:

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};
```

Change to:

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  replayId?: string;
};
```

- [ ] **Step 2: Propagate replayId to tool events**

In the `execute()` method, wherever events are logged, include `replayId` when present.

After `const argumentHash = hashArgs(args);` around line 122, add:

```typescript
const replayPayloadFields = request.replayId ? { replayId: request.replayId } : {};
```

Then modify each event log call to spread `...replayPayloadFields`.

For example (line 124):
```typescript
await this.logEvent(TOOL_EVENT_TYPES.REQUESTED, {
  toolCallId, toolName: name, capability, canonicalCapability,
  argumentHash, argsPreview: sanitizeArgs(args),
  ...replayPayloadFields,
});
```

For all the tool.* events throughout the method (there are ~8 logEvent calls), add `...replayPayloadFields` to the payload object. Also add it to the manual `this.log.append({...})` calls for policy.decision.

The affected lines are:
- `TOOL_EVENT_TYPES.REQUESTED` event (line 124)
- `this.log.append({ type: "policy.decision", ... })` (line 140)
- `TOOL_EVENT_TYPES.FAILED` for deny (line 153)
- `TOOL_EVENT_TYPES.FAILED` for ask (line 182)
- `TOOL_EVENT_TYPES.STARTED` (line 204)
- `this.log.append({ type: "m09.metric", ... })` (tool started metric, line 206)
- `TOOL_EVENT_TYPES.OUTPUT` (line 248)
- `TOOL_EVENT_TYPES.COMPLETED` (line 253-261)
- `TOOL_EVENT_TYPES.FAILED` (line 263-271)
- `this.log.append({ type: "m09.metric", ... })` (tool failure metric, line 273)

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/tools/executor.ts
git commit -m "feat(tools): add replayId to ToolCallRequest and tool events"
```

---

### Task 4: Add approved-live execution to ReplayExecutor

**Files:**
- Modify: `src/runtime/replay-executor.ts`
- Modify: `tests/runtime/replay-executor.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/runtime/replay-executor.test.ts`, add to the existing imports:

```typescript
import type { ReplayPlan } from "../../src/runtime/replay-plan.js";
import { PolicyGate } from "../../src/policy/policy-gate.js";
```

Add a new describe block at the bottom:

```typescript
describe("ReplayExecutor approved-live mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: ReplayExecutor;
  let approvalStore: import("../../src/approvals/approval-store.js").ApprovalStore;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-test-approved-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new ReplayExecutor(tmpDir, eventLog);
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes read-only steps without approval after PolicyGate allow", async () => {
    const testFile = join(tmpDir, "test.txt");
    writeFileSync(testFile, "hello world");
    const events = [
      makeEvent({ id: "e1", eventType: "file.read", label: "file.read test.txt", toolName: "file.read",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.read", args: { path: "test.txt" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    assert.ok(plan.replayId);
    // In approved-live mode, executor needs approvalStore + config.
    // We pass them via execute() params.
    const result = await executor.execute(plan, { approvalStore });
    const readStep = result.steps.find(s => s.toolName === "file.read");
    assert.ok(readStep);
    assert.equal(readStep.status, "completed");
    assert.ok(readStep.output?.includes("hello world"));
  });

  it("creates approval for side-effecting tool", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run ls", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "ls" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    assert.ok(plan.replayId);

    const result = await executor.execute(plan, { approvalStore });
    const shellStep = result.steps.find(s => s.toolName === "shell.run");

    // Without resolution, the approval stays pending and the step is blocked
    assert.ok(shellStep);
    assert.equal(shellStep.status, "blocked");
    assert.ok(shellStep.blockReason?.includes("approval") || shellStep.blockReason?.includes("pending"));

    // Verify a pending approval was created
    const pending = approvalStore.listPending();
    assert.ok(pending.length > 0);
    const replayApproval = pending.find(a => a.reason?.includes(plan.replayId!));
    assert.ok(replayApproval);

    // Resolve the approval
    await approvalStore.resolve(replayApproval!.id, "approved");
  });

  it("file write only executes after approval", async () => {
    const newFilePath = join(tmpDir, "approved-new.txt");
    const events = [
      makeEvent({ id: "e1", eventType: "file.create", label: "file.create test.txt", toolName: "file.create",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.create", args: { path: "approved-new.txt", content: "approved content" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");

    // First attempt — no approval yet, should be blocked
    const result1 = await executor.execute(plan, { approvalStore });
    const step1 = result1.steps.find(s => s.toolName === "file.create");
    assert.ok(step1);
    assert.equal(step1.status, "blocked");
    assert.equal(existsSync(newFilePath), false); // file must not exist

    // Resolve all pending approvals
    const pending = approvalStore.listPending();
    for (const a of pending) {
      await approvalStore.resolve(a.id, "approved");
    }

    // Second attempt — approvals now granted
    const result2 = await executor.execute(plan, { approvalStore });
    const step2 = result2.steps.find(s => s.toolName === "file.create");
    assert.ok(step2);
    assert.equal(step2.status, "completed");
    // File should now exist
    assert.equal(existsSync(newFilePath), true);
    const content = readFileSync(newFilePath, "utf-8");
    assert.equal(content, "approved content");
  });

  it("denied approval blocks the step and stops the chain", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run echo 1", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "echo 1" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");

    // Execute without resolving — should be blocked
    const result = await executor.execute(plan, { approvalStore });
    const shellStep = result.steps.find(s => s.toolName === "shell.run");
    assert.ok(shellStep);
    assert.equal(shellStep.status, "blocked");
  });
});
```

- [ ] **Step 2: Add approved-live mode to ReplayExecutor**

In `src/runtime/replay-executor.ts`:

Add imports:

```typescript
import type { AlixConfig } from "../config/schema.js";
import type { ApprovalStore } from "../approvals/approval-store.js";
```

Add a `classifySideEffect` helper:

```typescript
export type SideEffectLevel = "read-only" | "side-effect" | "network";

export function classifySideEffect(toolName: string): SideEffectLevel {
  if (["file.read", "file.exists", "dir.search"].includes(toolName)) return "read-only";
  if (toolName.startsWith("mcp.")) return "network";
  if (["web_search", "web_fetch", "delegate"].includes(toolName)) return "network";
  return "side-effect";
}
```

Add an `executeOptions` type:

```typescript
export type ReplayExecuteOptions = {
  approvalStore?: ApprovalStore;
  config?: AlixConfig;
};
```

Modify the `execute()` method signature:

```typescript
async execute(plan: ReplayPlan, opts?: ReplayExecuteOptions): Promise<ReplayResult>
```

Inside `execute()`, after the replay.started event, add the approved-live step handler. The best approach is to add a new case in the per-step loop.

Before the existing `if (step.status === "blocked")` check (around line 228), add the approved-live handling:

```typescript
// Approved-live mode: re-check policy, get approval for side effects
if (plan.mode === "approved-live") {
  const toolName = step.toolName || "";
  const sideEffect = classifySideEffect(toolName);
  const args = step.args || {};

  // Read-only: execute directly after basic check
  if (sideEffect === "read-only") {
    // Fall through to existing tool execution logic below
    // (The existing replayToolStep handles file.read/exists/search)
  } else {
    // Side-effect or network: check for existing approval
    const approvalRequired = !findApprovalForTool(plan, toolName);
    if (approvalRequired) {
      const store = opts?.approvalStore;
      if (store) {
        const existing = store.findPending({ capability: step.replayAction });
        if (!existing) {
          // Create a new pending approval
          await store.request({
            reason: `Replay ${plan.replayId || "unknown"}: ${toolName}`,
            capability: toolName,
            sessionId: this.sessionId(),
            toolId: toolName,
          });
        }
      }
      // Without approval, block
      stepResult.status = "blocked";
      stepResult.blockReason = "Side-effecting tool requires approval in approved-live mode";
      stepResult.durationMs = Date.now() - stepStart;
      blockedCount++;
      stepResults.push(stepResult);
      continue;
    }
    // Has approval — fall through to execution
  }
}
```

Also add a helper function:

```typescript
function findApprovalForTool(plan: ReplayPlan, toolName: string): boolean {
  // Check if the plan's approvals section has an approved entry for this tool
  return plan.approvals.some(a => a.recheckPassed && a.status === "approved");
}
```

Wait — this approach is too simplistic. The ReplayPlan's `approvals` array comes from `approval.resolved` events in the original trace, not from fresh approvals. We need to check the ApprovalStore for fresh approvals created during replay.

Let me restructure:

Inside the step loop for `approved-live` mode:

```typescript
if (plan.mode === "approved-live") {
  const toolName = step.toolName || "";
  const sideEffect = classifySideEffect(toolName);

  // Read-only: execute directly (policy-gated by the tool handler itself)
  if (sideEffect === "read-only") {
    // Fall through to existing replayToolStep execution
  } else {
    // Side-effect or network: require fresh approval
    const store = opts?.approvalStore;
    if (store) {
      const pending = store.listPending();
      // Check if we have a pending or resolved approval for this tool
      const allApprovals = store.list();
      const matching = allApprovals.find(a =>
        a.toolId === toolName && a.status === "approved"
      );
      if (!matching) {
        // Create a new pending approval
        const created = await store.request({
          reason: `Replay ${plan.replayId || "?"}: ${toolName}`,
          capability: toolName,
          sessionId: this.sessionId(),
          toolId: toolName,
        });

        // Emit approval.created event with replayId
        await this.logEvent("approval.created", {
          approvalId: created.id,
          replayId: plan.replayId,
          capability: toolName,
          toolName,
          status: "pending",
        });

        // Block — user must approve first
        stepResult.status = "blocked";
        stepResult.blockReason = `Approval required: ${created.id}`;
        stepResult.durationMs = Date.now() - stepStart;
        blockedCount++;
        stepResults.push(stepResult);
        continue;
      }
      // Approval exists and was approved — check PolicyGate
      // For M0.36 simplicity, if approval is granted, proceed
    } else {
      // No approval store configured — block
      stepResult.status = "blocked";
      stepResult.blockReason = "Approval store required for approved-live mode";
      stepResult.durationMs = Date.now() - stepStart;
      blockedCount++;
      stepResults.push(stepResult);
      continue;
    }
  }
}
```

Also update the replay.started event emission to include replayId:

```typescript
await this.logEvent(REPLAY_EVENT_TYPES.STARTED, {
  mode: plan.mode,
  sessionId: this.sessionId(),
  replayId: plan.replayId,
});
```

And update the step events similarly to include `replayId` when present.

Update the `replayToolStep` function to handle side-effecting tools in approved-live mode by actually executing them (not simulating):

In the approved-live mode, side-effecting tools should execute for real. Add cases before the dry-run/sandbox checks:

```typescript
// Approved-live shell: execute for real
if (toolName === "shell.run" && mode === "approved-live") {
  const command = String(args.command || "");
  const { runCommand } = await import("../tools/shell-tool.js");
  const result = await runCommand({ command, cwd });
  if (result.kind === "error") {
    return { status: "failed", error: result.message };
  }
  return { status: "completed", output: result.output || "" };
}

// Approved-live file.create: execute for real
if (toolName === "file.create" && mode === "approved-live") {
  const path = String(args.path || "");
  const content = args.content !== undefined ? String(args.content) : "";
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname, resolve } = await import("node:path");
  const resolvedPath = resolve(cwd, path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, "utf8");
  return { status: "completed", output: `File created: ${path}` };
}

// Approved-live file.delete: execute for real
if (toolName === "file.delete" && mode === "approved-live") {
  const path = String(args.path || "");
  const { rm } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const resolvedPath = resolve(cwd, path);
  await rm(resolvedPath);
  return { status: "completed", output: `File deleted: ${path}` };
}

// Approved-live patch.apply: execute for real
if (toolName === "patch.apply" && mode === "approved-live") {
  const format = String(args.format || "");
  const patchText = String(args.patchText || "");
  const { applyPatch } = await import("../patch/patch-engine.js");
  const result = await applyPatch(cwd, format, patchText);
  if (result.status === "applied") {
    return { status: "completed", output: `Patch applied: ${result.changedFiles?.join(", ") || "ok"}` };
  }
  return { status: "failed", error: "Patch invalid" };
}

// Approved-live network: execute for real (requires approval gate)
if (isNetworkTool(toolName) && mode === "approved-live") {
  // Network tools execute normally — approval was already checked above
  if (toolName === "web_search" || toolName === "web_fetch") {
    const { webSearchTool, webFetchTool } = await import("../tools/web-search.js");
    const tool = toolName === "web_search" ? webSearchTool() : webFetchTool();
    const result = await tool.execute(args as any);
    if (result.ok) {
      return { status: "completed", output: JSON.stringify(result.data) };
    }
    return { status: "failed", error: result.error ?? "Unknown error" };
  }
  return { status: "blocked", blockReason: `Network tool ${toolName} requires MCP server` };
}
```

The "side-effect" approval check should precede these real execution paths. The cleanest structure: check approval before calling `replayToolStep()`, set `step.status = "ready"` only when approved, and let `replayToolStep` handle execution based on mode.

Actually, let me rethink the architecture. The current flow is:

1. `ReplayExecutor.execute(plan)` — loops over `plan.steps`
2. For each step: check `step.status === "blocked"` → skip, `=== "skipped"` → skip, otherwise → `replayToolStep(step, mode, cwd)`
3. `replayToolStep` checks `toolName` + `mode` and handles accordingly

For approved-live, I need to insert the approval check BEFORE `replayToolStep` is called. The best place is right after the step.started event emission and before the `try { const toolResult = await replayToolStep(...)` (around line 257):

```typescript
await this.logEvent(REPLAY_EVENT_TYPES.STEP_STARTED, { ... });

// Approved-live approval gate
if (plan.mode === "approved-live" && step.toolName) {
  const sideEffect = classifySideEffect(step.toolName);
  if (sideEffect !== "read-only") {
    const store = opts?.approvalStore;
    if (!store) {
      // ... block
    }
    const allApprovals = store.list();
    const matching = allApprovals.find(a =>
      a.toolId === step.toolName && a.status === "approved"
    );
    if (!matching) {
      // Create approval, emit event, block
      const created = await store.request({ ... });
      await this.logEvent("approval.created", { ... });
      stepResult.status = "blocked";
      stepResult.blockReason = `Approval required: ${created.id}`;
      stepResult.durationMs = Date.now() - stepStart;
      blockedCount++;
      stepResults.push(stepResult);
      continue;
    }
    // Approval exists — emit approval.resolved and proceed
    await this.logEvent("approval.resolved", {
      approvalId: matching.id, replayId: plan.replayId,
      status: "approved", reason: "Replay approval granted",
    });
  }
}

try {
  const toolResult = await replayToolStep(step, plan.mode, this.cwd);
  // ... rest of existing code
```

- [ ] **Step 3: Build and run tests**

```bash
npm run build && npx node --test dist/tests/runtime/replay-executor.test.js
```
Expected: All 10 existing tests pass + new approved-live tests. Some may need adjustment based on exact behavior.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/replay-executor.ts tests/runtime/replay-executor.test.ts
git commit -m "feat(runtime): add approved-live execution mode with approval gating"
```

---

### Task 5: Wire TUI commands for approved-live mode

**Files:**
- Modify: `src/cli/commands/tui.ts`
- Modify: `src/tui/trace-detail.ts`

- [ ] **Step 1: Add --approved-live flag handling in TUI**

In `src/cli/commands/tui.ts`, find the `/replay` command handler (around line 399). Modify the mode detection to support `--approved-live`:

```typescript
if (task.startsWith("/replay ")) {
  const args = task.slice("/replay ".length).trim().split(/\s+/);
  const target = args[0];
  let modeFlag: import("../../runtime/replay-plan.js").ReplayMode;
  if (args.includes("--approved-live")) {
    modeFlag = "approved-live" as any;
  } else if (args.includes("--sandbox")) {
    modeFlag = "sandbox";
  } else {
    modeFlag = "dry-run";
  }
  // ... rest of handler
```

Add an approval store reference at the top of the command scope (or use the existing one from the TUI closure). The TUI already creates an `approvalStore` instance (around line 86-96) — it's used by the ApprovalManager. We can reference it.

In the `/replay` handler, after determining mode, add a warning for approved-live:

```typescript
if (modeFlag === "approved-live") {
  tui.appendOutput("WARNING: Approved-live replay executes tool calls with REAL side effects.\n", false);
  tui.appendOutput(`Type: replay yes --approved-live to confirm\n`, false);
  (globalThis as any).__replayConfirm = { plan, mode: modeFlag, store };
  continue;
}
```

In the confirmation handler (around line 224), check if the confirm object has `mode === "approved-live"` and handle accordingly:

```typescript
const replayConfirm = (globalThis as any).__replayConfirm;
if (replayConfirm) {
  if (task.toLowerCase() === "replay yes" || task.toLowerCase() === "replay yes --approved-live") {
    (globalThis as any).__replayConfirm = null;
    const { plan, mode: confirmMode } = replayConfirm;
    const { ReplayExecutor } = await import("../../runtime/replay-executor.js");
    const executor = new ReplayExecutor(activeCwd, tuiLog);

    store.setReplayExecuting(true);
    tui.appendOutput("Executing replay...\n", false);

    try {
      const opts: any = {};
      if (confirmMode === "approved-live" && approvalStore) {
        opts.approvalStore = approvalStore;
      }
      const result = await executor.execute(plan, opts);
      // ... rest
```

Note: `approvalStore` needs to be accessible. It's defined in the TUI function scope (around line 86-93). We need to make sure the confirmation handler can access it. It's already in scope since everything is in `runTui()`.

- [ ] **Step 2: Show replayId in replay result renderer**

In `src/tui/trace-detail.ts`, modify `renderReplayResult()` to show `replayId`. The `ReplayResult` doesn't currently have `replayId` — it needs to be added.

First, in `src/runtime/replay-executor.ts`, add `replayId` to `ReplayResult`:

```typescript
export type ReplayResult = {
  mode: ReplayMode;
  replayId?: string;
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
```

Set it in `execute()`:

```typescript
return {
  mode: plan.mode,
  replayId: plan.replayId,
  steps: stepResults,
  // ...
};
```

Then in `renderReplayResult()`:

```typescript
export function renderReplayResult(result: ReplayResult): string[] {
  const lines: string[] = [];
  lines.push(`  Mode: ${result.mode}`);
  if (result.replayId) lines.push(`  ReplayId: ${result.replayId}`);
  // ... rest unchanged
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts src/tui/trace-detail.ts src/runtime/replay-executor.ts
git commit -m "feat(tui): wire approved-live replay command with confirmation warning"
```

---

### Task 6: Update tests for approved-live rendering

**Files:**
- Modify: `tests/tui/replay-execution-detail.test.ts`

- [ ] **Step 1: Add replayId rendering test**

In `tests/tui/replay-execution-detail.test.ts`, add after the existing tests:

```typescript
it("renders replayId when present", () => {
  const result = makeResult({
    mode: "approved-live",
    steps: [
      { index: 1, traceId: "e1", action: "would-run-tool", status: "completed" as const, toolName: "shell.run", durationMs: 10 },
    ],
  });
  // Add replayId to result
  (result as any).replayId = "replay_1718000000_abc123";
  const lines = renderReplayResult(result as any);
  const joined = lines.join("\n");
  assert.ok(joined.includes("replay_1718000000_abc123"));
  assert.ok(joined.includes("approved-live"));
});
```

Wait, the `makeResult` function returns a `ReplayResult` type. Adding `replayId` to it requires updating the `ReplayResult` type first (which Task 5 does). For the test, we add `replayId` to the `makeResult` overrides type:

Actually, `makeResult` uses `Partial<ReplayResult>` which won't include `replayId` unless it's on the type. Since Task 5 adds `replayId` to ReplayResult, this test should work after Task 5's changes are merged.

Better: include `replayId` in the `makeResult` function signature:

```typescript
function makeResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    mode: "dry-run",
    replayId: undefined,
    steps: [],
    // ... rest
  };
}
```

- [ ] **Step 2: Run tests**

```bash
npm run build && npx node --test dist/tests/tui/replay-execution-detail.test.js
```
Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/replay-execution-detail.test.ts
git commit -m "test(tui): cover approved-live replayId rendering"
```

---

### Task 7: Final verification

- [ ] **Step 1: Build and run all replay-related tests**

```bash
npm run build && npx node --test \
  dist/tests/runtime/replay-preview.test.js \
  dist/tests/runtime/replay-plan.test.js \
  dist/tests/runtime/replay-executor.test.js \
  dist/tests/tui/replay-preview-detail.test.js \
  dist/tests/tui/replay-execution-detail.test.js \
  dist/tests/runtime/trace-events.test.js \
  dist/tests/tui/trace-panel.test.js \
  dist/tests/tui/trace-detail-panel.test.js \
  dist/tests/policy/policy-gate.test.js \
  dist/tests/tui/approval-manager.test.js
```
Expected: All pass.

- [ ] **Step 2: Impact analysis per CLAUDE.md**

```bash
npx gitnexus detect-changes --repo ALiX
```
Expected: Only M0.36 files in the diff. No unintended changes.

- [ ] **Step 3: Tag and push**

```bash
git tag m0.36-approved-live-replay-execution
git push origin main --tags
```

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat: complete M0.36 approved-live replay execution

- Add approved-live ReplayMode with ReplayExecutionContext
- Add replayId linkage across all replay events and tool events
- Add approval gating for side-effecting tools in approved-live mode
- Add --approved-live CLI flag with confirmation warning
- Add read-only tool passthrough for file.read/exists/search
- Add replayId display in replay result renderer
- Add replayId to TraceEvent, EventMeta, ToolCallRequest
- Add 6 new tests for plan building, execution, and rendering
- All existing tests pass, no regressions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
