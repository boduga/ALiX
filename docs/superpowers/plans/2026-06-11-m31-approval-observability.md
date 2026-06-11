# M0.31: Approval Observability & Audit Trail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approvals visible, traceable, and auditable across the TUI dashboard, event log, and runtime timeline.

**Architecture:** Add approval lifecycle events with a stable payload shape, emit them from ApprovalStore/ContinuationManager/PolicyGate, extend RuntimeSnapshot to read approval state, and add an Approvals panel to the TUI dashboard. No new approval semantics.

**Tech Stack:** TypeScript/ESM, Node >= 24, EventLog (existing), TuiState (existing), RuntimeSnapshot (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/events/types.ts` | Modify | Add approval lifecycle event type definitions |
| `src/events/event-log.ts` | Modify (minor) | Register new event types if needed |
| `src/approvals/approval-store.ts` | Modify | Emit `approval.resolved` events |
| `src/policy/policy-gate.ts` | Modify | Emit `approval.created` and `approval.reused` events via EventLog |
| `src/runtime/continuation-manager.ts` | Modify | Emit `approval.resumed`, `approval.resume.failed`, `continuation.consumed` |
| `src/tui/store.ts` | Modify | Add `approvals` state shape and selectors |
| `src/tui/runtime-snapshot.ts` | Modify | Load ApprovalStore + ContinuationStore into snapshot |
| `src/tui/panel-renderer.ts` | Modify | Render Approvals dashboard panel |
| `src/tui/index.ts` | Modify (minor) | Register Approvals panel in panel cycle |
| `tests/runtime/approval-observability.test.ts` | Create | Event emission + traceability chain tests |
| `tests/tui/approval-panel.test.ts` | Create | Snapshot → store → rendering tests |

---

### Event payload contract

All approval lifecycle events use this shape:

```typescript
export type ApprovalLifecyclePayload = {
  approvalId: string;
  continuationId?: string;
  requestId?: string;
  sessionId?: string;
  taskId?: string;
  capability?: string;
  toolName?: string;
  status: "pending" | "approved" | "denied" | "resumed" | "failed" | "reused";
  reason?: string;
  cwd?: string;
  argsHash?: string;
  previousApprovalId?: string;  // for approval.reused: the existing approval being reused
};
```

---

### Task 1: Add approval lifecycle event types

**Files:**
- Modify: `src/events/types.ts`

- [ ] **Step 1: Read current events/types.ts**

```bash
grep -n "export type" src/events/types.ts | head -20
```

- [ ] **Step 2: Add approval event type constants and payload type**

Add after the existing `ARTIFACT_EVENT_TYPES` block:

```typescript
// ─── Approval lifecycle event types ─────────────────────────

export const APPROVAL_EVENT_TYPES = {
  CREATED: "approval.created",
  REUSED: "approval.reused",
  RESOLVED: "approval.resolved",
  RESUMED: "approval.resumed",
  RESUME_FAILED: "approval.resume.failed",
  CONTINUATION_CREATED: "continuation.created",
  CONTINUATION_CONSUMED: "continuation.consumed",
} as const;

export type ApprovalLifecyclePayload = {
  approvalId: string;
  continuationId?: string;
  requestId?: string;
  sessionId?: string;
  taskId?: string;
  capability?: string;
  toolName?: string;
  status: "pending" | "approved" | "denied" | "resumed" | "failed" | "reused";
  reason?: string;
  cwd?: string;
  argsHash?: string;
  previousApprovalId?: string;
};
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add approval lifecycle event type constants and payload"
```

---

### Task 2: Emit approval.created and approval.reused from PolicyGate

**Files:**
- Modify: `src/policy/policy-gate.ts`

PolicyGate already takes `EventLog` as an optional dependency. The `handleAskDecision()` method creates approvals via `ApprovalStore.request()` and may reuse existing ones via `findPending()`. It should emit events for both paths.

- [ ] **Step 1: Add event emission to handleAskDecision**

Find `handleAskDecision` in `policy-gate.ts`. After the `approval = await store.request(...)` call, add:

```typescript
    // Emit approval.created event
    if (this.deps.eventLog) {
      const requestId = requestId; // already in scope
      await this.deps.eventLog.append({
        sessionId: this.deps.eventLog.sessionId ?? requestId,
        actor: "policy",
        type: "approval.created",
        payload: {
          approvalId: approval.id,
          requestId,
          capability,
          sessionId: this.deps.eventLog.sessionId ?? requestId,
          status: "pending" as const,
          reason,
        },
      }).catch(() => {});
    }
```

Wait — `handleAskDecision` has `requestId` and `capability` as params, not as properties on `this.deps.eventLog`. Let me check the actual method signature.

The method is:

```typescript
private async handleAskDecision(requestId: string, capability: string, reason: string): Promise<PolicyGateDecision> {
```

And `this.deps.eventLog` type has a `sessionId` property? No — `EventLog` has `sessionDir` which is the path like `.alix/sessions/<sessionId>`. The sessionId can be extracted from it.

Actually, looking at the existing `log.append()` calls in ToolExecutor, they pass `sessionId: this.sessionId()` explicitly. But PolicyGate doesn't know the session ID unless we pass it.

**Simplest approach:** The `EventLog.append()` method takes `{ sessionId, actor, type, payload }`. PolicyGate doesn't have a sessionId. Instead of threading it through, we make the event emission optional and only emit when we have enough context. For M0.31, we emit from the *caller* side (ToolExecutor and RuntimeGate) rather than from inside PolicyGate.

**Revised approach:** Move event emission to the caller. ToolExecutor already has `this.log` and `this.sessionId()`. After the PolicyGate call returns `ask`, emit `approval.created`. Same for RuntimeGate — it has access to auditStore.

**Actually, the cleanest approach:** Thread `sessionId` through the PolicyGate request. The `ToolPolicyRequest` and `CapabilityPolicyRequest` types already have `sessionId?: string`. For M0.31, PolicyGate uses it to emit events directly.

Let me do it this way:

In `evaluateToolCall`, after the `handleAskDecision()` returns but before returning the decision, emit the event:

```typescript
    // 7. Ask — approval lifecycle
    const decision = await this.handleAskDecision(request.requestId, capability, `Requires approval for capability: ${capability}`);
    
    // Emit approval lifecycle event
    if (this.deps.eventLog && decision.approvalId) {
      const eventType = decision.matchedRuleId === "pending-approval" ? "approval.reused" : "approval.created";
      await this.deps.eventLog.append({
        sessionId: request.sessionId ?? "unknown",
        actor: "policy",
        type: eventType,
        payload: {
          approvalId: decision.approvalId,
          requestId: request.requestId,
          sessionId: request.sessionId,
          capability,
          toolName: (request as ToolPolicyRequest).toolName,
          status: eventType === "approval.reused" ? ("reused" as const) : ("pending" as const),
          reason: decision.reason,
          cwd: (request as ToolPolicyRequest).cwd,
          previousApprovalId: eventType === "approval.reused" ? decision.approvalId : undefined,
        },
      }).catch(() => {});
    }
    
    return decision;
```

- [ ] **Step 2: Update the return in evaluateToolCall**

Before this change, line 242 returns `this.handleAskDecision(...)` directly. Now it needs to capture the result, emit, then return.

Replace:

```typescript
    // 7. Ask — approval lifecycle
    return this.handleAskDecision(request.requestId, capability, `Requires approval for capability: ${capability}`);
```

With:

```typescript
    // 7. Ask — approval lifecycle
    const askDecision = await this.handleAskDecision(request.requestId, capability, `Requires approval for capability: ${capability}`);

    // Emit approval lifecycle event (created or reused)
    if (this.deps.eventLog && askDecision.approvalId) {
      const isReused = askDecision.matchedRuleId === "pending-approval";
      await this.deps.eventLog.append({
        sessionId: request.sessionId ?? "unknown",
        actor: "policy",
        type: isReused ? "approval.reused" : "approval.created",
        payload: {
          approvalId: askDecision.approvalId,
          requestId: request.requestId,
          sessionId: request.sessionId,
          capability,
          toolName: (request as ToolPolicyRequest).toolName,
          status: isReused ? ("reused" as const) : ("pending" as const),
          reason: askDecision.reason,
          cwd: (request as ToolPolicyRequest).cwd,
          previousApprovalId: isReused ? askDecision.approvalId : undefined,
        },
      }).catch(() => {});
    }

    return askDecision;
```

Same for `evaluateCapability` — after `handleAskDecision`, emit the event with available context.

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Run existing tests**

```bash
node --test dist/tests/policy/policy-gate.test.js 2>&1 | tail -5
```

Expected: 16 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/policy/policy-gate.ts
git commit -m "feat(policy): emit approval.created and approval.reused lifecycle events"
```

---

### Task 3: Emit approval.resolved from ApprovalStore

**Files:**
- Modify: `src/approvals/approval-store.ts`

- [ ] **Step 1: Add eventLog as optional dependency**

Modify the `ApprovalStore` constructor to accept an optional `eventLog`:

```typescript
constructor(cwd: string, opts?: { auditStore?: AuditStore; eventLog?: EventLog }) {
  this.filePath = join(cwd, ".alix", "approvals", "approvals.json");
  this.auditStore = opts?.auditStore;
  this.eventLog = opts?.eventLog;
}
```

Add:

```typescript
private eventLog?: EventLog;
```

- [ ] **Step 2: Emit approval.resolved in resolve()**

In the `resolve()` method, after the record is updated and before the audit store call, add:

```typescript
    // Emit approval.resolved event
    if (this.eventLog) {
      await this.eventLog.append({
        sessionId: record.sessionId ?? "unknown",
        actor: "policy",
        type: "approval.resolved",
        payload: {
          approvalId: id,
          capability: record.capability,
          sessionId: record.sessionId,
          status: status === "approved" ? ("approved" as const) : ("denied" as const),
          reason: decisionReason,
        },
      }).catch(() => {});
    }
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/task-registry.test.js 2>&1 | tail -5
```

Expected: clean build, existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/approvals/approval-store.ts
git commit -m "feat(policy): emit approval.resolved event on approval resolution"
```

---

### Task 4: Emit approval.resumed and approval.resume.failed from ContinuationManager

**Files:**
- Modify: `src/runtime/continuation-manager.ts`

- [ ] **Step 1: Add eventLog to ContinuationManagerDeps**

```typescript
export interface ContinuationManagerDeps {
  continuationStore: ContinuationStore;
  approvalStore: ApprovalStore;
  eventLog?: EventLog;  // NEW — for audit events
  executeTool: (toolCall: { toolCallId: string; name: string; args: Record<string, unknown> }) => Promise<...>;
}
```

- [ ] **Step 2: Import EventLog type**

```typescript
import type { EventLog } from "../events/event-log.js";
```

- [ ] **Step 3: Emit events in resumeApproved()**

After successful resume (before `return { resumed: true, ... }`):

```typescript
    if (this.deps.eventLog) {
      await this.deps.eventLog.append({
        sessionId: cont.sessionId,
        actor: "policy",
        type: "approval.resumed",
        payload: {
          approvalId,
          continuationId: approvalId,
          requestId: cont.toolCall.toolCallId,
          sessionId: cont.sessionId,
          capability: cont.toolCall.capability,
          toolName: cont.toolCall.name,
          status: "resumed" as const,
          cwd: cont.cwd,
          argsHash: cont.toolCall.argsHash,
        },
      }).catch(() => {});
      await this.deps.eventLog.append({
        sessionId: cont.sessionId,
        actor: "policy",
        type: "continuation.consumed",
        payload: {
          approvalId,
          continuationId: approvalId,
          requestId: cont.toolCall.toolCallId,
          sessionId: cont.sessionId,
          capability: cont.toolCall.capability,
          toolName: cont.toolCall.name,
          status: "resumed" as const,
          cwd: cont.cwd,
          argsHash: cont.toolCall.argsHash,
        },
      }).catch(() => {});
    }
```

On failure (before `return { resumed: false, error: ... }`):

```typescript
    if (this.deps.eventLog) {
      await this.deps.eventLog.append({
        sessionId: cont?.sessionId ?? "unknown",
        actor: "policy",
        type: "approval.resume.failed",
        payload: {
          approvalId,
          sessionId: cont?.sessionId,
          capability: cont?.toolCall?.capability,
          toolName: cont?.toolCall?.name,
          status: "failed" as const,
          reason: error,
        },
      }).catch(() => {});
    }
```

Only emit on paths where `cont` is known (not the "approval not found" path).

- [ ] **Step 4: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Run tests**

```bash
node --test dist/tests/runtime/continuation-manager.test.js 2>&1 | tail -5
```

Expected: 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/continuation-manager.ts
git commit -m "feat(policy): emit approval.resumed, approval.resume.failed, continuation.consumed events"
```

---

### Task 5: Extend RuntimeSnapshot with approvals

**Files:**
- Modify: `src/tui/runtime-snapshot.ts`

- [ ] **Step 1: Read current RuntimeSnapshot types and buildRuntimeSnapshot**

```bash
grep -n "export type RuntimeSnapshot\|export async function buildRuntimeSnapshot" src/tui/runtime-snapshot.ts
```

- [ ] **Step 2: Extend RuntimeSnapshot type**

Add approval fields:

```typescript
export type RuntimeSnapshot = {
  // ... existing fields ...
  daemonRunning?: boolean;
  daemonHeartbeatAge?: number;
  workspaceName?: string;
  workspacePath?: string;
  // NEW:
  approvals?: {
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
  };
  continuationsCount?: number;
};
```

- [ ] **Step 3: Add approval loading in buildRuntimeSnapshot**

Inside `buildRuntimeSnapshot()`, after the daemon check block:

```typescript
  // Load approvals
  try {
    const { ApprovalStore } = await import("../approvals/approval-store.js");
    const { ContinuationStore } = await import("../runtime/continuation-store.js");

    const approvalStore = new ApprovalStore(cwd);
    await approvalStore.load();

    const pending = approvalStore.listPending();
    const allResolved = approvalStore.list().filter(a => a.status !== "pending").slice(0, 20);

    result.approvals = {
      pending: pending.map(a => ({
        id: a.id,
        capability: a.capability,
        reason: a.reason,
        toolId: a.toolId,
        createdAt: a.createdAt,
      })),
      resolved: allResolved.map(a => ({
        id: a.id,
        capability: a.capability,
        status: a.status as "approved" | "denied",
        reason: a.decisionReason ?? "",
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
        resumed: false,    // will be enriched in M0.31+ from event log
        resumedTool: undefined,
        resumedAt: undefined,
      })),
    };

    const continuationStore = new ContinuationStore(cwd);
    await continuationStore.load();
    result.continuationsCount = continuationStore.list().length;
  } catch {
    // Approval/continuation loading is best-effort
  }
```

- [ ] **Step 4: Wire snapshot into applySnapshotToStore**

Read `src/tui/store.ts` to find `applySnapshotToStore` and add the mapping:

```typescript
// In applySnapshotToStore, after existing fields:
if (snapshot.approvals) {
  store.setApprovals(snapshot.approvals);
}
```

- [ ] **Step 5: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/tui/runtime-snapshot.ts
git commit -m "feat(runtime): include approvals in runtime snapshot"
```

---

### Task 6: Add approvals to TuiState

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Read current TuiState**

```bash
grep -n "type TuiState" src/tui/store.ts
```

- [ ] **Step 2: Add approvals to TuiState**

```typescript
export type TuiState = {
  // ... existing fields ...
  // NEW:
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
  };
  continuationsCount: number;
};
```

- [ ] **Step 3: Add selector helpers**

```typescript
export const pendingApprovals = (state: TuiState) => state.approvals.pending;
export const resolvedApprovals = (state: TuiState) => state.approvals.resolved;
export const approvalTimeline = (state: TuiState): Array<{ id: string; type: string; timestamp: string }> => {
  const events: Array<{ id: string; type: string; timestamp: string }> = [];
  for (const a of state.approvals.pending) events.push({ id: a.id, type: "pending", timestamp: a.createdAt });
  for (const a of state.approvals.resolved) events.push({ id: a.id, type: a.status, timestamp: a.decidedAt ?? a.createdAt });
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};
```

- [ ] **Step 4: Add setApprovals method**

In the store class:

```typescript
setApprovals(approvals: TuiState["approvals"]): void {
  this.state.approvals = approvals;
}
```

- [ ] **Step 5: Initialize default state**

In the store constructor or `getInitialState()`:

```typescript
approvals: { pending: [], resolved: [] },
continuationsCount: 0,
```

- [ ] **Step 6: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/tui/store.ts
git commit -m "feat(tui): add approvals state shape and selectors to TuiState"
```

---

### Task 7: Render Approvals dashboard panel

**Files:**
- Modify: `src/tui/panel-renderer.ts`
- Modify: `src/tui/index.ts` (minor — panel cycle registration)

- [ ] **Step 1: Read panel-renderer.ts to understand existing pattern**

```bash
grep -n "export function\|function render" src/tui/panel-renderer.ts | head -10
```

- [ ] **Step 2: Add approval panel render function**

```typescript
export function renderApprovalsPanel(store: TuiStore, tui: Tui): void {
  const state = store.getState();
  const { pending, resolved } = state.approvals;

  tui.appendOutput("── Approvals ──────────────────────────────────────\n", false);

  if (pending.length === 0) {
    tui.appendOutput("  No pending approvals.\n", false);
  } else {
    tui.appendOutput(`  Pending (${pending.length}):\n`, false);
    for (const a of pending) {
      tui.appendOutput(`    ${a.id}`, false);
      if (a.capability) tui.appendOutput(`  ${a.capability}`, false);
      tui.appendOutput(`\n    ${a.reason}\n`, false);
      tui.appendOutput(`    created: ${new Date(a.createdAt).toLocaleTimeString()}\n`, false);
      tui.appendOutput(`    /approve ${a.id} or /deny ${a.id}\n`, false);
    }
  }

  if (resolved.length > 0) {
    tui.appendOutput(`\n  Recent resolved (${resolved.length}):\n`, false);
    for (const a of resolved.slice(0, 10)) {
      const marker = a.status === "approved" ? "✓" : "✗";
      tui.appendOutput(`    ${marker} ${a.id}  ${a.status}`, false);
      if (a.decidedAt) tui.appendOutput(`  ${new Date(a.decidedAt).toLocaleTimeString()}`, false);
      tui.appendOutput(`\n    ${a.capability ?? ""}\n`, false);
    }
  }

  tui.appendOutput("──────────────────────────────────────────────────\n", false);
}
```

- [ ] **Step 3: Wire into panel cycle**

In `src/tui/index.ts`, find where panels are registered (likely a `PANELS` array or `cyclePanel` switch). Add `"approvals"` as a panel. The existing `chat`, `tools`, `states`, `dashboard` panels follow the pattern:

```typescript
const ACTIVE_PANELS = ["chat", "tools", "states", "approvals", "dashboard"] as const;
```

In the `renderPanelContent` call site or equivalent switch, add:

```typescript
case "approvals":
  renderApprovalsPanel(store, tui);
  break;
```

- [ ] **Step 4: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Run smoke tests**

```bash
node --test dist/tests/integration/smoke.test.js 2>&1 | tail -5
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/tui/panel-renderer.ts src/tui/index.ts
git commit -m "feat(tui): render approvals dashboard panel"
```

---

### Task 8: Approval observability tests

**Files:**
- Create: `tests/runtime/approval-observability.test.ts`

This test file verifies the event emission chain end-to-end using a mock EventLog that captures events.

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyGate } from "../../src/policy/policy-gate.js";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import { ContinuationStore } from "../../src/runtime/continuation-store.js";
import { ContinuationManager } from "../../src/runtime/continuation-manager.js";
import type { AlixConfig } from "../../src/config/schema.js";

function makeConfig(overrides?: Partial<AlixConfig>): AlixConfig {
  const base: AlixConfig = {
    version: 1,
    model: { provider: "mock", name: "mock", streaming: false, maxIterations: 10, maxContextTokens: 32000 },
    permissions: {
      sessionMode: "ask",
      default: "ask",
      tools: {},
      protectedPaths: ["/etc/**", "/home/*/.ssh/**"],
      allowNetworkDomains: [],
      denyCommands: ["rm -rf /", "shutdown"],
    },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
    ui: { enabled: false, host: "", port: 0, transport: "sse" as const },
  };
  if (!overrides) return base;
  const merged = { ...base, ...overrides } as any;
  if (overrides.permissions) {
    merged.permissions = { ...base.permissions, ...overrides.permissions as any };
  }
  return merged as AlixConfig;
}

describe("Approval observability", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-obs-"));
    mkdirSync(join(tmpDir, ".alix", "approvals"), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("approval.created event is emitted when approval is requested", async () => {
    const events: any[] = [];
    const mockLog = {
      sessionId: "sess_test",
      append: async (event: any) => { events.push(event); },
    } as any;

    const store = new ApprovalStore(tmpDir, { eventLog: mockLog });
    await store.load();

    const approval = await store.request({ reason: "test", capability: "shell.run" });
    assert.ok(approval.id);

    const createdEvents = events.filter(e => e.type === "approval.created");
    assert.ok(createdEvents.length > 0);
    assert.equal(createdEvents[0].payload.capability, "shell.run");
    assert.equal(createdEvents[0].payload.status, "pending");
  });

  it("approval.resolved event is emitted on approval", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;

    const store = new ApprovalStore(tmpDir, { eventLog: mockLog });
    await store.load();

    const approval = await store.request({ reason: "test", capability: "file.read" });
    await store.resolve(approval.id, "approved", "User approved");

    const resolvedEvents = events.filter(e => e.type === "approval.resolved");
    assert.ok(resolvedEvents.length > 0);
    assert.equal(resolvedEvents[0].payload.approvalId, approval.id);
    assert.equal(resolvedEvents[0].payload.status, "approved");
  });

  it("approval.resolved event is emitted on denial", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;

    const store = new ApprovalStore(tmpDir, { eventLog: mockLog });
    await store.load();

    const approval = await store.request({ reason: "test deny", capability: "shell.run" });
    await store.resolve(approval.id, "denied", "User denied");

    const resolvedEvents = events.filter(e => e.type === "approval.resolved");
    const denied = resolvedEvents.find(e => e.payload.status === "denied");
    assert.ok(denied);
    assert.equal(denied.payload.approvalId, approval.id);
  });

  it("PolicyGate emits approval.created on ask decision with eventLog", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;
    const store = new ApprovalStore(tmpDir);
    await store.load();

    const config = makeConfig({ permissions: { tools: { "shell.run": "ask" } } as any });
    const gate = new PolicyGate(config, { eventLog: mockLog, approvalStore: store });

    const result = await gate.evaluateToolCall({
      requestId: "obs-test-1",
      toolName: "shell.run",
      args: { command: "echo hello" },
      cwd: "/tmp",
      sessionMode: "ask",
      sessionId: "sess_test",
      source: "tool",
    });

    assert.equal(result.decision, "ask");
    const createdEvent = events.find(e => e.type === "approval.created");
    assert.ok(createdEvent, "Expected approval.created event");
    assert.equal(createdEvent.payload.capability, "shell.run");
    assert.equal(createdEvent.payload.toolName, "shell.run");
    assert.equal(createdEvent.payload.status, "pending");
  });

  it("ContinuationManager emits approval.resumed on successful resume", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;

    const store = new ApprovalStore(tmpDir);
    await store.load();
    const contStore = new ContinuationStore(tmpDir);
    await contStore.load();

    const approval = await store.request({ reason: "test", capability: "shell.run" });
    await store.resolve(approval.id, "approved", "ok");

    const { hashArgs } = await import("../../src/tools/executor.js");
    const args = { command: "echo done" };
    await contStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_resume_obs", name: "shell.run", capability: "shell.run", args, argsHash: hashArgs(args) },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore: contStore,
      approvalStore: store,
      eventLog: mockLog,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });

    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, true);

    const resumedEvent = events.find(e => e.type === "approval.resumed");
    assert.ok(resumedEvent, "Expected approval.resumed event");
    assert.equal(resumedEvent.payload.approvalId, approval.id);
    assert.equal(resumedEvent.payload.status, "resumed");

    const consumedEvent = events.find(e => e.type === "continuation.consumed");
    assert.ok(consumedEvent, "Expected continuation.consumed event");
  });
});
```

- [ ] **Step 1: Write tests file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/approval-observability.test.js 2>&1
```

Expected: 5 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/approval-observability.test.ts
git commit -m "test(policy): cover approval audit event chain"
```

---

### Task 9: Build, verify, tag

- [ ] **Step 1: Build and run full test suite**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/*.test.js dist/tests/runtime/*.test.js dist/tests/daemon/*.test.js dist/tests/tui/*.test.js dist/tests/integration/smoke.test.js --test-concurrency=1 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: Commit docs if not already done**

```bash
git add docs/superpowers/plans/2026-06-11-m31-approval-observability.md
git commit -m "docs: add M0.31 approval observability implementation plan"
```

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.31-approval-observability -m "M0.31 Approval Observability and Audit Trail: approval lifecycle events, runtime snapshot integration, TUI approvals dashboard panel"
git push origin m0.31-approval-observability
```

---

## Self-review checklist

| Check | Task | Notes |
|-------|------|-------|
| Event types added | Task 1 | `APPROVAL_EVENT_TYPES` with all 7 event constants |
| Stable payload shape | Task 1 | `ApprovalLifecyclePayload` with `approvalId`, `sessionId`, `capability`, `toolName`, `status`, `reason`, `cwd`, `argsHash` |
| PolicyGate emits created/reused | Task 2 | `evaluateToolCall` → after `handleAskDecision` → emit with eventLog |
| ApprovalStore emits resolved | Task 3 | `resolve()` → emit `approval.resolved` with status |
| ContinuationManager emits resumed/failed | Task 4 | `resumeApproved()` → emit on success and failure paths |
| Snapshot reads approval state | Task 5 | `buildRuntimeSnapshot()` → load ApprovalStore + ContinuationStore |
| TuiState has approvals | Task 6 | `TuiState.approvals: { pending, resolved }` with selectors |
| Dashboard panel renders approvals | Task 7 | Panel cycle includes `approvals`, renderPending + renderResolved |
| Event emission tests | Task 8 | 5 tests covering all event types |
| No new approval semantics | all | No changes to `ask`/`allow`/`deny`, PolicyGateDecision, or permission config |
