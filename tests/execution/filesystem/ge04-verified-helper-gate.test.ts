import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertGe04VerifiedHelperGate } from "../../../src/execution/filesystem/ge04-verified-helper-gate.js";
import { inspectGe04WorkerCredentials } from "../../../src/execution/filesystem/ge04-worker-credentials.js";

test("GE04 combined gate rejects a forged distinct UID for same-UID process", {
  skip: process.platform !== "linux",
}, async () => {
  const root = await mkdtemp(join(homedir(), ".ge04-verified-gate-"));
  try {
    const executable = join(root, "helper");
    const bytes = Buffer.from("#!/bin/sh\nexit 0\n");
    await writeFile(executable, bytes);
    await chmod(executable, 0o500);
    const owner = process.geteuid!();
    const forgedUid = owner === 65534 ? 65533 : 65534;
    const config = {
      executable, expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      expectedOwnerUid: owner, workerPid: process.pid, workerUid: forgedUid,
      workerGid: process.getegid!(), workerStartTimeTicks: "1",
    };
    await assert.rejects(assertGe04VerifiedHelperGate(config), /worker shares coordinator UID/);
    await assert.rejects(assertGe04VerifiedHelperGate({ ...config, workerPid: 0 }), /Linux worker PID required/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("GE04 combined gate matches a real distinct-UID process, rejects forged credentials", {
  skip: process.platform !== "linux" || process.geteuid?.() !== 0,
}, async () => {
  const root = await mkdtemp(join(homedir(), ".ge04-verified-gate-root-"));
  const child = spawn("/bin/sleep", ["15"], { uid: 65534, gid: 65534, stdio: "ignore" });
  try {
    assert.ok(child.pid);
    const bytes = Buffer.from("#!/bin/sh\nexit 0\n");
    const executable = join(root, "helper");
    await writeFile(executable, bytes);
    await chmod(executable, 0o500);
    const observed = await inspectGe04WorkerCredentials(child.pid!);
    const config = {
      executable, expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      expectedOwnerUid: 0, workerPid: child.pid!, workerUid: observed.uid,
      workerGid: observed.gid, workerStartTimeTicks: observed.startTimeTicks,
    };
    await assertGe04VerifiedHelperGate(config);
    await assert.rejects(assertGe04VerifiedHelperGate({ ...config, workerUid: 65533 }), /differs from declared/);
    await assert.rejects(assertGe04VerifiedHelperGate({ ...config, workerStartTimeTicks: "1" }), /differs from declared/);
  } finally {
    child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
