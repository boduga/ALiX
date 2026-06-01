# Event Schema Alignment: Patch Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement patch events per event-kernel-schema.md to enable observability, diff viewing, and replay.

**Architecture:** Add event emission to PatchEngine. Use checkpoint-based rollback. Events follow AlixEvent base type with `actor: "system"`.

**Tech Stack:** TypeScript, existing EventLog class, file-based checkpoints

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/events/types.ts` | Add patch event payload types |
| `src/patch/checkpoint.ts` | CheckpointManager for rollback support |
| `src/patch/patch-engine.ts` | Emit patch events at each lifecycle step |
| `src/run.ts` | Wire checkpoint manager into patch flow |
| `tests/patch/checkpoint.test.ts` | Checkpoint create/restore tests |
| `tests/events/patch-events.test.ts` | Event emission tests |

---

## Task 1: Add Patch Event Payload Types

**Files:**
- Modify: `src/events/types.ts`
- Test: `tests/events/patch-events.test.ts`

- [ ] **Step 1: Add payload types to types.ts**

Add after existing `ToolEventPayload` type (around line 33):

```typescript
export type PatchProposalPayload = {
  proposalId: string;
  format: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  provider: string;
  model: string;
  files: Array<{ path: string; operation: "create" | "modify" | "delete" | "rename"; preimageHash?: string }>;
  requiresApproval: boolean;
};

export type PatchParsedPayload = {
  proposalId: string;
  validated: boolean;
  errors?: string[];
};

export type PatchRejectedPayload = {
  proposalId: string;
  reason: string;
};

export type PatchCheckpointCreatedPayload = {
  checkpointId: string;
  proposalId: string;
  files: string[];
};

export type PatchAppliedPayload = {
  proposalId: string;
  checkpointId: string;
  changedFiles: string[];
  diffRef?: string;
};

export type PatchRolledBackPayload = {
  proposalId: string;
  checkpointId: string;
  reason: string;
};
```

- [ ] **Step 2: Add event type constants**

Add to `src/events/types.ts`:

```typescript
export const PATCH_EVENT_TYPES = {
  PROPOSED: "patch.proposed",
  PARSED: "patch.parsed",
  REJECTED: "patch.rejected",
  CHECKPOINT_CREATED: "patch.checkpoint_created",
  APPLIED: "patch.applied",
  ROLLED_BACK: "patch.rolled_back",
} as const;
```

- [ ] **Step 3: Write test for payload types**

Create `tests/events/patch-events.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  PatchProposalPayload,
  PatchParsedPayload,
  PatchAppliedPayload,
} from "../../src/events/types.js";

describe("Patch Event Payload Types", () => {
  it("PatchProposalPayload has required fields", () => {
    const payload: PatchProposalPayload = {
      proposalId: "test-123",
      format: "search_replace",
      provider: "anthropic",
      model: "claude-sonnet-4",
      files: [{ path: "src/index.ts", operation: "modify" }],
      requiresApproval: false,
    };
    assert.equal(payload.proposalId, "test-123");
    assert.equal(payload.format, "search_replace");
    assert.equal(payload.files.length, 1);
  });

  it("PatchAppliedPayload tracks changed files", () => {
    const payload: PatchAppliedPayload = {
      proposalId: "test-123",
      checkpointId: "ckpt-456",
      changedFiles: ["src/index.ts", "src/utils.ts"],
    };
    assert.equal(payload.changedFiles.length, 2);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/events/patch-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/types.ts tests/events/patch-events.test.ts
git commit -m "feat(events): add patch event payload types"
```

---

## Task 2: Implement CheckpointManager

**Files:**
- Create: `src/patch/checkpoint.ts`
- Test: `tests/patch/checkpoint.test.ts`

- [ ] **Step 1: Write failing test for CheckpointManager**

Create `tests/patch/checkpoint.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CheckpointManager } from "../../src/patch/checkpoint.js";

describe("CheckpointManager", () => {
  const testDir = join(process.cwd(), ".test-checkpoints");
  let manager: CheckpointManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    manager = new CheckpointManager(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates checkpoint with files", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");
    const checkpoint = await manager.create("patch-1", [testFile]);
    assert.ok(checkpoint.id);
    assert.equal(checkpoint.files.length, 1);
    assert.equal(checkpoint.files[0], testFile);
  });

  it("restores checkpoint to original state", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");
    const checkpoint = await manager.create("patch-1", [testFile]);
    await writeFile(testFile, "modified content");
    assert.equal(await readFile(testFile, "utf8"), "modified content");
    await manager.restore(checkpoint.id);
    assert.equal(await readFile(testFile, "utf8"), "original content");
  });

  it("lists checkpoints", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");
    await manager.create("patch-1", [testFile]);
    await manager.create("patch-2", [testFile]);
    const checkpoints = await manager.list();
    assert.equal(checkpoints.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/patch/checkpoint.test.ts`
Expected: FAIL with "Cannot find module checkpoint"

- [ ] **Step 3: Write CheckpointManager implementation**

Create `src/patch/checkpoint.ts`:

```typescript
import { mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export type Checkpoint = {
  id: string;
  patchId: string;
  files: string[];
  createdAt: string;
};

export class CheckpointManager {
  constructor(private checkpointsDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
  }

  async create(patchId: string, filePaths: string[]): Promise<Checkpoint> {
    const id = randomUUID();
    const checkpoint: Checkpoint = {
      id,
      patchId,
      files: filePaths,
      createdAt: new Date().toISOString(),
    };
    const checkpointDir = join(this.checkpointsDir, id);
    await mkdir(checkpointDir, { recursive: true });
    for (const filePath of filePaths) {
      const destDir = join(checkpointDir, basename(filePath));
      await cp(filePath, destDir, { recursive: true }).catch(() => {});
    }
    await writeFile(join(checkpointDir, "metadata.json"), JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  async restore(checkpointId: string): Promise<void> {
    const checkpointDir = join(this.checkpointsDir, checkpointId);
    const metadataPath = join(checkpointDir, "metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Checkpoint;
    for (const filePath of metadata.files) {
      const src = join(checkpointDir, basename(filePath));
      await cp(src, filePath, { recursive: true });
    }
  }

  async list(): Promise<Checkpoint[]> {
    const entries = await readdir(this.checkpointsDir);
    const checkpoints: Checkpoint[] = [];
    for (const id of entries) {
      const metadataPath = join(this.checkpointsDir, id, "metadata.json");
      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Checkpoint;
        checkpoints.push(metadata);
      } catch {}
    }
    return checkpoints;
  }

  async delete(checkpointId: string): Promise<void> {
    const checkpointDir = join(this.checkpointsDir, checkpointId);
    await rm(checkpointDir, { recursive: true, force: true });
  }
}
```

Note: `readdir` needs to be imported. Add at top:
```typescript
import { readdir } from "node:fs/promises";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/patch/checkpoint.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/patch/checkpoint.ts tests/patch/checkpoint.test.ts
git commit -m "feat(patch): add CheckpointManager for rollback support"
```

---

## Task 3: Add Event Emission to PatchEngine

**Files:**
- Modify: `src/patch/patch-engine.ts`
- Test: `tests/patch/patch-events-emission.test.ts`

- [ ] **Step 1: Add event emission to applyPatch**

Modify `src/patch/patch-engine.ts` to accept EventLog and emit events:

```typescript
import type { EventLog } from "../events/event-log.js";
import { PATCH_EVENT_TYPES } from "../events/types.js";

export type PatchEngineOptions = {
  eventLog?: EventLog;
  checkpointManager?: CheckpointManager;
};

export async function applyPatch(
  root: string,
  format: EditFormat,
  patchText: string,
  options: PatchEngineOptions = {}
): Promise<PatchApplyResult> {
  const { eventLog, checkpointManager } = options;
  const proposalId = randomUUID();
  const startTime = Date.now();

  // Emit patch.proposed
  if (eventLog) {
    await eventLog.append({
      sessionId: "session", // Will be injected by caller
      actor: "system",
      type: PATCH_EVENT_TYPES.PROPOSED,
      payload: {
        proposalId,
        format,
        provider: "alix",
        model: "n/a",
        files: extractPatchFiles(patchText, format),
        requiresApproval: false,
      } as PatchProposalPayload,
    });
  }

  // Parse and validate
  let parsedBlocks;
  try {
    if (format === "search_replace") {
      parsedBlocks = parseSearchReplace(patchText);
    } else {
      parsedBlocks = parseStructuredPatch(patchText);
    }
  } catch (err) {
    if (eventLog) {
      await eventLog.append({
        sessionId: "session",
        actor: "system",
        type: PATCH_EVENT_TYPES.REJECTED,
        payload: { proposalId, reason: (err as Error).message } as PatchRejectedPayload,
      });
    }
    throw err;
  }

  // Emit patch.parsed
  if (eventLog) {
    await eventLog.append({
      sessionId: "session",
      actor: "system",
      type: PATCH_EVENT_TYPES.PARSED,
      payload: { proposalId, validated: true } as PatchParsedPayload,
    });
  }

  // Create checkpoint before applying
  let checkpointId: string | undefined;
  if (checkpointManager) {
    const checkpoint = await checkpointManager.create(proposalId, []);
    checkpointId = checkpoint.id;
    if (eventLog) {
      await eventLog.append({
        sessionId: "session",
        actor: "system",
        type: PATCH_EVENT_TYPES.CHECKPOINT_CREATED,
        payload: { checkpointId, proposalId, files: [] } as PatchCheckpointCreatedPayload,
      });
    }
  }

  // Apply patch (existing logic)...

  // Emit patch.applied
  if (eventLog) {
    await eventLog.append({
      sessionId: "session",
      actor: "system",
      type: PATCH_EVENT_TYPES.APPLIED,
      payload: {
        proposalId,
        checkpointId: checkpointId ?? "",
        changedFiles: result.changedFiles,
      } as PatchAppliedPayload,
    });
  }

  return result;
}
```

Helper function to add:
```typescript
function extractPatchFiles(patchText: string, format: EditFormat): Array<{ path: string; operation: string }> {
  if (format === "search_replace") {
    const blocks = parseSearchReplace(patchText);
    return blocks.map((b) => ({ path: b.path, operation: "modify" }));
  }
  const patch = parseStructuredPatch(patchText);
  return patch.files.map((f) => ({ path: f.path, operation: f.operation }));
}
```

- [ ] **Step 2: Add rollback method**

Add to `src/patch/patch-engine.ts`:

```typescript
export async function rollbackPatch(
  proposalId: string,
  checkpointId: string,
  eventLog?: EventLog,
  checkpointManager?: CheckpointManager
): Promise<void> {
  if (!checkpointManager) throw new Error("No checkpoint manager configured");

  await checkpointManager.restore(checkpointId);

  if (eventLog) {
    await eventLog.append({
      sessionId: "session",
      actor: "system",
      type: PATCH_EVENT_TYPES.ROLLED_BACK,
      payload: {
        proposalId,
        checkpointId,
        reason: "Patch failed verification",
      } as PatchRolledBackPayload,
    });
  }
}
```

- [ ] **Step 3: Write integration test**

Create `tests/patch/patch-events-emission.test.ts`:

```typescript
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { applyPatch } from "../../src/patch/patch-engine.js";
import { CheckpointManager } from "../../src/patch/checkpoint.js";

describe("Patch Events Emission", () => {
  const testDir = join(process.cwd(), ".test-patch-events");
  let eventLog: EventLog;
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    eventLog = new EventLog(testDir);
    await eventLog.init();
    checkpointManager = new CheckpointManager(join(testDir, "checkpoints"));
    await checkpointManager.init();
  });

  it("emits patch.proposed event", async () => {
    await applyPatch(process.cwd(), "search_replace", createTestPatch(), {
      eventLog,
      checkpointManager,
    });
    const events = await eventLog.readAll();
    const proposed = events.find((e) => e.type === "patch.proposed");
    assert.ok(proposed);
    assert.equal((proposed.payload as any).format, "search_replace");
  });

  it("emits patch.applied event on success", async () => {
    await applyPatch(process.cwd(), "search_replace", createTestPatch(), {
      eventLog,
      checkpointManager,
    });
    const events = await eventLog.readAll();
    const applied = events.find((e) => e.type === "patch.applied");
    assert.ok(applied);
  });

  it("emits patch.checkpoint_created before applying", async () => {
    await applyPatch(process.cwd(), "search_replace", createTestPatch(), {
      eventLog,
      checkpointManager,
    });
    const events = await eventLog.readAll();
    const proposedIdx = events.findIndex((e) => e.type === "patch.proposed");
    const checkpointIdx = events.findIndex((e) => e.type === "patch.checkpoint_created");
    assert.ok(checkpointIdx > proposedIdx);
  });
});

function createTestPatch(): string {
  return `<<<<<<< SEARCH path=test.txt
original
=======
modified
>>>>>>> REPLACE`;
}
```

- [ ] **Step 4: Run tests to verify**

Run: `npm test -- tests/patch/patch-events-emission.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/patch-engine.ts tests/patch/patch-events-emission.test.ts
git commit -m "feat(patch): emit patch events during apply lifecycle"
```

---

## Task 4: Wire CheckpointManager into run.ts

**Files:**
- Modify: `src/run.ts`
- Test: `tests/integration/patch-rollback.test.ts`

- [ ] **Step 1: Add CheckpointManager to session state**

Find where `eventLog` is created in run.ts and add:

```typescript
import { CheckpointManager } from "./patch/checkpoint.js";

// In session setup:
const checkpointManager = new CheckpointManager(
  join(sessionDir, "checkpoints")
);
await checkpointManager.init();
```

- [ ] **Step 2: Pass to applyPatch calls**

Find all `applyPatch` calls and add options:

```typescript
const patchResult = await applyPatch(root, format, patchText, {
  eventLog,
  checkpointManager,
});
```

- [ ] **Step 3: Add rollback on verification failure**

After running verification, if it fails:

```typescript
if (!verificationPassed && lastCheckpointId) {
  await rollbackPatch(
    lastProposalId,
    lastCheckpointId,
    eventLog,
    checkpointManager
  );
}
```

- [ ] **Step 4: Write rollback integration test**

Create `tests/integration/patch-rollback.test.ts`:

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { CheckpointManager } from "../../src/patch/checkpoint.js";
import { rollbackPatch } from "../../src/patch/patch-engine.js";

describe("Patch Rollback Integration", () => {
  const testDir = join(process.cwd(), ".test-rollback");
  let eventLog: EventLog;
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    await mkdir(join(testDir, "checkpoints"), { recursive: true });
    eventLog = new EventLog(join(testDir, "events"));
    await eventLog.init();
    checkpointManager = new CheckpointManager(join(testDir, "checkpoints"));
    await checkpointManager.init();
  });

  it("emits rollback event and restores files", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original");
    const checkpoint = await checkpointManager.create("patch-1", [testFile]);

    await writeFile(testFile, "changed");

    await rollbackPatch("patch-1", checkpoint.id, eventLog, checkpointManager);

    const events = await eventLog.readAll();
    const rollbackEvent = events.find((e) => e.type === "patch.rolled_back");
    assert.ok(rollbackEvent);
    assert.equal(await readFile(testFile, "utf8"), "original");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/integration/patch-rollback.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/run.ts tests/integration/patch-rollback.test.ts
git commit -m "feat(run): wire CheckpointManager into session lifecycle"
```

---

## Verification

```bash
npm test -- tests/patch/ tests/events/patch-events.test.ts tests/integration/patch-rollback.test.ts
```

All tests should pass. Manual verification:
- [ ] `patch.proposed` event appears when patch is submitted
- [ ] `patch.checkpoint_created` appears before applying
- [ ] `patch.applied` appears after successful apply
- [ ] `patch.rolled_back` appears when verification fails and rollback occurs
- [ ] UI can reconstruct diff state from event log

---

## Summary

| Task | Focus | Risk |
|------|-------|------|
| 1 | Event payload types | Low |
| 2 | CheckpointManager | Medium |
| 3 | Event emission in PatchEngine | Medium |
| 4 | Wire into run.ts | Medium |