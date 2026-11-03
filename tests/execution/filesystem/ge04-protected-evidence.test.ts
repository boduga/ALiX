import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
// Use the private home ancestor; /tmp and the checkout are group/world writable.
import { homedir } from "node:os";
import { join } from "node:path";
import { recordGe04ProtectedEvidence } from "../../../src/execution/filesystem/ge04-protected-evidence.js";

test("GE-04 pinned evidence writer rejects same UID and persists bound record", async () => {
  if (process.platform !== "linux" || process.getuid === undefined) return;
  const root = await mkdtemp(join(homedir(), ".ge04-pinned-"));
  try {
    const workspaceRoot = join(root, "workspace");
    const evidenceRoot = join(root, "evidence");
    await mkdir(workspaceRoot);
    await mkdir(evidenceRoot, { mode: 0o700 });
    await chmod(evidenceRoot, 0o700);
    const config = { workspaceRoot, evidenceRoot, workerUid: process.getuid() };
    const evidence = { approvalId: "approval-a", invocationFingerprint: "fingerprint-a" };
    await assert.rejects(recordGe04ProtectedEvidence(config, evidence), /worker UID must not own/);
    // Simulates a distinct worker UID in configuration only; not an OS-level
    // isolation test. Production must attest the actual worker credentials.
    const id = await recordGe04ProtectedEvidence({ ...config, workerUid: process.getuid() + 1 }, evidence);
    assert.deepEqual(await readdir(evidenceRoot), [id + ".json"]);
    const stored = JSON.parse(await readFile(join(evidenceRoot, id + ".json"), "utf8"));
    assert.equal(stored.approvalId, evidence.approvalId);
    assert.equal(stored.invocationFingerprint, evidence.invocationFingerprint);
    assert.equal(stored.state, "pre_spawn");
  } finally { await rm(root, { recursive: true, force: true }); }
});
