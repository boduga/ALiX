/**
 * checkpoint-restore.test.ts — #714 shared restore-semantics pin.
 *
 * One CheckpointManager implementation (src/patch/checkpoint.ts) serves
 * every former call site (tool-router create/restore, agent + executor
 * pass-through, runtime-builder close). These tests pin the restore
 * contract all of them rely on.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CheckpointManager } from "../../src/patch/checkpoint.js";

describe("CheckpointManager restore semantics (single authority)", () => {
  let dir: string;
  let store: CheckpointManager;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "ckpt-restore-"));
    store = new CheckpointManager(join(dir, "checkpoints"));
    await store.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("roundtrips modified files back to checkpointed content", async () => {
    const file = join(dir, "a.txt");
    await writeFile(file, "original");
    const cp = await store.create("patch", [file]);
    await writeFile(file, "modified");
    await store.restore(cp.id);
    assert.equal(await readFile(file, "utf-8"), "original");
  });

  it("tolerates missing source files at create time (new files)", async () => {
    const file = join(dir, "new.txt");
    const cp = await store.create("patch", [file]);
    assert.ok(cp.id);
    const listed = await store.list();
    assert.ok(listed.some((c) => c.id === cp.id));
  });

  it("throws when restoring an unknown checkpoint", async () => {
    await assert.rejects(store.restore("nope"), /not found or corrupted|ENOENT/);
  });

  it("delete removes the checkpoint and is idempotent", async () => {
    const file = join(dir, "b.txt");
    await writeFile(file, "x");
    const cp = await store.create("patch", [file]);
    await store.delete(cp.id);
    assert.equal((await store.list()).filter((c) => c.id === cp.id).length, 0);
    await store.delete(cp.id);
  });

  it("close resolves (runtime-builder lifecycle)", async () => {
    await store.close();
  });
});
