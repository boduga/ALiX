import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathScopesOverlap, scopeContains, pathInScope, normalizePathScope } from "../../src/ownership/path-scope.js";
import type { PathScope } from "../../src/ownership/ownership-types.js";

function makeScope(root: string, recursive: boolean): PathScope {
  return { kind: "path", root, recursive };
}

describe("pathScopesOverlap (symmetric)", () => {
  const src = makeScope("/proj/src", true);
  const srcRuntime = makeScope("/proj/src/runtime", true);
  const srcExact = makeScope("/proj/src/runtime/executor.ts", false);
  const tests = makeScope("/proj/tests", true);

  it("identical scopes overlap", () => {
    assert.ok(pathScopesOverlap(src, src));
  });

  it("recursive parent and child overlap (both directions)", () => {
    assert.ok(pathScopesOverlap(src, srcRuntime));
    assert.ok(pathScopesOverlap(srcRuntime, src));
  });

  it("recursive scope and exact file overlap", () => {
    assert.ok(pathScopesOverlap(src, srcExact));
    assert.ok(pathScopesOverlap(srcExact, src));
  });

  it("disjoint scopes do not overlap", () => {
    assert.equal(pathScopesOverlap(src, tests), false);
  });

  it("both recursive with shared prefix overlap", () => {
    const a = makeScope("/proj/src", true);
    const b = makeScope("/proj/src/runtime", true);
    assert.ok(pathScopesOverlap(a, b));
    assert.ok(pathScopesOverlap(b, a));
  });

  it("sibling directories do not overlap", () => {
    const a = makeScope("/proj/src/runtime", true);
    const b = makeScope("/proj/src/policy", true);
    assert.equal(pathScopesOverlap(a, b), false);
  });
});

describe("scopeContains (directional) and pathInScope", () => {
  const recursive = makeScope("/proj/src", true);
  const exact = makeScope("/proj/src/executor.ts", false);
  const nonRec = makeScope("/proj/src/foo", false);

  it("recursive scope contains descendant", () => {
    assert.ok(scopeContains(recursive, "/proj/src/runtime/executor.ts"));
  });

  it("recursive scope contains direct child", () => {
    assert.ok(scopeContains(recursive, "/proj/src/main.ts"));
  });

  it("recursive scope does not contain outside path", () => {
    assert.equal(scopeContains(recursive, "/proj/tests/main.test.ts"), false);
  });

  it("exact file scope matches that file", () => {
    assert.ok(scopeContains(exact, "/proj/src/executor.ts"));
  });

  it("exact file scope does not match sibling", () => {
    assert.equal(scopeContains(exact, "/proj/src/other.ts"), false);
  });

  it("non-recursive scope does not contain child", () => {
    assert.equal(scopeContains(nonRec, "/proj/src/foo/bar"), false);
  });

  it("pathInScope is an alias", () => {
    assert.equal(pathInScope(recursive, "/proj/src/main.ts"), scopeContains(recursive, "/proj/src/main.ts"));
  });
});

describe("normalizePathScope", () => {
  it("handles ** glob as recursive", () => {
    const s = normalizePathScope("src/runtime/**", "/proj");
    assert.equal(s.root, "/proj/src/runtime");
    assert.equal(s.recursive, true);
  });

  it("handles plain directory as non-recursive", () => {
    const s = normalizePathScope("src/runtime", "/proj");
    assert.equal(s.root, "/proj/src/runtime");
    assert.equal(s.recursive, false);
  });

  it("handles trailing slash as recursive", () => {
    const s = normalizePathScope("src/runtime/", "/proj");
    assert.equal(s.root, "/proj/src/runtime");
    assert.equal(s.recursive, true);
  });

  it("handles exact file path", () => {
    const s = normalizePathScope("src/runtime/executor.ts", "/proj");
    assert.equal(s.root, "/proj/src/runtime/executor.ts");
    assert.equal(s.recursive, false);
  });

  it("rejects .. path segment", () => {
    assert.throws(() => normalizePathScope("../etc/passwd", "/proj"));
  });

  it("allows .. as part of a filename (foo..bar)", () => {
    const s = normalizePathScope("src/foo..bar.ts", "/proj");
    assert.equal(s.root, "/proj/src/foo..bar.ts");
  });

  it("rejects outside workspace", () => {
    assert.throws(() => normalizePathScope("/tmp/foo", "/proj", "/proj"));
  });

  it("rejects unsupported wildcard pattern with *", () => {
    assert.throws(() => normalizePathScope("src/*.ts", "/proj"));
  });

  it("rejects leading globstar", () => {
    assert.throws(() => normalizePathScope("**/executor.ts", "/proj"));
  });

  it("rejects empty string", () => {
    assert.throws(() => normalizePathScope("", "/proj"));
  });
});
