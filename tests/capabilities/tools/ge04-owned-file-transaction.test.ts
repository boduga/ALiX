import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OwnedReplaceAmbiguousError, replaceOwnedFileStaged } from "../../../src/capabilities/tools/owned-file-replace.js";
import { FileToolRouter } from "../../../src/capabilities/tools/tool-router.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "alix-owned-transaction-"));
  const owned = join(root, "owned");
  const outside = join(root, "outside");
  await mkdir(owned);
  await mkdir(outside);
  return { root, owned, outside, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("owned rewrite commits via replacement inode, not in-place truncation", async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "artifact.txt");
    await writeFile(path, "long original content");
    const before = await lstat(path);
    const result = await new FileToolRouter(f.root).execute({
      toolCallId: "atomic-replace", name: "file.create",
      args: { path: "owned/artifact.txt", content: "short" },
      ownedPaths: ["owned/**"],
    });
    assert.equal(result.kind, "success", JSON.stringify(result));
    assert.equal(await readFile(path, "utf8"), "short");
    if (process.platform !== "win32") {
      assert.notEqual((await lstat(path)).ino, before.ino);
    }
    assert.deepEqual((await readdir(f.owned)).sort(), ["artifact.txt"]);
  } finally {
    await f.cleanup();
  }
});

test("injected staging failure cannot truncate existing content", async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "artifact.txt");
    await writeFile(path, "original");
    const before = await stat(path);
    await assert.rejects(
      replaceOwnedFileStaged(path, "new", before, "original", {
        beforeCommit: async () => { throw new Error("simulated write/fsync failure before commit"); },
      }),
      /simulated write\/fsync failure/,
    );
    assert.equal(await readFile(path, "utf8"), "original");
    assert.equal((await stat(path)).ino, before.ino);
    assert.deepEqual(await readdir(f.owned), ["artifact.txt"]);
  } finally {
    await f.cleanup();
  }
});

test("old inode acquired a hard-link alias during staging: reject without changing unowned alias", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "artifact.txt");
    const alias = join(f.outside, "alias.txt");
    await writeFile(path, "original");
    const before = await stat(path);
    await assert.rejects(
      replaceOwnedFileStaged(path, "new", before, "original", {
        beforeCommit: async () => { await link(path, alias); },
      }),
      /hard link/i,
    );
    assert.equal(await readFile(path, "utf8"), "original");
    assert.equal(await readFile(alias, "utf8"), "original");
  } finally {
    await f.cleanup();
  }
});

test("parent directory replacement before commit is denied without touching replacement target", async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "artifact.txt");
    const moved = join(f.root, "moved-parent");
    await writeFile(path, "original");
    const before = await stat(path);
    await assert.rejects(
      replaceOwnedFileStaged(path, "malicious content", before, "original", {
        beforeCommit: async () => {
          await rename(f.owned, moved);
          await mkdir(f.owned);
          await writeFile(path, "victim preserved");
        },
      }),
      /parent changed/i,
    );
    assert.equal(await readFile(path, "utf8"), "victim preserved");
    assert.equal(await readFile(join(moved, "artifact.txt"), "utf8"), "original");
  } finally {
    await f.cleanup();
  }
});

test("leaf target swap before commit is rejected instead of overwriting attacker target", async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "artifact.txt");
    const moved = join(f.outside, "former.txt");
    await writeFile(path, "original");
    const before = await stat(path);
    await assert.rejects(
      replaceOwnedFileStaged(path, "malicious content", before, "original", {
        beforeCommit: async () => {
          await rename(path, moved);
          await writeFile(path, "victim preserved");
        },
      }),
      /target changed/i,
    );
    assert.equal(await readFile(path, "utf8"), "victim preserved");
    assert.equal(await readFile(moved, "utf8"), "original");
  } finally {
    await f.cleanup();
  }
});

test("existing 0444 target may be read idempotently but cannot be rewritten by directory access alone", { skip: process.platform !== "linux" || process.geteuid?.() === 0 }, async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "readonly.txt");
    await writeFile(path, "unchanged");
    await chmod(path, 0o444);
    const before = await stat(path);
    await assert.rejects(replaceOwnedFileStaged(path, "changed", before, "unchanged"), /EACCES/);
    assert.equal(await readFile(path, "utf8"), "unchanged");
  } finally {
    await f.cleanup();
  }
});


test("post-commit fault is explicitly ambiguous and never claims no mutation", async () => {
  const f = await fixture();
  try {
    const path = join(f.owned, "artifact.txt");
    await writeFile(path, "original");
    const before = await stat(path);
    await assert.rejects(
      replaceOwnedFileStaged(path, "new", before, "original", {
        afterCommit: async () => { throw new Error("simulated directory fsync failure"); },
      }),
      (error: unknown) => error instanceof OwnedReplaceAmbiguousError &&
        /outcome unverified/.test(error.message),
    );
    // The commit DID occur; the caller must not treat the failure as safe-to-retry.
    assert.equal(await readFile(path, "utf8"), "new");
  } finally {
    await f.cleanup();
  }
});


test("staging inode replacement is denied before changing the owned target", async () => {
  const f = await fixture();
  try {
    const target = join(f.owned, "artifact.txt");
    await writeFile(target, "original");
    const before = await stat(target);
    await assert.rejects(
      replaceOwnedFileStaged(target, "new", before, "original", {
        beforeCommit: async () => {
          const staging = (await readdir(f.owned)).find(name => name.includes(".alix-stage-"));
          assert.ok(staging);
          await rename(join(f.owned, staging), join(f.outside, "moved-stage.txt"));
          await writeFile(join(f.owned, staging), "attacker controlled");
        },
      }),
      /staging inode changed/,
    );
    assert.equal(await readFile(target, "utf8"), "original");
  } finally {
    await f.cleanup();
  }
});

test("staging stays private and restores group-writable mode only after install", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    const target = join(f.owned, "shared.txt");
    await writeFile(target, "original");
    await chmod(target, 0o664);
    const before = await stat(target);
    await replaceOwnedFileStaged(target, "new", before, "original", {
      beforeCommit: async () => {
        const name = (await readdir(f.owned)).find(entry => entry.includes(".alix-stage-"));
        assert.ok(name);
        assert.equal((await stat(join(f.owned, name))).mode & 0o777, 0o600);
      },
    });
    assert.equal(await readFile(target, "utf8"), "new");
    assert.equal((await stat(target)).mode & 0o777, 0o664);
  } finally {
    await f.cleanup();
  }
});
