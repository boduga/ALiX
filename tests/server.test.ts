import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InspectorComparison, InspectorSnapshot } from "../src/events/types.js";
import { startServer } from "../src/server/server.js";

function eventLine(seq: number, type: string, payload: unknown = {}, sessionId = "s1"): string {
  return JSON.stringify({
    id: String(seq),
    seq,
    version: 1,
    sessionId,
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    type,
    actor: "system",
    payload
  });
}

async function writeEvents(root: string, sessionId: string, lines: string[]): Promise<void> {
  const sessionDir = join(root, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "events.jsonl"), `${lines.join("\n")}\n`);
}

test("serves inspector html", async () => {
  const server = await startServer(process.cwd(), "127.0.0.1", 0);
  try {
    const response = await fetch(server.url);
    const text = await response.text();
    assert.match(text, /ALiX Inspector/);
  } finally {
    await server.close();
  }
});

test("serves projection module fallback before projection asset exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-server-"));
  try {
    const server = await startServer(root, "127.0.0.1", 0);
    try {
      const response = await fetch(`${server.url}/projection.js`);
      const text = await response.text();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/javascript");
      assert.equal(text.trim(), "export {};");
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serves session snapshot JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-server-"));
  try {
    await writeEvents(root, "s1", [
      eventLine(1, "session.started"),
      eventLine(2, "session.ended", { reason: "completed" })
    ]);

    const server = await startServer(root, "127.0.0.1", 0);
    try {
      const response = await fetch(`${server.url}/api/sessions/s1/snapshot`);
      const snapshot = (await response.json()) as InspectorSnapshot;

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(snapshot.sessionId, "s1");
      assert.equal(snapshot.summary.status, "completed");
      assert.equal(snapshot.summary.eventCount, 2);
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serves session comparison JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-server-"));
  try {
    await writeEvents(root, "left", [
      eventLine(1, "tool.completed", { toolCallId: "left-patch", toolName: "patch.apply", changedFiles: ["left.ts", "both.ts"] }, "left")
    ]);
    await writeEvents(root, "right", [
      eventLine(1, "tool.completed", { toolCallId: "right-patch", toolName: "patch.apply", changedFiles: ["right.ts", "both.ts"] }, "right")
    ]);

    const server = await startServer(root, "127.0.0.1", 0);
    try {
      const response = await fetch(`${server.url}/api/sessions/compare?left=left&right=right`);
      const comparison = (await response.json()) as InspectorComparison;

      assert.equal(response.status, 200);
      assert.equal(comparison.leftSessionId, "left");
      assert.equal(comparison.rightSessionId, "right");
      assert.deepEqual(comparison.changedFilesOnlyLeft, ["left.ts"]);
      assert.deepEqual(comparison.changedFilesOnlyRight, ["right.ts"]);
      assert.deepEqual(comparison.changedFilesBoth, ["both.ts"]);
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects session comparison requests missing either session id", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-server-"));
  try {
    const server = await startServer(root, "127.0.0.1", 0);
    try {
      const response = await fetch(`${server.url}/api/sessions/compare?left=left`);
      const text = await response.text();

      assert.equal(response.status, 400);
      assert.equal(text, "Missing left or right session id");
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serves inspector shell with observability panels", async () => {
  const server = await startServer(process.cwd(), "127.0.0.1", 0);
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
