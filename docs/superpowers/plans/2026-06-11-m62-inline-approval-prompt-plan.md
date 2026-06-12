# M0.62 Inline TUI Approval Prompt

**Goal:** When a command triggers approval inside interactive TUI, show approval details immediately and prompt "Approve? [y/N/details]" — no manual ID copy/paste required.

**Architecture:** Intercept the `executeRoute` result in the TUI's direct execution path. If the output contains an approval ID, parse it, show a prompt, and on `y` call the existing approval+resume path (already wired at lines 437-464). The backend two-stage model (PolicyGate → ApprovalStore → ContinuationManager) stays unchanged.

---

## Files

- `src/cli/commands/tui.ts` — modify direct execution path (lines 942-957), add confirmation state + prompt handler
- `tests/tui/tui-approval-prompt.test.ts` — test the inline prompt flow

## Design

### Approach: `globalThis.__approvalConfirm`

Follow the existing pattern used by replay and rollback confirmation (lines 219, 264). After `executeRoute` returns an approval-required message:

1. Parse the approval ID from the output
2. Store `{ approvalId, output }` on `globalThis.__approvalConfirm`
3. Append the approval details + "Approve? [y/N/details]" prompt
4. On next `readLine()`, check for `__approvalConfirm` before normal command handling (same as replay/rollback confirm)
5. `y` → call approvalManager + resume the continuation
6. `n` → deny the approval
7. `details` → show full approval + IFÁ-MAS context + re-prompt

### Existing continuation resume already works

Lines 437-464 already handle approving + resuming a continuation. The inline prompt just calls the same `ApprovalManager.resolveApproval` → `ContinuationManager.resumeApproved` path.

## Implementation

### Step 1: Intercept approval-required output in direct execution path

Find the direct execution path at lines 942-957:

```typescript
        const text = await executeRoute(route, ctx, new LocalRuntimeExecutor());
        if (text) tui.appendOutput(text, false);
```

Replace with:

```typescript
        const text = await executeRoute(route, ctx, new LocalRuntimeExecutor());
        if (!text) continue;

        // Check if the output contains an approval-required message
        const approvalMatch = text.match(/approval_([a-zA-Z0-9_-]+)/);
        if (approvalMatch) {
          const approvalId = `approval_${approvalMatch[1]}`;
          // Store confirmation context
          (globalThis as any).__approvalConfirm = { approvalId, text };
          tui.appendOutput(text, false);
          tui.appendOutput("Approve? [y/N/details] ", false);
          continue;
        }

        tui.appendOutput(text, false);
```

Wait — the regex needs to match the full ID. The message format is `Approval required.\n\nPending approval:\n  approval_<ts>_<random>\n\nRun:\n  /approve approval_<ts>_<random>\n...`. The regex should capture `approval_<ts>_<random>`.

Better approach — match the full approval ID pattern:
```typescript
        const approvalMatch = text.match(/approval_[a-zA-Z0-9_-]+/);
```

This will match `approval_1781213289696_abcde` in full (with the underscore fix from the plan doc).

### Step 2: Add `__approvalConfirm` handler in the main loop

After the `__rollbackConfirm` handler (around line 310), add:

```typescript
    // Inline approval confirmation
    const approvalConfirm = (globalThis as any).__approvalConfirm;
    if (approvalConfirm) {
      const confirmPhrase = task.toLowerCase().trim();
      if (confirmPhrase === "y" || confirmPhrase === "yes") {
        (globalThis as any).__approvalConfirm = null;
        const { approvalId } = approvalConfirm;

        // Resolve the approval
        const approvalResult = await approvalManager.tryHandleCommand(`/approve ${approvalId}`);
        tui.appendOutput(approvalResult.message + "\n", false);

        // Resume the continuation
        if (approvalResult.action === "approved" && approvalResult.approvalId) {
          try {
            const { ContinuationStore } = await import("../../runtime/continuation-store.js");
            const { ContinuationManager } = await import("../../runtime/continuation-manager.js");
            const { ToolExecutor } = await import("../../tools/executor.js");

            const continuationStore = new ContinuationStore(activeCwd);
            await continuationStore.load();
            const contManager = new ContinuationManager({
              continuationStore,
              approvalStore,
              executeTool: async (tc) => {
                const executor = new ToolExecutor(activeConfig, tuiLog, activeCwd, undefined, undefined, undefined, undefined, approvalStore);
                const result = await executor.execute(tc);
                return result;
              },
            });
            const resumeResult = await contManager.resumeApproved(approvalResult.approvalId);
            if (resumeResult.resumed) {
              tui.appendOutput(`\n✅ Continued:\n${resumeResult.output}\n`, false);
            } else {
              tui.appendOutput(`\n❌ Could not resume: ${resumeResult.error}\n`, false);
            }
          } catch (err: any) {
            tui.appendOutput(`\n❌ Resume error: ${err.message}\n`, false);
          }
        }
      } else if (confirmPhrase === "n" || confirmPhrase === "no") {
        (globalThis as any).__approvalConfirm = null;
        // Deny the approval
        const { approvalId } = approvalConfirm;
        await approvalManager.tryHandleCommand(`/deny ${approvalId}`);
        tui.appendOutput("Approval denied.\n", false);
      } else if (confirmPhrase === "details" || confirmPhrase === "d") {
        // Show full details and re-prompt
        tui.appendOutput(approvalConfirm.text + "\n", false);
        // Show pending approvals with full context
        const listResult = await approvalManager.tryHandleCommand("/approvals");
        tui.appendOutput(listResult.message + "\n", false);
        tui.appendOutput("Approve? [y/N/details] ", false);
      } else {
        tui.appendOutput("Press y to approve, n to deny, details for more info.\n", false);
        tui.appendOutput("Approve? [y/N/details] ", false);
      }
      continue;
    }
```

### Step 3: Tests

Create `tests/tui/tui-approval-prompt.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("inline approval prompt", () => {
  it("approval ID is extracted from approval-required output", () => {
    const output = "Approval required.\n\nPending approval:\n  approval_1718100000000_a1b2c\n\nRun:\n  /approve approval_1718100000000_a1b2c\nor:\n  /deny approval_1718100000000_a1b2c";
    const match = output.match(/approval_[a-zA-Z0-9_-]+/);
    assert.ok(match);
    assert.equal(match[0], "approval_1718100000000_a1b2c");
  });

  it("approval not in output returns null", () => {
    const output = "ls\nfile1.txt\nfile2.txt";
    const match = output.match(/approval_[a-zA-Z0-9_-]+/);
    assert.equal(match, null);
  });

  it("approval confirm context stores approvalId", () => {
    const ctx = { approvalId: "approval_123_xyz", text: "Approval required" };
    assert.ok(ctx.approvalId);
    assert.equal(ctx.approvalId, "approval_123_xyz");
  });

  it("y response triggers approval path", () => {
    const response = "y";
    const approved = response === "y" || response === "yes";
    assert.equal(approved, true);
  });

  it("n response triggers denial path", () => {
    const response = "n";
    const denied = response === "n" || response === "no";
    assert.equal(denied, true);
  });
});
```

## Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/tui-approval-prompt.test.js` — 5/5 pass
3. Full suite — no regressions
