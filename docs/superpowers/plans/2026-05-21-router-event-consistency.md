# Tighten Router/Event Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify ToolExecutor still emits all required events after the router split.

**Architecture:** Check each event type against the router implementations to ensure consistency.

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Audit Event Emission Requirements

**Files:**
- Read: `src/tools/tool-router.ts`
- Read: `src/tools/executor.ts`
- Read: `src/events/types.ts`

- [ ] **Step 1: List required events**

Required events from the plan:
- `changedFiles` — files modified by patch
- `createdPath` — files created by patch
- `deletedPath` — files deleted by patch
- `MCP provenance` — MCP tool call metadata
- `patch rollback` — rollback on failed patch
- `denial` — tool denial events

- [ ] **Step 2: Check each router implementation**

Read each router's execute() method and verify it emits the correct events.

---

### Task 2: Verify PatchToolRouter Events

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Check PatchToolRouter.execute()**

Verify it emits:
- `changedFiles` event after patch.apply
- `createdPath` event for new files
- `deletedPath` event for deleted files
- `patch rollback` event on failure

- [ ] **Step 2: Fix missing events**

If any events are missing, add them.

- [ ] **Step 3: Test**

Run: `node --test tests/tools/tool-router.test.ts 2>&1 | tail -10`

---

### Task 3: Verify McpToolRouter Events

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Check McpToolRouter.execute()**

Verify it emits:
- `MCP provenance` event (tool name, server, timing)

- [ ] **Step 2: Fix missing events**

Add missing MCP provenance events.

- [ ] **Step 3: Test**

Run: `node --test tests/tools/tool-router.test.ts 2>&1 | tail -10`

---

### Task 4: Verify ShellToolRouter & FileToolRouter Events

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Check denial events**

Verify shell/file tools emit `denial` events when blocked by policy.

- [ ] **Step 2: Fix missing events**

Add missing denial events.

- [ ] **Step 3: Test**

---

### Task 5: Verify ToolExecutor Orchestration

**Files:**
- Read: `src/tools/executor.ts`

- [ ] **Step 1: Check execute() method**

Verify ToolExecutor.execute() correctly routes to routers and aggregates events.

- [ ] **Step 2: Ensure events propagate**

Verify router events are passed through to the caller.

---

### Task 6: Write Integration Test

**Files:**
- Create: `tests/tools/tool-router-events.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/tools/tool-router-events.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolExecutor } from "../../src/tools/executor.js";
import { createMockConfig } from "./helpers.js";

describe("ToolExecutor event emission", () => {
  it("emits changedFiles event for patch.apply", async () => {
    // Test that patch.apply emits changedFiles event
  });

  it("emits MCP provenance for mcp.* tools", async () => {
    // Test that MCP tools emit provenance event
  });

  it("emits denial event for blocked tools", async () => {
    // Test that denied tools emit denial event
  });

  it("emits rollback event on patch failure", async () => {
    // Test that failed patches emit rollback event
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add src/tools/tool-router.ts tests/tools/tool-router-events.test.ts
git commit -m "test(router): add integration tests for event emission

- Verify PatchToolRouter emits changedFiles, createdPath, deletedPath
- Verify McpToolRouter emits MCP provenance
- Verify denial events for blocked tools
- Add rollback event on patch failure

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```