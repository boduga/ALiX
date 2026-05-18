// tests/extensions/version-check.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../src/extensions/registry.js";

test("getVersionInfo returns null for unknown extension", () => {
  const registry = new ExtensionRegistry("/tmp/test-ext-registry");
  const info = registry.getVersionInfo("skill/nonexistent");
  assert.strictEqual(info, null);
});