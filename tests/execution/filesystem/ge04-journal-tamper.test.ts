import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordGe04Attempt } from "../../../src/execution/filesystem/ge04-attempt-journal.js";

test("GE-04: same-UID workspace writer can forge pre-spawn evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-journal-tamper-"));
  try {
    const authority = { workspaceRoot: root, ownedScope: "owned", workerId: "worker-a",
      leaseId: "lease-a", approvalId: "approval-a", policyRevision: "revision-a" };
    const id = await recordGe04Attempt(authority, {
      kind: "create", relativePath: "target.txt", content: Buffer.from("original"),
    });
    const path = join(root, ".alix", "ge04", "attempts", id + ".json");
    const before = JSON.parse(await readFile(path, "utf8"));
    assert.equal(before.approvalId, "approval-a");
    // Owner-only modes do not isolate two processes running under the same UID.
    // This is a characterization of a security gap, not desired behavior.
    await writeFile(path, JSON.stringify({ ...before, approvalId: "forged-approval" }) + "\n");
    const after = JSON.parse(await readFile(path, "utf8"));
    assert.equal(after.approvalId, "forged-approval");
    // A recovery reader must never authorize replay from this mutable record.
  } finally { await rm(root, { recursive: true, force: true }); }
});
