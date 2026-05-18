import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildSessionDigest, buildSessionDigestWithMemory } from "../../../src/utils/session-digest.js";

test("buildSessionDigestWithMemory exists and can be called", async () => {
  const sessionDir = join(process.env.TMPDIR || "/tmp", "test-session-" + Date.now());
  await mkdir(sessionDir, { recursive: true });

  try {
    const result = await buildSessionDigestWithMemory(sessionDir);
    // Should return null or string, not throw
    assert.ok(result === null || typeof result === "string");
  } finally {
    await rm(sessionDir, { recursive: true }).catch(() => {});
  }
});

test("buildSessionDigestWithMemory combines session digest with memory context", async () => {
  const sessionDir = join(process.env.TMPDIR || "/tmp", "test-session-digest-" + Date.now());
  await mkdir(sessionDir, { recursive: true });

  // Write a session event file
  await writeFile(
    join(sessionDir, "events.jsonl"),
    JSON.stringify({ type: "tool.completed", payload: { toolName: "file.create", path: "/test/foo.ts" } }) + "\n"
  );

  try {
    const result = await buildSessionDigestWithMemory(sessionDir);
    assert.ok(result !== null, "Expected result to not be null when session has events");
    assert.ok(typeof result === "string");
    assert.ok(result.includes("[Session Digest]"), "Result should contain session digest section");
  } finally {
    await rm(sessionDir, { recursive: true }).catch(() => {});
  }
});

test("buildSessionDigest reads current create and delete event payloads", async () => {
  const sessionDir = join(process.env.TMPDIR || "/tmp", "test-session-current-events-" + Date.now());
  await mkdir(sessionDir, { recursive: true });

  await writeFile(
    join(sessionDir, "events.jsonl"),
    [
      JSON.stringify({ type: "tool.completed", payload: { toolName: "file.create", createdPath: "src/new.ts" } }),
      JSON.stringify({ type: "tool.completed", payload: { toolName: "file.delete", deletedPath: "src/old.ts" } }),
    ].join("\n") + "\n"
  );

  try {
    const result = await buildSessionDigest(sessionDir);
    assert.ok(result !== null);
    assert.ok(result.includes("Files created: src/new.ts"));
    assert.ok(result.includes("Files deleted: src/old.ts"));
  } finally {
    await rm(sessionDir, { recursive: true }).catch(() => {});
  }
});

test("buildSessionDigestWithMemory returns string containing both sections", async () => {
  const sessionDir = join(process.env.TMPDIR || "/tmp", "test-session-both-" + Date.now());
  const memoryDir = join(sessionDir, "memory");
  await mkdir(sessionDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });

  // Write session events
  await writeFile(
    join(sessionDir, "events.jsonl"),
    JSON.stringify({ type: "tool.completed", payload: { toolName: "file.write", path: "/src/bar.ts" } }) + "\n"
  );
  await writeFile(
    join(memoryDir, "memory.md"),
    "# ALiX Memory Index\n\n## Project\n- [Test Memory](project/test-memory.md) - confirms memory context\n"
  );

  try {
    const result = await buildSessionDigestWithMemory(sessionDir, memoryDir);
    assert.ok(result !== null);
    assert.ok(typeof result === "string");

    // Verify the result has both session and memory sections
    assert.ok(
      result.includes("[Session Digest]") && result.includes("# Context"),
      "Result should contain both session digest and memory context sections"
    );
  } finally {
    await rm(sessionDir, { recursive: true }).catch(() => {});
  }
});

test("buildSessionDigestWithMemory handles empty session gracefully", async () => {
  const sessionDir = join(process.env.TMPDIR || "/tmp", "test-session-empty-" + Date.now());
  await mkdir(sessionDir, { recursive: true });

  try {
    const result = await buildSessionDigestWithMemory(sessionDir);
    // Empty session should return memory context only or null
    assert.ok(result === null || typeof result === "string");
  } finally {
    await rm(sessionDir, { recursive: true }).catch(() => {});
  }
});
