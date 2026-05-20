import test from "node:test";
import assert from "node:assert/strict";
import { buildRepoMapLite, RepoMapLiteIndexer } from "../src/repomap/repomap-lite.js";

test("builds a lightweight repo map", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  assert.ok(map.configFiles.includes("package.json"));
  assert.ok(map.sourceFiles.includes("src/add.ts"));
  assert.ok(map.testFiles.includes("src/add.test.ts"));
  assert.ok(map.topLevelSymbols.some((symbol) => symbol.name === "add"));
});

test("filter returns files matching predicate", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  const indexer = new RepoMapLiteIndexer(map);

  const filtered = indexer.filter((file) => file.kind === "source").toRepoMapLite();

  assert.ok(filtered.files.every((f) => f.kind === "source"), "all files should be source");
  assert.ok(filtered.files.length < map.files.length, "should have fewer files");
});

test("filterByDependencyScope returns reachable files", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  const indexer = new RepoMapLiteIndexer(map);

  // Start from an existing file in the fixture
  const entryPoints = map.sourceFiles.slice(0, 1);
  const filtered = indexer.filterByDependencyScope(2, entryPoints).toRepoMapLite();

  assert.ok(filtered.files.length > 0, "should have reachable files");
  assert.ok(filtered.files.length <= map.files.length, "should not exceed original");
});

test("matchGlob returns files matching patterns", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  const indexer = new RepoMapLiteIndexer(map);

  const filtered = indexer.matchGlob(["src/**/*.ts"]).toRepoMapLite();

  assert.ok(filtered.files.every((f) => f.path.startsWith("src/") && f.path.endsWith(".ts")), "all files should match glob");
});

test("chaining filter methods works correctly", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  const indexer = new RepoMapLiteIndexer(map);

  const result = indexer
    .filter((f) => f.kind === "source")
    .matchGlob(["src/**"])
    .toRepoMapLite();

  assert.ok(result.files.every((f) => f.kind === "source"), "all files should be source");
  assert.ok(result.files.every((f) => f.path.startsWith("src/")), "all files should match src/**");
});

test("toRepoMapLite returns proper structure", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  const indexer = new RepoMapLiteIndexer(map);

  const result = indexer.toRepoMapLite();

  assert.ok(result.root === map.root, "root should match");
  assert.ok(Array.isArray(result.files), "files should be array");
  assert.ok(Array.isArray(result.sourceFiles), "sourceFiles should be array");
  assert.ok(Array.isArray(result.testFiles), "testFiles should be array");
  assert.ok(Array.isArray(result.configFiles), "configFiles should be array");
  assert.ok(Array.isArray(result.docsFiles), "docsFiles should be array");
  assert.ok(Array.isArray(result.topLevelSymbols), "topLevelSymbols should be array");
});

test("filter preserves symbols for filtered files", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  const indexer = new RepoMapLiteIndexer(map);

  const filtered = indexer.filter((f) => f.path.includes("add.ts")).toRepoMapLite();

  const addSymbol = filtered.topLevelSymbols.find((s) => s.name === "add");
  assert.ok(addSymbol, "add symbol should be preserved");
  assert.ok(filtered.files.some((f) => f.path.includes("add.ts")), "add.ts should be in files");
});