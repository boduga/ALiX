import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ExtensionRegistry } from "../../src/extensions/registry.js";

describe("ExtensionRegistry", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ext-reg-"));
  });

  it("discovers extensions from a directory", async () => {
    await mkdir(join(root, "skill-my-skill"), { recursive: true });
    await writeFile(join(root, "skill-my-skill", "EXTENSION.yaml"), "name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: A skill\ntrigger: /my");
    await mkdir(join(root, "mcp-github-mcp"), { recursive: true });
    await writeFile(join(root, "mcp-github-mcp", "EXTENSION.yaml"), "name: github-mcp\ntype: mcp\nversion: 2.0.0\ndescription: GitHub MCP\ncommand: npx\nargs:\n  - -y\n  - @modelcontextprotocol/server-github");

    const registry = new ExtensionRegistry(root);
    const all = registry.list();
    assert.strictEqual(all.length, 2);
    assert.ok(all.some(e => e.manifest.name === "my-skill" && e.manifest.type === "skill"));
    assert.ok(all.some(e => e.manifest.name === "github-mcp" && e.manifest.type === "mcp"));
  });

  it("gets an extension by id", async () => {
    await mkdir(join(root, "skill-my-skill"), { recursive: true });
    await writeFile(join(root, "skill-my-skill", "EXTENSION.yaml"), "name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: A skill\ntrigger: /my");

    const registry = new ExtensionRegistry(root);
    const ext = registry.get("skill/my-skill");
    assert.ok(ext, "should find skill/my-skill");
    assert.strictEqual(ext?.manifest.type, "skill");
    assert.strictEqual((ext?.manifest as any).trigger, "/my");
  });

  it("returns undefined for unknown id", async () => {
    const registry = new ExtensionRegistry(root);
    assert.strictEqual(registry.get("skill/nonexistent"), undefined);
  });

  it("searches extensions by type", async () => {
    await mkdir(join(root, "skill-my-skill"), { recursive: true });
    await writeFile(join(root, "skill-my-skill", "EXTENSION.yaml"), "name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: A skill\ntrigger: /my");
    await mkdir(join(root, "mcp-github-mcp"), { recursive: true });
    await writeFile(join(root, "mcp-github-mcp", "EXTENSION.yaml"), "name: github-mcp\ntype: mcp\nversion: 2.0.0\ndescription: GitHub MCP\ncommand: npx\nargs:\n  - -y\n  - @modelcontextprotocol/server-github");

    const registry = new ExtensionRegistry(root);
    const skills = registry.list({ type: "skill" });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].manifest.name, "my-skill");
    const mcp = registry.list({ type: "mcp" });
    assert.strictEqual(mcp.length, 1);
    assert.strictEqual(mcp[0].manifest.name, "github-mcp");
  });

  it("searches extensions by tag", async () => {
    await mkdir(join(root, "skill-tagged"), { recursive: true });
    await writeFile(join(root, "skill-tagged", "EXTENSION.yaml"), "name: tagged\ntype: skill\nversion: 1.0.0\ndescription: Tagged\ntags:\n  - testing\n  - lint");

    const registry = new ExtensionRegistry(root);
    const tagged = registry.list({ tag: "testing" });
    assert.strictEqual(tagged.length, 1);
    assert.strictEqual(tagged[0].manifest.name, "tagged");
  });

  it("installs an extension from a source directory", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-store-"));
    const srcDir = join(root, "to-install");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "EXTENSION.yaml"), "name: to-install\ntype: skill\nversion: 1.0.0\ndescription: Will be installed\ntrigger: /install");

    const registry = new ExtensionRegistry(store);
    const installed = await registry.install(srcDir);
    assert.strictEqual(installed?.manifest.name, "to-install");
    const found = registry.get("skill/to-install");
    assert.ok(found, "should be found after install");
  });

  it("uninstalls an extension", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-store2-"));
    await mkdir(join(store, "hook-to-remove"), { recursive: true });
    await writeFile(join(store, "hook-to-remove", "EXTENSION.yaml"), "name: to-remove\ntype: hook\nversion: 1.0.0\ndescription: Will be removed\ntrigger: post_task\ncommand: echo removed");

    const registry = new ExtensionRegistry(store);
    const uninstalled = await registry.uninstall("hook/to-remove");
    assert.strictEqual(uninstalled, true);
    assert.strictEqual(registry.get("hook/to-remove"), undefined);
  });

  it("refuses to uninstall core extensions", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-store3-"));
    await mkdir(join(store, "skill-core"), { recursive: true });
    await writeFile(join(store, "skill-core", "EXTENSION.yaml"), "name: core\ntype: skill\nversion: 1.0.0\ndescription: Core skill\nis_core: true");

    const registry = new ExtensionRegistry(store);
    const uninstalled = await registry.uninstall("skill/core");
    assert.strictEqual(uninstalled, false);
    assert.ok(registry.get("skill/core"), "core extension should remain");
  });

  it("lists skills by trigger", async () => {
    await mkdir(join(root, "skill-my-skill"), { recursive: true });
    await writeFile(join(root, "skill-my-skill", "EXTENSION.yaml"), "name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: A skill\ntrigger: /my");

    const registry = new ExtensionRegistry(root);
    const byTrigger = registry.list({ trigger: "/my" });
    assert.strictEqual(byTrigger.length, 1);
    assert.strictEqual(byTrigger[0].manifest.name, "my-skill");
  });

  it("lists hooks by hookTrigger", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-hooks-"));
    await mkdir(join(store, "hook-pre"), { recursive: true });
    await writeFile(join(store, "hook-pre", "EXTENSION.yaml"), "name: pre-hook\ntype: hook\nversion: 1.0.0\ndescription: Pre task\ntrigger: pre_task\ncommand: echo pre");
    await mkdir(join(store, "hook-post"), { recursive: true });
    await writeFile(join(store, "hook-post", "EXTENSION.yaml"), "name: post-hook\ntype: hook\nversion: 1.0.0\ndescription: Post task\ntrigger: post_task\ncommand: echo post");

    const registry = new ExtensionRegistry(store);
    const pre = registry.list({ hookTrigger: "pre_task" });
    assert.strictEqual(pre.length, 1);
    assert.strictEqual((pre[0].manifest as any).trigger, "pre_task");
  });

  it("count returns the number of extensions", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-count-"));
    await mkdir(join(store, "skill-one"), { recursive: true });
    await writeFile(join(store, "skill-one", "EXTENSION.yaml"), "name: one\ntype: skill\nversion: 1.0.0\ndescription: One");
    const registry = new ExtensionRegistry(store);
    assert.strictEqual(registry.count(), 1);
  });

  it("handles directories without EXTENSION.yaml gracefully", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-skip-"));
    await mkdir(join(store, "just-files"), { recursive: true });
    await writeFile(join(store, "just-files", "README.md"), "# Not an extension");

    const registry = new ExtensionRegistry(store);
    assert.strictEqual(registry.count(), 0);
  });

  it("install fails gracefully without EXTENSION.yaml", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-install-fail-"));
    const noManifestDir = await mkdtemp(join(tmpdir(), "no-manifest-"));
    await writeFile(join(noManifestDir, "README.md"), "No extension here");

    const registry = new ExtensionRegistry(store);
    const installed = await registry.install(noManifestDir);
    assert.strictEqual(installed, null);
  });
});