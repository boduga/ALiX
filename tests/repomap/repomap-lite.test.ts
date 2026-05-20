import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RepoMapLiteIndexer } from "../../src/repomap/repomap-lite.js";

function createTestData() {
  return {
    root: "/test",
    generatedAt: new Date().toISOString(),
    files: [
      { path: "src/app.ts", kind: "source" as const, sizeBytes: 100 },
      { path: "src/auth.ts", kind: "source" as const, sizeBytes: 200 },
      { path: "src/utils.ts", kind: "source" as const, sizeBytes: 150 },
      { path: "tests/app.test.ts", kind: "test" as const, sizeBytes: 50 },
      { path: "tests/auth.test.ts", kind: "test" as const, sizeBytes: 60 },
      { path: "package.json", kind: "config" as const, sizeBytes: 30 },
      { path: "README.md", kind: "docs" as const, sizeBytes: 20 },
      { path: "dist/bundle.js", kind: "unknown" as const, sizeBytes: 500 },
    ],
    configFiles: ["package.json"],
    docsFiles: ["README.md"],
    testFiles: ["tests/app.test.ts", "tests/auth.test.ts"],
    sourceFiles: ["src/app.ts", "src/auth.ts", "src/utils.ts"],
    topLevelSymbols: [
      { path: "src/app.ts", name: "app", kind: "function" as const, line: 1 },
      { path: "src/auth.ts", name: "auth", kind: "function" as const, line: 1 },
      { path: "src/utils.ts", name: "helper", kind: "function" as const, line: 1 },
    ],
  };
}

describe("RepoMapLiteIndexer", () => {
  let indexer: RepoMapLiteIndexer;

  beforeEach(() => {
    indexer = new RepoMapLiteIndexer(createTestData());
  });

  describe("filter()", () => {
    it("filters files by predicate", () => {
      const result = indexer.filter((f) => f.kind === "source");

      assert.equal(result.toRepoMapLite().files.length, 3);
      assert.equal(result.toRepoMapLite().sourceFiles.length, 3);
    });

    it("filters source files only", () => {
      const result = indexer.filter((f) => f.path.startsWith("src/"));

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 3);
      assert.ok(data.files.every((f) => f.path.startsWith("src/")));
    });

    it("filters symbols to match remaining files", () => {
      const result = indexer.filter((f) => f.path === "src/app.ts");

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 1);
      assert.equal(data.topLevelSymbols.length, 1);
      assert.equal(data.topLevelSymbols[0].name, "app");
    });

    it("returns new indexer instance", () => {
      const result = indexer.filter((f) => f.kind === "source");

      assert.ok(result instanceof RepoMapLiteIndexer);
      assert.notEqual(result, indexer);
    });
  });

  describe("matchGlob()", () => {
    it("matches single glob pattern", () => {
      const result = indexer.matchGlob(["src/**/*.ts"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 3);
      assert.ok(data.files.every((f) => f.path.startsWith("src/")));
    });

    it("matches test files", () => {
      const result = indexer.matchGlob(["**/*.test.ts"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 2);
      assert.ok(data.files.every((f) => f.path.endsWith(".test.ts")));
    });

    it("matches multiple patterns", () => {
      const result = indexer.matchGlob(["src/*.ts", "package.json"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 4);
    });

    it("returns empty result when no patterns match", () => {
      const result = indexer.matchGlob(["nonexistent/**/*"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 0);
    });
  });

  describe("filterByDependencyScope()", () => {
    it("returns empty for depth 0", () => {
      const result = indexer.filterByDependencyScope(0, ["src/app.ts"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 0);
    });

    it("includes root files at depth 1", () => {
      const result = indexer.filterByDependencyScope(1, ["src/app.ts"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 1);
      assert.equal(data.files[0].path, "src/app.ts");
    });

    it("filters files within dependency depth", () => {
      // Create data with actual dependencies
      const dataWithDeps = {
        ...createTestData(),
        files: [
          { path: "src/main.ts", kind: "source" as const, sizeBytes: 100 },
          { path: "src/util.ts", kind: "source" as const, sizeBytes: 50 },
          { path: "src/dep.ts", kind: "source" as const, sizeBytes: 30 },
        ],
      };

      const depIndexer = new RepoMapLiteIndexer({
        ...dataWithDeps,
        sourceFiles: ["src/main.ts", "src/util.ts", "src/dep.ts"],
        configFiles: [],
        docsFiles: [],
        testFiles: [],
        topLevelSymbols: [],
      });

      const result = depIndexer.filterByDependencyScope(1, ["src/main.ts"]);

      const resultData = result.toRepoMapLite();
      assert.ok(resultData.files.some((f) => f.path === "src/main.ts"));
    });
  });

  describe("chaining methods", () => {
    it("chains filter and matchGlob", () => {
      const result = indexer
        .filter((f) => f.kind === "source")
        .matchGlob(["src/app.ts", "src/auth.ts"]);

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 2);
    });

    it("chains multiple filters", () => {
      const result = indexer
        .filter((f) => f.kind === "source" || f.kind === "test")
        .filter((f) => f.path.startsWith("src/") || f.path.startsWith("tests/"));

      const data = result.toRepoMapLite();
      assert.equal(data.files.length, 5);
    });

    it("chains matchGlob with filter", () => {
      const result = indexer
        .matchGlob(["**/*.ts"])
        .filter((f) => f.kind !== "unknown");

      const data = result.toRepoMapLite();
      assert.ok(data.files.every((f) => f.kind !== "unknown"));
    });

    it("chains all methods together", () => {
      const result = indexer
        .filter((f) => f.kind === "source" || f.kind === "test")
        .matchGlob(["src/*.ts", "tests/*.test.ts"])
        .filter((f) => f.sizeBytes > 100);

      const data = result.toRepoMapLite();
      assert.ok(data.files.length > 0);
      assert.ok(data.files.every((f) => f.sizeBytes > 100));
    });
  });

  describe("toRepoMapLite()", () => {
    it("returns RepoMapLite with filtered data", () => {
      const result = indexer.filter((f) => f.kind === "config");
      const data = result.toRepoMapLite();

      assert.equal(data.root, "/test");
      assert.equal(data.configFiles.length, 1);
      assert.equal(data.configFiles[0], "package.json");
    });

    it("updates categorized file lists after filtering", () => {
      const result = indexer.filter((f) => f.kind === "source");
      const data = result.toRepoMapLite();

      assert.equal(data.sourceFiles.length, 3);
      assert.equal(data.testFiles.length, 0);
      assert.equal(data.configFiles.length, 0);
    });
  });
});