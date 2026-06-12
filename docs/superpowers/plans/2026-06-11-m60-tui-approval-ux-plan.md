# M0.60 TUI Approval Continuation UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `/approvals`, `/approve`, and `/deny` commands in the TUI help text, improve the "blocked by policy" message to show next-step commands, and verify the end-to-end approval flow works.

**Architecture:** The `ApprovalManager` already exists with full command parsing (`/approvals`, `/approve <id>`, `/deny <id>`). The TUI command loop already wires it. Two bare-minimum fixes: update the help text, improve the blocked-policy output message, and add a test to confirm the chain works.

**Tech Stack:** TypeScript, existing ApprovalManager/ApprovalStore patterns, `node:test`.

---

## File Structure

### Modify
- `src/cli/commands/tui.ts` — update help text to mention approval commands
- `src/runtime/route-executor.ts` — improve "Blocked by policy" message with next-step instructions

### Create
- `tests/tui/tui-approval-continuation.test.ts` — test the end-to-end approval flow

---

### Task 1: Update help text

**Files:**
- Modify: `src/cli/commands/tui.ts` line 399

- [ ] **Step 1: Add approval commands to help text**

Change line 399 from:
```typescript
      tui.appendOutput(`Commands: r=refresh tab=next panel d=dashboard(${dState}) ?=help q=quit\n`, false);
```
To:
```typescript
      tui.appendOutput(`Commands: r=refresh tab=next panel d=dashboard(${dState}) /approvals /approve <id> /deny <id> ?=help q=quit\n`, false);
```

---

### Task 2: Improve blocked-policy message

**Files:**
- Modify: `src/runtime/route-executor.ts` lines 65-66

- [ ] **Step 1: Replace the single-line blocked message with multi-line actionable message**

Change:
```typescript
      return `Blocked by policy: ${result.reason}`;
```
To:
```typescript
      const reason = result.reason || "";
      if (reason.includes("approval") || reason.includes("Approval")) {
        const idMatch = reason.match(/(approval_[a-zA-Z0-9-]+)/);
        const approvalId = idMatch ? idMatch[1] : "";
        let msg = "Approval required.\n\nPending approval:\n";
        msg += `  ${approvalId || reason}\n\n`;
        msg += "Run:\n";
        msg += `  /approve ${approvalId || "<id>"}\n`;
        msg += "or:\n";
        msg += `  /deny ${approvalId || "<id>"}\n`;
        return msg;
      }
      return `Blocked by policy: ${reason}`;
```

This parses the `result.reason` for approval IDs (matching `approval_xxx` pattern) and reformats into a clear multi-line message with next-step commands. Non-approval policy blocks still use the original format.

---

### Task 3: Write end-to-end test for approval flow

**Files:**
- Create: `tests/tui/tui-approval-continuation.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../../src/tui/approval-manager.js";
import type { ApprovalManagerDeps } from "../../src/tui/approval-manager.js";

describe("TUI approval continuation", () => {
  let pendingList: Array<{ id: string; capability?: string; reason: string; createdAt: string }> = [];

  const deps: ApprovalManagerDeps = {
    listPendingApprovals: async () => pendingList,
    resolveApproval: async (id, status) => {
      if (id === "approval_unknown") {
        return { success: false, message: `Approval not found: ${id}` };
      }
      return { success: true, message: `Approval ${id} ${status}.` };
    },
  };

  const manager = new ApprovalManager(deps);

  beforeEach(() => {
    pendingList = [
      { id: "approval_001", capability: "filesystem.read", reason: "list files in directory", createdAt: new Date().toISOString() },
    ];
  });

  it("/approvals lists pending approvals", async () => {
    const result = await manager.tryHandleCommand("/approvals");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("approval_001"));
    assert.ok(result.message.includes("filesystem.read"));
  });

  it("/approvals shows empty message when no pending", async () => {
    pendingList = [];
    const result = await manager.tryHandleCommand("/approvals");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("No pending"));
  });

  it("/approve <id> marks approval approved", async () => {
    const result = await manager.tryHandleCommand("/approve approval_001");
    assert.equal(result.handled, true);
    assert.equal(result.action, "approved");
    assert.equal(result.approvalId, "approval_001");
  });

  it("/deny <id> marks approval denied", async () => {
    const result = await manager.tryHandleCommand("/deny approval_001");
    assert.equal(result.handled, true);
    assert.equal(result.action, "denied");
    assert.equal(result.approvalId, "approval_001");
  });

  it("unknown approval ID shows helpful error", async () => {
    const result = await manager.tryHandleCommand("/approve approval_unknown");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("not found"));
  });

  it("/approve without ID shows usage", async () => {
    const result = await manager.tryHandleCommand("/approve");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("Usage"));
  });

  it("/deny without ID shows usage", async () => {
    const result = await manager.tryHandleCommand("/deny");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("Usage"));
  });

  it("non-approval command is not handled", async () => {
    const result = await manager.tryHandleCommand("list files");
    assert.equal(result.handled, false);
  });
});
```

- [ ] **Step 2: Run the test**

Run:
```bash
npm run build
node --test dist/tests/tui/tui-approval-continuation.test.js
```
Expected: 8/8 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/tui-approval-continuation.test.js` — 8/8 pass
3. `node --test dist/tests/tui/*.test.js` — all TUI tests pass
4. Full suite — no regressions
5. Go to the help text in the TUI and verify `/approvals /approve /deny` appear
6. Git diff shows only the intended files
