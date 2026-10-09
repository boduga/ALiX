import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileOwnershipClaims } from "../../src/coordination/kernel/ownership-claim-compiler.js";

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

  it("scopes a root-level wildcard to root entries, never the whole workspace", () => {
    const r = compileOwnershipClaims(["Dockerfile*"]);
    assert.equal(r.claims.length, 1);
    assert.equal(r.claims[0].path, ".");
    // Root-level globs match entries directly in the root; a recursive claim
    // on "." would reserve every path in the workspace and collide with
    // unrelated leases elsewhere in the tree.
    assert.equal(r.claims[0].recursive, false);
    assert.ok(r.warnings.some(w => w.includes("Dockerfile*")), r.warnings.join("; "));
  });

  it("scopes a directory wildcard to its literal directory prefix", () => {
    const r = compileOwnershipClaims(["src/*.ts"]);
    assert.equal(r.claims.length, 1);
    assert.equal(r.claims[0].path, "src");
    assert.equal(r.claims[0].recursive, true);
  });

  it("keeps the infra domain map out of unrelated trees", () => {
    const r = compileOwnershipClaims([
      ".github/**", "Dockerfile*", "docker-compose*.yml", "compose*.yml",
      "infra/**", "terraform/**", "helm/**",
    ]);
    assert.deepEqual(
      r.claims.map(c => c.path),
      [".github", ".", "infra", "terraform", "helm"],
    );
    assert.equal(r.claims.every(c => c.path !== "." || c.recursive === false), true);
  });

  it("handles infra domain scopes", () => {
    const r = compileOwnershipClaims([".github/**", "terraform/**", "helm/**"]);
    assert.equal(r.claims.length, 3);
    assert.equal(r.claims[0].path, ".github");
    assert.equal(r.claims[2].path, "helm");
  });
});
