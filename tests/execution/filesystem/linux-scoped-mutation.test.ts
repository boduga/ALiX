import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperimentalLinuxScopedMutationService } from "../../../src/execution/filesystem/linux-scoped-mutation.js";

const authority = (root: string, ownedScope = "owned") => ({
  workspaceRoot: root, ownedScope, workerId: "test", policyRevision: "test", leaseId: "test",
});

test("experimental Linux adapter rejects unsupported operations and unsafe paths before spawn", async () => {
  const service = new ExperimentalLinuxScopedMutationService("/definitely/missing/helper");
  await assert.rejects(service.mutate(authority("/tmp"), { kind: "delete", relativePath: "a" }), /exclusive create only/);
  await assert.rejects(service.mutate(authority("/tmp"), { kind: "create", relativePath: "../escape", content: new Uint8Array() }), /invalid scoped path/);
  await assert.rejects(service.mutate(authority("/tmp"), { kind: "create", relativePath: "a", content: new Uint8Array([0]) }), /binary payload unsupported/);
});

test("experimental Linux adapter creates beneath owned root with supplied native helper", { skip: process.platform !== "linux" || !process.env.GE04_TEST_HELPER }, async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-adapter-"));
  try {
    await mkdir(join(root, "owned"));
    await mkdir(join(root, "unowned"));
    const service = new ExperimentalLinuxScopedMutationService(process.env.GE04_TEST_HELPER!);
    assert.deepEqual(await service.mutate(authority(root), { kind: "create", relativePath: "hello.txt", content: Buffer.from("hello") }), { kind: "created", changed: true });
    assert.equal(await readFile(join(root, "owned", "hello.txt"), "utf8"), "hello");
    await symlink("unowned", join(root, "alias"));
    await assert.rejects(service.mutate(authority(root, "alias"), { kind: "create", relativePath: "escape.txt", content: Buffer.from("attack") }), /native helper failed/);
    await assert.rejects(readFile(join(root, "unowned", "escape.txt")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
