import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "os";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import { getDefaultExtensionStore } from "../../src/extensions/index.js";

describe("extension config integration", () => {
  it("getDefaultExtensionStore returns correct default path", () => {
    const store = getDefaultExtensionStore();
    assert.strictEqual(store.enabled, true);
    assert.ok(store.path.includes(".alix"), "path should be under .alix");
    assert.strictEqual(store.path, join(homedir(), ".alix", "extensions"));
  });

  it("ExtensionRegistry works with a custom store path", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: pjoin } = await import("node:path");
    const { writeFile, mkdir } = await import("node:fs/promises");
    const root = await mkdtemp(pjoin(tmpdir(), "ext-config-"));
    await mkdir(pjoin(root, "skill-test-ext"), { recursive: true });
    await writeFile(pjoin(root, "skill-test-ext", "EXTENSION.yaml"), "name: test-ext\ntype: skill\nversion: 1.0.0\ndescription: Test extension\ntrigger: /test");

    const registry = new ExtensionRegistry(root);
    const list = registry.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].manifest.name, "test-ext");
  });
});
