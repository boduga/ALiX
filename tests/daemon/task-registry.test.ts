import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskRegistry } from "../../src/daemon/task-registry.js";

describe("TaskRegistry", () => {
  it("creates a queued task record", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-reg-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const r = reg.create("write a story");
      assert.ok(r.id.startsWith("task_"));
      assert.equal(r.status, "queued");
      assert.equal(r.task, "write a story");
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("updates task through lifecycle", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-life-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const r = reg.create("test");
      reg.update(r.id, { status: "running", sessionId: "sess_1", startedAt: new Date().toISOString() });
      reg.update(r.id, { status: "completed" });
      const updated = reg.get(r.id);
      assert.equal(updated!.status, "completed");
      assert.equal(updated!.sessionId, "sess_1");
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("get returns undefined for unknown ID", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-get-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      assert.equal(reg.get("nonexistent"), undefined);
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("list returns newest first", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-list-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const a = reg.create("first");
      await new Promise(r => setTimeout(r, 2));
      const b = reg.create("second");
      const list = reg.list();
      assert.equal(list[0].id, b.id);
      assert.equal(list[1].id, a.id);
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("findQueued returns only queued tasks", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-queued-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const r = reg.create("queued task");
      reg.update(r.id, { status: "running" });
      assert.equal(reg.findQueued(r.id), undefined);
      const r2 = reg.create("still queued");
      assert.ok(reg.findQueued(r2.id));
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("persists to disk and reloads", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-persist-"));
    try {
      const reg1 = new TaskRegistry(tmpDir);
      await reg1.load();
      reg1.create("disk test");
      await new Promise(r => setTimeout(r, 50));

      const reg2 = new TaskRegistry(tmpDir);
      await reg2.load();
      assert.equal(reg2.list().length, 1);
      assert.equal(reg2.list()[0].task, "disk test");
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });
});
