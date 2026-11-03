import test from "node:test";
import assert from "node:assert/strict";
import { inspectGe04WorkerCredentials } from "../../../src/execution/filesystem/ge04-worker-credentials.js";

test("GE-04 refuses coordinator and same-UID process as isolated worker", async () => {
  if (process.platform !== "linux" || !process.getuid) return;
  await assert.rejects(inspectGe04WorkerCredentials(process.pid), /shares coordinator UID/);
  await assert.rejects(inspectGe04WorkerCredentials(-1), /Linux worker PID required/);
  await assert.rejects(inspectGe04WorkerCredentials(Number.MAX_SAFE_INTEGER), /ENOENT/);
});

test("GE-04 observes kernel credentials for an existing different-UID process, if available", async t => {
  if (process.platform !== "linux" || !process.getuid) return;
  // PID 1 may be owned by root in conventional Linux installations; this
  // test never creates, signals, or grants access to that process.
  const status = await import("node:fs/promises").then(fs => fs.readFile("/proc/1/status", "utf8"));
  const match = /^Uid:\s+(\d+)/m.exec(status);
  if (!match || Number(match[1]) === process.getuid()) {
    t.skip("No different-UID PID 1 available for read-only observation");
    return;
  }
  const observed = await inspectGe04WorkerCredentials(1);
  assert.equal(observed.uid, Number(match[1]));
  assert.match(observed.startTimeTicks, /^\d+$/);
});
