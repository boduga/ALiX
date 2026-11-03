import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests the actual native notification channel independently of the
// authorization adapter. These are transport checks, not trusted receipts.
const helper = process.env.GE04_TEST_HELPER;
test("GE04 native notification matches attempt and is delivered on fd 3", {
  skip: process.platform !== "linux" || !helper,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-notify-adapter-"));
  try {
    await mkdir(join(root, "owned"));
    const attemptId = randomUUID();
    const result = await new Promise<{ code: number | null; notification: string }>((resolve, reject) => {
      const child = spawn(helper!, [root, "owned", "file.txt", "data"], {
        stdio: ["ignore", "ignore", "pipe", "pipe"],
        env: { ...process.env, GE04_ATTEMPT_ID: attemptId, GE04_RECEIPT_FD: "3" },
      });
      let notification = "";
      child.stdio[3]?.on("data", (chunk: Buffer) => { notification += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, notification }));
    });
    assert.equal(result.code, 0);
    assert.equal(result.notification, `GE04v1 ${attemptId} fsynced\n`);
    assert.equal(await readFile(join(root, "owned", "file.txt"), "utf8"), "data");
  } finally { await rm(root, { recursive: true, force: true }); }
});
