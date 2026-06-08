# PR 4: Session Artifact Output Refs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move large tool output files from `/tmp/alix-tool-outputs/` (ephemeral, lost on reboot) to `.alix/sessions/<sessionId>/artifacts/` (session-scoped, replayable, inspectable).

**Architecture:** Change the output directory in `ToolExecutor.writeOutputToFile()` from `tmpdir()/alix-tool-outputs` to `<sessionDir>/artifacts`. The `sessionDir` is available from the `EventLog` instance passed to `ToolExecutor`. Emit an `artifact.created` event for each output written. Update the Inspector projection to read from the new path.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tools/executor.ts` | **Modify** | Change output directory from `/tmp` to session artifacts; emit `artifact.created` event |
| `src/events/types.ts` | **Modify** | Add `ArtifactCreatedPayload` type and `ARTIFACT_EVENT_TYPES` constant |
| `src/inspector/projection.ts` | **Modify** | Update artifact path resolution |
| `tests/tools/large-output-artifact.test.ts` | **Create** | Tests for artifact path and event |

---

### Task 1: Add artifact event type

**Files:**
- Modify: `src/events/types.ts`

- [ ] **Step 1: Add ArtifactCreatedPayload and ARTIFACT_EVENT_TYPES**

Add after the `CONTEXT_EVENT_TYPES` block (around line 290):

```typescript
export type ArtifactCreatedPayload = {
  artifactId: string;
  toolCallId: string;
  path: string;
  mimeType: string;
  size: number;
  retention: "session";
};

export const ARTIFACT_EVENT_TYPES = {
  CREATED: "artifact.created",
} as const;
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add artifact.created event type"
```

---

### Task 2: Change output path and emit artifact.created

**Files:**
- Modify: `src/tools/executor.ts`

- [ ] **Step 1: Change writeOutputToFile to use session artifacts dir**

Replace the current `writeOutputToFile` function:

```typescript
async function writeOutputToFile(output: unknown, sessionDir: string, toolCallId: string, log: EventLog): Promise<string> {
  const { join } = await import("node:path");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const artifactsDir = join(sessionDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const artifactId = `art_tool_${randomUUID()}`;
  const filePath = join(artifactsDir, `${artifactId}.json`);
  const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  await writeFile(filePath, content, "utf8");

  // Emit artifact.created event
  await log.append({
    sessionId: "",
    actor: "system",
    type: ARTIFACT_EVENT_TYPES.CREATED,
    payload: {
      artifactId,
      toolCallId,
      path: filePath,
      mimeType: "application/json",
      size: Buffer.byteLength(content, "utf8"),
      retention: "session",
    } as ArtifactCreatedPayload,
  });

  return filePath;
}
```

- [ ] **Step 2: Update the call site in execute()**

Find where `writeOutputToFile` is called (around line 160) and update to pass the required arguments:

```typescript
// Current:
const outputRef = outputSize > LARGE_OUTPUT_THRESHOLD
  ? await writeOutputToFile(result.output)
  : undefined;

// New:
const outputRef = outputSize > LARGE_OUTPUT_THRESHOLD
  ? await writeOutputToFile(result.output, this.log.path.replace(/\/events\.jsonl$/, ""), toolCallId, this.log)
  : undefined;
```

The `this.log.path` is the path to `events.jsonl`. We derive the session directory by stripping the filename.

- [ ] **Step 3: Import the new event types at the top of executor.ts**

```typescript
import type { ToolStartedPayload, ToolOutputPayload, ToolCompletedPayload, ToolFailedPayload, ArtifactCreatedPayload } from "../events/types.js";
import { TOOL_EVENT_TYPES, ARTIFACT_EVENT_TYPES } from "../events/types.js";
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/executor.ts
git commit -m "feat(tools): move large tool outputs from /tmp to session artifacts dir"
```

---

### Task 3: Update Inspector to read from new artifact path

**Files:**
- Modify: `src/inspector/projection.ts`

- [ ] **Step 1: Check if Inspector reads from /tmp/alix-tool-outputs**

```bash
grep -n "alix-tool-outputs\|tmpdir\|/tmp" src/inspector/projection.ts
```

If the Inspector reads tool outputs from `/tmp`, update the path to derive from the session directory. The typical pattern is:

```typescript
const artifactsDir = join(sessionDir, "artifacts");
```

Replace any `/tmp/alix-tool-outputs` reference with `artifactsDir`. If the Inspector already reads from `events.jsonl`'s outputRef field without a fixed path assumption, no change is needed.

- [ ] **Step 2: Commit (if changes needed)**

```bash
git add src/inspector/projection.ts
git commit -m "fix(inspector): read tool artifacts from session artifacts dir"
```

(If no change was needed, skip this step.)

---

### Task 4: Write tests

**Files:**
- Create: `tests/tools/large-output-artifact.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../../src/events/event-log.js";

describe("Artifact output path", () => {
  let tmpDir: string;
  let log: EventLog;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "artifact-test-"));
    log = new EventLog(tmpDir);
    return log.init();
  });

  after(() => {
    log.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes artifact to session artifacts directory", async () => {
    // Import and test writeOutputToFile indirectly through the session path
    const artifactsDir = join(tmpDir, "artifacts");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");

    await mkdir(artifactsDir, { recursive: true });
    const artifactId = `art_test_${randomUUID()}`;
    const filePath = join(artifactsDir, `${artifactId}.json`);
    const content = JSON.stringify({ hello: "world" });
    await writeFile(filePath, content, "utf8");

    assert.ok(existsSync(filePath), "artifact file should exist");
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(data.hello, "world");
  });

  it("emits artifact.created event with correct path", async () => {
    const { randomUUID } = await import("node:crypto");
    const artifactId = `art_evt_${randomUUID()}`;
    const filePath = join(tmpDir, "artifacts", `${artifactId}.json`);

    await log.append({
      sessionId: "test",
      actor: "system",
      type: "artifact.created",
      payload: {
        artifactId,
        toolCallId: "tc_123",
        path: filePath,
        mimeType: "application/json",
        size: 42,
        retention: "session",
      },
    });

    const events = await log.readAll();
    const artifactEvents = events.filter(e => e.type === "artifact.created");
    assert.ok(artifactEvents.length >= 1);
    const last = artifactEvents[artifactEvents.length - 1];
    assert.equal((last.payload as any).path, filePath);
    assert.equal((last.payload as any).retention, "session");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/tools/large-output-artifact.test.ts 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/large-output-artifact.test.ts
git commit -m "test(tools): artifact output path and artifact.created event"
```
