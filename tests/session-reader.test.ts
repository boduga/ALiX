import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlixEvent } from "../src/events/types.js";
import { readSessionComparison, readSessionEvents, readSessionSnapshot } from "../src/inspector/session-reader.js";

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

test("readSessionEvents reads JSONL events and readSessionSnapshot projects completed status", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-session-reader-"));
  try {
    await writeEvents(root, "s1", [
      eventLine(1, "session.started"),
      "",
      eventLine(2, "session.ended", { reason: "completed" })
    ]);

    const events = await readSessionEvents(root, "s1");
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((event: AlixEvent) => event.type),
      ["session.started", "session.ended"]
    );

    const snapshot = await readSessionSnapshot(root, "s1");
    assert.equal(snapshot.sessionId, "s1");
    assert.equal(snapshot.summary.status, "completed");
    assert.equal(snapshot.summary.eventCount, 2);
    assert.equal(snapshot.summary.latestSeq, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readSessionEvents returns an empty list for a missing session file", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-session-reader-"));
  try {
    const events = await readSessionEvents(root, "missing");
    const snapshot = await readSessionSnapshot(root, "missing");

    assert.deepEqual(events, []);
    assert.equal(snapshot.sessionId, "missing");
    assert.equal(snapshot.summary.eventCount, 0);
    assert.equal(snapshot.summary.status, "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readSessionEvents rejects unsafe session ids before reading from disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-session-reader-"));
  try {
    for (const unsafe of ["", "../escape", "foo/bar", "foo\\bar", "foo..bar", ".hidden"]) {
      await assert.rejects(() => readSessionEvents(root, unsafe), /Invalid session id/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readSessionComparison compares sessions with different changed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "alix-session-reader-"));
  try {
    await writeEvents(root, "left", [
      eventLine(1, "tool.completed", { toolCallId: "left-patch", toolName: "patch.apply", changedFiles: ["left.ts", "both.ts"] }, "left")
    ]);
    await writeEvents(root, "right", [
      eventLine(1, "tool.completed", { toolCallId: "right-patch", toolName: "patch.apply", changedFiles: ["right.ts", "both.ts"] }, "right")
    ]);

    const comparison = await readSessionComparison(root, "left", "right");
    assert.deepEqual(comparison.changedFilesOnlyLeft, ["left.ts"]);
    assert.deepEqual(comparison.changedFilesOnlyRight, ["right.ts"]);
    assert.deepEqual(comparison.changedFilesBoth, ["both.ts"]);
    assert.equal(comparison.leftSessionId, "left");
    assert.equal(comparison.rightSessionId, "right");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
