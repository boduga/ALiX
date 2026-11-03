import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchGe04PinnedHelper } from "../../../src/execution/filesystem/ge04-pinned-helper-launch.js";

const helper = process.env.GE04_TEST_HELPER;
test("GE04 pinned helper launch executes verified descriptor with notification fd", {
  skip: process.platform !== "linux" || !helper,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-pinned-launch-"));
  try {
    const executable = join(root, "helper");
    const bytes = await readFile(helper!);
    await writeFile(executable, bytes);
    await chmod(executable, 0o500);
    await mkdir(join(root, "owned"));
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const attemptId = randomUUID();
    const result = await launchGe04PinnedHelper({ executable, expectedSha256, expectedOwnerUid: process.getuid!() },
      [root, "owned", "created.txt", "value"], attemptId);
    assert.equal(result.code, 0);
    assert.equal(result.notification, `GE04v1 ${attemptId} fsynced\n`);
    assert.equal(await readFile(join(root, "owned", "created.txt"), "utf8"), "value");
  } finally { await rm(root, { recursive: true, force: true }); }
});
