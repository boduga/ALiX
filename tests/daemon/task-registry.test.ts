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

  it("reconcileOnStartup marks running as failed_orphaned", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-recon-running-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const r = reg.create("lost task");
      reg.update(r.id, { status: "running", startedAt: new Date().toISOString() });
      const result = reg.reconcileOnStartup();
      assert.equal(result.reconciled, 1);
      const updated = reg.get(r.id);
      assert.equal(updated!.status, "failed_orphaned");
      assert.ok(updated!.error!.includes("Daemon restarted"));
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("reconcileOnStartup marks cancel_requested as cancelled", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-recon-cancel-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const r = reg.create("cancel task");
      reg.update(r.id, { status: "cancel_requested" });
      reg.reconcileOnStartup();
      const updated = reg.get(r.id);
      assert.equal(updated!.status, "cancelled");
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("reconcileOnStartup leaves queued unchanged", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-recon-queued-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      reg.create("queued task");
      reg.reconcileOnStartup();
      assert.equal(reg.list()[0].status, "queued");
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("reconcileOnStartup leaves terminal states unchanged", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-recon-terminal-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const c = reg.create("comp"); reg.update(c.id, { status: "completed" });
      const f = reg.create("fail"); reg.update(f.id, { status: "failed" });
      const x = reg.create("cancel"); reg.update(x.id, { status: "cancelled" });
      reg.reconcileOnStartup();
      assert.equal(reg.get(c.id)!.status, "completed");
      assert.equal(reg.get(f.id)!.status, "failed");
      assert.equal(reg.get(x.id)!.status, "cancelled");
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it("reconcileOnStartup is idempotent", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "task-recon-idem-"));
    try {
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const r = reg.create("idem"); reg.update(r.id, { status: "running" });
      reg.reconcileOnStartup();
      const first = reg.reconcileOnStartup();
      assert.equal(first.reconciled, 0); // already reconciled
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
