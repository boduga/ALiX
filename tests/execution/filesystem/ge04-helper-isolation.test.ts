import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { assertGe04HelperIsolation } from "../../../src/execution/filesystem/ge04-helper-isolation.js";

test("GE04 isolation gate rejects same UID, writable helper and unsafe ancestor", {
  skip: process.platform !== "linux",
}, async () => {
  const owner = process.geteuid!();
  const workerUid = owner === 65534 ? 65533 : 65534;
  const root = await mkdtemp(join(homedir(), ".ge04-helper-isolation-"));
  const unsafe = await mkdtemp(join(tmpdir(), "ge04-unsafe-"));
  try {
    const executable = join(root, "helper");
    await writeFile(executable, "native fixture", { mode: 0o500 });
    const config = { executable, expectedSha256: "0".repeat(64), expectedOwnerUid: owner, workerUid };
    await assertGe04HelperIsolation(config);
    await assert.rejects(assertGe04HelperIsolation({ ...config, workerUid: owner }), /distinct coordinator UID/);
    await chmod(executable, 0o700);
    await assert.rejects(assertGe04HelperIsolation(config), /non-writable/);
    await chmod(executable, 0o500);
    const unsafeFile = join(unsafe, "helper");
    await writeFile(unsafeFile, "native fixture", { mode: 0o500 });
    await assert.rejects(assertGe04HelperIsolation({ ...config, executable: unsafeFile }), /ancestor/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(unsafe, { recursive: true, force: true });
  }
});
