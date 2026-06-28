# M0.61 TUI Approval Store Session Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/approve approval_xxx` find the approval that was created by `PolicyGate`/`ToolExecutor` during the same TUI session.

**Root cause:** `ApprovalStore.resolve()` searches in-memory (`this.approvals.find()`). The approval was created by a different `ApprovalStore` instance (inside `PolicyGate.handleAskDecision()`), which wrote to disk. The TUI's `resolveApproval` closure never reloads from disk before resolving, so the in-memory array is stale.

**Architecture:** Single fix — call `await approvalStore.load()` before `resolve()` in the TUI's `resolveApproval` closure. This reloads from disk and picks up approvals created by any `ApprovalStore` instance. No structural changes needed.

**Tech Stack:** TypeScript, existing ApprovalStore, `node:test`.

---

## File Structure

### Modify
- `src/cli/commands/tui.ts` — add `load()` before `resolve()` in the resolveApproval closure

### Create
- `tests/tui/tui-approval-persistence.test.ts` — guard test proving same-session approval cross-instance resolve works

---

### Task 1: Fix resolveApproval to reload from disk

**Files:**
- Modify: `src/cli/commands/tui.ts` lines 95-99

- [ ] **Step 1: Add `load()` before `resolve()`**

Change:
```typescript
    resolveApproval: async (id, status) => {
      const record = await approvalStore.resolve(id, status, `Resolved by user via TUI`);
      if (!record) return { success: false, message: `Approval not found: ${id}` };
      return { success: true, message: `Approval ${id} ${status}.` };
    },
```

To:
```typescript
    resolveApproval: async (id, status) => {
      await approvalStore.load(); // reload from disk — approval may have been created by PolicyGate
      const record = await approvalStore.resolve(id, status, `Resolved by user via TUI`);
      if (!record) return { success: false, message: `Approval not found: ${id}` };
      return { success: true, message: `Approval ${id} ${status}.` };
    },
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Write guard test

**Files:**
- Create: `tests/tui/tui-approval-persistence.test.ts`

- [ ] **Step 1: Write the test**

```typescript
/**
 * tui-approval-persistence.test.ts — Guard test for approval store cross-instance persistence.
 *
 * The bug: ApprovalStore.resolve() searches in-memory this.approvals.
 * When PolicyGate creates an approval via a different ApprovalStore instance,
 * the TUI's store doesn't have it in memory. The fix: call load() before resolve().
 *
 * This test simulates that exact scenario:
 *   1. Instance A creates an approval (simulates PolicyGate) — saves to disk
 *   2. Instance B (simulates /approve handler) loads from disk then resolves
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("TUI approval store cross-instance persistence", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-persist-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cross-instance: approval created by one store is found by another", async () => {
    // Instance A: simulates PolicyGate creating an approval
    const storeA = new ApprovalStore(tmpDir);
    await storeA.load();
    const record = await storeA.request({
      capability: "filesystem.read",
      reason: "list files",
    });
    const approvalId = record.id;
    assert.equal(record.status, "pending");

    // Instance B: simulates TUI /approve handler
    // Does NOT share in-memory state with storeA
    const storeB = new ApprovalStore(tmpDir);
    await storeB.load(); // THIS IS THE FIX — reload from disk
    const resolved = await storeB.resolve(approvalId, "approved", "User approved via TUI");

    assert.ok(resolved, `approval ${approvalId} must be found by storeB after load()`);
    assert.equal(resolved!.status, "approved");
    assert.equal(resolved!.id, approvalId);
  });

  it("cross-instance: denial works across stores", async () => {
    const storeA = new ApprovalStore(tmpDir);
    await storeA.load();
    const record = await storeA.request({
      capability: "shell.run",
      reason: "run command",
    });
    const approvalId = record.id;

    const storeB = new ApprovalStore(tmpDir);
    await storeB.load();
    const resolved = await storeB.resolve(approvalId, "denied", "User denied");

    assert.ok(resolved, `approval ${approvalId} must be found`);
    assert.equal(resolved!.status, "denied");
  });

  it("cross-instance: unknown ID still returns null", async () => {
    const store = new ApprovalStore(tmpDir);
    await store.load();
    const result = await store.resolve("approval_nonexistent", "approved", "test");
    assert.equal(result, null);
  });

  it("approval appears in listPending after cross-instance create", async () => {
    const storeA = new ApprovalStore(tmpDir);
    await storeA.load();
    await storeA.request({ capability: "test.read", reason: "cross-instance list" });

    const storeB = new ApprovalStore(tmpDir);
    await storeB.load();
    const pending = storeB.listPending();

    assert.ok(pending.length > 0, "storeB must see approvals from storeA after load()");
    assert.ok(pending.some(a => a.capability === "test.read"), "must find the cross-instance approval");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run build && node --test dist/tests/tui/tui-approval-persistence.test.js`
Expected: 4/4 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/tui-approval-persistence.test.js` — 4/4 pass
3. `node --test dist/tests/tui/*.test.js` — all TUI tests pass
4. Full suite — no regressions
5. Git diff shows only the intended files
