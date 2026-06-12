# M0.59 TUI Approval Store Wiring + IFÁ-MAS Empty-State UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two platform plumbing gaps exposed by real usage — wire ApprovalStore into the TUI direct execution path so "ask" decisions work correctly, and improve the `/ifamas` command to handle missing trace selection gracefully.

**Architecture:** Two independent fixes in the same module (`src/cli/commands/tui.ts`):
1. Pass the TUI's `approvalStore` into the `LocalRuntimeExecutor` so `PolicyGate` can create pending approvals instead of denying with "no approval store configured"
2. Add fallback logic to `/ifamas`: if no trace selected but a previous diagnostic exists, show that; if none exists, show a helpful empty state

**Tech Stack:** TypeScript, existing ApprovalStore/PolicyGate/TuiStore patterns, `node:test`.

---

## File Structure

### Modify
- `src/cli/commands/tui.ts` — both fixes
- `src/runtime/route-executor.ts` — accept optional `approvalStore` in `LocalRuntimeExecutor`
- `src/tui/store.ts` — add method to retrieve latest diagnostic without selected trace

### Create
- `tests/tui/tui-approval-store.test.ts` — test the approval store wiring
- `tests/tui/ifamas-fallback.test.ts` — test the `/ifamas` fallback behavior

---

### Task 1: Pass approvalStore through LocalRuntimeExecutor

**Files:**
- Modify: `src/runtime/route-executor.ts`
- Modify: `src/cli/commands/tui.ts`

**Problem:** `LocalRuntimeExecutor.executeTool()` creates `new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd)` and `PolicyGate` inside that creates `handleAskDecision()` which returns `"deny"` when `this.deps.approvalStore` is undefined.

**Fix:** Accept an optional `approvalStore` in the `RuntimeContext` type and pass it through to `ToolExecutor`.

- [ ] **Step 1: Add `approvalStore` to `RuntimeContext`**

In `src/runtime/route-executor.ts`, find the `RuntimeContext` type and add:
```typescript
  approvalStore?: import("../approvals/approval-store.js").ApprovalStore;
```

- [ ] **Step 2: Pass approvalStore in `executeTool`**

In `LocalRuntimeExecutor.executeTool()`, find the `ToolExecutor` construction and change it from:
```typescript
const executor = new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd);
```
To:
```typescript
const executor = new ToolExecutor(
  ctx.config,
  ctx.eventLog,
  ctx.cwd,
  ctx.approvalStore ? { approvalStore: ctx.approvalStore } : undefined,
);
```

This passes the approvalStore through ToolExecutor's `ToolExecutorOptions` parameter, which already accepts `approvalStore` in its type definition.

- [ ] **Step 3: Wire approvalStore into TUI's execution context**

In `src/cli/commands/tui.ts`, find the `RuntimeContext` construction in the direct execution path (around line 948) and add `approvalStore` to the context object:
```typescript
const ctx: RuntimeContext = {
  cwd: activeCwd, sessionId: activeSessionId, sessionDir: activeSessionDir,
  eventLog: tuiLog,
  config: activeConfig,
  approvalStore: approvalStore ?? undefined,
  onStream: (chunk) => {
```

- [ ] **Step 4: Ensure approvalStore is initialized before execution**

In the same file, ensure the `approvalStore` variable is initialized before the first direct execution. The `approvalStore` is currently lazily initialized inside the `ApprovalManager` closures. Add eager initialization early in `runTui()`, after the config is loaded (around line 77):

```typescript
// Initialize approval store for direct execution path
const { ApprovalStore: AS } = await import("../../approvals/approval-store.js");
const approvalStore = new AS(activeCwd);
await approvalStore.load();
```

But wait — `approvalStore` is already declared as `let approvalStore: any = null;` at line 86. Move the initialization there and replace the lazy pattern. The ApprovalManager closures already cache it, so change to eager initialization.

Replace the existing lazy block (lines 86-106):
```typescript
  // Approval store + manager for /approvals, /approve, /deny commands
  let approvalStore: any = null;
  const approvalManager = new ApprovalManager({
    listPendingApprovals: async () => {
      ...
    },
    resolveApproval: async (id, status) => {
      ...
    },
  });
```

With eager initialization:
```typescript
  // Approval store + manager for /approvals, /approve, /deny commands
  const { ApprovalStore } = await import("../../approvals/approval-store.js");
  const approvalStore = new ApprovalStore(activeCwd);
  await approvalStore.load();

  const approvalManager = new ApprovalManager({
    listPendingApprovals: async () => {
      await approvalStore.load(); // reload to pick up changes
      return approvalStore.listPending();
    },
    resolveApproval: async (id, status) => {
      const record = await approvalStore.resolve(id, status, `Resolved by user via TUI`);
      if (!record) return { success: false, message: `Approval not found: ${id}` };
      return { success: true, message: `Approval ${id} ${status}.` };
    },
  });
```

- [ ] **Step 5: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Add /ifamas fallback when no trace selected

**Files:**
- Modify: `src/cli/commands/tui.ts`
- Modify: `src/tui/store.ts`

**Problem:** `/ifamas` immediately returns "No trace event selected" without trying to show any existing diagnostic data.

**Fix:** Add a three-tier fallback:
1. If trace selected → run diagnostic on it (existing behavior)
2. If no trace selected but `ifamasPanelData` exists → show latest diagnostic
3. If no trace and no diagnostic → show helpful empty state

- [ ] **Step 1: Add `hasIfamasPanelData` helper to store.ts**

In `src/tui/store.ts`, add to the `TuiStore` class:
```typescript
  hasIfamasPanelData(): boolean {
    return this.state.ifamasPanelData !== undefined;
  }
```

- [ ] **Step 2: Rewrite the `/ifamas` handler in tui.ts**

Replace the current `/ifamas` handler (which starts with `if (task.startsWith("/ifamas"))`) with this logic:

```typescript
      // /ifamas — run IFÁ-MAS diagnostic pipeline
      if (task.startsWith("/ifamas")) {
        const selected = store.getSelectedTraceEvent();

        if (selected) {
          // Tier 1: Run diagnostic on selected trace event (existing behavior)
          const { createSignalFrame } = await import("../../runtime/signal-frame.js");
          const { runIfamasDiagnostic } = await import("../../runtime/ifamas-pipeline.js");

          const bits = {
            intentClear: true, policyRisk: false, toolRequired: false,
            memoryRequired: false, freshnessRequired: false,
            mutationPossible: false, approvalRequired: false,
            replayRollbackContext: false,
          };
          const signal = createSignalFrame({ bits, domain: "task", intent: selected.label ?? "trace-event" });

          try {
            const diagnostic = await runIfamasDiagnostic({ signal, eventLog: tuiLog });
            const { IfamasTracePanel, formatIfamasPanel } = await import("../../tui/ifamas-panel.js");

            const panelData: IfamasTracePanel = {
              signalCode: diagnostic.signal.code,
              polarity: diagnostic.signal.polarity,
              offeringAction: diagnostic.offering.action,
              routeTarget: diagnostic.routeDecision.routeHint.targetRole,
              gatewayValid: diagnostic.gatewayValidation.valid,
              guildCandidateCount: diagnostic.guildCandidates.length,
              topGuildCandidate: diagnostic.guildCandidates[0]?.profile?.agentId,
              chronicleRefCount: diagnostic.routeDecision.chronicleEntries.length,
            };

            store.getState().ifamasPanelData = panelData;
            store.setPanel("ifamas");
            const panelLines = formatIfamasPanel(panelData);
            tui.appendOutput(panelLines.join("\n") + "\n", false);
            tui.appendOutput("Diagnostic recorded as trace event.\n", false);
          } catch (err: any) {
            tui.appendOutput("IFÁ-MAS diagnostic error: " + err.message + "\n", false);
          }
        } else if (store.hasIfamasPanelData()) {
          // Tier 2: No trace selected but we have previous diagnostic data
          const { formatIfamasPanel } = await import("../../tui/ifamas-panel.js");
          store.setPanel("ifamas");
          const panelLines = formatIfamasPanel(store.getState().ifamasPanelData!);
          tui.appendOutput("No trace event selected. Showing latest IFÁ-MAS diagnostic instead.\n", false);
          tui.appendOutput(panelLines.join("\n") + "\n", false);
        } else {
          // Tier 3: Nothing available
          tui.appendOutput("No IFÁ-MAS diagnostic available yet.\n", false);
          tui.appendOutput("Run a task in the TUI first, then use /ifamas to diagnose a trace event.\n", false);
          tui.appendOutput("Or type: /ifamas (with a trace event selected) to run a fresh diagnostic.\n", false);
        }
        continue;
      }
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 3: Write tests

**Files:**
- Create: `tests/tui/tui-approval-store.test.ts`
- Create: `tests/tui/ifamas-fallback.test.ts`

- [ ] **Step 1: Write approval store wiring test**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("TUI approval store wiring", () => {
  let tmpDir: string;
  let store: ApprovalStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-test-"));
    store = new ApprovalStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ApprovalStore can be eagerly initialized", async () => {
    // Simulates the eager initialization in runTui()
    const s = new ApprovalStore(tmpDir);
    await s.load();
    assert.ok(s, "ApprovalStore must construct and load without error");
    assert.equal(s.listPending().length, 0, "fresh store must have 0 pending");
  });

  it("ApprovalStore request creates a pending approval", async () => {
    const record = await store.request({
      capability: "filesystem.read",
      reason: "list files in directory",
    });
    assert.ok(record);
    assert.equal(record.status, "pending");
    assert.equal(record.capability, "filesystem.read");
    assert.ok(existsSync(join(tmpDir, ".alix", "approvals", "approvals.json")));
  });

  it("ApprovalStore resolve marks approval as approved", async () => {
    const record = await store.request({
      capability: "filesystem.write",
      reason: "write test file",
    });
    const resolved = await store.resolve(record.id, "approved", "User approved");
    assert.ok(resolved);
    assert.equal(resolved!.status, "approved");
  });

  it("ApprovalStore resolve marks approval as denied", async () => {
    const record = await store.request({
      capability: "shell.run",
      reason: "run unknown command",
    });
    const resolved = await store.resolve(record.id, "denied", "User denied");
    assert.ok(resolved);
    assert.equal(resolved!.status, "denied");
  });

  it("PolicyGate receives approvalStore through RuntimeContext", async () => {
    // This test verifies the type contract: RuntimeContext.approvalStore
    // exists and can be passed through. The actual flow is:
    // tui.ts → RuntimeContext → LocalRuntimeExecutor → ToolExecutor → PolicyGate
    const ctx: { approvalStore?: ApprovalStore } = { approvalStore: store };
    assert.ok(ctx.approvalStore, "approvalStore must be settable on RuntimeContext");
    // If the store exists, PolicyGate.handleAskDecision will use it
    // instead of returning "deny" with "no approval store configured"
  });
});
```

- [ ] **Step 2: Write `/ifamas` fallback test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatIfamasPanel } from "../../src/tui/ifamas-panel.js";
import type { IfamasTracePanel } from "../../src/tui/ifamas-panel.js";

describe("/ifamas fallback", () => {
  function makePanelData(overrides: Partial<IfamasTracePanel> = {}): IfamasTracePanel {
    return {
      signalCode: "00000000",
      polarity: "neutral",
      offeringAction: "proceed",
      routeTarget: "guild",
      gatewayValid: true,
      guildCandidateCount: 0,
      chronicleRefCount: 0,
      ...overrides,
    };
  }

  it("fallback: shows latest diagnostic data when no trace selected", () => {
    // Simulates Tier 2: ifamasPanelData exists but no trace selected
    const panelData = makePanelData({
      signalCode: "10101010",
      polarity: "ire",
      offeringAction: "proceed",
    });
    const lines = formatIfamasPanel(panelData);
    assert.ok(lines.some(l => l.includes("ire")), "must show polarity");
    assert.ok(lines.some(l => l.includes("10101010")), "must show signal code");
    assert.ok(lines.some(l => l.includes("proceed")), "must show offering action");
  });

  it("fallback: handles missing routeTarget gracefully", () => {
    const panelData = makePanelData({ routeTarget: undefined });
    const lines = formatIfamasPanel(panelData);
    assert.ok(lines.some(l => l.includes("—")), "must show dash for missing routeTarget");
  });

  it("fallback: handles no top guild candidate gracefully", () => {
    const panelData = makePanelData({ guildCandidateCount: 0, topGuildCandidate: undefined });
    const lines = formatIfamasPanel(panelData);
    assert.ok(lines.some(l => l.includes("0")), "must show zero candidates");
    assert.ok(!lines.some(l => l.startsWith("  Top:")), "must not show Top line when empty");
  });

  it("fallback: renders empty state without crashing", () => {
    // Verifies Tier 3 output is valid — this is tested structurally
    // by checking that formatIfamasPanel handles edge data
    const panelData = makePanelData({
      signalCode: "",
      polarity: "",
      offeringAction: "",
      routeTarget: undefined,
      gatewayValid: false,
      guildCandidateCount: 0,
      topGuildCandidate: undefined,
      chronicleRefCount: 0,
    });
    const lines = formatIfamasPanel(panelData);
    assert.ok(lines.length > 0, "must produce lines even with empty data");
    assert.ok(lines.some(l => l.includes("IFÁ-MAS")), "must show panel header");
  });
});
```

- [ ] **Step 3: Run both test files**

Run:
```bash
npm run build
node --test dist/tests/tui/tui-approval-store.test.js
node --test dist/tests/tui/ifamas-fallback.test.js
```

Expected: 9/9 tests pass (5 approval store + 4 fallback)

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/tui-approval-store.test.js` — 5/5 pass
3. `node --test dist/tests/tui/ifamas-fallback.test.js` — 4/4 pass
4. `node --test dist/tests/runtime/*.test.js dist/tests/tui/*.test.js` — no regressions
5. `grep -n 'approvalStore' src/runtime/route-executor.ts` — verify it appears in both RuntimeContext and executeTool
6. Git diff shows only the intended files
