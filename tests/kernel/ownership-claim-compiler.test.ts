import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileOwnershipClaims } from "../../src/kernel/ownership-claim-compiler.js";

describe("compileOwnershipClaims", () => {
  it("converts src/** to recursive src claim", () => {
    const r = compileOwnershipClaims(["src/**"]);
    assert.deepEqual(r.claims, [{ path: "src", recursive: true, sourcePattern: "src/**" }]);
  });

  it("converts plain file path to non-recursive claim", () => {
    const r = compileOwnershipClaims(["package.json"]);
    assert.deepEqual(r.claims, [{ path: "package.json", recursive: false, sourcePattern: "package.json" }]);
  });

  it("converts ** to workspace root recursive claim", () => {
    const r = compileOwnershipClaims(["**"]);
    assert.deepEqual(r.claims, [{ path: ".", recursive: true, sourcePattern: "**" }]);
  });

  it("widens unsupported wildcard to workspace root", () => {
    const r = compileOwnershipClaims(["*.generated.*"]);
    assert.equal(r.claims.length, 1);
    assert.equal(r.claims[0].path, ".");
    assert.ok(r.warnings.length > 0);
  });

  it("handles multiple patterns", () => {
    const r = compileOwnershipClaims(["src/**", "docs/**", "README.md"]);
    assert.equal(r.claims.length, 3);
  });

  it("deduplicates overlapping claims", () => {
    const r = compileOwnershipClaims(["src/**", "src/**"]);
    assert.equal(r.claims.length, 1);
  });

  it("returns empty for empty input", () => {
    const r = compileOwnershipClaims([]);
    assert.equal(r.claims.length, 0);
  });

  it("rejects absolute path", () => {
    const r = compileOwnershipClaims(["/etc/passwd"]);
    assert.equal(r.claims.length, 0);
    assert.ok(r.warnings.some(w => w.includes("Absolute")));
  });

  it("rejects traversal path", () => {
    const r = compileOwnershipClaims(["../outside"]);
    assert.equal(r.claims.length, 0);
    assert.ok(r.warnings.some(w => w.includes("Traversal")));
  });

  it("rejects tilde path", () => {
    const r = compileOwnershipClaims(["~/config"]);
    assert.equal(r.claims.length, 0);
    assert.ok(r.warnings.some(w => w.includes("Tilde")));
  });

  it("rejects empty pattern", () => {
    const r = compileOwnershipClaims([""]);
    assert.equal(r.claims.length, 0);
  });

  it("converts Dockerfile* to workspace root", () => {
    const r = compileOwnershipClaims(["Dockerfile*"]);
    assert.equal(r.claims.length, 1);
    assert.equal(r.claims[0].path, ".");
    assert.equal(r.claims[0].recursive, true);
  });

  it("handles infra domain scopes", () => {
    const r = compileOwnershipClaims([".github/**", "terraform/**", "helm/**"]);
    assert.equal(r.claims.length, 3);
    assert.equal(r.claims[0].path, ".github");
    assert.equal(r.claims[2].path, "helm");
  });
});
