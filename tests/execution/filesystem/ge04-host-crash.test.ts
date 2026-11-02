import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("GE-04: host killed after journal fsync leaves pre-spawn evidence on restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-host-crash-"));
  const fixture = fileURLToPath(new URL("./fixtures/ge04-crash-child.js", import.meta.url));
  const child = fork(fixture, [root], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  try {
    const id = await new Promise<string>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => reject(new Error(`child exited before ready: ${code}/${signal}`)));
      child.once("message", (msg: unknown) => {
        if (typeof msg === "object" && msg !== null && "attemptId" in msg && typeof msg.attemptId === "string") {
          resolve(msg.attemptId);
        } else reject(new Error("invalid child readiness message"));
      });
    });
    child.kill("SIGKILL");
    const exit = await new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
    assert.equal(exit, "SIGKILL");
    const directory = join(root, ".alix", "ge04", "attempts");
    assert.deepEqual(await readdir(directory), [id + ".json"]);
    const evidence = JSON.parse(await readFile(join(directory, id + ".json"), "utf8"));
    assert.equal(evidence.approvalId, "approval-crash");
    assert.equal(evidence.hostPid, child.pid);
    assert.equal(evidence.state, "pre_spawn");
    // This record cannot prove that a native helper ever started.
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
