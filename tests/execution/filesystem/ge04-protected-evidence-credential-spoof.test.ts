import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordGe04ProtectedEvidence } from "../../../src/execution/filesystem/ge04-protected-evidence.js";

test("GE-04: caller-declared worker UID is not credential attestation", async () => {
  if (process.platform !== "linux" || !process.getuid) return;
  const root = await mkdtemp(join(homedir(), ".ge04-credential-spoof-"));
  try {
    const workspaceRoot = join(root, "workspace");
    const evidenceRoot = join(root, "evidence");
    await mkdir(workspaceRoot, { mode: 0o700 });
    await mkdir(evidenceRoot, { mode: 0o700 });
    const coordinatorUid = process.getuid();
    // Declared worker UID differs, but the test's 'worker' actually runs as
    // the coordinator UID. This must never be interpreted as real isolation.
    const id = await recordGe04ProtectedEvidence({
      workspaceRoot, evidenceRoot, workerUid: coordinatorUid + 1,
    }, { approvalId: "original", invocationFingerprint: "original-fingerprint" });
    const path = join(evidenceRoot, id + ".json");
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, approvalId: "forged" }) + "\n");
    assert.equal(JSON.parse(await readFile(path, "utf8")).approvalId, "forged");
    // The file descriptor pins a directory against pathname swaps, but
    // cannot protect it from a worker that shares the coordinator's UID.
  } finally { await rm(root, { recursive: true, force: true }); }
});
