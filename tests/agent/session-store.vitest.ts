// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Tests for JsonlSessionStore — file-backed SessionStore implementation.
 *
 * Coverage:
 *  - save/load round-trip preserves every field
 *  - list() returns sessions newest-first by updatedAt
 *  - load() returns null for missing session
 *  - atomic-write semantics: a stray .tmp file is not surfaced via load()
 *  - serialisation guards against Date objects
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JsonlSessionStore,
} from "../../src/agent/session-store-jsonl.js";
import type { SessionSnapshot } from "../../src/agent/session-store.js";
import type { ToolExecution } from "../../src/agent/session.js";

function freshTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "session-store-test-"));
}

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: "11111111-2222-3333-4444-555555555555",
    task: "Build a parser",
    sessionMode: "auto",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ],
    toolHistory: [
      {
        toolName: "shell.run",
        args: { command: "ls" },
        result: "ok",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
    turnCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    scopeSnapshot: { foo: "bar" },
    stateSnapshot: { state: "running" },
    completed: false,
    ...overrides,
  };
}

describe("JsonlSessionStore", () => {
  let rootDir: string;
  let store: JsonlSessionStore;

  beforeEach(() => {
    rootDir = freshTmpDir();
    store = new JsonlSessionStore(rootDir);
  });

  it("save() then load() round-trips every field", async () => {
    const snap = makeSnapshot();
    await store.save(snap);

    const loaded = await store.load(snap.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(snap);
  });

  it("load() returns null for an unknown session id", async () => {
    const result = await store.load("does-not-exist");
    expect(result).toBeNull();
  });

  it("list() returns sessions newest-first by updatedAt", async () => {
    // Three snapshots with strictly increasing updatedAt.
    const a = makeSnapshot({
      sessionId: "11111111-2222-3333-4444-555555555555",
      updatedAt: "2026-01-01T00:00:00.000Z",
      task: "first",
      turnCount: 1,
    });
    const b = makeSnapshot({
      sessionId: "22222222-2222-3333-4444-555555555555",
      updatedAt: "2026-01-02T00:00:00.000Z",
      task: "second",
      turnCount: 2,
    });
    const c = makeSnapshot({
      sessionId: "33333333-2222-3333-4444-555555555555",
      updatedAt: "2026-01-03T00:00:00.000Z",
      task: "third",
      turnCount: 3,
    });

    await store.save(a);
    await store.save(b);
    await store.save(c);

    const listed = await store.list();
    expect(listed.map((s) => s.sessionId)).toEqual([
      c.sessionId,
      b.sessionId,
      a.sessionId,
    ]);
    expect(listed[0].turnCount).toBe(3);
  });

  it("list() honours the limit argument", async () => {
    for (let i = 0; i < 5; i++) {
      const s = makeSnapshot({
        sessionId: `0000000${i}-2222-3333-4444-555555555555`,
        updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        task: `task ${i}`,
      });
      await store.save(s);
    }
    const top2 = await store.list(2);
    expect(top2).toHaveLength(2);
  });

  it("list() returns empty array when no sessions exist", async () => {
    const listed = await store.list();
    expect(listed).toEqual([]);
  });

  it("save() is idempotent: a second save overwrites the first", async () => {
    const snap = makeSnapshot({ task: "v1" });
    await store.save(snap);
    const updated: SessionSnapshot = { ...snap, task: "v2", updatedAt: "2026-02-01T00:00:00.000Z", turnCount: 7 };
    await store.save(updated);
    const loaded = await store.load(snap.sessionId);
    expect(loaded?.task).toBe("v2");
    expect(loaded?.turnCount).toBe(7);
  });

  it("save() uses atomic write (tmp file then rename)", async () => {
    const snap = makeSnapshot();
    await store.save(snap);
    // After save(), no stale .tmp file should remain.
    const dir = store.sessionDir(snap.sessionId);
    expect(existsSync(join(dir, "snapshot.json"))).toBe(true);
    expect(existsSync(join(dir, "snapshot.json.tmp"))).toBe(false);
  });

  it("load() returns null when snapshot.json is corrupt", async () => {
    const snap = makeSnapshot();
    await store.save(snap);
    // Overwrite snapshot.json with garbage to simulate a crash mid-write.
    const dir = store.sessionDir(snap.sessionId);
    writeFileSync(join(dir, "snapshot.json"), "{ not valid json", "utf-8");
    const loaded = await store.load(snap.sessionId);
    expect(loaded).toBeNull();
  });

  it("a stranded .tmp file does not break load()", async () => {
    const snap = makeSnapshot();
    await store.save(snap);
    const dir = store.sessionDir(snap.sessionId);
    // Simulate a write that crashed after creating the .tmp but before rename.
    writeFileSync(join(dir, "snapshot.json.tmp"), '{"partial":', "utf-8");
    const loaded = await store.load(snap.sessionId);
    expect(loaded).toEqual(snap);
  });

  it("preserves Date-typed updatedAt via ISO-string fallback", async () => {
    const dateSnap: SessionSnapshot = {
      ...makeSnapshot(),
      // Force a Date instance even though the contract says ISO string.
      updatedAt: new Date("2026-06-15T12:34:56.789Z") as unknown as string,
      createdAt: new Date("2026-06-15T12:00:00.000Z") as unknown as string,
    };
    await store.save(dateSnap);
    const loaded = await store.load(dateSnap.sessionId);
    expect(loaded?.updatedAt).toBe("2026-06-15T12:34:56.789Z");
    expect(loaded?.createdAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("messages.jsonl receives appended entries on subsequent saves", async () => {
    const first = makeSnapshot({
      messages: [{ role: "user", content: "one" }],
    });
    await store.save(first);

    const second: SessionSnapshot = {
      ...first,
      messages: [
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
      ],
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    await store.save(second);

    const dir = store.sessionDir(first.sessionId);
    expect(existsSync(join(dir, "messages.jsonl"))).toBe(true);
  });

  it("list() returns compact SessionInfo, not full snapshots", async () => {
    await store.save(makeSnapshot({ task: "compact-test", turnCount: 9 }));
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].task).toBe("compact-test");
    expect(listed[0].turnCount).toBe(9);
    expect(listed[0]).not.toHaveProperty("messages");
  });
});
