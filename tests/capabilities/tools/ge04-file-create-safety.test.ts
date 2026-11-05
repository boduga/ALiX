import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileToolRouter } from "../../../src/capabilities/tools/tool-router.js";

async function fixture(): Promise<{ root: string; router: FileToolRouter; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "alix-file-create-hardlink-"));
  await mkdir(join(root, "owned"));
  await mkdir(join(root, "outside"));
  return { root, router: new FileToolRouter(root), cleanup: () => rm(root, { recursive: true, force: true }) };
}

function create(router: FileToolRouter, path: string, content: string, ownedPaths: readonly string[] = ["owned/**"]) {
  return router.execute({
    toolCallId: "file-create-regression",
    name: "file.create",
    args: { path, content },
    ownedPaths,
  });
}

test("file.create identical 0444 file is a read-only idempotent success", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "owned", "immutable.txt");
    await writeFile(target, "unchanged");
    await chmod(target, 0o444);
    const original = await stat(target);
    const result = await create(f.router, "owned/immutable.txt", "unchanged");
    assert.equal(result.kind, "success", JSON.stringify(result));
    if (result.kind === "success") {
      assert.equal(result.outcome, "already_exists_identical");
      assert.equal(result.changed, false);
    }
    assert.equal(await readFile(target, "utf8"), "unchanged");
    assert.equal((await stat(target)).ino, original.ino);
  } finally {
    await f.cleanup();
  }
});

test("file.create differing 0444 content cannot be overwritten without write permission", { skip: process.platform !== "linux" || process.geteuid?.() === 0 }, async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "owned", "immutable.txt");
    await writeFile(target, "unchanged");
    await chmod(target, 0o444);
    const result = await create(f.router, "owned/immutable.txt", "changed");
    assert.equal(result.kind, "error");
    assert.equal(await readFile(target, "utf8"), "unchanged");
  } finally {
    await f.cleanup();
  }
});

test("file.create refuses owned-path hard link that aliases unowned file", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    const outside = join(f.root, "outside", "important.txt");
    const alias = join(f.root, "owned", "alias.txt");
    await writeFile(outside, "DO NOT CHANGE");
    await link(outside, alias);
    assert.equal((await stat(alias)).nlink, 2);
    const result = await create(f.router, "owned/alias.txt", "ATTACK");
    assert.equal(result.kind, "error", JSON.stringify(result));
    assert.match(result.kind === "error" ? result.message : "", /hard.link/i);
    assert.equal(await readFile(outside, "utf8"), "DO NOT CHANGE");
    assert.equal(await readFile(alias, "utf8"), "DO NOT CHANGE");
  } finally {
    await f.cleanup();
  }
});

test("file.create still overwrites an owned single-link file", async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "owned", "normal.txt");
    await writeFile(target, "previous and longer");
    const result = await create(f.router, "owned/normal.txt", "new");
    assert.equal(result.kind, "success", JSON.stringify(result));
    if (result.kind === "success") assert.equal(result.outcome, "overwritten");
    assert.equal(await readFile(target, "utf8"), "new");
  } finally {
    await f.cleanup();
  }
});

test("file.create does not grant a differing-content rewrite without owned paths", async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "owned", "normal.txt");
    await writeFile(target, "previous");
    const result = await create(f.router, "owned/normal.txt", "new", []);
    assert.equal(result.kind, "error");
    assert.equal(await readFile(target, "utf8"), "previous");
  } finally {
    await f.cleanup();
  }
});
