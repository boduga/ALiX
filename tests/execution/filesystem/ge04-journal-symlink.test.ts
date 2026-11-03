import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordGe04Attempt } from "../../../src/execution/filesystem/ge04-attempt-journal.js";

const operation = { kind: "create" as const, relativePath: "hello.txt", content: Buffer.from("hello") };
test("GE-04 journal refuses symlinked workspace and journal components", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-journal-link-"));
  const outside = await mkdtemp(join(tmpdir(), "ge04-journal-outside-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const authority = { workspaceRoot: workspace, ownedScope: "owned",
      workerId: "worker-a", leaseId: "lease-a", approvalId: "approval-a", policyRevision: "revision-a" };
    const link = join(root, "workspace-link");
    await symlink(workspace, link);
    await assert.rejects(recordGe04Attempt({ ...authority, workspaceRoot: link }, operation), /real directory/);
    await symlink(outside, join(workspace, ".alix"));
    await assert.rejects(recordGe04Attempt(authority, operation), /real directory/);
    await rm(join(workspace, ".alix"));
    await mkdir(join(workspace, ".alix"));
    await symlink(outside, join(workspace, ".alix", "ge04"));
    await assert.rejects(recordGe04Attempt(authority, operation), /real directory/);
    await rm(join(workspace, ".alix", "ge04"));
    await mkdir(join(workspace, ".alix", "ge04"));
    await symlink(outside, join(workspace, ".alix", "ge04", "attempts"));
    await assert.rejects(recordGe04Attempt(authority, operation), /real directory/);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
