import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

test("GE-04 real distinct-UID worker cannot read or overwrite owner-only evidence", async t => {
  if (process.platform !== "linux" || !process.getuid || !process.getgid) {
    t.skip("Linux UID/GID support required"); return;
  }
  if (process.geteuid?.() !== 0) {
    t.skip("Requires an explicitly privileged test environment; no sudo or elevation attempted");
    return;
  }
  const root = await mkdtemp(join(homedir(), ".ge04-cross-uid-"));
  try {
    const evidence = join(root, "evidence");
    await mkdir(evidence, { mode: 0o700 });
    const record = join(evidence, "attempt.json");
    await writeFile(record, "original\n", { mode: 0o600 });
    const workerUid = 65534;
    const workerGid = 65534;
    const script = `
      const fs = require("node:fs");
      let denied = 0;
      for (const action of [
        () => fs.readFileSync(process.argv[1]),
        () => fs.writeFileSync(process.argv[1], "forged"),
        () => fs.writeFileSync(process.argv[2], "forged")
      ]) {
        try { action(); } catch (e) { if (e.code === "EACCES" || e.code === "EPERM") denied++; }
      }
      process.exit(denied === 3 ? 0 : 1);
    `;
    const child = spawn(process.execPath, ["-e", script, record, join(evidence, "new.json")], {
      uid: workerUid, gid: workerGid, shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null);
    assert.equal(code, 0, "distinct-UID child must be denied all three accesses");
    assert.equal(await readFile(record, "utf8"), "original\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
