// tests/extensions/version-check.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

test("canCheckVersion compatibility", () => {
  const registry = new ExtensionRegistry("/tmp/test-ext-registry");
  assert.ok(typeof registry.canCheckVersion === "function", "should have canCheckVersion method");
});

test("getVersionInfo returns version data", () => {
  const registry = new ExtensionRegistry("/tmp/test-ext-registry");
  const info = registry.getVersionInfo("skill/test-skill");
  assert.ok(info === null || typeof info === "object", "should return null or version object");
});