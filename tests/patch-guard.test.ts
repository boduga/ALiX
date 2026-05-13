import test from "node:test";
import assert from "node:assert/strict";
import { validatePatchOperations, isPathSafe, isProtectedPath, DEFAULT_PATCH_GUARD_CONFIG } from "../src/patch/patch-guard.js";

const MAX_FILE_SIZE = 500_000;

test("rejects patch exceeding file size limit", () => {
  const largeContent = "x".repeat(MAX_FILE_SIZE + 1);
  const ops = [{ path: "src/util.ts", operation: "create" as const, content: largeContent }];
  const result = validatePatchOperations(ops, {
    protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
    maxFileSizeBytes: MAX_FILE_SIZE,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes("exceeds max file size"));
});

test("rejects patch touching protected path", () => {
  const ops = [
    { path: ".env", operation: "modify" as const, content: "FOO=bar" },
  ];
  const result = validatePatchOperations(ops, {
    protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
    maxFileSizeBytes: 10 * 1024 * 1024,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes("protected"));
});

test("rejects create outside workspace", () => {
  const ops = [
    { path: "../etc/passwd", operation: "create" as const, content: "root:x:0:0" },
  ];
  const result = validatePatchOperations(ops, {
    protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
    maxFileSizeBytes: 10 * 1024 * 1024,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes("unsafe"));
});

test("accepts valid operations", () => {
  const ops = [
    { path: "src/util.ts", operation: "modify" as const, content: "export function add(a: number, b: number) { return a + b; }\n" },
  ];
  const result = validatePatchOperations(ops, {
    protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
    maxFileSizeBytes: 10 * 1024 * 1024,
  });
  assert.equal(result.valid, true);
});

test("isPathSafe rejects leading ..", () => {
  assert.equal(isPathSafe("../etc/passwd"), false);
});

test("isPathSafe rejects leading /", () => {
  assert.equal(isPathSafe("/etc/passwd"), false);
});

test("isPathSafe rejects embedded ..", () => {
  assert.equal(isPathSafe("src/../etc/passwd"), false);
});

test("isPathSafe rejects ~ expansion", () => {
  assert.equal(isPathSafe("~/foo"), false);
});

test("isPathSafe rejects $ expansion", () => {
  assert.equal(isPathSafe("$HOME/foo"), false);
});

test("isPathSafe accepts normal paths", () => {
  assert.equal(isPathSafe("src/util.ts"), true);
  assert.equal(isPathSafe("src/nested/deep/util.ts"), true);
});

test("isProtectedPath does not false-match on prefix collision", () => {
  // .git/** should match .git/config but NOT .github/config
  assert.equal(isProtectedPath([".git/**"], ".github/config"), false);
  assert.equal(isProtectedPath([".git/**"], ".git/config"), true);
  assert.equal(isProtectedPath([".git/**"], ".git"), true);
});

test("isProtectedPath matches wildcard patterns", () => {
  assert.equal(isProtectedPath([".git/**"], ".git/config"), true);
  assert.equal(isProtectedPath([".env", ".env.*"], ".env"), true);
  assert.equal(isProtectedPath([".env", ".env.*"], ".env.local"), true);
  assert.equal(isProtectedPath(["secrets/**"], "secrets/db.json"), true);
  assert.equal(isProtectedPath(["src/file.ts"], "src/file.ts"), true);
  assert.equal(isProtectedPath(["src/file.ts"], "src/other.ts"), false);
});