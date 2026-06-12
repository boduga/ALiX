import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";

const ROOT = "/home/user/project";
const resolver = new WorkspacePathResolver(ROOT, [".git/**", ".env", "secrets/**"]);

describe("WorkspacePathResolver", () => {
  // --- resolve ---

  it("resolves relative path against workspace root", () => {
    const abs = resolver.resolve("src/index.ts");
    assert.equal(abs, "/home/user/project/src/index.ts");
  });

  it("passes through absolute paths", () => {
    const abs = resolver.resolve("/tmp/foo.txt");
    assert.equal(abs, "/tmp/foo.txt");
  });

  // --- isInWorkspace ---

  it("relative path is inside workspace", () => {
    assert.ok(resolver.isInWorkspace("/home/user/project/src/index.ts"));
  });

  it("path outside workspace is rejected", () => {
    assert.ok(!resolver.isInWorkspace("/tmp/foo.txt"));
  });

  // --- isProtected ---

  it("detects .git paths as protected", () => {
    assert.ok(resolver.isProtected("/home/user/project/.git/config"));
  });

  it("detects .env as protected", () => {
    assert.ok(resolver.isProtected("/home/user/project/.env"));
  });

  it("non-protected path returns false", () => {
    assert.ok(!resolver.isProtected("/home/user/project/src/index.ts"));
  });

  // --- isSensitive ---

  it("detects .ssh paths as sensitive", () => {
    assert.ok(resolver.isSensitive("/home/user/.ssh/id_rsa"));
  });

  it("detects .alix paths as sensitive", () => {
    assert.ok(resolver.isSensitive("/home/user/project/.alix/approvals.json"));
  });

  it("detects .git as sensitive", () => {
    assert.ok(resolver.isSensitive("/home/user/project/.git/HEAD"));
  });

  it("non-sensitive path returns false", () => {
    assert.ok(!resolver.isSensitive("/home/user/project/src/index.ts"));
  });

  // --- check (full pipeline) ---

  it("check approves a normal workspace file", () => {
    const result = resolver.check("src/index.ts");
    assert.equal(result.insideWorkspace, true);
    assert.equal(result.protected, false);
    assert.equal(result.sensitive, false);
    assert.equal(result.reason, undefined);
  });

  it("check rejects sensitive .ssh path", () => {
    const result = resolver.check("~/.ssh/id_rsa");
    assert.equal(result.sensitive, true);
    assert.ok(result.reason);
  });

  it("check rejects .git path as sensitive", () => {
    const result = resolver.check(".git/config");
    assert.equal(result.sensitive, true);
    assert.ok(result.reason);
  });

  it("check rejects .alix path via sensitivity", () => {
    const result = resolver.check(".alix/config.json");
    assert.equal(result.sensitive, true);
  });

  // --- isTraversalSafe ---

  it("rejects parent directory traversal", () => {
    assert.ok(!resolver.isTraversalSafe("../etc/passwd"));
    assert.ok(!resolver.isTraversalSafe("src/../../etc/passwd"));
  });

  it("rejects tilde expansion", () => {
    assert.ok(!resolver.isTraversalSafe("~/foo"));
  });

  it("accepts normal relative path", () => {
    assert.ok(resolver.isTraversalSafe("src/index.ts"));
    assert.ok(resolver.isTraversalSafe("./src/index.ts"));
  });
});
