# M0.30: Approval UX & Continuation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PolicyGate `ask` decisions operational — visible in the TUI, resolvable via `/approve`/`/deny` commands, and resumable without losing the original execution context.

**Architecture:** Three new components: `ContinuationStore` (persist blocked operations), `ContinuationManager` (resume approved calls with argsHash verification), `ApprovalManager` (TUI commands). ToolExecutor creates continuations on `ask`. The TUI loop checks workspace commands, then approval commands, then normal task submission.

**Tech Stack:** TypeScript/ESM, Node >= 24, file-based persistence under `.alix/approvals/`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/continuation-store.ts` | Create | `PendingContinuation` type, file-backed persistence at `.alix/approvals/continuations.json` |
| `src/runtime/continuation-manager.ts` | Create | `resumeApproved()` — verify argsHash, re-execute via ToolExecutor |
| `src/tui/approval-manager.ts` | Create | `/approvals`, `/approve <id>`, `/deny <id>` TUI commands |
| `src/cli/commands/tui.ts` | Modify | Wire ApprovalManager into loop, approval display for `ask` results |
| `src/tools/executor.ts` | Modify | On `ask`: create continuation before returning. On resume: accept external `argsHash` verification |
| `src/runtime/route-executor.ts` | Modify | Export `hashArgs` or import from executor for continuation replay |
| `tests/runtime/continuation-store.test.ts` | Create | Persistence tests |
| `tests/runtime/continuation-manager.test.ts` | Create | Resume + safety tests |
| `tests/tui/approval-manager.test.ts` | Create | Command parsing tests |

---

### Task 1: ContinuationStore

**Files:**
- Create: `src/runtime/continuation-store.ts`

**Types:**

```typescript
// src/runtime/continuation-store.ts

export type PendingContinuation = {
  approvalId: string;
  kind: "tool" | "capability";
  sessionId: string;
  cwd: string;
  toolCall?: {
    toolCallId: string;
    name: string;
    capability: string;
    args: Record<string, unknown>;
    argsHash: string;
  };
  createdAt: string;
};

export class ContinuationStore {
  private continuations: PendingContinuation[] = [];
  private dirty = false;
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "approvals", "continuations.json");
  }

  async load(): Promise<void> { /* same pattern as ApprovalStore */ }
  async save(): Promise<void> { /* same pattern — write if dirty */ }

  persist(cont: PendingContinuation): Promise<void>;
  findByApprovalId(approvalId: string): PendingContinuation | undefined;
  remove(approvalId: string): Promise<void>;
  list(): PendingContinuation[];
}
```

- [ ] **Step 1: Write `src/runtime/continuation-store.ts`**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type PendingContinuation = {
  approvalId: string;
  kind: "tool" | "capability";
  sessionId: string;
  cwd: string;
  toolCall?: {
    toolCallId: string;
    name: string;
    capability: string;
    args: Record<string, unknown>;
    argsHash: string;
  };
  createdAt: string;
};

export class ContinuationStore {
  private continuations: PendingContinuation[] = [];
  private dirty = false;
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "approvals", "continuations.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.continuations = [];
      this.dirty = false;
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.continuations = JSON.parse(raw);
      this.dirty = false;
    } catch {
      this.continuations = [];
      this.dirty = false;
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.filePath, JSON.stringify(this.continuations, null, 2), "utf-8");
    this.dirty = false;
  }

  async persist(cont: PendingContinuation): Promise<void> {
    this.continuations.push(cont);
    this.dirty = true;
    await this.save();
  }

  findByApprovalId(approvalId: string): PendingContinuation | undefined {
    return this.continuations.find(c => c.approvalId === approvalId);
  }

  async remove(approvalId: string): Promise<void> {
    this.continuations = this.continuations.filter(c => c.approvalId !== approvalId);
    this.dirty = true;
    await this.save();
  }

  list(): PendingContinuation[] {
    return [...this.continuations];
  }
}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/continuation-store.ts
git commit -m "feat(policy): add ContinuationStore for pending execution records"
```

---

### Task 2: ApprovalManager (TUI)

**Files:**
- Create: `src/tui/approval-manager.ts`

Follow the same pattern as `WorkspaceManager` — a class that parses input and returns structured results. The continuation manager is injected as a dependency so this layer doesn't import executor details.

**Types:**

```typescript
export type ApprovalManagerResult =
  | { handled: false }
  | { handled: true; message: string; action?: "approved" | "denied"; approvalId?: string };

export interface ApprovalManagerDeps {
  listPendingApprovals(): Promise<Array<{ id: string; capability?: string; reason: string; toolId?: string; createdAt: string }>>;
  resolveApproval(id: string, status: "approved" | "denied"): Promise<{ success: boolean; message: string }>;
}
```

**Commands:**

| Input | Action |
|-------|--------|
| `/approvals` | List all pending approvals with ID, capability, reason |
| `/approve <id>` | Call `resolveApproval(id, "approved")` |
| `/deny <id>` | Call `resolveApproval(id, "denied")` |

- [ ] **Step 1: Write `src/tui/approval-manager.ts`**

```typescript
/**
 * approval-manager.ts — TUI commands for approval lifecycle.
 *
 * Parses /approvals, /approve, /deny commands.
 * Follows the same pattern as WorkspaceManager.
 */

export type ApprovalManagerResult =
  | { handled: false }
  | { handled: true; message: string; action?: "approved" | "denied"; approvalId?: string };

export interface ApprovalManagerDeps {
  listPendingApprovals(): Promise<Array<{ id: string; capability?: string; reason: string; toolId?: string; createdAt: string }>>;
  resolveApproval(id: string, status: "approved" | "denied"): Promise<{ success: boolean; message: string }>;
}

const APPROVAL_PREFIXES = ["/approvals", "/approval"] as const;

export class ApprovalManager {
  private deps: ApprovalManagerDeps;

  constructor(deps: ApprovalManagerDeps) {
    this.deps = deps;
  }

  async tryHandleCommand(input: string): Promise<ApprovalManagerResult> {
    const trimmed = input.trim();

    // /approvals or /approval — list pending
    if ((APPROVAL_PREFIXES as readonly string[]).includes(trimmed)) {
      return this.handleList();
    }

    // /approve <id>
    if (trimmed.startsWith("/approve ")) {
      const id = trimmed.slice(9).trim();
      if (!id) return { handled: true, message: "Usage: /approve <approval-id>" };
      return this.handleResolve(id, "approved");
    }

    // /deny <id>
    if (trimmed.startsWith("/deny ")) {
      const id = trimmed.slice(6).trim();
      if (!id) return { handled: true, message: "Usage: /deny <approval-id>" };
      return this.handleResolve(id, "denied");
    }

    return { handled: false };
  }

  private async handleList(): Promise<ApprovalManagerResult> {
    const pending = await this.deps.listPendingApprovals();
    if (pending.length === 0) {
      return { handled: true, message: "No pending approvals." };
    }
    const lines = pending.map(a =>
      `  ${a.id} — ${a.capability ?? "unknown"} (${a.reason})` +
      ` — created ${new Date(a.createdAt).toLocaleString()}`
    );
    return {
      handled: true,
      message: `Pending approvals:\n${lines.join("\n")}`,
    };
  }

  private async handleResolve(id: string, status: "approved" | "denied"): Promise<ApprovalManagerResult> {
    const result = await this.deps.resolveApproval(id, status);
    return {
      handled: true,
      message: result.message,
      action: status,
      approvalId: id,
    };
  }
}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/approval-manager.ts
git commit -m "feat(tui): add ApprovalManager for /approvals /approve /deny commands"
```

---

### Task 3: ContinuationManager

**Files:**
- Create: `src/runtime/continuation-manager.ts`

The bridge between an approved approval and actually re-executing the blocked tool call. Takes `ContinuationStore`, `ApprovalStore`, and a `executeTool` callback.

```typescript
export class ContinuationManager {
  constructor(
    private deps: {
      continuationStore: ContinuationStore;
      approvalStore: ApprovalStore;
      executeTool: (toolCall: { toolCallId: string; name: string; args: Record<string, unknown> }) => Promise<{ kind: string; output?: string; content?: string; message?: string }>;
    },
  ) {}

  /**
   * Resume a blocked tool call after approval.
   * Returns the tool result or an error message.
   */
  async resumeApproved(approvalId: string): Promise<{ resumed: boolean; output?: string; error?: string }> {
    // 1. Verify approval is actually approved
    const approval = this.deps.approvalStore.get(approvalId);
    if (!approval) return { resumed: false, error: `Approval not found: ${approvalId}` };
    if (approval.status !== "approved") return { resumed: false, error: `Approval ${approvalId} status is '${approval.status}', not 'approved'` };

    // 2. Look up continuation
    const cont = this.deps.continuationStore.findByApprovalId(approvalId);
    if (!cont) return { resumed: false, error: `No continuation record for approval: ${approvalId}` };
    if (cont.kind !== "tool" || !cont.toolCall) return { resumed: false, error: `Continuation '${cont.kind}' cannot be resumed (only 'tool' supported in M0.30)` };

    // 3. Verify argsHash integrity
    const { hashArgs } = await import("../tools/executor.js");
    const currentHash = hashArgs(cont.toolCall.args);
    if (currentHash !== cont.toolCall.argsHash) {
      return { resumed: false, error: "Args hash mismatch — continuation rejected for safety" };
    }

    // 4. Remove continuation (one-shot)
    await this.deps.continuationStore.remove(approvalId);

    // 5. Re-execute
    const result = await this.deps.executeTool(cont.toolCall);
    if (result.kind === "success") {
      return { resumed: true, output: result.output || result.content || "(tool completed)" };
    }
    return { resumed: false, error: result.kind === "error" ? result.message : "Tool request denied" };
  }
}
```

- [ ] **Step 1: Write `src/runtime/continuation-manager.ts`**

```typescript
/**
 * continuation-manager.ts — Resume blocked tool calls after approval.
 *
 * Verifies approval status, argsHash integrity, then re-executes the
 * original tool call. Each continuation is one-shot — removed on resume.
 */

import type { ApprovalStore } from "../approvals/approval-store.js";
import type { ContinuationStore } from "./continuation-store.js";

export interface ContinuationManagerDeps {
  continuationStore: ContinuationStore;
  approvalStore: ApprovalStore;
  executeTool: (toolCall: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  }) => Promise<{ kind: string; output?: string; content?: string; message?: string }>;
}

export class ContinuationManager {
  constructor(private deps: ContinuationManagerDeps) {}

  async resumeApproved(approvalId: string): Promise<{ resumed: boolean; output?: string; error?: string }> {
    // 1. Verify approval is actually approved
    const approval = this.deps.approvalStore.get(approvalId);
    if (!approval) {
      return { resumed: false, error: `Approval not found: ${approvalId}` };
    }
    if (approval.status !== "approved") {
      return { resumed: false, error: `Approval ${approvalId} status is '${approval.status}', not 'approved'` };
    }

    // 2. Look up continuation
    const cont = this.deps.continuationStore.findByApprovalId(approvalId);
    if (!cont) {
      return { resumed: false, error: `No continuation record for approval: ${approvalId}` };
    }
    if (cont.kind !== "tool" || !cont.toolCall) {
      return { resumed: false, error: `Continuation '${cont.kind}' cannot be resumed (only 'tool' supported in M0.30)` };
    }

    // 3. Verify argsHash integrity
    const { hashArgs } = await import("../tools/executor.js");
    const currentHash = hashArgs(cont.toolCall.args);
    if (currentHash !== cont.toolCall.argsHash) {
      return { resumed: false, error: `Args hash mismatch — expected ${cont.toolCall.argsHash}, got ${currentHash}. Continuation rejected for safety.` };
    }

    // 4. Remove continuation (one-shot)
    await this.deps.continuationStore.remove(approvalId);

    // 5. Re-execute
    const result = await this.deps.executeTool(cont.toolCall);
    if (result.kind === "success") {
      return { resumed: true, output: result.output || result.content || "(tool completed)" };
    }
    return { resumed: false, error: result.kind === "error" ? result.message : "Tool request denied" };
  }
}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/runtime/continuation-manager.ts
git commit -m "feat(runtime): add ContinuationManager with argsHash verification"
```

---

### Task 4: Wire continuation creation into ToolExecutor

**Files:**
- Modify: `src/tools/executor.ts`

When PolicyGate returns `ask`, ToolExecutor should create a continuation record before returning the denied response.

- [ ] **Step 1: Add continuation store instantiation and creation on `ask`**

In the `ask` branch of `execute()`, after the existing `return { kind: "denied" }` replacement:

```typescript
    if (policyDecision.decision === "ask") {
      // Persist continuation so approval can resume this tool call
      try {
        const { ContinuationStore } = await import("../runtime/continuation-store.js");
        const continuationStore = new ContinuationStore(this.root);
        await continuationStore.load();
        await continuationStore.persist({
          approvalId: policyDecision.approvalId!,
          kind: "tool",
          sessionId: this.sessionId(),
          cwd: this.root,
          toolCall: {
            toolCallId,
            name,
            capability,
            args,
            argsHash: argumentHash,
          },
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        // Continuation is best-effort — if persistence fails, the user can still manually re-run
        console.error("Failed to persist continuation:", err);
      }

      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: `Approval required: ${policyDecision.approvalId}`, durationMs: 0, canonicalCapability, argumentHash });
      return { kind: "denied", reason: `Approval required (${policyDecision.approvalId}): ${policyDecision.reason}` };
    }
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Run existing tests**

```bash
node --test dist/tests/policy/policy-gate.test.js 2>&1 | tail -5
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add src/tools/executor.ts
git commit -m "feat(tools): persist continuation record on ask decision"
```

---

### Task 5: Wire ApprovalManager into TUI loop

**Files:**
- Modify: `src/cli/commands/tui.ts`

Wire `ApprovalManager` into the TUI loop. The loop order becomes:

```
1. WorkspaceManager.tryHandleCommand(input)
2. ApprovalManager.tryHandleCommand(input)
3. Normal task submission
```

When `ApprovalManager` returns `{ action: "approved", approvalId }`, call `ContinuationManager.resumeApproved()` and display the result.

- [ ] **Step 1: Add imports and setup to `runTui()`**

```typescript
import { ApprovalManager } from "../../tui/approval-manager.js";
import { ContinuationStore } from "../../runtime/continuation-store.js";
import { ContinuationManager } from "../../runtime/continuation-manager.js";
import { ToolExecutor } from "../../tools/executor.js";

// In runTui(), after workspaceManager is created:
const approvalManager = new ApprovalManager({
  listPendingApprovals: async () => {
    // Use the same ApprovalStore from the config
    const { ApprovalStore } = await import("../../approvals/approval-store.js");
    const store = new ApprovalStore(activeCwd);
    await store.load();
    return store.listPending();
  },
  resolveApproval: async (id, status) => {
    const { ApprovalStore } = await import("../../approvals/approval-store.js");
    const store = new ApprovalStore(activeCwd);
    await store.load();
    const record = await store.resolve(id, status, `Resolved by user via TUI`);
    if (!record) return { success: false, message: `Approval not found: ${id}` };
    return { success: true, message: `Approval ${id} ${status}.` };
  },
});
```

- [ ] **Step 2: Add approval check before task submission**

Inside the main TUI loop, after workspace command handling and before echoTask/normal submission:

```typescript
// --- Approval commands ---
const approvalResult = await approvalManager.tryHandleCommand(task);
if (approvalResult.handled) {
  tui.appendSafe(`\n${approvalResult.message}`);

  // If approved, try to resume the continuation
  if (approvalResult.action === "approved" && approvalResult.approvalId) {
    try {
      const continuationStore = new ContinuationStore(activeCwd);
      await continuationStore.load();
      const contManager = new ContinuationManager({
        continuationStore,
        approvalStore,  // needs to be available in scope
        executeTool: async (tc) => {
          const executor = new ToolExecutor(activeConfig, eventLog, activeCwd);
          const result = await executor.execute(tc);
          return result;
        },
      });
      const resumeResult = await contManager.resumeApproved(approvalResult.approvalId);
      if (resumeResult.resumed) {
        tui.appendSafe(`\n✅ Continued:\n${resumeResult.output}`);
      } else {
        tui.appendSafe(`\n❌ Could not resume: ${resumeResult.error}`);
      }
    } catch (err: any) {
      tui.appendSafe(`\n❌ Resume error: ${err.message}`);
    }
  }
  continue;
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire ApprovalManager + continuation resume into TUI loop"
```

---

### Task 6: ContinuationStore unit tests

**Files:**
- Create: `tests/runtime/continuation-store.test.ts`

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuationStore, type PendingContinuation } from "../../src/runtime/continuation-store.js";

const makeCont = (approvalId: string, overrides?: Partial<PendingContinuation>): PendingContinuation => ({
  approvalId,
  kind: "tool",
  sessionId: "sess_test",
  cwd: "/tmp",
  toolCall: { toolCallId: "tc1", name: "shell.run", capability: "shell.run", args: { command: "echo hi" }, argsHash: "abc123" },
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("ContinuationStore", () => {
  let tmpDir: string;
  let store: ContinuationStore;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cont-store-"));
    store = new ContinuationStore(tmpDir);
    await store.load();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists and retrieves a continuation", async () => {
    await store.persist(makeCont("approval_001"));
    const found = store.findByApprovalId("approval_001");
    assert.ok(found);
    assert.equal(found?.toolCall?.name, "shell.run");
  });

  it("returns undefined for unknown approvalId", () => {
    const found = store.findByApprovalId("nonexistent");
    assert.equal(found, undefined);
  });

  it("removes a continuation", async () => {
    await store.persist(makeCont("approval_002"));
    await store.remove("approval_002");
    assert.equal(store.findByApprovalId("approval_002"), undefined);
  });

  it("lists all continuations", async () => {
    await store.persist(makeCont("approval_003"));
    await store.persist(makeCont("approval_004"));
    const all = store.list();
    assert.ok(all.length >= 2);
  });

  it("survives save and reload cycle", async () => {
    await store.persist(makeCont("approval_005"));
    const store2 = new ContinuationStore(tmpDir);
    await store2.load();
    assert.ok(store2.findByApprovalId("approval_005"));
  });
});
```

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/continuation-store.test.js 2>&1
```

Expected: 5 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/continuation-store.test.ts
git commit -m "test(policy): add ContinuationStore unit tests"
```

---

### Task 7: ContinuationManager unit tests

**Files:**
- Create: `tests/runtime/continuation-manager.test.ts`

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuationManager } from "../../src/runtime/continuation-manager.js";
import { ContinuationStore } from "../../src/runtime/continuation-store.js";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("ContinuationManager", () => {
  let tmpDir: string;
  let continuationStore: ContinuationStore;
  let approvalStore: ApprovalStore;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cont-mgr-"));
    mkdirSync(join(tmpDir, ".alix", "approvals"), { recursive: true });
    continuationStore = new ContinuationStore(tmpDir);
    await continuationStore.load();
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects unknown approval", async () => {
    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });
    const result = await mgr.resumeApproved("nonexistent");
    assert.equal(result.resumed, false);
    assert.ok(result.error?.includes("not found"));
  });

  it("rejects non-approved status", async () => {
    const approval = await approvalStore.request({ reason: "test", capability: "shell.run" });
    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });
    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, false);
    assert.ok(result.error?.includes("not 'approved'"));
  });

  it("resumes an approved and persisted tool call", async () => {
    const approval = await approvalStore.request({ reason: "test resume", capability: "shell.run" });
    await approvalStore.resolve(approval.id, "approved", "Test approved");
    await continuationStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_resume", name: "shell.run", capability: "shell.run", args: { command: "echo done" }, argsHash: "abc123" },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "executed" }),
    });
    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, true);
    assert.equal(result.output, "executed");
  });

  it("rejects argsHash mismatch", async () => {
    const approval = await approvalStore.request({ reason: "test hash", capability: "file.read" });
    await approvalStore.resolve(approval.id, "approved", "Approved");
    await continuationStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_hash", name: "file.read", capability: "file.read", args: { path: "/etc/passwd" }, argsHash: "original_hash" },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "should not run" }),
    });
    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, false);
    assert.ok(result.error?.includes("hash mismatch"));
  });

  it("is one-shot — continuation removed after resume", async () => {
    const approval = await approvalStore.request({ reason: "test oneshot", capability: "shell.run" });
    await approvalStore.resolve(approval.id, "approved", "Approved");
    await continuationStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_oneshot", name: "shell.run", capability: "shell.run", args: { command: "echo one" }, argsHash: "abc123" },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });
    await mgr.resumeApproved(approval.id);
    const cont = continuationStore.findByApprovalId(approval.id);
    assert.equal(cont, undefined);
  });
});
```

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/continuation-manager.test.js 2>&1
```

Expected: 5 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/continuation-manager.test.ts
git commit -m "test(policy): add ContinuationManager unit tests for resume + safety"
```

---

### Task 8: ApprovalManager unit tests

**Files:**
- Create: `tests/tui/approval-manager.test.ts`

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager, type ApprovalManagerDeps } from "../../src/tui/approval-manager.js";

describe("ApprovalManager", () => {
  let deps: ApprovalManagerDeps;
  let resolvedId: string | null;
  let resolvedStatus: string | null;

  beforeEach(() => {
    resolvedId = null;
    resolvedStatus = null;
    deps = {
      listPendingApprovals: async () => [
        { id: "approval_001", capability: "shell.run", reason: "Command 'rm' requires approval", toolId: "shell.run", createdAt: "2026-06-10T12:00:00Z" },
        { id: "approval_002", capability: "file.write", reason: "Path is protected", toolId: "file.write", createdAt: "2026-06-10T12:01:00Z" },
      ],
      resolveApproval: async (id, status) => {
        resolvedId = id;
        resolvedStatus = status;
        return { success: true, message: `Approval ${id} ${status}.` };
      },
    };
  });

  it("non-command returns handled: false", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("hello");
    assert.equal(r.handled, false);
  });

  it("/approvals lists pending approvals", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approvals");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("approval_001"));
    assert.ok((r as any).message.includes("approval_002"));
  });

  it("/approval alias lists pending approvals", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approval");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Pending approvals"));
  });

  it("/approve <id> resolves approval", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approve approval_001");
    assert.equal(r.handled, true);
    assert.equal((r as any).action, "approved");
    assert.equal((r as any).approvalId, "approval_001");
    assert.equal(resolvedId, "approval_001");
    assert.equal(resolvedStatus, "approved");
  });

  it("/deny <id> resolves as denied", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/deny approval_001");
    assert.equal(r.handled, true);
    assert.equal((r as any).action, "denied");
    assert.equal((r as any).approvalId, "approval_001");
    assert.equal(resolvedStatus, "denied");
  });

  it("/approve without id shows usage", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approve");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Usage"));
  });

  it("/deny without id shows usage", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/deny");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Usage"));
  });

  it("empty list returns no pending message", async () => {
    const emptyDeps: ApprovalManagerDeps = {
      ...deps,
      listPendingApprovals: async () => [],
    };
    const mgr = new ApprovalManager(emptyDeps);
    const r = await mgr.tryHandleCommand("/approvals");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("No pending approvals"));
  });
});
```

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/tui/approval-manager.test.js 2>&1
```

Expected: 8 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/approval-manager.test.ts
git commit -m "test(tui): add ApprovalManager unit tests for command parsing"
```

---

### Task 9: Build, verify, tag

- [ ] **Step 1: Build and run all tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/*.test.js dist/tests/runtime/*.test.js dist/tests/daemon/*.test.js dist/tests/tui/*.test.js dist/tests/integration/smoke.test.js --test-concurrency=1 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: Commit spec and plan docs**

```bash
git add docs/superpowers/specs/2026-06-10-m30-approval-continuation-design.md docs/superpowers/plans/2026-06-10-m30-approval-continuation.md
git commit -m "docs: add M0.30 Approval UX and Continuation spec and plan"
```

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.30-approval-continuation -m "M0.30 Approval UX and Continuation: ask decisions become operational — visible in TUI, resolvable via /approve /deny, resumable via ContinuationManager"
git push origin m0.30-approval-continuation
```

---

## Self-review checklist

| Check | Task | Notes |
|-------|------|-------|
| ContinuationStore type definition | Task 1 | `PendingContinuation` with `approvalId`, `kind`, `toolCall`, `argsHash` |
| Persistence round-trip | Task 6 | save → load → verify |
| ApprovalManager command parsing | Task 2 | `/approvals`, `/approve`, `/deny` |
| ContinuationManager resume logic | Task 3 | status check → continuation lookup → argsHash verify → execute |
| argsHash integrity on resume | Task 3 | `hashArgs()` imported from executor, compared to stored `argsHash` |
| Continuation creation on `ask` | Task 4 | ToolExecutor persists continuation before returning denied |
| TUI loop integration | Task 5 | WorkspaceManager first → ApprovalManager second → normal task |
| One-shot removal | Task 3 | `continuationStore.remove()` after resume |
| Deny does not resume | Task 7 | Test: non-approved status returns error |
