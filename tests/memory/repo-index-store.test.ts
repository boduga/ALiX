import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoIndexStore } from "../../src/memory/repo-index-store.js";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

test("RepoIndexStore.init creates index directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();
    assert.ok(existsSync(join(dir, ".alix", "indexes")), "index directory should exist");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.init uses custom indexDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir, "custom-indexes");
    await store.init();
    assert.ok(existsSync(join(dir, "custom-indexes")), "custom index directory should exist");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.save stores index data and metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    const data = { symbols: ["foo", "bar"], relations: 42 };
    await store.save("test-index", data, { sourceFiles: ["a.ts", "b.ts"] });

    const loaded = await store.load("test-index");
    assert.deepEqual(loaded, data, "loaded data should match saved data");

    const stats = await store.getStats();
    assert.equal(stats.indexCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.load returns undefined for non-existent index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    const loaded = await store.load("nonexistent");
    assert.strictEqual(loaded, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.isStale detects age-based staleness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    await store.save("old-index", { data: "test" }, { maxAge: 100 }); // 100ms max age

    // Wait enough to exceed maxAge
    await new Promise((r) => setTimeout(r, 150));

    const stale = await store.isStale("old-index", { maxAge: 100 });
    assert.ok(stale, "index should be stale due to age");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.isStale detects repo modification staleness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    const currentTime = Date.now();
    await store.save("repo-index", { data: "test" });

    // Repo modified after index creation
    const stale = await store.isStale("repo-index", { repoModified: currentTime + 1000 });
    assert.ok(stale, "index should be stale when repo modified after index created");

    // Repo modified before index creation
    const notStale = await store.isStale("repo-index", { repoModified: currentTime - 1000 });
    assert.ok(!notStale, "index should not be stale when repo modified before index created");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.delete removes index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    await store.save("to-delete", { data: "test" });
    await store.delete("to-delete");

    const loaded = await store.load("to-delete");
    assert.strictEqual(loaded, undefined, "index should be deleted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.clearAll removes all indexes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    await store.save("index1", { data: 1 });
    await store.save("index2", { data: 2 });
    await store.clearAll();

    const stats = await store.getStats();
    assert.equal(stats.indexCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.getStats returns correct statistics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    const before = Date.now();
    await store.save("index1", { small: "data" });
    await new Promise((r) => setTimeout(r, 50));
    await store.save("index2", { larger: "data" });
    const after = Date.now();

    const stats = await store.getStats();
    assert.equal(stats.indexCount, 2);
    assert.ok(stats.totalSize > 0, "total size should be > 0");
    assert.ok(stats.oldestIndex, "should have oldest index");
    assert.ok(stats.newestIndex, "should have newest index");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore handles metadata with sourceFiles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    await store.save("indexed", { symbols: 42 }, { sourceFiles: files });

    // Verify index data is correct
    const data = await store.load("indexed");
    assert.deepEqual(data, { symbols: 42 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.isStale returns false for fresh index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    await store.save("fresh", { data: "test" });

    const stale = await store.isStale("fresh", { maxAge: 60000 }); // 1 minute
    assert.ok(!stale, "fresh index should not be stale");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RepoIndexStore.save overwrites existing index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-index-store-"));
  try {
    const store = new RepoIndexStore(dir);
    await store.init();

    await store.save("overwrite-me", { version: 1 });
    await store.save("overwrite-me", { version: 2 });

    const data = await store.load("overwrite-me");
    assert.deepEqual(data, { version: 2 }, "should have latest version");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});