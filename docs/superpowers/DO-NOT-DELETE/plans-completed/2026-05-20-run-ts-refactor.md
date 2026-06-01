# Split run.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 995-line `src/run.ts` into focused modules with clear responsibilities.

**Architecture:** Extract logical groups into separate modules:
- `src/run/event-handlers.ts` — Event handlers and message processing
- `src/run/task-loop.ts` — Main task execution loop
- `src/run/initialization.ts` — Startup initialization logic
- `src/run/cleanup.ts` — Session cleanup and memory saving
- `src/run.ts` — Orchestrator that imports and wires the pieces

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Map run.ts Structure

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Analyze run.ts structure**

Read `src/run.ts` and identify logical sections:
1. Imports (lines 1-38)
2. Helper functions (lines 40-98)
3. Session initialization (buildRuntime, etc.)
4. Main task loop (runTask, handleToolCall, etc.)
5. Verification and cleanup

- [ ] **Step 2: Document the extraction plan**

Create a section at the top of run.ts with comments showing where each section will be extracted.

- [ ] **Step 3: Verify baseline tests pass**

Run: `npm test 2>&1 | tail -5`
Expected: All tests pass

---

### Task 2: Extract Helper Functions

**Files:**
- Create: `src/run/helpers.ts`
- Modify: `src/run.ts`

- [ ] **Step 1: Create helpers module**

```typescript
// src/run/helpers.ts
export async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function saveDecisionsToMemory(
  sessionEvents: Awaited<ReturnType<EventLog["readAll"]>>,
  memoryStore: MemoryStore
): Promise<void> {
  // ... extract from run.ts lines 54-84
}

export async function streamToResponse(
  provider: ModelAdapter,
  request: NormalizedRequest
): Promise<{ text: string; toolCalls: ToolCall[]; usage?: TokenUsage }> {
  // ... extract from run.ts lines 86-98
}
```

- [ ] **Step 2: Update imports in run.ts**

Replace inline implementations with imports from helpers module.

- [ ] **Step 3: Verify build and tests**

Run: `npm run build && npm test 2>&1 | tail -5`
Expected: Build succeeds, all tests pass

---

### Task 3: Extract Event Handling

**Files:**
- Create: `src/run/event-handlers.ts`
- Modify: `src/run.ts`

- [ ] **Step 1: Identify event handler patterns**

Look for functions that handle tool calls, patch results, approval responses, etc.

- [ ] **Step 2: Create event handlers module**

```typescript
// src/run/event-handlers.ts
export type EventHandlerDeps = {
  policyEngine: PolicyEngine;
  mcpManager: McpManager;
  // ... other deps
};

export async function handleToolCall(/* ... */) { /* ... */ }
export async function handleApproval(/* ... */) { /* ... */ }
export async function handlePatchResult(/* ... */) { /* ... */ }
```

- [ ] **Step 3: Verify build and tests**

---

### Task 4: Extract Main Task Loop

**Files:**
- Create: `src/run/task-loop.ts`
- Modify: `src/run.ts`

- [ ] **Step 1: Identify runTask function**

Extract the main task execution loop.

- [ ] **Step 2: Create task loop module**

```typescript
// src/run/task-loop.ts
export interface TaskLoopDeps { /* ... */ }
export async function runTask(/* ... */) { /* ... */ }
```

- [ ] **Step 3: Verify build and tests**

---

### Task 5: Verify and Document

**Files:**
- Modify: `src/run.ts`
- Create: `src/run/index.ts` (barrel export)

- [ ] **Step 1: Verify all functionality**

Run full test suite and verify CLI still works:
- `npm test`
- `node dist/src/cli.js --help`

- [ ] **Step 2: Update imports and re-exports**

Create barrel export in `src/run/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/run/
git commit -m "refactor: split run.ts into focused modules

- Extract helpers to src/run/helpers.ts
- Extract event handlers to src/run/event-handlers.ts
- Extract task loop to src/run/task-loop.ts
- Add barrel export in src/run/index.ts
- Verify all tests pass
"
```