import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskRegistry } from "../../src/daemon/task-registry.js";

describe("TaskRegistry", () => {
  let origHome: string | undefined;
  let testHome: string;

  before(() => {
    origHome = process.env.HOME;
    testHome = mkdtempSync(join(tmpdir(), "task-reg-home-"));
    process.env.HOME = testHome;
    // Ensure ~/.alix/ exists so TaskRegistry.save() can write
    mkdirSync(join(testHome, ".alix"), { recursive: true });
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("creates a queued task record", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("write a story", testHome);
    assert.ok(r.id.startsWith("task_"));
    assert.equal(r.status, "queued");
    assert.equal(r.task, "write a story");
    assert.equal(r.cwd, testHome);
  });

  it("updates task through lifecycle", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("test", testHome);
    reg.update(r.id, { status: "running", sessionId: "sess_1", startedAt: new Date().toISOString() });
    reg.update(r.id, { status: "completed" });
    const updated = reg.get(r.id);
    assert.equal(updated!.status, "completed");
    assert.equal(updated!.sessionId, "sess_1");
  });

  it("get returns undefined for unknown ID", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    assert.equal(reg.get("nonexistent"), undefined);
  });

  it("list returns newest first", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const a = reg.create("first", testHome);
    await new Promise(r => setTimeout(r, 2));
    const b = reg.create("second", testHome);
    const list = reg.list();
    assert.equal(list[0].id, b.id);
    assert.equal(list[1].id, a.id);
  });

  it("findQueued returns only queued tasks", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("queued task", testHome);
    reg.update(r.id, { status: "running" });
    assert.equal(reg.findQueued(r.id), undefined);
    const r2 = reg.create("still queued", testHome);
    assert.ok(reg.findQueued(r2.id));
  });

  it("reconcileOnStartup marks running as failed_orphaned", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("lost task", testHome);
    reg.update(r.id, { status: "running", startedAt: new Date().toISOString() });
    const result = reg.reconcileOnStartup();
    assert.equal(result.reconciled, 1);
    const updated = reg.get(r.id);
    assert.equal(updated!.status, "failed_orphaned");
    assert.ok(updated!.error!.includes("Daemon restarted"));
  });

  it("reconcileOnStartup marks cancel_requested as cancelled", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("cancel task", testHome);
    reg.update(r.id, { status: "cancel_requested" });
    reg.reconcileOnStartup();
    const updated = reg.get(r.id);
    assert.equal(updated!.status, "cancelled");
  });

  it("reconcileOnStartup leaves queued unchanged", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    reg.create("queued task", testHome);
    reg.reconcileOnStartup();
    assert.equal(reg.list()[0].status, "queued");
  });

  it("reconcileOnStartup leaves terminal states unchanged", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const c = reg.create("comp", testHome); reg.update(c.id, { status: "completed" });
    const f = reg.create("fail", testHome); reg.update(f.id, { status: "failed" });
    const x = reg.create("cancel", testHome); reg.update(x.id, { status: "cancelled" });
    reg.reconcileOnStartup();
    assert.equal(reg.get(c.id)!.status, "completed");
    assert.equal(reg.get(f.id)!.status, "failed");
    assert.equal(reg.get(x.id)!.status, "cancelled");
  });

  it("reconcileOnStartup is idempotent", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("idem", testHome); reg.update(r.id, { status: "running" });
    reg.reconcileOnStartup();
    const first = reg.reconcileOnStartup();
    assert.equal(first.reconciled, 0); // already reconciled
  });

  it("persists to disk and reloads", async () => {
    // Use nested describe to isolate HOME override
    const isoHome = mkdtempSync(join(tmpdir(), "task-persist-"));
    const origHome = process.env.HOME;
    process.env.HOME = isoHome;
    mkdirSync(join(isoHome, ".alix"), { recursive: true });
    try {
      const reg1 = new TaskRegistry();
      await reg1.load();
      reg1.create("disk test", isoHome);
      await new Promise(r => setTimeout(r, 100));

      const reg2 = new TaskRegistry();
      await reg2.load();
      assert.equal(reg2.list().length, 1);
      assert.equal(reg2.list()[0].task, "disk test");
    } finally {
      process.env.HOME = origHome;
      rmSync(isoHome, { recursive: true, force: true });
    }
  });
});
