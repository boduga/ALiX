import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExtensionManifest, getExtensionId, isCoreExtension, EXTENSION_TYPES } from "../../src/extensions/manifest.js";

describe("parseExtensionManifest", () => {
  it("parses a skill extension", () => {
    const yaml = `name: test-skill\ntype: skill\nversion: 1.0.0\ndescription: A test skill\ntrigger: /test`;
    const manifest = parseExtensionManifest(yaml, "skill");
    assert.strictEqual(manifest?.name, "test-skill");
    assert.strictEqual(manifest?.type, "skill");
    assert.strictEqual(manifest?.version, "1.0.0");
    assert.strictEqual((manifest as any).trigger, "/test");
  });

  it("parses an MCP extension", () => {
    const yaml = `name: github-mcp\ntype: mcp\nversion: 2.0.0\ndescription: GitHub MCP server\ncommand: npx\nargs:\n  - -y\n  - "@modelcontextprotocol/server-github"`;
    const manifest = parseExtensionManifest(yaml, "mcp");
    assert.strictEqual(manifest?.type, "mcp");
    assert.strictEqual((manifest as any).command, "npx");
    assert.deepStrictEqual((manifest as any).args, ["-y", "@modelcontextprotocol/server-github"]);
  });

  it("parses a hook extension", () => {
    const yaml = `name: pre-commit-lint\ntype: hook\nversion: 1.0.0\ndescription: Run lint on pre-task\ntrigger: pre_task\ncommand: npm run lint`;
    const manifest = parseExtensionManifest(yaml, "hook");
    assert.strictEqual(manifest?.type, "hook");
    assert.strictEqual((manifest as any).trigger, "pre_task");
    assert.strictEqual((manifest as any).command, "npm run lint");
  });

  it("parses a recipe extension", () => {
    const yaml = `name: refactor-recipe\ntype: recipe\nversion: 1.0.0\ndescription: Refactoring workflow`;
    const manifest = parseExtensionManifest(yaml, "recipe");
    assert.strictEqual(manifest?.type, "recipe");
  });

  it("parses a subagent extension", () => {
    const yaml = `name: code-reviewer\ntype: subagent\nversion: 1.0.0\ndescription: Code reviewer subagent\nreadonly: true`;
    const manifest = parseExtensionManifest(yaml, "subagent");
    assert.strictEqual(manifest?.type, "subagent");
    assert.strictEqual((manifest as any).readonly, true);
  });

  it("returns null for invalid manifest", () => {
    const manifest = parseExtensionManifest("invalid: yaml", "skill");
    assert.strictEqual(manifest, null);
  });

  it("returns null for missing name", () => {
    const manifest = parseExtensionManifest("description: no name\ntype: skill", "skill");
    assert.strictEqual(manifest, null);
  });

  it("getExtensionId returns namespaced id", () => {
    const yaml = `name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: Desc`;
    const manifest = parseExtensionManifest(yaml, "skill")!;
    assert.strictEqual(getExtensionId(manifest), "skill/my-skill");
  });

  it("isCoreExtension returns true for core extensions", () => {
    const yaml = `name: core-skill\ntype: skill\nversion: 1.0.0\ndescription: Core skill\nis_core: true`;
    const manifest = parseExtensionManifest(yaml, "skill")!;
    assert.strictEqual(isCoreExtension(manifest), true);
  });

  it("isCoreExtension returns false for non-core extensions", () => {
    const yaml = `name: user-skill\ntype: skill\nversion: 1.0.0\ndescription: User skill`;
    const manifest = parseExtensionManifest(yaml, "skill")!;
    assert.strictEqual(isCoreExtension(manifest), false);
  });

  it("EXTENSION_TYPES includes all five types", () => {
    assert.deepStrictEqual(EXTENSION_TYPES, ["skill", "hook", "mcp", "recipe", "subagent"]);
  });
});
