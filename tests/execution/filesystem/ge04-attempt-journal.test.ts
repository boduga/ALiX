import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordGe04Attempt } from "../../../src/execution/filesystem/ge04-attempt-journal.js";

test("GE-04 pre-spawn evidence binds approval, worker and invocation durably", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-attempt-"));
  try {
    const authority = {
      workspaceRoot: root, ownedScope: "owned", workerId: "worker-a",
      leaseId: "lease-a", approvalId: "approval-a", policyRevision: "revision-a",
    };
    const operation = { kind: "create" as const, relativePath: "hello.txt", content: Buffer.from("hello") };
    const id = await recordGe04Attempt(authority, operation);
    const dir = join(root, ".alix", "ge04", "attempts");
    assert.deepEqual(await readdir(dir), [id + ".json"]);
    const record = JSON.parse(await readFile(join(dir, id + ".json"), "utf8"));
    assert.equal(record.approvalId, authority.approvalId);
    assert.equal(record.leaseId, authority.leaseId);
    assert.equal(record.workerId, authority.workerId);
    assert.equal(record.invocation.agentId, authority.workerId);
    assert.equal(record.state, "pre_spawn");
    assert.equal(record.hostPid, process.pid);
    const second = await recordGe04Attempt(authority, operation);
    assert.notEqual(second, id);
  } finally { await rm(root, { recursive: true, force: true }); }
});
