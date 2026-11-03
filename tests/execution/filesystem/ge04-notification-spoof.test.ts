import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deliberate adversarial demonstration: the fd-3 message alone cannot
// authenticate the executable, even when the attempt ID is exact.
test("GE04: substituted helper can forge an exact attempt-bound notification", {
  skip: process.platform !== "linux",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-spoof-"));
  try {
    const helper = join(root, "substitute.sh");
    await writeFile(helper, "#!/bin/sh\nprintf 'GE04v1 %s fsynced\\n' \"$GE04_ATTEMPT_ID\" >&3\n");
    await chmod(helper, 0o700);
    const attemptId = randomUUID();
    const result = await new Promise<{ code: number | null; receipt: string }>((resolve, reject) => {
      const child = spawn(helper, [], {
        stdio: ["ignore", "ignore", "pipe", "pipe"],
        env: { ...process.env, GE04_ATTEMPT_ID: attemptId, GE04_RECEIPT_FD: "3" },
      });
      let receipt = "";
      child.stdio[3]?.on("data", (chunk: Buffer) => { receipt += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, receipt }));
    });
    assert.equal(result.code, 0);
    assert.equal(result.receipt, `GE04v1 ${attemptId} fsynced\n`);
    assert.equal(await readFile(helper, "utf8").then(x => x.includes("fsynced")), true);
    // No native mutation was executed; the exact notification was forged.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
