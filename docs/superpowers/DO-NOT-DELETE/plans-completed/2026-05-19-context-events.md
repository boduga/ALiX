# Event Schema Alignment: Context Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement context events per event-kernel-schema.md: `context.repo_map_created`, `context.bundle_created`, `context.file_pinned`, `context.file_unpinned`.

**Architecture:** Emit events during ContextCompiler lifecycle. Events track why each context item was included for auditability.

**Tech Stack:** TypeScript, ContextCompiler, EventLog

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/events/types.ts` | Add context event payload types |
| `src/repomap/context-compiler.ts` | Emit context lifecycle events |
| `src/run.ts` | Pass EventLog to ContextCompiler |
| `tests/repomap/context-events.test.ts` | Context event emission tests |

---

## Task 1: Add Context Event Payload Types

**Files:**
- Modify: `src/events/types.ts`
- Test: `tests/events/context-events.test.ts`

- [ ] **Step 1: Add context event payload types**

Add to `src/events/types.ts`:

```typescript
export type ContextItemRef = {
  path: string;
  kind: string;
  score: number;
  reason: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type RepoMapCreatedPayload = {
  sourceFileCount: number;
  testFileCount: number;
  symbolCount: number;
  dependencyCount: number;
};

export type ContextBundleCreatedPayload = {
  bundleId: string;
  taskType: string;
  usedTokens: number;
  maxTokens: number;
  primaryFiles: ContextItemRef[];
  supportingFiles: ContextItemRef[];
  tests: ContextItemRef[];
  omittedCount: number;
};

export type FilePinnedPayload = {
  path: string;
  reason: string;
};

export type FileUnpinnedPayload = {
  path: string;
};

export const CONTEXT_EVENT_TYPES = {
  REPO_MAP_CREATED: "context.repo_map_created",
  BUNDLE_CREATED: "context.bundle_created",
  FILE_PINNED: "context.file_pinned",
  FILE_UNPINNED: "context.file_unpinned",
} as const;
```

- [ ] **Step 2: Write tests for context payload types**

Create `tests/events/context-events.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  ContextItemRef,
  ContextBundleCreatedPayload,
  RepoMapCreatedPayload,
} from "../../src/events/types.js";

describe("Context Event Payload Types", () => {
  it("ContextItemRef includes all required fields", () => {
    const ref: ContextItemRef = {
      path: "src/index.ts",
      kind: "file",
      score: 0.95,
      reason: "explicitly mentioned by user",
    };
    assert.equal(ref.path, "src/index.ts");
    assert.ok(ref.score > 0.9);
    assert.ok(ref.reason);
  });

  it("ContextBundleCreatedPayload tracks token budget", () => {
    const payload: ContextBundleCreatedPayload = {
      bundleId: "bundle-123",
      taskType: "bugfix",
      usedTokens: 5000,
      maxTokens: 20000,
      primaryFiles: [],
      supportingFiles: [],
      tests: [],
      omittedCount: 3,
    };
    assert.equal(payload.usedTokens, 5000);
    assert.equal(payload.maxTokens, 20000);
    assert.equal(payload.omittedCount, 3);
  });

  it("RepoMapCreatedPayload tracks map stats", () => {
    const payload: RepoMapCreatedPayload = {
      sourceFileCount: 42,
      testFileCount: 15,
      symbolCount: 280,
      dependencyCount: 350,
    };
    assert.equal(payload.sourceFileCount, 42);
    assert.ok(payload.symbolCount > 0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/events/context-events.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/events/types.ts tests/events/context-events.test.ts
git commit -m "feat(events): add context event payload types"
```

---

## Task 2: Add Event Emission to ContextCompiler

**Files:**
- Modify: `src/repomap/context-compiler.ts`
- Test: `tests/repomap/context-events.test.ts`

- [ ] **Step 1: Update ContextCompiler constructor**

Add EventLog parameter to ContextCompiler:

```typescript
import type { EventLog } from "../events/event-log.js";
import { CONTEXT_EVENT_TYPES } from "../events/types.js";
import type { RepoMapCreatedPayload, ContextBundleCreatedPayload } from "../events/types.js";

export type ContextCompilerOptions = {
  root: string;
  maxTokens?: number;
  eventLog?: EventLog;
  sessionId?: string;
};

export class ContextCompiler {
  constructor(private options: ContextCompilerOptions) {}

  async warm(): Promise<RepoMap> {
    // ... existing warm logic ...

    // Emit context.repo_map_created
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "system",
        type: CONTEXT_EVENT_TYPES.REPO_MAP_CREATED,
        payload: {
          sourceFileCount: repoMap.sourceFiles.length,
          testFileCount: repoMap.testFiles.length,
          symbolCount: repoMap.symbols.length,
          dependencyCount: countDependencies(repoMap),
        } as RepoMapCreatedPayload,
      });
    }

    return repoMap;
  }
}
```

- [ ] **Step 2: Update compileContext method**

Modify `compileContext` to emit `context.bundle_created`:

```typescript
async compileContext(
  task: string,
  taskType: TaskType,
  pinned?: string[]
): Promise<ContextBundle> {
  // ... existing compilation logic ...

  const bundle: ContextBundle = {
    id: generateBundleId(),
    taskType,
    budget: {
      maxTokens: this.options.maxTokens ?? 20000,
      usedTokens: estimateTokens(bundle),
    },
    primaryFiles: [...],
    supportingFiles: [...],
    tests: [...],
    pinned: pinned?.map(p => ({ path: p, kind: "file" as const, score: 1.0, reason: "user pinned" })) ?? [],
  };

  // Emit context.bundle_created
  if (this.options.eventLog && this.options.sessionId) {
    await this.options.eventLog.append({
      sessionId: this.options.sessionId,
      actor: "system",
      type: CONTEXT_EVENT_TYPES.BUNDLE_CREATED,
      payload: {
        bundleId: bundle.id,
        taskType: bundle.taskType,
        usedTokens: bundle.budget.usedTokens,
        maxTokens: bundle.budget.maxTokens,
        primaryFiles: bundle.primaryFiles.map(toContextItemRef),
        supportingFiles: bundle.supportingFiles.map(toContextItemRef),
        tests: bundle.tests.map(toContextItemRef),
        omittedCount: omittedCount,
      } as ContextBundleCreatedPayload,
    });
  }

  return bundle;
}
```

Helper function to add:
```typescript
function toContextItemRef(item: ContextItem): ContextItemRef {
  return {
    path: item.path,
    kind: item.kind,
    score: item.score,
    reason: item.reason,
    symbolName: item.symbolName,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
  };
}

function generateBundleId(): string {
  return `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
```

- [ ] **Step 3: Add pin/unpin methods with events**

Add to ContextCompiler:

```typescript
async pinFile(path: string, reason: string): Promise<void> {
  this.pinnedFiles.add(path);
  if (this.options.eventLog && this.options.sessionId) {
    await this.options.eventLog.append({
      sessionId: this.options.sessionId,
      actor: "user",
      type: CONTEXT_EVENT_TYPES.FILE_PINNED,
      payload: { path, reason } as FilePinnedPayload,
    });
  }
}

async unpinFile(path: string): Promise<void> {
  this.pinnedFiles.delete(path);
  if (this.options.eventLog && this.options.sessionId) {
    await this.options.eventLog.append({
      sessionId: this.options.sessionId,
      actor: "user",
      type: CONTEXT_EVENT_TYPES.FILE_UNPINNED,
      payload: { path } as FileUnpinnedPayload,
    });
  }
}
```

- [ ] **Step 4: Write context event emission tests**

Create `tests/repomap/context-events.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { ContextCompiler } from "../../src/repomap/context-compiler.js";

describe("Context Compiler Events", () => {
  const testDir = join(process.cwd(), ".test-context-events");
  let eventLog: EventLog;
  let compiler: ContextCompiler;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
    compiler = new ContextCompiler({
      root: process.cwd(),
      maxTokens: 5000,
      eventLog,
      sessionId: "test-session",
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits context.repo_map_created on warm", async () => {
    await compiler.warm();
    const events = await eventLog.readAll();
    const repoMapEvent = events.find((e) => e.type === "context.repo_map_created");
    assert.ok(repoMapEvent);
    const payload = repoMapEvent.payload as any;
    assert.ok(payload.sourceFileCount >= 0);
    assert.ok(payload.symbolCount >= 0);
  });

  it("emits context.bundle_created on compile", async () => {
    await compiler.warm();
    await compiler.compileContext("fix the login bug", "bugfix");
    const events = await eventLog.readAll();
    const bundleEvent = events.find((e) => e.type === "context.bundle_created");
    assert.ok(bundleEvent);
    const payload = bundleEvent.payload as any;
    assert.equal(payload.taskType, "bugfix");
    assert.ok(payload.primaryFiles.length >= 0);
  });

  it("emits context.file_pinned when pinning", async () => {
    await compiler.pinFile("src/auth.ts", "needed for login fix");
    const events = await eventLog.readAll();
    const pinEvent = events.find((e) => e.type === "context.file_pinned");
    assert.ok(pinEvent);
    const payload = pinEvent.payload as any;
    assert.equal(payload.path, "src/auth.ts");
    assert.equal(payload.reason, "needed for login fix");
  });

  it("emits context.file_unpinned when unpinning", async () => {
    await compiler.pinFile("src/auth.ts", "test");
    await compiler.unpinFile("src/auth.ts");
    const events = await eventLog.readAll();
    const unpinEvent = events.find((e) => e.type === "context.file_unpinned");
    assert.ok(unpinEvent);
    const payload = unpinEvent.payload as any;
    assert.equal(payload.path, "src/auth.ts");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/repomap/context-events.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/repomap/context-compiler.ts tests/repomap/context-events.test.ts
git commit -m "feat(repomap): emit context lifecycle events"
```

---

## Task 3: Wire EventLog into run.ts ContextCompiler

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Pass EventLog to ContextCompiler**

Find where ContextCompiler is instantiated in run.ts and update:

```typescript
const contextCompiler = new ContextCompiler({
  root,
  maxTokens: contextLimits.maxTokens,
  eventLog,  // Add this
  sessionId,  // Add this
});
```

- [ ] **Step 2: Expose pin/unpin to agent**

Make ContextCompiler available to agent tools:

```typescript
// Make compiler accessible for pin/unpin tools
const sessionContext = {
  contextCompiler,
  eventLog,
  // ...
};
```

- [ ] **Step 3: Commit**

```bash
git add src/run.ts
git commit -m "feat(run): wire EventLog into ContextCompiler"
```

---

## Verification

```bash
npm test -- tests/events/context-events.test.ts tests/repomap/context-events.test.ts
```

All tests should pass. Manual verification:
- [ ] `context.repo_map_created` appears after warm()
- [ ] `context.bundle_created` appears with file list and scores
- [ ] `context.file_pinned` appears when user pins a file
- [ ] `context.file_unpinned` appears when user unpins
- [ ] Audit trail shows why each file was included

---

## Summary

| Task | Focus | Risk |
|------|-------|------|
| 1 | Event payload types | Low |
| 2 | ContextCompiler events | Medium |
| 3 | run.ts integration | Low |