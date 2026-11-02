import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function waitForFile(path: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await readFile(path, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for " + path);
}

test("GE-04: killing host during native-style helper does not kill helper or prove outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-orphan-host-"));
  const fixture = fileURLToPath(new URL("./fixtures/ge04-orphan-host.js", import.meta.url));
  const host = fork(fixture, [root], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let helperPid: number | undefined;
  try {
    const ready = await new Promise<{ attemptId: string; helperPid: number }>((resolve, reject) => {
      host.once("error", reject);
      host.once("exit", () => reject(new Error("host exited before helper readiness")));
      host.once("message", (message: unknown) => {
        if (typeof message === "object" && message !== null &&
            "attemptId" in message && typeof message.attemptId === "string" &&
            "helperPid" in message && typeof message.helperPid === "number") {
          resolve({ attemptId: message.attemptId, helperPid: message.helperPid });
        } else reject(new Error("invalid readiness message"));
      });
    });
    helperPid = ready.helperPid;
    assert.equal(await waitForFile(join(root, "started")), "ready");
    const exited = new Promise<NodeJS.Signals | null>(resolve => host.once("exit", (_code, signal) => resolve(signal)));
    host.kill("SIGKILL");
    assert.equal(await exited, "SIGKILL");
    assert.equal(await waitForFile(join(root, "orphan.txt")), "orphan");
    const evidence = JSON.parse(await readFile(join(root, ".alix", "ge04", "attempts", ready.attemptId + ".json"), "utf8"));
    assert.equal(evidence.state, "pre_spawn");
    assert.equal(evidence.hostPid, host.pid);
    // No authenticated helper receipt or automatic claim transition is inferred.
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGKILL");
    if (helperPid) { try { process.kill(helperPid, "SIGKILL"); } catch { /* already exited */ } }
    await rm(root, { recursive: true, force: true });
  }
});
