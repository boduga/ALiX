# P1.1 Frontend Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full ALiX inspector experience so users can inspect context, patches, shell output, approvals, verification, token usage, replay, and session comparison from the vanilla JavaScript UI.

**Architecture:** Keep the event log as the single source of truth. Add one pure projection layer that turns raw events into view models, expose session snapshots and comparison through small server endpoints, then render focused inspector panels from those projections. Avoid new runtime dependencies and keep all UI code vanilla browser JavaScript.

**Tech Stack:** TypeScript, Node HTTP server, JSONL event log, vanilla JavaScript ES modules, `node:test`, existing SSE stream.

---

## Current Status

Already implemented:
- `src/server/server.ts` serves static UI assets and live SSE events from `.alix/sessions/<sessionId>/events.jsonl`.
- `src/ui/index.html`, `src/ui/app.js`, and `src/ui/styles.css` render a basic live timeline.
- `src/events/event-log.ts` appends JSONL events.
- `src/events/replay.ts` has a minimal projection for changed files and summary.
- Tests cover SSE streaming and basic HTML serving.

Missing:
- Diff/patch activity view.
- Terminal output stream view.
- Approval panel.
- Context bundle view with files, symbols, scores, reasons, and budget.
- Verification result view.
- Token usage display.
- Replay controls.
- Session comparison.

## File Structure

- Create `src/inspector/projection.ts`
  - Server-side projection from `AlixEvent[]` to an inspector snapshot.
  - Keeps UI endpoint output stable and easy to test.

- Create `src/inspector/session-reader.ts`
  - Reads session event logs from `.alix/sessions/<id>/events.jsonl`.
  - Compares two snapshots.

- Modify `src/events/types.ts`
  - Add `InspectorSnapshot`, `InspectorComparison`, and small view-model types.

- Modify `src/server/server.ts`
  - Add `GET /api/sessions/:id/snapshot`.
  - Add `GET /api/sessions/compare?left=<id>&right=<id>`.
  - Serve `projection.js`.

- Create `src/ui/projection.js`
  - Browser-side projection helpers for live SSE updates and replay controls.
  - Export functions for Node tests and assign a browser global for the UI.

- Modify `src/ui/index.html`
  - Add tabbed inspector layout and panel containers.
  - Load `projection.js` and `app.js` as ES modules.

- Modify `src/ui/app.js`
  - Use projection helpers.
  - Render timeline, context, diffs, terminal, approvals, verification, tokens, and comparison.
  - Add replay controls.

- Modify `src/ui/styles.css`
  - Add dense dashboard layout, tabs, split panels, code/output blocks, and replay controls.

- Modify `package.json`
  - Copy `src/ui/projection.js` during build.

- Modify `src/run.ts`
  - Enrich `context.bundle_compiled` payload with the actual context items needed by the inspector.
  - Log provider token usage when available.

- Create tests:
  - `tests/inspector-projection.test.ts`
  - `tests/session-reader.test.ts`
  - `tests/ui-projection.test.js`
  - Extend `tests/server.test.ts`
  - Extend `tests/context-prompt.test.ts` or create `tests/context-events.test.ts`

---

### Task 1: Server-Side Inspector Projection

**Files:**
- Modify: `src/events/types.ts`
- Create: `src/inspector/projection.ts`
- Test: `tests/inspector-projection.test.ts`

- [ ] **Step 1: Write failing projection tests**

Create `tests/inspector-projection.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { AlixEvent } from "../src/events/types.js";
import { buildInspectorSnapshot, compareInspectorSnapshots } from "../src/inspector/projection.js";

function event(seq: number, type: string, actor: AlixEvent["actor"], payload: unknown): AlixEvent {
  return {
    id: `event-${seq}`,
    seq,
    version: 1,
    sessionId: "s1",
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    type,
    actor,
    payload,
  };
}

test("buildInspectorSnapshot groups observable session data", () => {
  const snapshot = buildInspectorSnapshot("s1", [
    event(1, "session.started", "system", { cwd: "/repo" }),
    event(2, "context.bundle_compiled", "system", {
      taskType: "bugfix",
      budget: { maxTokens: 1000, usedTokens: 300 },
      primaryFiles: [{ path: "src/auth.ts", kind: "file", score: 100, tokenEstimate: 80, reason: "task_mention" }],
      tests: [{ path: "tests/auth.test.ts", kind: "test", score: 40, tokenEstimate: 50, reason: "test_relationship" }],
      supportingFiles: [{ path: "package.json", kind: "config", score: 10, tokenEstimate: 20, reason: "config_file" }],
      pinned: [],
    }),
    event(3, "tool.requested", "system", { toolCallId: "t1", toolName: "shell.run", argsPreview: { command: "npm test" } }),
    event(4, "tool.completed", "system", { toolCallId: "t1", toolName: "shell.run", outputPreview: "ok", status: "success" }),
    event(5, "patch.checkpoint_created", "system", { toolCallId: "p1", files: ["src/auth.ts"], missingFiles: [] }),
    event(6, "tool.completed", "system", { toolCallId: "p1", toolName: "patch.apply", changedFiles: ["src/auth.ts"] }),
    event(7, "autonomy.scope_expansion", "policy", { paths: ["src/new.ts"], toolCallId: "p2", toolName: "patch.apply" }),
    event(8, "verification.check_started", "verifier", { command: "npm test", reason: "package script" }),
    event(9, "verification.check_finished", "verifier", { command: "npm test", status: "passed" }),
    event(10, "model.usage", "agent", { provider: "anthropic", model: "claude", inputTokens: 100, outputTokens: 20 }),
    event(11, "session.ended", "system", { reason: "completed", summary: "done" }),
  ]);

  assert.equal(snapshot.sessionId, "s1");
  assert.equal(snapshot.summary.eventCount, 11);
  assert.equal(snapshot.summary.status, "completed");
  assert.equal(snapshot.context?.taskType, "bugfix");
  assert.equal(snapshot.context?.primaryFiles[0]?.path, "src/auth.ts");
  assert.equal(snapshot.terminal[0]?.command, "npm test");
  assert.deepEqual(snapshot.diffs[0]?.changedFiles, ["src/auth.ts"]);
  assert.deepEqual(snapshot.approvals[0]?.paths, ["src/new.ts"]);
  assert.equal(snapshot.verification[0]?.status, "passed");
  assert.equal(snapshot.tokens.totalInputTokens, 100);
  assert.equal(snapshot.tokens.totalOutputTokens, 20);
});

test("compareInspectorSnapshots reports changed file and verification differences", () => {
  const left = buildInspectorSnapshot("left", [
    event(1, "tool.completed", "system", { toolCallId: "p1", toolName: "patch.apply", changedFiles: ["src/a.ts"] }),
    event(2, "verification.check_finished", "verifier", { command: "npm test", status: "passed" }),
  ]);
  const right = buildInspectorSnapshot("right", [
    { ...event(1, "tool.completed", "system", { toolCallId: "p2", toolName: "patch.apply", changedFiles: ["src/b.ts"] }), sessionId: "right" },
    { ...event(2, "verification.check_finished", "verifier", { command: "npm test", status: "failed" }), sessionId: "right" },
  ]);

  const comparison = compareInspectorSnapshots(left, right);
  assert.deepEqual(comparison.changedFilesOnlyLeft, ["src/a.ts"]);
  assert.deepEqual(comparison.changedFilesOnlyRight, ["src/b.ts"]);
  assert.equal(comparison.verificationStatus.left, "passed");
  assert.equal(comparison.verificationStatus.right, "failed");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: TypeScript fails because `src/inspector/projection.ts` does not exist.

- [ ] **Step 3: Add inspector types**

Append these types to `src/events/types.ts`:

```ts
export type InspectorContextItem = {
  path: string;
  kind: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  score?: number;
  tokenEstimate?: number;
  reason?: string;
};

export type InspectorSnapshot = {
  sessionId: string;
  summary: {
    eventCount: number;
    status: "running" | "completed" | "failed" | "unknown";
    reason?: string;
    latestSeq?: number;
    startedAt?: string;
    endedAt?: string;
  };
  timeline: AlixEvent[];
  context?: {
    taskType?: string;
    budget?: { maxTokens: number; usedTokens: number };
    primaryFiles: InspectorContextItem[];
    tests: InspectorContextItem[];
    supportingFiles: InspectorContextItem[];
    pinned: InspectorContextItem[];
  };
  diffs: Array<{
    toolCallId?: string;
    changedFiles: string[];
    checkpointFiles: string[];
    rolledBack: boolean;
    status: "applied" | "failed" | "rolled_back" | "checkpointed";
  }>;
  terminal: Array<{
    toolCallId?: string;
    command: string;
    status?: string;
    outputPreview?: string;
    error?: string;
  }>;
  approvals: Array<{
    toolCallId?: string;
    toolName?: string;
    paths: string[];
    status: "pending" | "approved" | "denied" | "auto_approved" | "skipped";
  }>;
  verification: Array<{
    command: string;
    reason?: string;
    status?: "passed" | "failed" | "skipped" | string;
    output?: string;
  }>;
  tokens: {
    totalInputTokens: number;
    totalOutputTokens: number;
    entries: Array<{ provider?: string; model?: string; inputTokens: number; outputTokens: number }>;
  };
};

export type InspectorComparison = {
  leftSessionId: string;
  rightSessionId: string;
  changedFilesOnlyLeft: string[];
  changedFilesOnlyRight: string[];
  changedFilesBoth: string[];
  verificationStatus: { left: string; right: string };
  tokenDelta: { inputTokens: number; outputTokens: number };
};
```

- [ ] **Step 4: Implement projection**

Create `src/inspector/projection.ts`:

```ts
import type { AlixEvent, InspectorComparison, InspectorSnapshot } from "../events/types.js";

type Payload = Record<string, unknown>;

export function buildInspectorSnapshot(sessionId: string, events: AlixEvent[]): InspectorSnapshot {
  const snapshot: InspectorSnapshot = {
    sessionId,
    summary: {
      eventCount: events.length,
      status: "running",
      latestSeq: events.at(-1)?.seq,
      startedAt: events.find((event) => event.type === "session.started")?.timestamp,
    },
    timeline: events,
    diffs: [],
    terminal: [],
    approvals: [],
    verification: [],
    tokens: { totalInputTokens: 0, totalOutputTokens: 0, entries: [] },
  };

  const shellByToolCall = new Map<string, InspectorSnapshot["terminal"][number]>();
  const diffByToolCall = new Map<string, InspectorSnapshot["diffs"][number]>();
  const verificationByCommand = new Map<string, InspectorSnapshot["verification"][number]>();

  for (const event of events) {
    const payload = asPayload(event.payload);

    if (event.type === "session.ended") {
      snapshot.summary.status = String(payload.reason ?? "") === "completed" ? "completed" : "failed";
      snapshot.summary.reason = stringValue(payload.reason);
      snapshot.summary.endedAt = event.timestamp;
    }

    if (event.type === "context.bundle_compiled") {
      snapshot.context = {
        taskType: stringValue(payload.taskType),
        budget: isBudget(payload.budget) ? payload.budget : undefined,
        primaryFiles: arrayValue(payload.primaryFiles),
        tests: arrayValue(payload.tests),
        supportingFiles: arrayValue(payload.supportingFiles),
        pinned: arrayValue(payload.pinned),
      };
    }

    if (event.type === "tool.requested" && payload.toolName === "shell.run") {
      const toolCallId = stringValue(payload.toolCallId);
      const argsPreview = asPayload(payload.argsPreview);
      const item = { toolCallId, command: stringValue(argsPreview.command) ?? "", status: "requested" };
      if (toolCallId) shellByToolCall.set(toolCallId, item);
      snapshot.terminal.push(item);
    }

    if ((event.type === "tool.completed" || event.type === "tool.failed") && payload.toolName === "shell.run") {
      const toolCallId = stringValue(payload.toolCallId);
      const item = (toolCallId && shellByToolCall.get(toolCallId)) ?? {
        toolCallId,
        command: "",
      };
      item.status = stringValue(payload.status) ?? (event.type === "tool.completed" ? "success" : "error");
      item.outputPreview = stringValue(payload.outputPreview);
      item.error = stringValue(payload.error);
      if (!snapshot.terminal.includes(item)) snapshot.terminal.push(item);
    }

    if (event.type === "patch.checkpoint_created") {
      const toolCallId = stringValue(payload.toolCallId);
      const item = {
        toolCallId,
        changedFiles: [],
        checkpointFiles: stringArray(payload.files),
        rolledBack: false,
        status: "checkpointed" as const,
      };
      if (toolCallId) diffByToolCall.set(toolCallId, item);
      snapshot.diffs.push(item);
    }

    if ((event.type === "tool.completed" || event.type === "tool.failed") && payload.toolName === "patch.apply") {
      const toolCallId = stringValue(payload.toolCallId);
      const item = (toolCallId && diffByToolCall.get(toolCallId)) ?? {
        toolCallId,
        changedFiles: [],
        checkpointFiles: [],
        rolledBack: false,
        status: "checkpointed" as const,
      };
      item.changedFiles = stringArray(payload.changedFiles);
      item.status = event.type === "tool.completed" ? "applied" : "failed";
      if (!snapshot.diffs.includes(item)) snapshot.diffs.push(item);
    }

    if (event.type === "patch.rollback_completed") {
      const toolCallId = stringValue(payload.toolCallId);
      const item = toolCallId ? diffByToolCall.get(toolCallId) : undefined;
      if (item) {
        item.rolledBack = true;
        item.status = "rolled_back";
      }
    }

    if (event.type === "autonomy.scope_expansion") {
      snapshot.approvals.push({
        toolCallId: stringValue(payload.toolCallId),
        toolName: stringValue(payload.toolName),
        paths: stringArray(payload.paths),
        status: "pending",
      });
    }

    if (event.type === "autonomy.scope_approved" || event.type === "autonomy.scope_auto_approved" || event.type === "autonomy.scope_denied" || event.type === "autonomy.scope_skipped") {
      snapshot.approvals.push({
        toolCallId: stringValue(payload.toolCallId),
        toolName: stringValue(payload.toolName),
        paths: stringArray(payload.paths),
        status:
          event.type === "autonomy.scope_approved" ? "approved" :
          event.type === "autonomy.scope_auto_approved" ? "auto_approved" :
          event.type === "autonomy.scope_skipped" ? "skipped" :
          "denied",
      });
    }

    if (event.type === "verification.check_started") {
      const command = stringValue(payload.command) ?? "";
      const item = { command, reason: stringValue(payload.reason), status: "running" };
      verificationByCommand.set(command, item);
      snapshot.verification.push(item);
    }

    if (event.type === "verification.check_finished") {
      const command = stringValue(payload.command) ?? "";
      const item = verificationByCommand.get(command) ?? { command };
      item.status = stringValue(payload.status);
      item.output = stringValue(payload.output);
      if (!snapshot.verification.includes(item)) snapshot.verification.push(item);
    }

    if (event.type === "model.usage") {
      const inputTokens = numberValue(payload.inputTokens);
      const outputTokens = numberValue(payload.outputTokens);
      snapshot.tokens.entries.push({
        provider: stringValue(payload.provider),
        model: stringValue(payload.model),
        inputTokens,
        outputTokens,
      });
      snapshot.tokens.totalInputTokens += inputTokens;
      snapshot.tokens.totalOutputTokens += outputTokens;
    }
  }

  if (snapshot.summary.status === "running" && events.some((event) => event.type === "tool.failed")) {
    snapshot.summary.status = "unknown";
  }

  return snapshot;
}

export function compareInspectorSnapshots(left: InspectorSnapshot, right: InspectorSnapshot): InspectorComparison {
  const leftFiles = new Set(left.diffs.flatMap((diff) => diff.changedFiles));
  const rightFiles = new Set(right.diffs.flatMap((diff) => diff.changedFiles));
  const changedFilesOnlyLeft = [...leftFiles].filter((file) => !rightFiles.has(file)).sort();
  const changedFilesOnlyRight = [...rightFiles].filter((file) => !leftFiles.has(file)).sort();
  const changedFilesBoth = [...leftFiles].filter((file) => rightFiles.has(file)).sort();

  return {
    leftSessionId: left.sessionId,
    rightSessionId: right.sessionId,
    changedFilesOnlyLeft,
    changedFilesOnlyRight,
    changedFilesBoth,
    verificationStatus: {
      left: summarizeVerification(left),
      right: summarizeVerification(right),
    },
    tokenDelta: {
      inputTokens: right.tokens.totalInputTokens - left.tokens.totalInputTokens,
      outputTokens: right.tokens.totalOutputTokens - left.tokens.totalOutputTokens,
    },
  };
}

function summarizeVerification(snapshot: InspectorSnapshot): string {
  if (snapshot.verification.length === 0) return "none";
  if (snapshot.verification.some((check) => check.status === "failed")) return "failed";
  if (snapshot.verification.every((check) => check.status === "passed")) return "passed";
  return "mixed";
}

function asPayload(value: unknown): Payload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Payload : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayValue(value: unknown): InspectorSnapshot["context"]["primaryFiles"] {
  return Array.isArray(value) ? value as InspectorSnapshot["context"]["primaryFiles"] : [];
}

function isBudget(value: unknown): value is { maxTokens: number; usedTokens: number } {
  const payload = asPayload(value);
  return typeof payload.maxTokens === "number" && typeof payload.usedTokens === "number";
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/inspector-projection.test.js
```

Expected: projection tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/events/types.ts src/inspector/projection.ts tests/inspector-projection.test.ts
git commit -m "feat: add inspector event projection"
```

---

### Task 2: Session Snapshot and Comparison Endpoints

**Files:**
- Create: `src/inspector/session-reader.ts`
- Modify: `src/server/server.ts`
- Test: `tests/session-reader.test.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing session reader tests**

Create `tests/session-reader.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSessionEvents, readSessionSnapshot, readSessionComparison } from "../src/inspector/session-reader.js";

test("readSessionSnapshot reads JSONL events and returns projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-inspector-"));
  try {
    const dir = join(root, ".alix", "sessions", "s1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), [
      JSON.stringify({ id: "1", seq: 1, version: 1, sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", type: "session.started", actor: "system", payload: {} }),
      JSON.stringify({ id: "2", seq: 2, version: 1, sessionId: "s1", timestamp: "2026-01-01T00:00:01Z", type: "session.ended", actor: "system", payload: { reason: "completed" } }),
    ].join("\n") + "\n");

    const events = await readSessionEvents(root, "s1");
    const snapshot = await readSessionSnapshot(root, "s1");
    assert.equal(events.length, 2);
    assert.equal(snapshot.summary.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readSessionComparison compares two sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-inspector-"));
  try {
    for (const sessionId of ["left", "right"]) {
      await mkdir(join(root, ".alix", "sessions", sessionId), { recursive: true });
    }
    await writeFile(join(root, ".alix", "sessions", "left", "events.jsonl"), `${JSON.stringify({
      id: "1", seq: 1, version: 1, sessionId: "left", timestamp: "2026-01-01T00:00:00Z", type: "tool.completed", actor: "system", payload: { toolCallId: "p1", toolName: "patch.apply", changedFiles: ["src/a.ts"] },
    })}\n`);
    await writeFile(join(root, ".alix", "sessions", "right", "events.jsonl"), `${JSON.stringify({
      id: "1", seq: 1, version: 1, sessionId: "right", timestamp: "2026-01-01T00:00:00Z", type: "tool.completed", actor: "system", payload: { toolCallId: "p2", toolName: "patch.apply", changedFiles: ["src/b.ts"] },
    })}\n`);

    const comparison = await readSessionComparison(root, "left", "right");
    assert.deepEqual(comparison.changedFilesOnlyLeft, ["src/a.ts"]);
    assert.deepEqual(comparison.changedFilesOnlyRight, ["src/b.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Extend server endpoint tests**

Append to `tests/server.test.ts`:

```ts
test("serves session snapshot as JSON", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "alix-server-"));
  try {
    await mkdir(join(root, ".alix", "sessions", "s1"), { recursive: true });
    await writeFile(join(root, ".alix", "sessions", "s1", "events.jsonl"), `${JSON.stringify({
      id: "1", seq: 1, version: 1, sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", type: "session.started", actor: "system", payload: {},
    })}\n`);

    const server = await startServer(root, 0);
    try {
      const response = await fetch(`${server.url}/api/sessions/s1/snapshot`);
      const json = await response.json() as { sessionId: string; summary: { eventCount: number } };
      assert.equal(response.status, 200);
      assert.equal(json.sessionId, "s1");
      assert.equal(json.summary.eventCount, 1);
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serves session comparison as JSON", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "alix-server-"));
  try {
    for (const sessionId of ["left", "right"]) {
      await mkdir(join(root, ".alix", "sessions", sessionId), { recursive: true });
      await writeFile(join(root, ".alix", "sessions", sessionId, "events.jsonl"), "");
    }

    const server = await startServer(root, 0);
    try {
      const response = await fetch(`${server.url}/api/sessions/compare?left=left&right=right`);
      const json = await response.json() as { leftSessionId: string; rightSessionId: string };
      assert.equal(response.status, 200);
      assert.equal(json.leftSessionId, "left");
      assert.equal(json.rightSessionId, "right");
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: build fails because `src/inspector/session-reader.ts` does not exist or endpoints are missing.

- [ ] **Step 4: Implement session reader**

Create `src/inspector/session-reader.ts`:

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlixEvent, InspectorComparison, InspectorSnapshot } from "../events/types.js";
import { buildInspectorSnapshot, compareInspectorSnapshots } from "./projection.js";

export async function readSessionEvents(root: string, sessionId: string): Promise<AlixEvent[]> {
  const eventsPath = join(root, ".alix", "sessions", sessionId, "events.jsonl");
  if (!existsSync(eventsPath)) return [];
  const text = await readFile(eventsPath, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AlixEvent);
}

export async function readSessionSnapshot(root: string, sessionId: string): Promise<InspectorSnapshot> {
  return buildInspectorSnapshot(sessionId, await readSessionEvents(root, sessionId));
}

export async function readSessionComparison(root: string, leftSessionId: string, rightSessionId: string): Promise<InspectorComparison> {
  const left = await readSessionSnapshot(root, leftSessionId);
  const right = await readSessionSnapshot(root, rightSessionId);
  return compareInspectorSnapshots(left, right);
}
```

- [ ] **Step 5: Add server endpoints and static module serving**

Modify `src/server/server.ts`:

```ts
import { readSessionComparison, readSessionSnapshot } from "../inspector/session-reader.js";
```

Change the static file condition:

```ts
if (url.pathname === "/app.js" || url.pathname === "/projection.js" || url.pathname === "/styles.css") {
  const file = join(root, "dist", "src", "ui", url.pathname.slice(1));
  res.setHeader("content-type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
  res.end(await readFile(file, "utf8"));
  return;
}
```

Add before the SSE endpoint:

```ts
if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/snapshot")) {
  const sessionId = url.pathname.split("/")[3];
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(await readSessionSnapshot(root, sessionId)));
  return;
}

if (url.pathname === "/api/sessions/compare") {
  const left = url.searchParams.get("left");
  const right = url.searchParams.get("right");
  if (!left || !right) {
    res.statusCode = 400;
    res.end("Missing left or right session id");
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(await readSessionComparison(root, left, right)));
  return;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/session-reader.test.js dist/tests/server.test.js
```

Expected: session reader and server tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/inspector/session-reader.ts src/server/server.ts tests/session-reader.test.ts tests/server.test.ts
git commit -m "feat: add inspector snapshot endpoints"
```

---

### Task 3: Browser Projection Helpers and Replay State

**Files:**
- Create: `src/ui/projection.js`
- Modify: `package.json`
- Test: `tests/ui-projection.test.js`

- [ ] **Step 1: Write failing browser projection tests**

Create `tests/ui-projection.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildUiProjection, createReplayState, visibleEventsForReplay } from "../src/ui/projection.js";

const events = [
  { seq: 1, type: "session.started", actor: "system", timestamp: "2026-01-01T00:00:00Z", payload: {} },
  { seq: 2, type: "tool.requested", actor: "system", timestamp: "2026-01-01T00:00:01Z", payload: { toolCallId: "s1", toolName: "shell.run", argsPreview: { command: "npm test" } } },
  { seq: 3, type: "tool.completed", actor: "system", timestamp: "2026-01-01T00:00:02Z", payload: { toolCallId: "s1", toolName: "shell.run", status: "success", outputPreview: "ok" } },
  { seq: 4, type: "verification.check_finished", actor: "verifier", timestamp: "2026-01-01T00:00:03Z", payload: { command: "npm test", status: "passed" } },
];

test("buildUiProjection derives panel counts from raw events", () => {
  const projection = buildUiProjection(events);
  assert.equal(projection.summary.eventCount, 4);
  assert.equal(projection.summary.toolCount, 2);
  assert.equal(projection.terminal[0].command, "npm test");
  assert.equal(projection.verification[0].status, "passed");
});

test("visibleEventsForReplay returns events up to cursor", () => {
  const state = createReplayState(events);
  state.cursor = 2;
  assert.deepEqual(visibleEventsForReplay(state).map((event) => event.seq), [1, 2]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test tests/ui-projection.test.js
```

Expected: fails because `src/ui/projection.js` does not exist.

- [ ] **Step 3: Implement UI projection helpers**

Create `src/ui/projection.js`:

```js
export function buildUiProjection(events) {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const summary = {
    eventCount: ordered.length,
    toolCount: ordered.filter((event) => event.type?.startsWith("tool.")).length,
    errorCount: ordered.filter((event) => event.type === "tool.failed").length,
    latestSeq: ordered.at(-1)?.seq ?? 0,
  };

  return {
    summary,
    timeline: ordered,
    context: latestPayload(ordered, "context.bundle_compiled"),
    terminal: buildTerminal(ordered),
    diffs: buildDiffs(ordered),
    approvals: buildApprovals(ordered),
    verification: buildVerification(ordered),
    tokens: buildTokens(ordered),
  };
}

export function createReplayState(events) {
  return {
    events: [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    cursor: events.length,
    playing: false,
    speedMs: 700,
  };
}

export function visibleEventsForReplay(state) {
  return state.events.slice(0, Math.max(0, state.cursor));
}

function latestPayload(events, type) {
  return [...events].reverse().find((event) => event.type === type)?.payload ?? null;
}

function buildTerminal(events) {
  const byId = new Map();
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "tool.requested" && payload.toolName === "shell.run") {
      byId.set(payload.toolCallId, {
        toolCallId: payload.toolCallId,
        command: payload.argsPreview?.command ?? "",
        status: "requested",
        outputPreview: "",
      });
    }
    if ((event.type === "tool.completed" || event.type === "tool.failed") && payload.toolName === "shell.run") {
      const item = byId.get(payload.toolCallId) ?? { toolCallId: payload.toolCallId, command: "" };
      item.status = payload.status ?? (event.type === "tool.completed" ? "success" : "error");
      item.outputPreview = payload.outputPreview ?? "";
      item.error = payload.error;
      byId.set(payload.toolCallId, item);
    }
  }
  return [...byId.values()];
}

function buildDiffs(events) {
  return events
    .filter((event) => event.type === "tool.completed" && event.payload?.toolName === "patch.apply")
    .map((event) => ({
      toolCallId: event.payload.toolCallId,
      changedFiles: event.payload.changedFiles ?? [],
      status: "applied",
    }));
}

function buildApprovals(events) {
  return events
    .filter((event) => event.type?.startsWith("autonomy.scope_"))
    .map((event) => ({
      type: event.type,
      paths: event.payload?.paths ?? [],
      status: event.type.replace("autonomy.scope_", ""),
    }));
}

function buildVerification(events) {
  return events
    .filter((event) => event.type === "verification.check_finished")
    .map((event) => ({
      command: event.payload?.command ?? "",
      status: event.payload?.status ?? "unknown",
      output: event.payload?.output ?? "",
    }));
}

function buildTokens(events) {
  const entries = events
    .filter((event) => event.type === "model.usage")
    .map((event) => event.payload ?? {});
  return {
    entries,
    totalInputTokens: entries.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
    totalOutputTokens: entries.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
  };
}

if (typeof window !== "undefined") {
  window.AlixInspectorProjection = {
    buildUiProjection,
    createReplayState,
    visibleEventsForReplay,
  };
}
```

- [ ] **Step 4: Update build copy command**

Modify `package.json`:

```json
"build": "tsc -p tsconfig.json && mkdir -p dist/src/ui && cp src/ui/index.html src/ui/app.js src/ui/projection.js src/ui/styles.css dist/src/ui/"
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test tests/ui-projection.test.js
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: tests pass and `dist/src/ui/projection.js` exists.

- [ ] **Step 6: Commit**

```bash
git add package.json src/ui/projection.js tests/ui-projection.test.js
git commit -m "feat: add inspector ui projection helpers"
```

---

### Task 4: Enrich Context and Token Events

**Files:**
- Modify: `src/run.ts`
- Test: `tests/context-events.test.ts`

- [ ] **Step 1: Write failing context event test**

Create `tests/context-events.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildContextBundleEventPayload, buildModelUsageEventPayload } from "../src/run.js";

test("buildContextBundleEventPayload includes inspectable context items", () => {
  const payload = buildContextBundleEventPayload({
    id: "bundle-1",
    taskType: "bugfix",
    budget: { maxTokens: 1000, usedTokens: 200 },
    primaryFiles: [{ path: "src/auth.ts", kind: "file", score: 100, tokenEstimate: 80, reason: "task_mention" }],
    tests: [{ path: "tests/auth.test.ts", kind: "test", score: 40, tokenEstimate: 50, reason: "test_relationship" }],
    supportingFiles: [{ path: "package.json", kind: "config", score: 10, tokenEstimate: 20, reason: "config_file" }],
    pinned: [],
  });

  assert.equal(payload.primaryCount, 1);
  assert.equal(payload.primaryFiles[0]?.path, "src/auth.ts");
  assert.equal(payload.tests[0]?.reason, "test_relationship");
});

test("buildModelUsageEventPayload normalizes provider usage", () => {
  const payload = buildModelUsageEventPayload("anthropic", "claude-sonnet", { inputTokens: 10, outputTokens: 3 });
  assert.deepEqual(payload, {
    provider: "anthropic",
    model: "claude-sonnet",
    inputTokens: 10,
    outputTokens: 3,
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: TypeScript fails because the exported helpers do not exist.

- [ ] **Step 3: Add exported helpers in `src/run.ts`**

Add near `renderContextBundleForPrompt()`:

```ts
export function buildContextBundleEventPayload(contextBundle: import("./repomap/context-compiler.js").ContextBundle) {
  return {
    taskType: contextBundle.taskType,
    budget: contextBundle.budget,
    primaryCount: contextBundle.primaryFiles.length,
    testCount: contextBundle.tests.length,
    supportingCount: contextBundle.supportingFiles.length,
    pinnedCount: contextBundle.pinned.length,
    primaryFiles: contextBundle.primaryFiles,
    tests: contextBundle.tests,
    supportingFiles: contextBundle.supportingFiles,
    pinned: contextBundle.pinned,
  };
}

export function buildModelUsageEventPayload(provider: string, model: string, usage: TokenUsage) {
  return {
    provider,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}
```

- [ ] **Step 4: Use helpers in run loop**

Replace the `context.bundle_compiled` payload in `src/run.ts` with:

```ts
payload: buildContextBundleEventPayload(contextBundle)
```

After `await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text } });`, add:

```ts
if (usage) {
  await log.append({
    ...session,
    actor: "agent",
    type: "model.usage",
    payload: buildModelUsageEventPayload(config.model.provider, config.model.name, usage),
  });
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/context-events.test.js dist/tests/context-prompt.test.js
```

Expected: context event tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/run.ts tests/context-events.test.ts
git commit -m "feat: expose context and token inspector events"
```

---

### Task 5: Inspector Panels and Replay Controls

**Files:**
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.js`
- Modify: `src/ui/styles.css`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Extend HTML serving test**

Add to `tests/server.test.ts`:

```ts
test("serves inspector shell with observability panels", async () => {
  const server = await startServer(process.cwd(), 0);
  try {
    const response = await fetch(server.url);
    const text = await response.text();
    assert.match(text, /data-panel="timeline"/);
    assert.match(text, /data-panel="context"/);
    assert.match(text, /data-panel="diffs"/);
    assert.match(text, /data-panel="terminal"/);
    assert.match(text, /data-panel="approvals"/);
    assert.match(text, /data-panel="verification"/);
    assert.match(text, /data-panel="tokens"/);
    assert.match(text, /id="replay-play"/);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/server.test.js
```

Expected: test fails because the panel markup is missing.

- [ ] **Step 3: Replace inspector HTML body layout**

In `src/ui/index.html`, replace the current timeline-only section with:

```html
      <section class="workspace">
        <nav class="tabs" aria-label="Inspector views">
          <button class="tab active" data-panel="timeline">Timeline</button>
          <button class="tab" data-panel="context">Context</button>
          <button class="tab" data-panel="diffs">Diffs</button>
          <button class="tab" data-panel="terminal">Terminal</button>
          <button class="tab" data-panel="approvals">Approvals</button>
          <button class="tab" data-panel="verification">Verification</button>
          <button class="tab" data-panel="tokens">Tokens</button>
          <button class="tab" data-panel="compare">Compare</button>
        </nav>

        <section class="replay-bar" aria-label="Replay controls">
          <button id="replay-start" title="Jump to start">|&lt;</button>
          <button id="replay-step-back" title="Step back">&lt;</button>
          <button id="replay-play" title="Play or pause replay">Play</button>
          <button id="replay-step-forward" title="Step forward">&gt;</button>
          <button id="replay-end" title="Jump to latest">&gt;|</button>
          <label for="replay-speed">Speed</label>
          <input id="replay-speed" type="range" min="150" max="1500" step="150" value="700">
          <span id="replay-position">0 / 0</span>
        </section>

        <section class="panel active" id="panel-timeline" aria-label="Session timeline">
          <div class="panel-header">
            <h2>Timeline</h2>
            <span class="status" id="connection-status">Disconnected</span>
          </div>
          <ol id="events"></ol>
        </section>

        <section class="panel" id="panel-context" aria-label="Context bundle"><div class="panel-header"><h2>Context</h2></div><div id="context-view" class="panel-body"></div></section>
        <section class="panel" id="panel-diffs" aria-label="Diff activity"><div class="panel-header"><h2>Diffs</h2></div><div id="diff-view" class="panel-body"></div></section>
        <section class="panel" id="panel-terminal" aria-label="Terminal output"><div class="panel-header"><h2>Terminal</h2></div><div id="terminal-view" class="panel-body"></div></section>
        <section class="panel" id="panel-approvals" aria-label="Approvals"><div class="panel-header"><h2>Approvals</h2></div><div id="approval-view" class="panel-body"></div></section>
        <section class="panel" id="panel-verification" aria-label="Verification"><div class="panel-header"><h2>Verification</h2></div><div id="verification-view" class="panel-body"></div></section>
        <section class="panel" id="panel-tokens" aria-label="Token usage"><div class="panel-header"><h2>Tokens</h2></div><div id="token-view" class="panel-body"></div></section>
        <section class="panel" id="panel-compare" aria-label="Session comparison">
          <div class="panel-header"><h2>Compare</h2></div>
          <div class="panel-body compare-form">
            <input id="compare-left" type="text" placeholder="Left session ID">
            <input id="compare-right" type="text" placeholder="Right session ID">
            <button id="compare-btn">Compare</button>
            <pre id="compare-view" class="event-payload"></pre>
          </div>
        </section>
      </section>
```

Change scripts at the bottom:

```html
    <script type="module" src="/projection.js"></script>
    <script type="module" src="/app.js"></script>
```

- [ ] **Step 4: Update app rendering**

At the top of `src/ui/app.js`, import projection helpers:

```js
import { buildUiProjection, createReplayState, visibleEventsForReplay } from "./projection.js";
```

Add DOM references:

```js
const panelEls = [...document.querySelectorAll(".panel")];
const tabEls = [...document.querySelectorAll(".tab")];
const contextView = document.getElementById("context-view");
const diffView = document.getElementById("diff-view");
const terminalView = document.getElementById("terminal-view");
const approvalView = document.getElementById("approval-view");
const verificationView = document.getElementById("verification-view");
const tokenView = document.getElementById("token-view");
const replayPlay = document.getElementById("replay-play");
const replayPosition = document.getElementById("replay-position");
const compareBtn = document.getElementById("compare-btn");
const compareView = document.getElementById("compare-view");
let replayState = createReplayState([]);
let replayTimer = null;
```

Add tab handling:

```js
for (const tab of tabEls) {
  tab.addEventListener("click", () => {
    const panel = tab.dataset.panel;
    tabEls.forEach((item) => item.classList.toggle("active", item === tab));
    panelEls.forEach((item) => item.classList.toggle("active", item.id === `panel-${panel}`));
  });
}
```

Replace direct `renderEvents()` calls with:

```js
function renderAll() {
  const visibleEvents = visibleEventsForReplay(replayState);
  const projection = buildUiProjection(visibleEvents);
  renderEventsFrom(visibleEvents);
  renderContext(projection.context);
  renderList(diffView, projection.diffs, renderDiff);
  renderList(terminalView, projection.terminal, renderTerminal);
  renderList(approvalView, projection.approvals, renderApproval);
  renderList(verificationView, projection.verification, renderVerification);
  renderTokens(projection.tokens);
  replayPosition.textContent = `${visibleEvents.length} / ${replayState.events.length}`;
}
```

Add render helpers:

```js
function renderContext(context) {
  if (!context) {
    contextView.innerHTML = `<p class="empty">No context bundle event yet.</p>`;
    return;
  }
  contextView.innerHTML = `
    <div class="metric-row">
      <span>Task: ${escapeHtml(context.taskType ?? "unknown")}</span>
      <span>Budget: ${context.budget?.usedTokens ?? 0} / ${context.budget?.maxTokens ?? 0}</span>
    </div>
    ${renderContextGroup("Primary", context.primaryFiles ?? [])}
    ${renderContextGroup("Tests", context.tests ?? [])}
    ${renderContextGroup("Supporting", context.supportingFiles ?? [])}
    ${renderContextGroup("Pinned", context.pinned ?? [])}
  `;
}

function renderContextGroup(title, items) {
  if (items.length === 0) return "";
  return `<h3>${title}</h3><ul class="compact-list">${items.map((item) => `<li><strong>${escapeHtml(item.path)}</strong><span>${escapeHtml(item.reason ?? "")}</span></li>`).join("")}</ul>`;
}

function renderList(container, items, renderer) {
  container.innerHTML = items.length === 0 ? `<p class="empty">No events yet.</p>` : items.map(renderer).join("");
}

function renderDiff(diff) {
  return `<article class="inspector-card"><strong>${escapeHtml(diff.status)}</strong><ul>${(diff.changedFiles ?? []).map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul></article>`;
}

function renderTerminal(item) {
  return `<article class="inspector-card"><strong>${escapeHtml(item.command)}</strong><span>${escapeHtml(item.status ?? "")}</span><pre>${escapeHtml(item.outputPreview ?? item.error ?? "")}</pre></article>`;
}

function renderApproval(item) {
  return `<article class="inspector-card"><strong>${escapeHtml(item.status)}</strong><ul>${(item.paths ?? []).map((path) => `<li>${escapeHtml(path)}</li>`).join("")}</ul></article>`;
}

function renderVerification(item) {
  return `<article class="inspector-card"><strong>${escapeHtml(item.command)}</strong><span>${escapeHtml(item.status ?? "unknown")}</span></article>`;
}

function renderTokens(tokens) {
  tokenView.innerHTML = `<div class="metric-grid"><div><span>Input</span><strong>${tokens.totalInputTokens}</strong></div><div><span>Output</span><strong>${tokens.totalOutputTokens}</strong></div></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
```

Add replay handling:

```js
replayPlay.addEventListener("click", () => {
  replayState.playing = !replayState.playing;
  replayPlay.textContent = replayState.playing ? "Pause" : "Play";
  if (replayTimer) clearInterval(replayTimer);
  if (replayState.playing) {
    replayTimer = setInterval(() => {
      replayState.cursor = Math.min(replayState.cursor + 1, replayState.events.length);
      if (replayState.cursor === replayState.events.length) {
        replayState.playing = false;
        replayPlay.textContent = "Play";
        clearInterval(replayTimer);
      }
      renderAll();
    }, replayState.speedMs);
  }
});
```

In `connect(sessionId)`, when events arrive, update replay state and call `renderAll()`:

```js
allEvents.push(event);
replayState = createReplayState(allEvents);
renderAll();
```

Add comparison button:

```js
compareBtn.addEventListener("click", async () => {
  const left = document.getElementById("compare-left").value.trim();
  const right = document.getElementById("compare-right").value.trim();
  if (!left || !right) return;
  const response = await fetch(`/api/sessions/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
  compareView.textContent = JSON.stringify(await response.json(), null, 2);
});
```

- [ ] **Step 5: Add panel styling**

Append to `src/ui/styles.css`:

```css
.workspace {
  display: grid;
  gap: 14px;
}

.tabs,
.replay-bar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tab,
.replay-bar button,
.compare-form button {
  background: rgba(21, 26, 27, 0.94);
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  font: inherit;
  padding: 7px 11px;
}

.tab.active {
  border-color: var(--accent);
  color: var(--accent);
}

.panel {
  display: none;
}

.panel.active {
  display: block;
}

.panel-body {
  padding: 16px 18px;
}

.metric-row,
.metric-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.metric-grid > div,
.inspector-card {
  background: rgba(0,0,0,0.22);
  border: 1px solid rgba(47,58,54,0.7);
  border-radius: 6px;
  margin-bottom: 10px;
  padding: 12px;
}

.compact-list {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}

.compact-list li {
  display: flex;
  gap: 10px;
  justify-content: space-between;
}

.empty {
  color: var(--muted);
  margin: 0;
}

.compare-form input,
#replay-speed {
  accent-color: var(--accent);
}
```

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/server.test.js tests/ui-projection.test.js
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/index.html src/ui/app.js src/ui/styles.css tests/server.test.ts
git commit -m "feat: add inspector observability panels"
```

---

### Task 6: Visual Smoke Test and Backlog Update

**Files:**
- Modify: `docs/post-mvp-backlog.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all non-integration tests pass, with the existing API-credit integration skips.

- [ ] **Step 2: Start local inspector server**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/cli.js server --port 0
```

Expected: command prints a local `http://127.0.0.1:<port>` URL.

- [ ] **Step 3: Inspect with the in-app browser**

Open the printed URL in the Codex in-app browser. Verify:
- The inspector loads without console-visible crashes.
- Tabs switch between Timeline, Context, Diffs, Terminal, Approvals, Verification, Tokens, and Compare.
- Replay controls do not change layout size.
- Text does not overlap at desktop width.
- Connecting to an existing session ID renders events and derived panels.

- [ ] **Step 4: Update backlog status**

In `docs/post-mvp-backlog.md`, replace the P1.1 missing list with:

```md
Current state: MVP complete. The inspector has a live timeline, snapshot endpoint, comparison endpoint, context view, diff activity view, terminal output view, approval history, verification view, token usage display, and replay controls.

Future upgrades:
- Inline patch hunks with syntax-aware highlighting.
- Interactive approval actions from the browser.
- Persisted replay bookmarks.
- Multi-session dashboard beyond pairwise comparison.
```

- [ ] **Step 5: GitNexus pre-commit check**

Run:

```bash
npx gitnexus analyze
```

Then use GitNexus `detect_changes` on staged changes before committing.

Expected: no HIGH or CRITICAL risk for the documentation/status update.

- [ ] **Step 6: Commit**

```bash
git add docs/post-mvp-backlog.md AGENTS.md CLAUDE.md
git commit -m "docs: mark inspector observability mvp complete"
```

---

## Self-Review

- **Spec coverage:** The plan covers all P1.1 missing items: diff viewer, terminal output, approval panel, context view, verification view, token usage, replay controls, and session comparison.
- **Placeholder scan:** No task uses deferred-detail placeholders. Each code-affecting task includes concrete files, tests, commands, and expected results.
- **Type consistency:** Server and UI projections intentionally use compatible snapshot field names: `context`, `diffs`, `terminal`, `approvals`, `verification`, and `tokens`.
- **Risk note:** The only runtime event-schema change is enriching `context.bundle_compiled` and adding `model.usage`; both are additive and should not break existing readers.
