import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";
import { extractMutationTargets } from "../../src/ownership/mutation-targets.js";

describe("extractMutationTargets", () => {
  let resolver: WorkspacePathResolver;

  before(() => {
    resolver = new WorkspacePathResolver("/workspace", []);
  });

  it("file.create extracts single path", () => {
    const result = extractMutationTargets("file.create", { path: "src/main.ts" }, resolver);
    assert.equal(result.classification, "known-write");
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].path, "/workspace/src/main.ts");
    assert.equal(result.targets[0].origin, "single");
    assert.equal(result.targets[0].confident, true);
  });

  it("file.rename extracts source and destination", () => {
    const result = extractMutationTargets("file.rename", { source: "old.ts", destination: "new.ts" }, resolver);
    assert.equal(result.classification, "known-write");
    assert.equal(result.targets.length, 2);
    assert.equal(result.targets[0].path, "/workspace/old.ts");
    assert.equal(result.targets[1].path, "/workspace/new.ts");
  });

  it("file.rename without source returns unknown-write", () => {
    const result = extractMutationTargets("file.rename", { destination: "new.ts" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });

  it("returns unknown-write for unrecognized tool with no path args", () => {
    const result = extractMutationTargets("web_search", { query: "hello" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });

  it("returns no-write for known read-only shell command", () => {
    const result = extractMutationTargets("shell.run", { command: "ls -la" }, resolver);
    assert.equal(result.classification, "no-write");
    assert.equal(result.targets.length, 0);
  });

  it("returns unknown-write for npm write-capable command", () => {
    const result = extractMutationTargets("shell.run", { command: "npm test" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });

  it("returns unknown-write for unknown shell command", () => {
    const result = extractMutationTargets("shell.run", { command: "rm -rf node_modules" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });

  it("patch.apply extracts paths from unified diff headers", () => {
    const patchText = `--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
 hello world
+new line
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,2 +10,3 @@
 old line
+another line`;
    const result = extractMutationTargets("patch.apply", { patchText, root: "/workspace" }, resolver);
    assert.equal(result.classification, "known-write");
    // Should find src/main.ts and src/utils.ts from headers, plus root as glob anchor
    assert.ok(result.targets.length >= 2);
    assert.ok(result.targets.some(t => t.path.endsWith("src/main.ts")));
    assert.ok(result.targets.some(t => t.path.endsWith("src/utils.ts")));
  });

  it("patch.apply without patchText returns unknown-write", () => {
    const result = extractMutationTargets("patch.apply", { root: "/workspace" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });

  it("file.create with sensitive path returns unknown-write", () => {
    const resolver2 = new WorkspacePathResolver("/workspace", []);
    const result = extractMutationTargets("file.create", { path: ".env" }, resolver2);
    // .env matches sensitive pattern -> check returns safe=false
    // The extractor uses resolver.check() which marks .env as sensitive
    assert.equal(result.classification, "unknown-write");
  });
});
