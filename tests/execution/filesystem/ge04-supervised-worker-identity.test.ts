import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { inspectGe04WorkerCredentials } from "../../../src/execution/filesystem/ge04-worker-credentials.js";

test("GE-04 supervised same-UID child is rejected, despite a stable PID/start identity", async () => {
  if (process.platform !== "linux" || !process.getuid) return;
  const child = spawn(process.execPath, ["-e", "process.stdout.write('ready\\n');setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    assert.ok(child.pid);
    await Promise.race([
      once(child.stdout!, "data"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("child readiness timeout")), 3000)),
    ]);
    await assert.rejects(inspectGe04WorkerCredentials(child.pid!), /shares coordinator UID/);
  } finally {
    child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
  }
});
