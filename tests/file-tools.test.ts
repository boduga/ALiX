import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, searchDir } from "../src/tools/file-tools.js";

test("readFile returns content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-file-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "export const x = 1;\n");
    const result = await readFile({ root: dir, path: "src/a.ts" });
    assert.equal(result.kind, "success");
    assert.equal(result.content, "export const x = 1;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFile returns error for missing file", async () => {
  const result = await readFile({ root: "/tmp", path: "nonexistent-file-xyz.ts" });
  assert.equal(result.kind, "error");
  assert.ok(result.message?.includes("not found"));
});

test("readFile rejects paths outside workspace", async () => {
  const result = await readFile({ root: "/tmp/alix", path: "../etc/passwd" });
  assert.equal(result.kind, "error");
});

test("searchDir returns matching files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-search-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "function hello() {}\n");
    await writeFile(join(dir, "src/b.ts"), "const x = 1;\n");
    await writeFile(join(dir, "src/c.js"), "function hello() {}\n");
    const result = await searchDir({ root: dir, pattern: "hello", extensions: [".ts"] });
    assert.equal(result.kind, "success");
    assert.equal(result.matches?.length, 1);
    assert.ok(result.matches?.[0].path.includes("a.ts"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});