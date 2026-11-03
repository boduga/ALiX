import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectGe04HelperIntegrity } from "../../../src/execution/filesystem/ge04-helper-integrity.js";

test("GE04 helper integrity preflight rejects substituted bytes, symlinks and writable modes", {
  skip: process.platform !== "linux",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-integrity-"));
  try {
    const executable = join(root, "helper");
    const original = Buffer.from("#!/bin/sh\nexit 0\n");
    await writeFile(executable, original, { mode: 0o700 });
    const expectedSha256 = createHash("sha256").update(original).digest("hex");
    const expectedOwnerUid = process.getuid!();
    const config = { executable, expectedSha256, expectedOwnerUid };
    const observed = await inspectGe04HelperIntegrity(config);
    assert.equal(observed.sha256, expectedSha256);
    await writeFile(executable, "#!/bin/sh\nexit 1\n");
    await assert.rejects(inspectGe04HelperIntegrity(config), /digest mismatch/);
    await writeFile(executable, original);
    await chmod(executable, 0o722);
    await assert.rejects(inspectGe04HelperIntegrity(config), /ownership, mode or link count/);
    await chmod(executable, 0o700);
    const alias = join(root, "alias");
    await symlink(executable, alias);
    await assert.rejects(inspectGe04HelperIntegrity({ ...config, executable: alias }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
