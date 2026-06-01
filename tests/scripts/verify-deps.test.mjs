// tests/scripts/verify-deps.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function loadPackageJson() {
  const path = join(ROOT, "package.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("verify-deps: real package.json", () => {
  it("has no ^ ranges in dependencies", () => {
    const pkg = loadPackageJson();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      assert.ok(
        !String(version).startsWith("^"),
        `${name} uses caret range: ${version}`
      );
    }
  });

  it("has no ~ ranges in dependencies", () => {
    const pkg = loadPackageJson();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      assert.ok(
        !String(version).startsWith("~"),
        `${name} uses tilde range: ${version}`
      );
    }
  });

  it("all dependencies use exact version pins", () => {
    const pkg = loadPackageJson();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      // Must be a version like "1.2.3" — no ranges, no wildcards
      assert.ok(
        /^\d+\.\d+\.\d+/.test(String(version)),
        `${name} not pinned: ${version}`
      );
    }
  });
});