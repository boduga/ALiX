import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertGe04EvidenceIsolation } from "../../../src/execution/filesystem/ge04-evidence-isolation.js";

test("GE-04 evidence preflight rejects same-UID worker and workspace evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-evidence-"));
  try {
    const workspace = join(root, "workspace");
    const evidence = join(root, "evidence");
    await mkdir(workspace);
    await mkdir(evidence, { mode: 0o700 });
    const workerUid = process.getuid?.();
    assert.notEqual(workerUid, undefined);
    const config = { workspaceRoot: workspace, evidenceRoot: evidence, workerUid: workerUid! };
    await assert.rejects(assertGe04EvidenceIsolation(config), /worker UID must not own/);
    await assert.rejects(assertGe04EvidenceIsolation({
      ...config, evidenceRoot: workspace,
    }), /outside workspace ancestry/);
    const link = join(root, "evidence-link");
    await symlink(evidence, link);
    await assert.rejects(assertGe04EvidenceIsolation({
      ...config, evidenceRoot: link,
    }), /real directories/);
    await chmod(evidence, 0o755);
    await assert.rejects(assertGe04EvidenceIsolation({
      ...config, workerUid: workerUid! + 1,
    }), /owner-only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
