import test from "node:test";
import assert from "node:assert/strict";
import { spawnGe04IsolatedWorker } from "../../../src/execution/filesystem/ge04-isolated-worker.js";

test("GE-04 worker launcher rejects same-UID and invalid credentials before spawn", async () => {
  if (process.platform !== "linux" || !process.getuid || !process.getgid) return;
  await assert.rejects(spawnGe04IsolatedWorker("/bin/true", [], process.getuid(), process.getgid()), /distinct-UID/);
  await assert.rejects(spawnGe04IsolatedWorker("/bin/true", [], -1, 1), /distinct-UID/);
  await assert.rejects(spawnGe04IsolatedWorker("true", [], process.getuid() + 1, 1), /absolute executable/);
});

test("GE-04 unprivileged coordinator cannot claim distinct-UID launch", async t => {
  if (process.platform !== "linux" || !process.getuid || !process.getgid) return;
  if (process.geteuid?.() === 0) { t.skip("Requires unprivileged coordinator"); return; }
  await assert.rejects(
    spawnGe04IsolatedWorker("/bin/true", [], process.getuid() + 1, process.getgid() + 1),
    /privileged supervisor/,
  );
});
