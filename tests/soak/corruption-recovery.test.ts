/**
 * corruption-recovery.test.ts — Verify stores survive corrupted files.
 *
 * Tier 1 (fast, runs on every commit). Tests that every storage layer
 * that reads from disk handles corrupt/empty/malformed input without
 * throwing uncaught exceptions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpDir(scope: string): string {
  const d = mkdtempSync(join(tmpdir(), `soak-${scope}-`));
  mkdirSync(join(d, ".alix"), { recursive: true });
  return d;
}
function cleanup(d: string) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

describe("Corruption Recovery — ContinuationStore", () => {
  it("handles partial JSON gracefully", async () => {
    const dir = tmpDir("cont-partial");
    try {
      const path = join(dir, ".alix", "approvals", "continuations.json");
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(path, `[{"approvalId":"incomplete"`, "utf-8");
      const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
      const store = new ContinuationStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });

  it("handles empty file gracefully", async () => {
    const dir = tmpDir("cont-empty");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(join(dir, ".alix", "approvals", "continuations.json"), "[]", "utf-8");
      const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
      const store = new ContinuationStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });

  it("handles zero-byte file", async () => {
    const dir = tmpDir("cont-zero");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(join(dir, ".alix", "approvals", "continuations.json"), "", "utf-8");
      const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
      const store = new ContinuationStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });
});

describe("Corruption Recovery — ApprovalStore", () => {
  it("handles trailing garbage", async () => {
    const dir = tmpDir("approve-garbage");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      const ap = join(dir, ".alix", "approvals", "approvals.json");
      writeFileSync(ap, "[]", "utf-8");
      const { corruptJsonWithTrailingGarbage } = await import("./fault-injector.js");
      corruptJsonWithTrailingGarbage(ap);
      const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
      const store = new ApprovalStore(dir);
      await store.load();
    } finally { cleanup(dir); }
  });

  it("handles zero-byte file", async () => {
    const dir = tmpDir("approve-zero");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(join(dir, ".alix", "approvals", "approvals.json"), "", "utf-8");
      const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
      const store = new ApprovalStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });
});

describe("Corruption Recovery — EventLog", () => {
  it("handles malformed JSONL gracefully", async () => {
    const dir = tmpDir("eventlog-malformed");
    try {
      const sessionDir = join(dir, ".alix", "sessions", "test-session");
      const eventsPath = join(sessionDir, "events.jsonl");
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(eventsPath, "", "utf-8");
      const { corruptJsonlWithMalformedLine } = await import("./fault-injector.js");
      corruptJsonlWithMalformedLine(eventsPath);

      const { EventLog } = await import("../../src/events/event-log.js");
      const log = new EventLog(sessionDir);
      await log.init();
      const events = await log.readAll();
      assert.equal(events.length, 2, "readAll should return 2 valid events, skipping the malformed line");
    } finally { cleanup(dir); }
  });
});

describe("Corruption Recovery — TaskRegistry", () => {
  it("handles malformed JSON gracefully", async () => {
    const testHome = mkdtempSync(join(tmpdir(), "soak-taskreg-"));
    try {
      mkdirSync(join(testHome, ".alix"), { recursive: true });
      writeFileSync(join(testHome, ".alix", "daemon-tasks.json"), "NOT_JSON", "utf-8");

      const oldHome = process.env.HOME;
      process.env.HOME = testHome;
      try {
        const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
        const reg = new TaskRegistry();
        await reg.load();
        const task = reg.create("test-task", "/tmp");
        assert.ok(task.id);
      } finally {
        process.env.HOME = oldHome;
      }
    } finally { cleanup(testHome); }
  });
});
