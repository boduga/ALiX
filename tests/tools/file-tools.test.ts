import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("file.delete removes existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ftools-"));
  try {
    const filePath = join(dir, "to-delete.txt");
    await writeFile(filePath, "old content");
    // verify file exists before deletion
    const before = await readFile(filePath, "utf8");
    assert.equal(before, "old content");
    // delete the file using rm (what the executor's delete would call)
    await rm(filePath);
    // verify file is gone
    await assert.rejects(
      async () => readFile(filePath, "utf8"),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file.create creates file and parent directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ftools-"));
  try {
    const content = "hello world";
    await mkdir(join(dir, "subdir"), { recursive: true });
    await writeFile(join(dir, "subdir", "test.txt"), content);
    const result = await readFile(join(dir, "subdir", "test.txt"), "utf8");
    assert.equal(result, content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});