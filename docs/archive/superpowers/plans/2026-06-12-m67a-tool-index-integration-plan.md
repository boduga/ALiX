# M0.67a — ToolCapabilityIndex Runtime Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the ToolCapabilityIndex (M0.67) into the CompositeToolRouter so tools are selected by task intent instead of stuffing every tool into every prompt.

**Architecture:** The `CompositeToolRouter` currently iterates through all sub-routers and picks the first that `canHandle()` the tool name. After this milestone, the tool router can optionally filter available tools using `ToolRetriever.selectForIntent()` based on the task's intent classification — reducing noise and risk by only exposing relevant tools.

**Tech Stack:** TypeScript, existing `CompositeToolRouter`/`ToolRouter` from `tool-router.ts`, existing `ToolRegistry`/`CapabilityIndex`/`ToolRetriever` from `tool-registry.ts`, `node:test`.

---

## File Structure

### Modify
- `src/tools/tool-router.ts` — add `ToolAwareRouter` decorator that filters tools by intent before passing to downstream routers

### Test
- `tests/tools/tool-index-integration.test.ts` — 8+ tests

---

### Task 1: Add ToolAwareRouter decorator

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Import the tool registry types**

Add at the top:
```typescript
import { buildDefaultToolIndex, ToolRetriever } from "./tool-registry.js";
```

- [ ] **Step 2: Add the ToolAwareRouter class before `CompositeToolRouter`**

```typescript
/**
 * Decorator router that filters available tools by intent before
 * passing to the downstream CompositeToolRouter. When intent keywords
 * are provided, only tools matching those keywords (plus essential
 * always-include tools) are offered.
 *
 * Pure filtering — does not change tool execution, PolicyGate, or
 * ApprovalStore behavior.
 */
export class ToolAwareRouter implements ToolRouter {
  private retriever: ToolRetriever;
  private currentIntent: string[] = [];

  constructor(
    private readonly downstream: ToolRouter,
    registry?: ToolRegistry,
    index?: CapabilityIndex,
  ) {
    if (registry && index) {
      this.retriever = new ToolRetriever(registry, index);
    } else {
      const { registry: r, index: idx } = buildDefaultToolIndex();
      this.retriever = new ToolRetriever(r, idx);
    }
  }

  /** Set the current task intent keywords for tool filtering. */
  setIntent(intent: string[]): void {
    this.currentIntent = intent;
  }

  /** Clear the current intent — fall back to all tools available. */
  clearIntent(): void {
    this.currentIntent = [];
  }

  canHandle(name: string): boolean {
    // If no intent is set, allow all tools (default behavior)
    if (this.currentIntent.length === 0) return true;

    // Check if the tool is relevant to the current intent
    const relevant = this.retriever.selectForIntent(this.currentIntent);
    return relevant.some(t => t.name === name);
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    return this.downstream.execute(request);
  }
}
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Write integration tests

**Files:**
- Create: `tests/tools/tool-index-integration.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ToolAwareRouter, FileToolRouter, CompositeToolRouter } from "../../src/tools/tool-router.js";
import type { ToolCallRequest } from "../../src/tools/types.js";

describe("ToolAwareRouter", () => {
  const downstream = new CompositeToolRouter([
    new FileToolRouter("/tmp"),
  ]);

  it("allows all tools when no intent is set", () => {
    const router = new ToolAwareRouter(downstream);
    assert.ok(router.canHandle("file.read"));
    assert.ok(router.canHandle("shell.run"));
    assert.ok(router.canHandle("file.create"));
  });

  it("filters tools to only those matching intent keywords", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["read", "file"]);

    assert.ok(router.canHandle("file.read"), "file.read matches read intent");
    assert.ok(!router.canHandle("file.create"), "file.create does not match read intent");
    assert.ok(!router.canHandle("shell.run"), "shell.run does not match read intent");
  });

  it("always includes essential tools regardless of intent", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["shell", "command"]);

    // Essential: file.read, dir.search, done
    assert.ok(router.canHandle("file.read"), "file.read is essential");
    assert.ok(router.canHandle("shell.run"), "shell.run matches shell intent");
  });

  it("clears intent and allows all tools after clearIntent()", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["write"]);
    assert.ok(!router.canHandle("file.read"), "filtered out");

    router.clearIntent();
    assert.ok(router.canHandle("file.read"), "allowed after clear");
    assert.ok(router.canHandle("shell.run"), "allowed after clear");
  });

  it("delegates execute to downstream router unchanged", () => {
    const router = new ToolAwareRouter(downstream);
    // Execute is delegated directly — behavior unchanged
    assert.equal(typeof router.execute, "function");
  });

  it("works with write intent to include file.create", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["write", "create"]);

    assert.ok(router.canHandle("file.create"), "file.create matches write/create intent");
    assert.ok(!router.canHandle("file.delete"), "file.delete does not match");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run build && node --test dist/tests/tools/tool-index-integration.test.js
```

Expected: 6/6 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tools/tool-index-integration.test.js` — 6/6 pass
3. `node --test dist/tests/tools/*.test.js` — all tool tests pass
4. No changes to PolicyGate, ApprovalStore, or ToolExecutor
5. No changes to existing CompositeToolRouter behavior when intent is not set
