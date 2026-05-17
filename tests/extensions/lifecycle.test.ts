import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import { loadExtensions } from "../../src/extensions/lifecycle.js";

describe("loadExtensions", () => {
  let root: string;

  it("loads all skills into a Map keyed by trigger or name", async () => {
    root = await mkdtemp(join(tmpdir(), "ext-lifecycle-"));
    await mkdir(join(root, "skill-tdd-skill"), { recursive: true });
    await writeFile(join(root, "skill-tdd-skill", "EXTENSION.yaml"), "name: tdd-skill\ntype: skill\nversion: 1.0.0\ndescription: TDD skill\ntrigger: /tdd");
    await mkdir(join(root, "skill-anon"), { recursive: true });
    await writeFile(join(root, "skill-anon", "EXTENSION.yaml"), "name: anon-skill\ntype: skill\nversion: 1.0.0\ndescription: Anonymous skill");

    const registry = new ExtensionRegistry(root);
    const result = loadExtensions(registry);
    assert.strictEqual(result.skills.size, 2);
    assert.ok(result.skills.has("/tdd"), "skill with trigger /tdd should be keyed by trigger");
    assert.ok(result.skills.has("anon-skill"), "skill without trigger should be keyed by name");
  });

  it("groups hooks by trigger", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-lifecycle2-"));
    await mkdir(join(store, "hook-pre-lint"), { recursive: true });
    await writeFile(join(store, "hook-pre-lint", "EXTENSION.yaml"), "name: pre-lint\ntype: hook\nversion: 1.0.0\ndescription: Pre lint\ntrigger: pre_task\ncommand: npm run lint");
    await mkdir(join(store, "hook-post-test"), { recursive: true });
    await writeFile(join(store, "hook-post-test", "EXTENSION.yaml"), "name: post-test\ntype: hook\nversion: 1.0.0\ndescription: Post test\ntrigger: post_task\ncommand: npm run test");
    await mkdir(join(store, "hook-on-change"), { recursive: true });
    await writeFile(join(store, "hook-on-change", "EXTENSION.yaml"), "name: on-change-hook\ntype: hook\nversion: 1.0.0\ndescription: On change\ntrigger: on_change\ncommand: echo changed");

    const registry = new ExtensionRegistry(store);
    const result = loadExtensions(registry);
    assert.strictEqual(result.hooks.get("pre_task")?.length, 1);
    assert.strictEqual(result.hooks.get("post_task")?.length, 1);
    assert.strictEqual(result.hooks.get("on_change")?.length, 1);
  });

  it("groups MCP and recipe and subagent extensions", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-lifecycle3-"));
    await mkdir(join(store, "mcp-github"), { recursive: true });
    await writeFile(join(store, "mcp-github", "EXTENSION.yaml"), "name: github\ntype: mcp\nversion: 1.0.0\ndescription: GitHub MCP\ntransport: stdio\ncommand: npx");
    await mkdir(join(store, "recipe-refactor"), { recursive: true });
    await writeFile(join(store, "recipe-refactor", "EXTENSION.yaml"), "name: refactor\ntype: recipe\nversion: 1.0.0\ndescription: Refactoring\nsteps:\n  - lint\n  - test");
    await mkdir(join(store, "subagent-reviewer"), { recursive: true });
    await writeFile(join(store, "subagent-reviewer", "EXTENSION.yaml"), "name: reviewer\ntype: subagent\nversion: 1.0.0\ndescription: Reviewer subagent\nreadonly: true");

    const registry = new ExtensionRegistry(store);
    const result = loadExtensions(registry);
    assert.strictEqual(result.mcp.size, 1);
    assert.ok(result.mcp.has("github"));
    assert.strictEqual(result.recipes.size, 1);
    assert.ok(result.recipes.has("refactor"));
    assert.strictEqual(result.subagents.size, 1);
    assert.ok(result.subagents.has("reviewer"));
  });

  it("returns empty maps when no extensions", async () => {
    const store = await mkdtemp(join(tmpdir(), "ext-lifecycle4-"));
    const registry = new ExtensionRegistry(store);
    const result = loadExtensions(registry);
    assert.strictEqual(result.skills.size, 0);
    assert.strictEqual(result.hooks.size, 3);  // always has 3 keys
    assert.strictEqual(result.hooks.get("pre_task")?.length, 0);
    assert.strictEqual(result.hooks.get("post_task")?.length, 0);
    assert.strictEqual(result.hooks.get("on_change")?.length, 0);
    assert.strictEqual(result.mcp.size, 0);
    assert.strictEqual(result.recipes.size, 0);
    assert.strictEqual(result.subagents.size, 0);
  });
});