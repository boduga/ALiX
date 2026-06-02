**Status:** ✅ COMPLETED (2026-05-31) — all tasks implemented and merged to main

# Agent Runtime Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `src/run.ts` (452 lines) into 5 focused modules in `src/agent/` with clear responsibilities, preserving the existing public API.

**Architecture:** Split by responsibility: initialization (`agent.ts`), the loop (`agent-loop.ts`), message-building helpers (`messages.ts`), streaming (`stream.ts`), mutation tracking (`mutations.ts`). `src/run.ts` becomes a 5-line re-export shim.

**Tech Stack:** TypeScript, existing module patterns, `node:test`.

---

## File Structure

**New files:**
- `src/agent/messages.ts` (~120 lines) — pure message-building helpers
- `src/agent/stream.ts` (~30 lines) — streaming utilities
- `src/agent/mutations.ts` (~50 lines) — mutation tracking
- `src/agent/agent.ts` (~150 lines) — initialization
- `src/agent/agent-loop.ts` (~150 lines) — the loop
- `src/agent/index.ts` (~10 lines) — back-compat re-exports
- `tests/agent/messages.test.ts` — tests for messages.ts
- `tests/agent/mutations.test.ts` — tests for mutations.ts
- `tests/agent/stream.test.ts` — tests for stream.ts

**Modified files:**
- `src/run.ts` — reduce to ~5 line re-export shim
- `src/cli.ts` — update import path

**Unchanged (referenced):**
- `src/providers/`, `src/tools/`, `src/policy/`, `src/events/`, `src/repomap/`, etc.

---

## Task 1: Create `messages.ts` (TDD)

**Files:**
- Create: `tests/agent/messages.test.ts`
- Create: `src/agent/messages.ts`

- [ ] **Step 1: Read current `run.ts` to see what helper functions to extract**

```bash
sed -n '1,200p' src/run.ts
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/agent/messages.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildErrorMessage, buildToolsForProvider } from "../../src/agent/messages.js";

describe("buildErrorMessage", () => {
  it("formats error with kind and message", () => {
    const msg = buildErrorMessage({ kind: "error", message: "boom" });
    assert.ok(msg.includes("boom"));
  });

  it("includes retryable hint when retryable: true", () => {
    const msg = buildErrorMessage({ kind: "error", message: "x", retryable: true });
    assert.ok(msg.includes("retry") || msg.includes("again"));
  });

  it("includes hint when provided", () => {
    const msg = buildErrorMessage({ kind: "error", message: "x", hint: "fix this" });
    assert.ok(msg.includes("fix this"));
  });
});

describe("buildToolsForProvider", () => {
  it("returns array of tool defs", () => {
    const tools = buildToolsForProvider({ editFormatPreference: "structured_patch" });
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
  });

  it("respects provider's edit format preference", () => {
    const structured = buildToolsForProvider({ editFormatPreference: "structured_patch" });
    const searchReplace = buildToolsForProvider({ editFormatPreference: "search_replace" });
    // Different preferences may produce different tools
    assert.notDeepEqual(structured, searchReplace);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

Expected: Module not found.

- [ ] **Step 4: Move helpers from `run.ts` to `messages.ts`**

Read the relevant lines from `run.ts` and copy the `buildErrorMessage` and `buildToolsForProvider` functions into `src/agent/messages.ts`. Adjust imports to use relative paths from `src/agent/`.

```typescript
// src/agent/messages.ts
// (Copy from run.ts, update imports)
import type { ToolDef } from "../providers/types.js";

export function buildErrorMessage(err: { kind: "error"; message: string; retryable?: boolean; hint?: string }): string {
  // (existing implementation from run.ts)
}

export function buildToolsForProvider(provider: Pick<ModelAdapter, "editFormatPreference">): ToolDef[] {
  // (existing implementation from run.ts)
}
```

Also move these helpers (read run.ts to find them):
- `buildContextBundleEventPayload`
- `buildModelUsageEventPayload`
- `renderContextBundleForPrompt`

- [ ] **Step 5: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/agent/messages.test.js 2>&1 | tail -5
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/messages.ts tests/agent/messages.test.ts
git commit -m "refactor(agent): extract message helpers to messages.ts"
```

---

## Task 2: Create `stream.ts`

**Files:**
- Create: `tests/agent/stream.test.ts`
- Create: `src/agent/stream.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/agent/stream.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldAutoDisableStreaming } from "../../src/agent/stream.js";

describe("shouldAutoDisableStreaming", () => {
  it("returns a boolean", () => {
    const result = shouldAutoDisableStreaming();
    assert.equal(typeof result, "boolean");
  });

  it("returns true when no TTY (CI environment)", () => {
    // In test env, no TTY -> should disable
    const result = shouldAutoDisableStreaming();
    assert.equal(result, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

- [ ] **Step 3: Move `shouldAutoDisableStreaming` to `stream.ts`**

```typescript
// src/agent/stream.ts
export function shouldAutoDisableStreaming(): boolean {
  // (existing implementation from run.ts)
}

export type StreamHandler = (chunk: unknown) => void;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/agent/stream.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/stream.ts tests/agent/stream.test.ts
git commit -m "refactor(agent): extract streaming utilities to stream.ts"
```

---

## Task 3: Create `mutations.ts`

**Files:**
- Create: `tests/agent/mutations.test.ts`
- Create: `src/agent/mutations.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/agent/mutations.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMutationPaths } from "../../src/agent/mutations.js";

describe("extractMutationPaths", () => {
  it("extracts path from file.write args", () => {
    const paths = extractMutationPaths("file.write", { path: "src/foo.ts", content: "x" });
    assert.deepEqual(paths, ["src/foo.ts"]);
  });

  it("extracts path from file.create args", () => {
    const paths = extractMutationPaths("file.create", { path: "src/bar.ts", content: "x" });
    assert.deepEqual(paths, ["src/bar.ts"]);
  });

  it("returns empty array for non-mutating tools", () => {
    const paths = extractMutationPaths("file.read", { path: "src/foo.ts" });
    assert.deepEqual(paths, []);
  });

  it("handles missing path gracefully", () => {
    const paths = extractMutationPaths("file.write", {});
    assert.deepEqual(paths, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Move mutation functions to `mutations.ts`**

```typescript
// src/agent/mutations.ts
export function extractMutationPaths(execName: string, args: Record<string, unknown>): string[] {
  // (existing implementation from run.ts)
}

export function recordMutationInSessionState(
  sessionState: { mutations?: Set<string> },
  execName: string,
  args: Record<string, unknown>
): void {
  // (existing implementation from run.ts)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/agent/mutations.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/mutations.ts tests/agent/mutations.test.ts
git commit -m "refactor(agent): extract mutation tracking to mutations.ts"
```

---

## Task 4: Create `agent.ts` (initialization)

**Files:**
- Create: `src/agent/agent.ts`

- [ ] **Step 1: Read the initialization section of `run.ts`**

```bash
sed -n '1,100p' src/run.ts
```

- [ ] **Step 2: Extract initialization into `agent.ts`**

Move the initialization code (config loading, event log, MCP manager, provider creation) into `agent.ts`. Define an `AgentContext` type that bundles the dependencies:

```typescript
// src/agent/agent.ts
import { loadConfig } from "../config/loader.js";
import { EventLog } from "../events/event-log.js";
import { createProvider } from "../providers/registry.js";
import { ToolExecutor } from "../tools/executor.js";
// ... other imports

export type AgentContext = {
  config: Awaited<ReturnType<typeof loadConfig>>;
  eventLog: EventLog;
  provider: ModelAdapter;
  toolExecutor: ToolExecutor;
  // ... other deps
};

export async function initAgent(cwd: string, opts: { /* ... */ }): Promise<AgentContext> {
  // (extracted initialization from run.ts)
  return { config, eventLog, provider, toolExecutor };
}
```

- [ ] **Step 3: Verify build succeeds**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent.ts
git commit -m "refactor(agent): extract initialization to agent.ts"
```

---

## Task 5: Create `agent-loop.ts` (the loop)

**Files:**
- Create: `src/agent/agent-loop.ts`

- [ ] **Step 1: Read the loop section of `run.ts`**

```bash
sed -n '100,452p' src/run.ts
```

- [ ] **Step 2: Extract `runTask` into `agent-loop.ts`**

```typescript
// src/agent/agent-loop.ts
import { initAgent, type AgentContext } from "./agent.js";
import { buildToolsForProvider, /* ... */ } from "./messages.js";
import { shouldAutoDisableStreaming, type StreamHandler } from "./stream.js";

export async function runTask(
  cwd: string,
  task: string,
  opts?: RunOpts,
  onStream?: StreamHandler
): Promise<RunResult> {
  const ctx = await initAgent(cwd, opts);
  // (existing loop body from run.ts, using ctx)
}
```

- [ ] **Step 3: Verify build succeeds**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent-loop.ts
git commit -m "refactor(agent): extract runTask loop to agent-loop.ts"
```

---

## Task 6: Replace `run.ts` with re-export shim

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Replace `run.ts` contents with re-exports**

```typescript
// src/run.ts
// Back-compat shim - prefer importing from src/agent/ directly
export { runTask, type RunOpts, type RunResult } from "./agent/agent-loop.js";
export { shouldAutoDisableStreaming, type StreamHandler } from "./agent/stream.js";
export { buildErrorMessage, buildToolsForProvider, buildContextBundleEventPayload, buildModelUsageEventPayload, renderContextBundleForPrompt } from "./agent/messages.js";
export { extractMutationPaths, recordMutationInSessionState } from "./agent/mutations.js";
```

- [ ] **Step 2: Verify build succeeds**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 3: Verify all existing tests still pass**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -5
```

Expected: pass count >= 1164, fail 0

- [ ] **Step 4: Update `src/cli.ts` import (if it uses `run.ts`)**

```bash
grep "from.*run" src/cli.ts
```

If it imports from `./run.js`, leave as-is (the shim handles it).

- [ ] **Step 5: Commit**

```bash
git add src/run.ts
git commit -m "refactor(agent): reduce run.ts to back-compat re-export shim"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: pass >= 1164, fail 0

- [ ] **Step 2: Verify line counts**

```bash
wc -l src/run.ts src/agent/*.ts | tail -10
```

Expected: `run.ts` < 10 lines, `agent/` total < 600 lines

- [ ] **Step 3: Build succeeds**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(agent): sub-project #2 agent runtime split complete

Decomposed 452-line run.ts monolith into 5 focused modules:
- agent.ts (initialization)
- agent-loop.ts (the loop)
- messages.ts (helpers)
- stream.ts (streaming utils)
- mutations.ts (tracking)
- run.ts reduced to 5-line back-compat shim"
```

---

## Self-Review

**1. Spec coverage:**
- [x] `messages.ts` with helpers → Task 1
- [x] `stream.ts` with utilities → Task 2
- [x] `mutations.ts` with tracking → Task 3
- [x] `agent.ts` with initialization → Task 4
- [x] `agent-loop.ts` with runTask → Task 5
- [x] `run.ts` as shim → Task 6
- [x] Final verification → Task 7
- [x] TDD per superpowers:test-driven-development ✓
- [x] Migration strategy (add new first, then move) ✓
- [x] Back-compat preserved ✓

**2. Placeholder scan:** No "TBD" or "TODO". All code references existing functions in `run.ts`.

**3. Type consistency:**
- `runTask` signature unchanged from `run.ts`
- `RunOpts`, `RunResult` types moved unchanged
- `StreamHandler` type moved to `stream.ts`
- `AgentContext` new type, used by `initAgent`

**4. Plan length:** 7 tasks, each 2-5 minutes. TDD throughout. ✓
