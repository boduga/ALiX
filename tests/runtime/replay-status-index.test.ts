import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayStatusIndex } from "../../src/runtime/replay-status-index.js";

describe("ReplayStatusIndex", () => {
  let tmpDir: string;
  let idx: ReplayStatusIndex;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "status-index-"));
    idx = new ReplayStatusIndex(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined for unknown replayId", async () => {
    const status = await idx.getStatus("nonexistent");
    assert.equal(status, undefined);
  });

  it("sets and gets status", async () => {
    await idx.setStatus("replay_001", "capturing");
    assert.equal(await idx.getStatus("replay_001"), "capturing");
    await idx.setStatus("replay_001", "completed");
    assert.equal(await idx.getStatus("replay_001"), "completed");
  });

  it("persists to disk and reloads", async () => {
    await idx.setStatus("replay_002", "rollback-completed");
    const idx2 = new ReplayStatusIndex(tmpDir);
    assert.equal(await idx2.getStatus("replay_002"), "rollback-completed");
  });

  it("handles multiple entries", async () => {
    await idx.setStatus("replay_a", "capturing");
    await idx.setStatus("replay_b", "completed");
    await idx.setStatus("replay_c", "rollback-partial");
    const all = await idx.getAll();
    assert.ok(all.some(e => e.replayId === "replay_a" && e.status === "capturing"));
    assert.ok(all.some(e => e.replayId === "replay_c" && e.status === "rollback-partial"));
  });

  it("ensureReplay creates entry with capturing status", async () => {
    await idx.ensureReplay("replay_new", "approved-live");
    const entry = await idx.getEntry("replay_new");
    assert.ok(entry);
    assert.equal(entry!.status, "capturing");
    assert.equal(entry!.replayMode, "approved-live");
  });
});
