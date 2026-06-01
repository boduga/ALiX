import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMutationPaths } from "../../src/agent/mutations.js";

describe("extractMutationPaths", () => {
  it("extracts path from file.write args", () => {
    const paths = extractMutationPaths("file.write", { path: "src/foo.ts", content: "x" });
    assert.deepEqual(paths, ["src/foo.ts"]);
  });

  it("extracts path from file.create args", () => {
    const paths = extractMutationPaths("file.create", { path: "src/bar.ts", content: "x" });
    assert.deepEqual(paths, ["src/bar.ts"]);
  });

  it("returns path for any tool with a path arg", () => {
    // extractMutationPaths returns path for any execName that has one
    const paths = extractMutationPaths("file.read", { path: "src/foo.ts" });
    assert.deepEqual(paths, ["src/foo.ts"]);
  });

  it("handles missing path gracefully", () => {
    const paths = extractMutationPaths("file.write", {});
    assert.deepEqual(paths, []);
  });
});