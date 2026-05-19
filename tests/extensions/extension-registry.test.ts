import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { ExtensionRegistry, ExtensionKind, ExtensionManifest } from "../../src/extensions/extension-registry.js";
import { mkdir, writeFile, rm } from "fs/promises";

describe("ExtensionRegistry", () => {
  let registry: ExtensionRegistry;

  const baseManifest = (overrides: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
    id: "test-ext",
    name: "Test Extension",
    version: "1.0.0",
    kind: "tool" as ExtensionKind,
    entrypoint: "./dist/index.js",
    capabilities: ["file_read"],
    permissions: [],
    enabled: true,
    ...overrides,
  });

  beforeEach(() => {
    registry = new ExtensionRegistry();
  });

  describe("register", () => {
    it("should register a valid extension manifest", () => {
      const manifest = baseManifest();
      registry.register(manifest);
      const result = registry.get("test-ext");
      assert.ok(result, "extension should be registered");
      assert.equal(result?.id, "test-ext");
      assert.equal(result?.name, "Test Extension");
    });

    it("should throw if extension with same id is already registered", () => {
      const manifest = baseManifest();
      registry.register(manifest);
      assert.throws(() => registry.register(manifest), /already registered/);
    });

    it("should set loadedAt timestamp on registration", () => {
      const manifest = baseManifest();
      registry.register(manifest);
      const result = registry.get("test-ext");
      assert.ok(result?.loadedAt, "should have loadedAt timestamp");
    });
  });

  describe("get", () => {
    it("should return undefined for unregistered extension", () => {
      assert.strictEqual(registry.get("nonexistent"), undefined);
    });

    it("should return registered extension", () => {
      registry.register(baseManifest({ id: "my-ext" }));
      const result = registry.get("my-ext");
      assert.equal(result?.id, "my-ext");
    });
  });

  describe("list", () => {
    it("should return empty array when no extensions registered", () => {
      assert.deepStrictEqual(registry.list(), []);
    });

    it("should return all registered extensions", () => {
      registry.register(baseManifest({ id: "ext-1" }));
      registry.register(baseManifest({ id: "ext-2", name: "Second" }));
      const list = registry.list();
      assert.equal(list.length, 2);
    });
  });

  describe("listByKind", () => {
    it("should return empty array when no extensions of that kind", () => {
      registry.register(baseManifest({ kind: "tool" }));
      assert.deepStrictEqual(registry.listByKind("skill"), []);
    });

    it("should return only extensions of specified kind", () => {
      registry.register(baseManifest({ id: "tool-ext", kind: "tool" }));
      registry.register(baseManifest({ id: "skill-ext", kind: "skill" }));
      registry.register(baseManifest({ id: "hook-ext", kind: "hook" }));
      const tools = registry.listByKind("tool");
      assert.equal(tools.length, 1);
      assert.equal(tools[0].id, "tool-ext");
    });
  });

  describe("listEnabled", () => {
    it("should return only enabled extensions", () => {
      registry.register(baseManifest({ id: "enabled-ext", enabled: true }));
      registry.register(baseManifest({ id: "disabled-ext", enabled: false }));
      const enabled = registry.listEnabled();
      assert.equal(enabled.length, 1);
      assert.equal(enabled[0].id, "enabled-ext");
    });
  });

  describe("disable", () => {
    it("should disable a registered extension", () => {
      registry.register(baseManifest({ id: "my-ext" }));
      registry.disable("my-ext");
      const result = registry.get("my-ext");
      assert.strictEqual(result?.enabled, false);
    });

    it("should throw for unregistered extension", () => {
      assert.throws(() => registry.disable("nonexistent"), /not found/);
    });
  });

  describe("enable", () => {
    it("should enable a registered extension", () => {
      registry.register(baseManifest({ id: "my-ext", enabled: false }));
      registry.enable("my-ext");
      const result = registry.get("my-ext");
      assert.strictEqual(result?.enabled, true);
    });

    it("should throw for unregistered extension", () => {
      assert.throws(() => registry.enable("nonexistent"), /not found/);
    });
  });

  describe("loadFromDir", () => {
    it("should load and register extensions from directory", async () => {
      const dir = "/tmp/test-ext-registry";
      await mkdir(dir, { recursive: true });
      await mkdir(dir + "/dir-ext", { recursive: true });
      await writeFile(dir + "/dir-ext/manifest.json", JSON.stringify({
        id: "dir-ext",
        name: "Dir Extension",
        version: "1.0.0",
        kind: "skill",
        entrypoint: "./index.js",
        capabilities: [],
        permissions: [],
        enabled: true,
      }));

      const count = await registry.loadFromDir(dir);
      assert.equal(count, 1);
      assert.ok(registry.get("dir-ext"), "extension should be loaded");

      await rm(dir, { recursive: true, force: true });
    });

    it("should skip directories without manifest.json", async () => {
      const dir = "/tmp/test-ext-registry-skip";
      await mkdir(dir, { recursive: true });
      await mkdir(dir + "/no-manifest", { recursive: true });
      await writeFile(dir + "/no-manifest/README.md", "# Test");

      const count = await registry.loadFromDir(dir);
      assert.equal(count, 0);

      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("loadFromConfig", () => {
    it("should load extensions from config file", async () => {
      const configPath = "/tmp/test-ext-config.json";
      await writeFile(configPath, JSON.stringify({
        extensions: [
          {
            id: "config-ext",
            name: "Config Extension",
            version: "1.0.0",
            kind: "plugin",
            entrypoint: "./plugin.js",
            capabilities: [],
            permissions: [],
            enabled: true,
          },
        ],
      }));

      await registry.loadFromConfig(configPath);
      assert.ok(registry.get("config-ext"), "extension should be loaded");

      await rm(configPath, { force: true });
    });

    it("should throw for missing config file", async () => {
      await assert.rejects(
        registry.loadFromConfig("/nonexistent/path.json"),
        /ENOENT/
      );
    });
  });
});