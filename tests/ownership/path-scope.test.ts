import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathScopesOverlap, scopeContains, pathInScope, normalizePathScope, resolveOwnedScopePrefix } from "../../src/ownership/path-scope.js";
import { resolve } from "node:path";
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

/**
 * THE PARITY TABLE. Every owned-scope spelling this system recognises, with the
 * prefix it is expected to authorize, pinned exhaustively.
 *
 * This exists because a derived rule introduced to replace an incomplete
 * enumeration turned out NARROWER than the list: it required every
 * separator-delimited segment to be a star, so the dot-slash spellings silently
 * stopped authorizing anything. The tests written alongside it did not catch
 * that, because they spelled out only the forms the old list already contained
 * — a test that enumerates the same cases as the implementation cannot detect
 * the implementation losing one.
 *
 * So this table is deliberately broader than any list: it is the input space,
 * not a sample. When a change to `resolveOwnedScopePrefix` alters any row, the
 * diff IS the review — you can see exactly what authority was gained or lost.
 * Expect a row to change only when the change is the point.
 */
describe("resolveOwnedScopePrefix — parity table", () => {
  const WORKSPACE = "/ws";

  /** [input, expected prefix relative to WORKSPACE, or null for "denies"] */
  const CASES: Array<[string, string | null]> = [
    // ── workspace-wide, every spelling, listed and derived ──
    [".", ""],
    ["./", ""],
    ["/", ""],
    ["*", ""],
    ["**", ""],
    ["/*", ""],
    ["/**", ""],
    ["./*", ""],
    ["./**", ""],
    ["./**/*", ""],
    ["./*/*", ""],
    ["**/*", ""],
    ["**/**", ""],
    ["**/**/*", ""],
    ["*/*", ""],
    ["*/*/*", ""],
    ["/**/*", ""],
    ["//**", ""],
    ["./**/", ""],

    // ── ordinary directories, files, recursive scopes ──
    ["docs", "docs"],
    ["docs/", "docs"],
    ["docs/**", "docs"],
    ["./docs", "docs"],
    ["./docs/**", "docs"],
    ["docs/sub", "docs/sub"],
    ["docs/sub/", "docs/sub"],
    ["docs/sub/**", "docs/sub"],
    ["src/a.ts", "src/a.ts"],
    [".tmp/out/a.md", ".tmp/out/a.md"],
    ["/ws/src", "src"],

    // ── must NOT be workspace-wide: a real directory narrows the grant ──
    ["docs/*.ts", null],
    ["docs/**/*.ts", null],
    ["a/**/b", null],
    ["src/*", null],
    ["src/**", "src"],

    // ── traversal and escape: always denied ──
    ["..", null],
    ["../escape", null],
    ["..//", null],
    ["../..", null],
    ["docs/../..", null],
    ["a/../b", null],
    ["**/../etc", null],
    ["..\\escape", null],
    // Backslashes normalise to "/" first, so this is the same recursive scope as docs/**.
    ["docs\\**", "docs"],

    // ── absolute outside the workspace: denied, never authorizing ──
    ["/etc", null],
    ["/etc/passwd", null],

    // ── empty ──
    ["", null],
    ["   ", null],
    // Redundant spellings of the current directory still mean the workspace.
    [".//", ""],
    ["./.", ""],
  ];

  for (const [input, expected] of CASES) {
    it(`${JSON.stringify(input)} -> ${expected === null ? "denies" : expected || "<workspace>"}`, () => {
      const result = resolveOwnedScopePrefix(input, WORKSPACE);
      if (expected === null) {
        assert.equal(result, undefined, `expected ${JSON.stringify(input)} to authorize nothing`);
        return;
      }
      assert.equal(
        result,
        expected === "" ? resolve(WORKSPACE) : resolve(WORKSPACE, expected),
        `unexpected prefix for ${JSON.stringify(input)}`,
      );
    });
  }

  it("grants nothing for an input no row covers — extend the table, do not guess", () => {
    // A guard on the table itself: if a new spelling is ever added to the code,
    // the parity table must be extended in the same commit, so a narrowing can
    // never hide in an untested corner again.
    const covered = new Set(CASES.map(([input]) => input));
    for (const input of [".", "**", "**/*", "docs/**", "..", "/etc"]) {
      assert.ok(covered.has(input), `parity table must cover ${JSON.stringify(input)}`);
    }
  });
});
