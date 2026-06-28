# M0.9-B: WorkflowRun Wrapper

**Status:** ✅ Completed (M0.9) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `alix run` creates a `WorkflowRun` at command start, emits `workflow.created` and `workflow.completed`/`workflow.failed` events, and surfaces the WorkflowRun ID in CLI output.

**Architecture:** A `WorkflowRunManager` that wraps the current `runTask()` call. It creates a `WorkflowRun` before calling `runTask()`, attaches the workflow ID to all events via `EventMeta`, and transitions the workflow status on completion/failure. The scaffold at `implementation/m0.9-starter/src/kernel/workflow-run.ts` provides the type definitions.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/workflow-run.ts` | **Create** | `WorkflowRun` types, `createWorkflowRun()`, `WorkflowRunManager` |
| `src/agent/agent-loop.ts` | **Modify** | Wire `WorkflowRunManager` around `runTask()` |
| `tests/kernel/workflow-run.test.ts` | **Create** | Tests |

---

### Task 1: Create WorkflowRun module

**Files:**
- Create: `src/kernel/workflow-run.ts`

- [ ] **Step 1: Write the module**

```typescript
import { randomUUID } from "node:crypto";

export type WorkflowStatus = "created" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowMode = "interactive" | "ci" | "unattended";

export interface WorkflowRun {
  id: string;
  schemaVersion: "1.0";
  sessionId: string;
  goal: string;
  mode: WorkflowMode;
  status: WorkflowStatus;
  budget?: { maxTokens?: number; maxCostUsd?: number; maxWallClockMs?: number; maxToolCalls?: number };
  policyContext?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function createWorkflowRun(sessionId: string, goal: string, mode?: WorkflowMode): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: `wf_${randomUUID()}`,
    schemaVersion: "1.0",
    sessionId,
    goal,
    mode: mode ?? "interactive",
    status: "created",
    createdAt: now,
    updatedAt: now,
  };
}

export function transitionWorkflowStatus(run: WorkflowRun, status: WorkflowStatus): WorkflowRun {
  return { ...run, status, updatedAt: new Date().toISOString() };
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit src/kernel/workflow-run.ts 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/workflow-run.ts
git commit -m "feat(kernel): WorkflowRun types and factory"
```

---

### Task 2: Wire into agent-loop.ts

**Files:**
- Modify: `src/agent/agent-loop.ts`

- [ ] **Step 1: Add WorkflowRun creation at start of runTask**

At the start of `runTask()`, after `const ctx = await initAgent(...)`, add:

```typescript
import { createWorkflowRun, transitionWorkflowStatus } from "../kernel/workflow-run.js";
import { toCanonicalEvent, CanonicalEventSink } from "../kernel/event-envelope.js";

// Create WorkflowRun for this task
const wfRun = createWorkflowRun(ctx.sessionId, task);
const wfMeta = { workflowId: wfRun.id };
const canonicalSink = new CanonicalEventSink();

// Emit workflow.created event
await ctx.log.append({
  ...session,
  type: "workflow.created",
  actor: "system",
  payload: { workflowId: wfRun.id, goal: task, mode: wfRun.mode },
  meta: wfMeta,
});

// Also emit via canonical sink
canonicalSink.emit(toCanonicalEvent(
  { id: randomUUID(), seq: 0, version: 1, sessionId: ctx.sessionId, timestamp: new Date().toISOString(), type: "workflow.created", actor: "system", payload: { workflowId: wfRun.id }, meta: wfMeta },
  wfMeta,
));
```

- [ ] **Step 2: Add workflow completion before return statements**

Before each `return { sessionId, summary: ..., ... }` in `runTask()`, add:

```typescript
const completedRun = transitionWorkflowStatus(wfRun, "completed");
await ctx.log.append({
  ...session, type: "workflow.completed", actor: "system",
  payload: { workflowId: wfRun.id, summary },
  meta: wfMeta,
});
```

For failure paths, emit `workflow.failed`.

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent-loop.ts
git commit -m "feat(kernel): wrap runTask in WorkflowRun with workflow.created/completed events"
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/kernel/workflow-run.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkflowRun, transitionWorkflowStatus } from "../../src/kernel/workflow-run.js";

describe("WorkflowRun", () => {

  it("creates with generated ID and created status", () => {
    const wf = createWorkflowRun("session_1", "test goal");
    assert.ok(wf.id.startsWith("wf_"), `ID should start with wf_ (got: ${wf.id})`);
    assert.equal(wf.status, "created");
    assert.equal(wf.goal, "test goal");
    assert.equal(wf.schemaVersion, "1.0");
  });

  it("transitions status correctly", () => {
    const wf = createWorkflowRun("session_1", "test");
    const running = transitionWorkflowStatus(wf, "running");
    assert.equal(running.status, "running");
    assert.ok(new Date(running.updatedAt) >= new Date(wf.createdAt));
  });

  it("preserves original fields on transition", () => {
    const wf = createWorkflowRun("session_1", "test", "unattended");
    const completed = transitionWorkflowStatus(wf, "completed");
    assert.equal(completed.id, wf.id);
    assert.equal(completed.goal, "test");
    assert.equal(completed.mode, "unattended");
  });

  it("generates unique IDs", () => {
    const wf1 = createWorkflowRun("s", "a");
    const wf2 = createWorkflowRun("s", "b");
    assert.notEqual(wf1.id, wf2.id);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/workflow-run.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/workflow-run.test.ts
git commit -m "test(kernel): WorkflowRun creation and transition tests"
```
