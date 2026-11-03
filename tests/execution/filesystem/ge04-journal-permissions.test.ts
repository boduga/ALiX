import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordGe04Attempt } from "../../../src/execution/filesystem/ge04-attempt-journal.js";

test("GE-04 refuses journal components writable or readable by other users", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-journal-permissions-"));
  const authority = { workspaceRoot: root, ownedScope: "owned",
    workerId: "worker-a", leaseId: "lease-a", approvalId: "approval-a", policyRevision: "revision-a" };
  const operation = { kind: "create" as const, relativePath: "hello.txt", content: Buffer.from("hello") };
  try {
    const alix = join(root, ".alix");
    await mkdir(alix, { mode: 0o777 });
    await chmod(alix, 0o777);
    await assert.rejects(recordGe04Attempt(authority, operation), /owner-only/);
    await chmod(alix, 0o700);
    const ge04 = join(alix, "ge04");
    await mkdir(ge04, { mode: 0o755 });
    await assert.rejects(recordGe04Attempt(authority, operation), /owner-only/);
    await chmod(ge04, 0o700);
    const attempts = join(ge04, "attempts");
    await mkdir(attempts, { mode: 0o770 });
    await assert.rejects(recordGe04Attempt(authority, operation), /owner-only/);
    await chmod(attempts, 0o700);
    const id = await recordGe04Attempt(authority, operation);
    assert.deepEqual(await readdir(attempts), [id + ".json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
