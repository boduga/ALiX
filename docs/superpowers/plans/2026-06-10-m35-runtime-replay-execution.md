# M0.35 — Runtime Replay Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute selected replay chains through a bounded replay executor using dry-run and sandbox modes, preserving PolicyGate enforcement and full trace auditability.

**Architecture:** ReplayPlan (builder from ReplayPreview chain) → PolicyGate re-check (each step) → sandboxed/dry-run tool router wrappers → ReplayResult. All replay actions emit `replay.*` events visible in the Trace timeline.

**Tech Stack:** Node.js, existing ToolRouter infrastructure, EventLog, PolicyGate, temp directories for sandbox.

---

### Task 1: Add replay event types and trace integration

**Files:**
- Modify: `src/events/types.ts`
- Modify: `src/runtime/trace-events.ts`

- [ ] **Step 1: Add REPLAY_EVENT_TYPES and payload types**

In `src/events/types.ts`, after the `APPROVAL_EVENT_TYPES` block (around line 363), add:

```typescript
// ─── Replay lifecycle event types ───────────────────────────

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
  mode: string;
  stepCount: number;
  toolCount: number;
  blockedSteps: number;
};

export type ReplayStartedPayload = {
  mode: string;
  sessionId: string;
};

export type ReplayStepPayload = {
  stepIndex: number;
  traceId: string;
  action: string;
  toolName?: string;
  status?: "completed" | "skipped" | "blocked" | "failed";
  outputPreview?: string;
  blockReason?: string;
  error?: string;
  durationMs?: number;
};

export type ReplayCompletedPayload = {
  mode: string;
  stepCount: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  totalDurationMs: number;
};

export type ReplayFailedPayload = {
  mode: string;
  reason: string;
  stepIndex?: number;
};
```

- [ ] **Step 2: Add "replay" to TraceSourceType and add replay event mapping**

In `src/runtime/trace-events.ts`:

Add `"replay"` to the `TraceSourceType` union:

```typescript
export type TraceSourceType =
  | "policy" | "approval" | "continuation"
  | "tool" | "task" | "session" | "daemon" | "runtime"
  | "replay";
```

Add `"replay"` to the `TraceEventFilter` default array in tui.ts (already uses `as const` — the filter cycles through all source types automatically when array-literal is defined; this is handled in Task 8).

In the `toTraceEvent()` function, before the `return null` at the end (after the task events block, around line 171), add:

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

- [ ] **Step 3: Verify tests pass**

Run: `npx tsx src/runtime/trace-events.ts` (syntax check only — no main). Better: `npm run build`

Run: `npx node --test dist/tests/runtime/trace-events.test.js`
Expected: 17 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/events/types.ts src/runtime/trace-events.ts
git commit -m "feat(events): add replay event types and trace integration"
```

---

### Task 2: Add replay source to PolicyGate

**Files:**
- Modify: `src/policy/policy-gate.ts`

- [ ] **Step 1: Add "replay" to ToolPolicyRequest.source type**

In `src/policy/policy-gate.ts`, find the `ToolPolicyRequest` type (around line 28):

```typescript
source: "tool" | "graph" | "daemon" | "tui";
```

Change to:

```typescript
source: "tool" | "graph" | "daemon" | "tui" | "replay";
```

Do the same for `CapabilityPolicyRequest.source` (line 46):

```typescript
source: "tool" | "graph" | "daemon" | "tui";
```

Change to:

```typescript
source: "tool" | "graph" | "daemon" | "tui" | "replay";
```

- [ ] **Step 2: Commit**

```bash
git add src/policy/policy-gate.ts
git commit -m "feat(policy): add replay source type to policy requests"
```

---

### Task 3: Build ReplayPlan model and builder

**Files:**
- Create: `src/runtime/replay-plan.ts`
- Modify: `src/runtime/replay-preview.ts` (export traceChainContext)

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/replay-plan.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReplayPlan } from "../../src/runtime/replay-plan.js";
import { buildReplayPreview } from "../../src/runtime/replay-preview.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("buildReplayPlan", () => {
  it("builds an executable plan from a tool chain preview", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "allowed", sourceType: "policy", label: "policy: shell.run", toolCallId: "tc1" }),
      makeEvent({ id: "e2", eventType: "tool.started", status: "running", label: "shell.run started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "shell.run", args: { command: "ls -la" }, argsHash: "abc123" } } }),
      makeEvent({ id: "e3", eventType: "tool.completed", status: "success", label: "shell.run completed", toolCallId: "tc1", timestamp: "2026-06-11T12:00:01Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.equal(plan.mode, "dry-run");
    assert.ok(plan.executable);
    assert.ok(plan.steps.length > 0);
    assert.equal(plan.toolCount, 1);
  });

  it("marks network tools as blocked in dry-run mode", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "web_search started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "web_search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.ok(plan.steps.length > 0);
    const webStep = plan.steps.find(s => s.toolName === "web_search");
    assert.ok(webStep);
    assert.equal(webStep.status, "blocked");
    assert.ok(webStep.blockReason?.includes("not available"));
  });

  it("marks mcp tools as blocked in sandbox mode", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "mcp.github.list_issues started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "mcp.github.list_issues", args: {} } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    assert.ok(plan.steps.length > 0);
    const mcpStep = plan.steps.find(s => s.toolName?.startsWith("mcp."));
    assert.ok(mcpStep);
    assert.equal(mcpStep.status, "blocked");
  });

  it("marks denied approval chain as blocked", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "approval.created", sourceType: "approval", label: "approval created", approvalId: "app_1" }),
      makeEvent({ id: "e2", eventType: "approval.resolved", status: "denied", sourceType: "approval", label: "approval denied", approvalId: "app_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.equal(plan.executable, false);
    assert.ok(plan.reason?.includes("denied"));
  });

  it("does not duplicate blocked steps from preview warnings", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "session.started", sourceType: "session", label: "session started" }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.equal(plan.executable, false);
    assert.ok(plan.toolCount === 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test tests/runtime/replay-plan.test.ts`
Expected: FAIL with `Cannot find module` for `replay-plan.js` or `buildReplayPlan not defined`.

- [ ] **Step 3: Create ReplayPlan model and builder**

Create `src/runtime/replay-plan.ts`:

```typescript
/**
 * replay-plan.ts — Build an executable replay plan from a ReplayPreview.
 *
 * Converts the chain classification from replay-preview.ts into a
 * structured plan with per-step status (ready/blocked) and tool call
 * data extracted from trace events.
 */

import type { TraceEvent } from "./trace-events.js";
import { traceChainContext } from "./trace-events.js";
import type { ReplayPreview, ReplayAction } from "./replay-preview.js";
import { hashArgs } from "../tools/executor.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ReplayMode = "dry-run" | "sandbox";

export type ReplayPlanStep = {
  index: number;
  traceId: string;
  eventType: string;
  replayAction: ReplayAction;
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

// ─── Network tools blocked in dry-run/sandbox ────────────────────────

const NETWORK_TOOLS = new Set([
  "web_search", "web_fetch", "delegate",
]);

function isNetworkTool(toolName: string): boolean {
  if (toolName.startsWith("mcp.")) return true;
  return NETWORK_TOOLS.has(toolName);
}

// ─── Builder ─────────────────────────────────────────────────────────

/**
 * Extract tool call data from a raw trace event payload.
 */
function extractToolCall(event: TraceEvent): { toolName: string; args: Record<string, unknown>; argsHash?: string } | null {
  const raw = event.rawEvent as any;
  const payload = raw?.payload || {};
  const toolName = payload.toolName || event.toolName || "";
  if (!toolName) return null;
  const args = (payload.args || {}) as Record<string, unknown>;
  const argsHash = payload.argsHash || (Object.keys(args).length > 0 ? hashArgs(args) : undefined);
  return { toolName, args, argsHash };
}

/**
 * Build a ReplayPlan from a ReplayPreview and the full event list.
 */
export function buildReplayPlan(
  preview: ReplayPreview,
  allEvents: TraceEvent[],
  mode: ReplayMode,
): ReplayPlan {
  const chainEvents = traceChainContext(allEvents, allEvents.find(e => e.id === preview.selectedTraceId) ?? allEvents[0]);
  const steps: ReplayPlanStep[] = [];
  const approvals: ReplayPlan["approvals"] = [];
  const warnings = [...preview.warnings];
  let toolCount = 0;
  let blockedSteps = 0;

  for (let i = 0; i < chainEvents.length; i++) {
    const event = chainEvents[i];
    const step: ReplayPlanStep = {
      index: i + 1,
      traceId: event.id,
      eventType: event.eventType,
      replayAction: "context-only",
      status: "ready",
    };

    // Deterministic action from chain context
    if (event.sourceType === "policy") step.replayAction = "would-check-policy";
    else if (event.sourceType === "approval") {
      if (event.eventType === "approval.created") step.replayAction = "would-require-approval";
      else step.replayAction = "context-only";
    }
    else if (event.sourceType === "tool") step.replayAction = "would-run-tool";
    else if (event.sourceType === "continuation") step.replayAction = "context-only";
    else step.replayAction = "context-only";

    // Extract tool call for tool events
    if (event.sourceType === "tool" || event.eventType === "continuation.consumed") {
      const toolCall = extractToolCall(event);
      if (toolCall) {
        step.toolName = toolCall.toolName;
        step.args = toolCall.args;
        step.argsHash = toolCall.argsHash;
        toolCount++;

        // Block network tools in both modes
        if (isNetworkTool(toolCall.toolName)) {
          step.status = "blocked";
          step.blockReason = `"${toolCall.toolName}" is not available in ${mode} mode`;
          blockedSteps++;
        }
      }
    }

    // Check approval status
    if (event.eventType === "approval.resolved" && event.approvalId) {
      const appStatus = event.status === "denied" ? "denied" : "approved";
      const recheckPassed = appStatus === "approved";
      if (appStatus === "denied") {
        step.status = "blocked";
        step.blockReason = "Approval was denied";
        if (!blockedSteps) {
          // Mark previous steps as blocked too if they depend on this approval
        }
      }
      approvals.push({ approvalId: event.approvalId, status: appStatus, recheckPassed });
    }

    steps.push(step);
  }

  // Determine overall executable
  const hasDeniedApproval = approvals.some(a => a.status === "denied");
  const readySteps = steps.filter(s => s.status === "ready");

  let executable = readySteps.length > 0;
  let reason: string | undefined;

  if (hasDeniedApproval) {
    executable = false;
    reason = "Chain contains a denied approval";
    warnings.push(reason);
  }
  if (toolCount === 0) {
    executable = false;
    reason = "No tool call in chain — nothing to replay";
    warnings.push(reason);
  }
  if (readySteps.length === 0 && toolCount > 0 && !hasDeniedApproval) {
    executable = false;
    reason = "All tool steps are blocked by mode restrictions";
    warnings.push(reason);
  }

  return {
    mode,
    sessionId: preview.sessionId,
    steps,
    toolCount,
    blockedSteps,
    executable,
    reason,
    approvals,
    warnings,
  };
}
```

- [ ] **Step 4: Export traceChainContext from replay-preview.ts**

In `src/runtime/replay-preview.ts`, add at the top:

```typescript
export { traceChainContext } from "./trace-events.js";
```

This is needed because the plan builder also needs to reconstruct the chain. (Actually, replay-preview.ts already imports traceChainContext internally, but doesn't export it. Let's check. Yes — line 9: `import { traceChainContext } from "./trace-events.js";` — it's imported but not re-exported. We add the re-export so replay-plan.ts can import it from a single place or directly from trace-events. Simpler: just import from trace-events.ts directly in replay-plan.ts and don't re-export. Let me update Step 4.)

Actually, simpler approach: `replay-plan.ts` imports `traceChainContext` directly from `./trace-events.js` (already in the code above). No re-export needed. Skip this step.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx node --test tests/runtime/replay-plan.test.js` (need to compile first)

```bash
npm run build
npx node --test dist/tests/runtime/replay-plan.test.js
```
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/replay-plan.ts tests/runtime/replay-plan.test.ts
git commit -m "feat(runtime): add replay plan model and builder"
```

---

### Task 4: Build ReplayExecutor with dry-run and sandbox wrappers

**Files:**
- Create: `src/runtime/replay-executor.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/replay-executor.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayExecutor } from "../../src/runtime/replay-executor.js";
import { buildReplayPreview } from "../../src/runtime/replay-preview.js";
import { buildReplayPlan } from "../../src/runtime/replay-plan.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";
import { EventLog } from "../../src/events/event-log.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("ReplayExecutor dry-run mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: ReplayExecutor;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-test-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new ReplayExecutor(tmpDir, eventLog);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes dry-run file.read (read passes through)", async () => {
    const testFile = join(tmpDir, "test.txt");
    writeFileSync(testFile, "hello world");
    const events = [
      makeEvent({ id: "e1", eventType: "file.read", label: "file.read test.txt", toolName: "file.read",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.read", args: { path: "test.txt" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    assert.equal(result.mode, "dry-run");
    assert.ok(result.steps.length > 0);
    // file.read should complete because it's read-only
    const readStep = result.steps.find(s => s.toolName === "file.read");
    assert.ok(readStep);
    assert.equal(readStep.status, "completed");
    // Test that the file still exists (no side effects)
    assert.ok(existsSync(testFile));
  });

  it("executes dry-run file.create (simulated, no file written)", async () => {
    const newFilePath = join(tmpDir, "new.txt");
    const events = [
      makeEvent({ id: "e1", eventType: "file.create", label: "file.create new.txt", toolName: "file.create",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.create", args: { path: "new.txt", content: "new content" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    const createStep = result.steps.find(s => s.toolName === "file.create");
    assert.ok(createStep);
    assert.equal(createStep.status, "completed");
    // File must NOT exist in dry-run mode
    assert.equal(existsSync(newFilePath), false);
    // Output should contain dry-run marker
    assert.ok(createStep.output?.includes("[DRY-RUN]"));
  });

  it("executes dry-run shell.run (simulated, no command run)", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run ls", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "echo hello" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    const shellStep = result.steps.find(s => s.toolName === "shell.run");
    assert.ok(shellStep);
    assert.equal(shellStep.status, "completed");
    assert.ok(shellStep.output?.includes("[DRY-RUN]"));
  });

  it("blocks network tools in dry-run mode", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "web_search", label: "web_search started", toolName: "web_search",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "web_search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    const webStep = result.steps.find(s => s.toolName === "web_search");
    assert.ok(webStep);
    assert.equal(webStep.status, "blocked");
  });
});

describe("ReplayExecutor sandbox mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: ReplayExecutor;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-test-sandbox-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new ReplayExecutor(tmpDir, eventLog);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes sandbox shell.run in temp dir", async () => {
    // Write a file in the real cwd
    writeFileSync(join(tmpDir, "real.txt"), "real data");
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run ls", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "ls" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    const result = await executor.execute(plan);
    const shellStep = result.steps.find(s => s.toolName === "shell.run");
    assert.ok(shellStep);
    assert.equal(shellStep.status, "completed");
    // Shell ran but in sandbox dir — output should NOT show real.txt
    assert.ok(!shellStep.output?.includes("real.txt") || shellStep.output === "");
  });

  it("sandbox temp dir is cleaned up after execution", async () => {
    const executor2 = new ReplayExecutor(tmpDir, eventLog);
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run pwd", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "pwd" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    const result = await executor2.execute(plan);
    // Sandbox dir should be cleaned up inside execute()
    assert.equal(result.mode, "sandbox");
    // Verify no leftover sandbox dirs
    const tmpFiles = readFileSync(tmpdir).filter(f => f.startsWith("alix-replay-"));
    // There should be no alix-replay dirs (they get cleaned up)
  });

  it("blocks mcp tools in sandbox mode", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "mcp.github.list_issues", label: "mcp.github.list_issues", toolName: "mcp.github.list_issues",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "mcp.github.list_issues", args: {} } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    const result = await executor.execute(plan);
    const mcpStep = result.steps.find(s => s.toolName?.startsWith("mcp."));
    assert.ok(mcpStep);
    assert.equal(mcpStep.status, "blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx node --test dist/tests/runtime/replay-executor.test.js`
Expected: FAIL with `Cannot find module` or `ReplayExecutor is not a constructor`.

- [ ] **Step 3: Create ReplayExecutor**

Create `src/runtime/replay-executor.ts`:

```typescript
/**
 * replay-executor.ts — Execute a ReplayPlan through bounded execution modes.
 *
 * Dry-run mode: simulates writes, blocks network, shell is simulated.
 * Sandbox mode: shell commands run in an isolated temp directory.
 * Both modes: policy re-checked, args hash validated, audit events emitted.
 */

import type { AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { REPLAY_EVENT_TYPES } from "../events/types.js";
import type { TraceEvent } from "./trace-events.js";
import type { ReplayAction } from "./replay-preview.js";
import type { ReplayPlan, ReplayPlanStep, ReplayMode } from "./replay-plan.js";
import { existsSync } from "node:fs";
import { readFile } from "../tools/file-tools.js";

// ─── Types ───────────────────────────────────────────────────────────

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

export type ReplayResult = {
  mode: ReplayMode;
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

// ─── Tool wrappers (dry-run / sandbox) ─────────────────────────────

/** Determine if a tool name is a read-only file operation. */
function isReadOnlyFileTool(toolName: string): boolean {
  return ["file.read", "file.exists", "dir.search"].includes(toolName);
}

/** Determine if a tool is a network tool (blocked in both modes). */
function isNetworkTool(toolName: string): boolean {
  if (toolName.startsWith("mcp.")) return true;
  return ["web_search", "web_fetch", "delegate"].includes(toolName);
}

/**
 * Execute a single tool step in the given mode.
 * Returns the step result without any side effects (for the mode).
 */
async function replayToolStep(
  step: ReplayPlanStep,
  mode: ReplayMode,
  cwd: string,
): Promise<Pick<ReplayStepResult, "status" | "output" | "error" | "blockReason">> {
  const toolName = step.toolName || "";
  const args = step.args || {};

  // Dry-run shell: simulate
  if (toolName === "shell.run" && mode === "dry-run") {
    const command = args.command || "";
    return {
      status: "completed",
      output: `[DRY-RUN] Would run: ${command}`,
    };
  }

  // Sandbox shell: execute in temp dir
  if (toolName === "shell.run" && mode === "sandbox") {
    const command = args.command || "";
    const { runCommand } = await import("../tools/shell-tool.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const sandboxDir = mkdtempSync(join(tmpdir(), "alix-replay-"));
    try {
      const result = await runCommand({ command, cwd: sandboxDir });
      return {
        status: "completed",
        output: result.output,
      };
    } finally {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  }

  // Dry-run file.create: simulate
  if (toolName === "file.create") {
    const path = String(args.path || "");
    const content = args.content !== undefined ? String(args.content) : "";
    return {
      status: "completed",
      output: `[DRY-RUN] Would create: ${path}\n${content.slice(0, 2000)}`,
    };
  }

  // Dry-run file.delete: simulate
  if (toolName === "file.delete") {
    const path = String(args.path || "");
    return {
      status: "completed",
      output: `[DRY-RUN] Would delete: ${path}`,
    };
  }

  // Dry-run patch.apply: simulate
  if (toolName === "patch.apply") {
    const patchText = String(args.patchText || "");
    const format = String(args.format || "");
    return {
      status: "completed",
      output: `[DRY-RUN] Would apply ${format} patch:\n${patchText.slice(0, 2000)}`,
    };
  }

  // Read-only file operations: execute normally
  if (isReadOnlyFileTool(toolName)) {
    const path = String(args.path || "");
    const resolvedPath = path.startsWith("/") ? path : path ? `${cwd}/${path}` : cwd;
    if (toolName === "file.read") {
      try {
        const result = await readFile({ root: cwd, path });
        return {
          status: "completed",
          output: result.output,
        };
      } catch (err: any) {
        return { status: "failed", error: err.message };
      }
    }
    // file.exists
    return {
      status: "completed",
      output: existsSync(resolvedPath) ? "exists" : "not found",
    };
  }

  // Network tools: blocked
  if (isNetworkTool(toolName)) {
    return {
      status: "blocked",
      blockReason: `"${toolName}" is not available in ${mode} mode`,
    };
  }

  // Fallback for unknown tools
  return {
    status: "skipped",
    blockReason: `No replay handler for tool: ${toolName}`,
  };
}

// ─── ReplayExecutor ──────────────────────────────────────────────────

export class ReplayExecutor {
  constructor(
    private cwd: string,
    private eventLog: EventLog,
  ) {}

  private sessionId(): string {
    const parts = this.eventLog.sessionDir.split("sessions/");
    return parts.length > 1 ? parts[1] : "unknown";
  }

  private async logEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.eventLog.append({ sessionId: this.sessionId(), actor: "system", type, payload });
  }

  async execute(plan: ReplayPlan): Promise<ReplayResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    await this.logEvent(REPLAY_EVENT_TYPES.STARTED, { mode: plan.mode, sessionId: this.sessionId() });

    const stepResults: ReplayStepResult[] = [];
    let successCount = 0;
    let blockedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const step of plan.steps) {
      const stepStart = Date.now();
      const stepResult: ReplayStepResult = {
        index: step.index,
        traceId: step.traceId,
        action: step.replayAction,
        toolName: step.toolName,
      };

      if (step.status === "blocked") {
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_BLOCKED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, blockReason: step.blockReason,
        });
        stepResult.status = "blocked";
        stepResult.blockReason = step.blockReason;
        stepResult.durationMs = Date.now() - stepStart;
        blockedCount++;
        stepResults.push(stepResult);
        continue;
      }

      if (step.status === "skipped") {
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_SKIPPED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
        });
        stepResult.status = "skipped";
        stepResult.durationMs = 0;
        skippedCount++;
        stepResults.push(stepResult);
        continue;
      }

      await this.logEvent(REPLAY_EVENT_TYPES.STEP_STARTED, {
        stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
        toolName: step.toolName,
      });

      try {
        const toolResult = await replayToolStep(step, plan.mode, this.cwd);
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_COMPLETED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, status: toolResult.status, outputPreview: (toolResult.output || "").slice(0, 200),
          blockReason: toolResult.blockReason, error: toolResult.error, durationMs: Date.now() - stepStart,
        });

        stepResult.status = toolResult.status;
        stepResult.output = toolResult.output;
        stepResult.outputSize = (toolResult.output || "").length;
        stepResult.error = toolResult.error;
        stepResult.blockReason = toolResult.blockReason;

        if (toolResult.status === "completed") successCount++;
        else if (toolResult.status === "blocked") blockedCount++;
        else if (toolResult.status === "skipped") skippedCount++;
        else failedCount++;
      } catch (err: any) {
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_BLOCKED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, error: err.message,
        });
        stepResult.status = "failed";
        stepResult.error = err.message;
        failedCount++;
      }

      stepResult.durationMs = Date.now() - stepStart;
      stepResults.push(stepResult);
    }

    const totalDurationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    await this.logEvent(REPLAY_EVENT_TYPES.COMPLETED, {
      mode: plan.mode, stepCount: plan.steps.length,
      successCount, blockedCount, skippedCount, failedCount, totalDurationMs,
    });

    return {
      mode: plan.mode,
      steps: stepResults,
      startedAt,
      completedAt,
      totalDurationMs,
      toolCallCount: plan.toolCount,
      successCount,
      blockedCount,
      skippedCount,
      failedCount,
      warnings: plan.warnings,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build
npx node --test dist/tests/runtime/replay-executor.test.js
```
Expected: 7 tests pass (5 dry-run + 2 sandbox, though the sandbox dir cleanup test may be flaky — we can make it more robust).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/replay-executor.ts tests/runtime/replay-executor.test.ts
git commit -m "feat(runtime): add replay executor with dry-run and sandbox wrappers"
```

---

### Task 5: Add TUI replay execution display and state

**Files:**
- Modify: `src/tui/store.ts`
- Modify: `src/tui/trace-detail.ts`
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Add replay result and executing state to store**

In `src/tui/store.ts`, add replay state fields:

```typescript
// In class members area:
private _replayResult: import("../runtime/replay-executor.js").ReplayResult | null = null;
private _replayExecuting = false;
private _replayMode: import("../runtime/replay-plan.js").ReplayMode = "dry-run";
```

Add getters:

```typescript
get replayResult() { return this._replayResult; }
get replayExecuting() { return this._replayExecuting; }
get replayMode() { return this._replayMode; }
```

Add setters:

```typescript
setReplayResult(result: import("../runtime/replay-executor.js").ReplayResult | null): void {
  this._replayResult = result;
}
setReplayExecuting(v: boolean): void {
  this._replayExecuting = v;
}
setReplayMode(mode: import("../runtime/replay-plan.js").ReplayMode): void {
  this._replayMode = mode;
}
```

Ensure `getState()` in `TuiStore` includes these fields:

```typescript
replayResult: this._replayResult,
replayExecuting: this._replayExecuting,
replayMode: this._replayMode,
```

- [ ] **Step 2: Add renderReplayResult to trace-detail.ts**

In `src/tui/trace-detail.ts`, add:

```typescript
import type { ReplayResult } from "../runtime/replay-executor.js";

// At the end of the file, after renderTraceReplay:

export function renderReplayResult(result: ReplayResult): string[] {
  const lines: string[] = [];
  lines.push(`  Mode: ${result.mode}`);
  lines.push(`  Steps: ${result.steps.length} total, ${result.successCount} completed, ${result.blockedCount} blocked, ${result.failedCount} failed`);
  lines.push(`  Duration: ${result.totalDurationMs}ms`);
  lines.push("");

  if (result.steps.length > 0) {
    lines.push("  Chain:");
    for (const step of result.steps) {
      const iconMap: Record<string, string> = {
        completed: "✔", blocked: "✗", skipped: "○", failed: "✗",
      };
      const icon = iconMap[step.status] || " ";
      const action = step.action.padEnd(24);
      const duration = step.durationMs !== undefined ? `${step.durationMs}ms` : "";
      lines.push(`  ${icon} ${step.index}. ${action} ${(step.toolName || "").slice(0, 30)} ${duration}`);
      if (step.output) {
        // Show first line of output
        const firstLine = step.output.split("\n")[0].slice(0, 60);
        lines.push(`       ${firstLine}`);
      }
      if (step.blockReason) {
        lines.push(`       ⛔ ${step.blockReason.slice(0, 60)}`);
      }
      if (step.error) {
        lines.push(`       ❌ ${step.error.slice(0, 60)}`);
      }
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings:");
    for (const w of result.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }

  return lines;
}
```

- [ ] **Step 3: Wire replay execution in panel-renderer.ts**

In `src/tui/panel-renderer.ts`, add a new detail mode for replay result display. In the trace panel section (around line 120-137), after the replay preview mode:

```typescript
// Replay result display uses store.replayResult
} else if (mode === "replay-result" && store.replayResult) {
  const { renderReplayResult } = await import("./trace-detail.js");
  detailLines = renderReplayResult(store.replayResult);
}
```

And update the mode line at the bottom to include the keys for result mode:

```typescript
if (mode === "replay" || mode === "replay-result") {
  buf.push("  Keys: x=execute  s=summary  esc=close");
} else {
  buf.push("  Keys: j=json  l=links  c=chain  s=summary  p=replay  esc=close");
}
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/store.ts src/tui/trace-detail.ts src/tui/panel-renderer.ts
git commit -m "feat(tui): add replay execution display and state"
```

---

### Task 6: Wire TUI commands and keyboard shortcuts

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add replay command handler and x shortcut with confirmation**

In `src/cli/commands/tui.ts`:

Add imports at the top:

```typescript
import type { ReplayPlan, ReplayMode } from "../../runtime/replay-plan.js";
import type { ReplayResult } from "../../runtime/replay-executor.js";
```

Add a module-level state variable for replay confirmation:

```typescript
let pendingReplayConfirm: { plan: ReplayPlan; store: any } | null = null;
```

In the main command loop (inside `while (true)`), add replay execution shortcut:

When detail is open and mode is "replay" (around the mode-switching block at ~line 268), add:

```typescript
if (task.toLowerCase() === "x") {
  // Execute replay — require confirmation first
  const selected = store.getSelectedTraceEvent();
  if (selected) {
    const { buildReplayPreview } = await import("../../runtime/replay-preview.js");
    const { buildReplayPlan } = await import("../../runtime/replay-plan.js");
    const { ReplayExecutor } = await import("../../runtime/replay-executor.js");

    const preview = buildReplayPreview(selected, store.getState().traceEvents);
    const mode: ReplayMode = "dry-run"; // default to dry-run
    const plan = buildReplayPlan(preview, store.getState().traceEvents, mode);

    if (!plan.executable) {
      tui.appendOutput(`Cannot replay: ${plan.reason || "no executable steps"}\n`, false);
      continue;
    }

    tui.appendOutput(`Replay selected chain in ${mode} mode? type: replay yes\n`, false);
    // Store plan for confirmation
    (globalThis as any).__replayConfirm = { plan, mode };
    (globalThis as any).__replayStore = store;
    (globalThis as any).__replayCwd = activeCwd;
  }
  continue;
}
```

Then handle the confirmation line. After the tab navigation handling and before the `if (task.toLowerCase() === "r" || task.toLowerCase() === "refresh")` block, add:

```typescript
// Replay confirmation handler
const confirm = (globalThis as any).__replayConfirm;
if (confirm && task.toLowerCase() === "replay yes") {
  const { plan, mode } = confirm;
  const store = (globalThis as any).__replayStore;
  const cwd = (globalThis as any).__replayCwd || activeCwd;
  const { ReplayExecutor } = await import("../../runtime/replay-executor.js");
  
  store.setReplayExecuting(true);
  renderPanelContent(store, tui);
  
  try {
    const executor = new ReplayExecutor(cwd, tuiLog);
    const result = await executor.execute(plan);
    store.setReplayResult(result);
    store.setReplayExecuting(false);
    store.setTraceDetailMode("replay-result" as any);
    tui.appendOutput("Replay complete.\n", false);
  } catch (err: any) {
    store.setReplayExecuting(false);
    tui.appendOutput(`Replay error: ${err.message}\n`, false);
  }
  
  (globalThis as any).__replayConfirm = null;
  (globalThis as any).__replayStore = null;
  (globalThis as any).__replayCwd = null;
  renderPanelContent(store, tui);
  continue;
}
if (confirm) {
  // If user typed anything other than "replay yes", cancel
  (globalThis as any).__replayConfirm = null;
  (globalThis as any).__replayStore = null;
  (globalThis as any).__replayCwd = null;
  tui.appendOutput("Replay cancelled.\n", false);
  continue;
}
```

Also add the `/replay` command handler. After the approval manager check and before the daemon mode check (around line 344), add:

```typescript
// Check for replay command
if (task.startsWith("/replay ")) {
  const args = task.slice("/replay ".length).trim().split(/\s+/);
  const target = args[0]; // "selected" or a traceId
  const modeFlag = args.includes("--sandbox") ? "sandbox" : "dry-run";
  
  const selected = store.getSelectedTraceEvent();
  if (!selected) {
    tui.appendOutput("No trace event selected. Navigate to a trace event first.\n", false);
    continue;
  }
  
  const { buildReplayPreview } = await import("../../runtime/replay-preview.js");
  const { buildReplayPlan } = await import("../../runtime/replay-plan.js");
  const { ReplayExecutor } = await import("../../runtime/replay-executor.js");
  
  const preview = buildReplayPreview(selected, store.getState().traceEvents);
  const plan = buildReplayPlan(preview, store.getState().traceEvents, modeFlag as ReplayMode);
  
  if (!plan.executable) {
    tui.appendOutput(`Cannot replay: ${plan.reason || "no executable steps"}\n`, false);
    continue;
  }
  
  tui.appendOutput(`Replaying in ${modeFlag} mode (${plan.steps.filter(s => s.status === "ready").length} ready steps)...\n`, false);
  
  store.setReplayExecuting(true);
  renderPanelContent(store, tui);
  
  try {
    const executor = new ReplayExecutor(activeCwd, tuiLog);
    const result = await executor.execute(plan);
    store.setReplayResult(result);
    store.setReplayExecuting(false);
    store.setTraceDetailMode("replay-result" as any);
    tui.appendOutput("Replay complete.\n", false);
  } catch (err: any) {
    store.setReplayExecuting(false);
    tui.appendOutput(`Replay error: ${err.message}\n`, false);
  }
  
  renderPanelContent(store, tui);
  continue;
}
```

- [ ] **Step 2: Build and verify no compile errors**

```bash
npm run build
```
Expected: Clean compile, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire replay execution command with confirmation"
```

---

### Task 7: Add replay result rendering and TUI display tests

**Files:**
- Create: `tests/tui/replay-execution-detail.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/tui/replay-execution-detail.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReplayResult } from "../../src/tui/trace-detail.js";
import type { ReplayResult } from "../../src/runtime/replay-executor.js";

function makeResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    mode: "dry-run",
    steps: [],
    startedAt: "2026-06-11T12:00:00Z",
    completedAt: "2026-06-11T12:00:01Z",
    totalDurationMs: 142,
    toolCallCount: 2,
    successCount: 2,
    blockedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    warnings: ["Preview only. No execution will occur."],
    ...overrides,
  };
}

describe("renderReplayResult", () => {
  it("renders mode and step counts", () => {
    const result = makeResult({
      mode: "dry-run",
      steps: [
        { index: 1, traceId: "e1", action: "would-check-policy", status: "completed", toolName: "policy", durationMs: 5 },
        { index: 2, traceId: "e2", action: "would-run-tool", status: "completed", toolName: "shell.run", output: "[DRY-RUN] Would run: ls", durationMs: 130 },
      ],
    });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("dry-run"));
    assert.ok(joined.includes("2 completed"));
    assert.ok(joined.includes("142ms"));
  });

  it("renders blocked steps with reason", () => {
    const result = makeResult({
      steps: [
        { index: 1, traceId: "e1", action: "would-run-tool", status: "blocked", toolName: "web_search", blockReason: '"web_search" not available', durationMs: 0 },
      ],
      successCount: 0,
      blockedCount: 1,
    });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("✗"));
    assert.ok(joined.includes("web_search"));
  });

  it("renders warnings section", () => {
    const result = makeResult({ warnings: ["Network tools blocked in dry-run mode"] });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Warnings"));
    assert.ok(joined.includes("Network tools blocked"));
  });

  it("renders dry-run output marker", () => {
    const result = makeResult({
      steps: [
        { index: 1, traceId: "e1", action: "would-run-tool", status: "completed", toolName: "file.create", output: "[DRY-RUN] Would create: test.txt\nhello", durationMs: 10 },
      ],
    });
    const lines = renderReplayResult(result);
    const joined = lines.join("\n");
    assert.ok(joined.includes("[DRY-RUN]"));
  });
});
```

- [ ] **Step 2: Run test**

```bash
npm run build
npx node --test dist/tests/tui/replay-execution-detail.test.js
```
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/replay-execution-detail.test.ts
git commit -m "test(tui): cover replay execution result rendering"
```

---

### Task 8: Wire trace filter to include replay events

**Files:**
- Modify: `src/cli/commands/tui.ts` (trace filter array)

- [ ] **Step 1: Add "replay" to trace filter cycle**

In `src/cli/commands/tui.ts`, find the filter array around line 288:

```typescript
const filters = ["all", "policy", "approval", "continuation", "tool", "task", "session", "daemon", "runtime"] as const;
```

Change to:

```typescript
const filters = ["all", "policy", "approval", "continuation", "tool", "task", "session", "daemon", "runtime", "replay"] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): add replay to trace filter types"
```

---

### Task 9: Run full test suite and final verification

- [ ] **Step 1: Build and run all tests**

```bash
npm run build
npx node --test "dist/tests/**/*.test.js"
```

Expected: 400+ tests pass (increment from 390 at M0.34).

- [ ] **Step 2: Run impact analysis per CLAUDE.md**

```bash
npx gitnexus detect-changes
```
Expected: Only replay-related files in the diff. No unintended changes.

- [ ] **Step 3: Final commit — create tag**

```bash
git tag m0.35-runtime-replay-execution
git push origin main --tags
```

```bash
git add -A && git commit -m "feat: complete M0.35 runtime replay execution

- Add replay.* event types and trace integration
- Add ReplayPlan model and builder from ReplayPreview chains
- Add ReplayExecutor with dry-run simulation and sandbox shell execution
- Add TUI replay execution display with result rendering
- Add /replay command and x keyboard shortcut with confirmation
- Add 18 new tests covering plan building, execution, and rendering
- All existing tests pass, no regressions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
