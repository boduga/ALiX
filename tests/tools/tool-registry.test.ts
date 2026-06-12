import test from "node:test";
import assert from "node:assert/strict";
import {
  ToolRegistry,
  CapabilityIndex,
  ToolRetriever,
  buildDefaultToolIndex,
  type ToolCapability,
  type ToolDomain,
} from "../../src/tools/tool-registry.js";

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

test("ToolRegistry.register and lookup", () => {
  const registry = new ToolRegistry();
  const cap: ToolCapability = {
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read file contents",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: true,
    tags: ["read", "file"],
  };

  registry.register(cap);
  const result = registry.lookup("file.read");
  assert.notStrictEqual(result, undefined);
  assert.strictEqual(result!.name, "file.read");
  assert.strictEqual(result!.description, "Read file contents");
  assert.strictEqual(result!.risk, "low");
  assert.strictEqual(result!.domain, "filesystem");
  assert.strictEqual(result!.mutates, false);
  assert.strictEqual(result!.alwaysInclude, true);
  assert.deepStrictEqual(result!.tags, ["read", "file"]);
});

test("ToolRegistry.lookupByName returns capability for plain string", () => {
  const registry = new ToolRegistry();
  const cap: ToolCapability = {
    name: "shell.run",
    capabilityId: "shell.exec",
    description: "Execute a shell command",
    risk: "high",
    domain: "shell",
    mutates: true,
    alwaysInclude: false,
    tags: ["shell"],
  };
  registry.register(cap);

  const result = registry.lookupByName("shell.run");
  assert.notStrictEqual(result, undefined);
  assert.strictEqual(result!.name, "shell.run");
});

test("ToolRegistry.lookup returns undefined for unknown name", () => {
  const registry = new ToolRegistry();
  assert.strictEqual(registry.lookup("file.read" as any), undefined);
});

test("ToolRegistry.getAll returns all registered tools", () => {
  const registry = new ToolRegistry();
  assert.strictEqual(registry.getAll().length, 0);

  registry.register({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: [],
  });
  registry.register({
    name: "done",
    capabilityId: "task.complete",
    description: "Done",
    risk: "low",
    domain: "system",
    mutates: false,
    alwaysInclude: false,
    tags: [],
  });

  assert.strictEqual(registry.getAll().length, 2);
});

test("ToolRegistry.getByDomain filters correctly", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: [],
  });
  registry.register({
    name: "shell.run",
    capabilityId: "shell.exec",
    description: "Run",
    risk: "high",
    domain: "shell",
    mutates: true,
    alwaysInclude: false,
    tags: [],
  });

  const fsTools = registry.getByDomain("filesystem");
  assert.strictEqual(fsTools.length, 1);
  assert.strictEqual(fsTools[0].name, "file.read");

  const shellTools = registry.getByDomain("shell");
  assert.strictEqual(shellTools.length, 1);
  assert.strictEqual(shellTools[0].name, "shell.run");
});

test("ToolRegistry.getByRisk filters correctly", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: [],
  });
  registry.register({
    name: "file.delete",
    capabilityId: "filesystem.write",
    description: "Delete",
    risk: "high",
    domain: "filesystem",
    mutates: true,
    alwaysInclude: false,
    tags: [],
  });

  const high = registry.getByRisk("high");
  assert.strictEqual(high.length, 1);
  assert.strictEqual(high[0].name, "file.delete");

  const low = registry.getByRisk("low");
  // "file.read" and potentially others; assert at least 1
  assert.ok(low.length >= 1);
  assert.ok(low.some(t => t.name === "file.read"));
});

test("ToolRegistry.getMutating returns only mutating tools", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: [],
  });
  registry.register({
    name: "file.create",
    capabilityId: "filesystem.write",
    description: "Create",
    risk: "medium",
    domain: "filesystem",
    mutates: true,
    alwaysInclude: false,
    tags: [],
  });
  registry.register({
    name: "patch.apply",
    capabilityId: "code.patch",
    description: "Patch",
    risk: "high",
    domain: "code",
    mutates: true,
    alwaysInclude: false,
    tags: [],
  });

  const mutating = registry.getMutating();
  assert.strictEqual(mutating.length, 2);
  assert.ok(mutating.every(t => t.mutates));
  assert.ok(mutating.some(t => t.name === "file.create"));
  assert.ok(mutating.some(t => t.name === "patch.apply"));
});

test("ToolRegistry.getEssential returns only alwaysInclude tools", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: true,
    tags: [],
  });
  registry.register({
    name: "file.create",
    capabilityId: "filesystem.write",
    description: "Create",
    risk: "medium",
    domain: "filesystem",
    mutates: true,
    alwaysInclude: false,
    tags: [],
  });
  registry.register({
    name: "done",
    capabilityId: "task.complete",
    description: "Done",
    risk: "low",
    domain: "system",
    mutates: false,
    alwaysInclude: true,
    tags: [],
  });

  const essential = registry.getEssential();
  assert.strictEqual(essential.length, 2);
  assert.ok(essential.every(t => t.alwaysInclude));
  assert.ok(essential.some(t => t.name === "file.read"));
  assert.ok(essential.some(t => t.name === "done"));
});

// ---------------------------------------------------------------------------
// CapabilityIndex
// ---------------------------------------------------------------------------

test("CapabilityIndex.findByTag returns tools for a tag", () => {
  const idx = new CapabilityIndex();
  idx.index({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: ["read", "file"],
  });

  const readTools = idx.findByTag("read");
  assert.deepStrictEqual(readTools, ["file.read"]);

  const fileTools = idx.findByTag("file");
  assert.deepStrictEqual(fileTools, ["file.read"]);
});

test("CapabilityIndex.findByTags returns union of tags", () => {
  const idx = new CapabilityIndex();
  idx.index({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: ["read", "file"],
  });
  idx.index({
    name: "file.delete",
    capabilityId: "filesystem.write",
    description: "Delete",
    risk: "high",
    domain: "filesystem",
    mutates: true,
    alwaysInclude: false,
    tags: ["delete", "file"],
  });

  const tools = idx.findByTags(["read", "delete"]);
  assert.strictEqual(tools.length, 2);
  assert.ok(tools.includes("file.read"));
  assert.ok(tools.includes("file.delete"));
});

test("CapabilityIndex.getAllTags returns all registered tags", () => {
  const idx = new CapabilityIndex();
  idx.index({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: ["read", "file"],
  });

  const tags = idx.getAllTags();
  assert.strictEqual(tags.length, 2);
  assert.ok(tags.includes("read"));
  assert.ok(tags.includes("file"));
});

test("CapabilityIndex.findByTag returns empty array for unknown tag", () => {
  const idx = new CapabilityIndex();
  idx.index({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: false,
    tags: ["read"],
  });

  const result = idx.findByTag("nonexistent");
  assert.deepStrictEqual(result, []);
});

// ---------------------------------------------------------------------------
// ToolRetriever
// ---------------------------------------------------------------------------

test("ToolRetriever.selectForIntent includes essential tools plus tag matches", () => {
  const registry = new ToolRegistry();
  const idx = new CapabilityIndex();

  // Register one essential tool and one non-essential tagged tool
  registry.register({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: true,
    tags: ["read", "file"],
  });
  registry.register({
    name: "shell.run",
    capabilityId: "shell.exec",
    description: "Shell",
    risk: "high",
    domain: "shell",
    mutates: true,
    alwaysInclude: false,
    tags: ["shell", "command"],
  });

  idx.index({
    name: "file.read",
    capabilityId: "filesystem.read",
    description: "Read",
    risk: "low",
    domain: "filesystem",
    mutates: false,
    alwaysInclude: true,
    tags: ["read", "file"],
  });
  idx.index({
    name: "shell.run",
    capabilityId: "shell.exec",
    description: "Shell",
    risk: "high",
    domain: "shell",
    mutates: true,
    alwaysInclude: false,
    tags: ["shell", "command"],
  });

  const retriever = new ToolRetriever(registry, idx);

  // Select with intent "shell" -- should return essential (file.read) + matched (shell.run)
  const result = retriever.selectForIntent(["shell"]);
  assert.strictEqual(result.length, 2);
  assert.ok(result.some(t => t.name === "file.read"));
  assert.ok(result.some(t => t.name === "shell.run"));
});

test("ToolRetriever.selectForIntent with write tags returns write-related tools", () => {
  const { registry, index } = buildDefaultToolIndex();
  const retriever = new ToolRetriever(registry, index);

  const result = retriever.selectForIntent(["write", "create"]);

  // Should include essential tools (file.read, dir.search, done) plus write-related tools
  assert.ok(result.some(t => t.name === "file.read"));
  assert.ok(result.some(t => t.name === "file.create"));
  assert.ok(result.some(t => t.name === "dir.search"));
  assert.ok(result.some(t => t.name === "done"));
});

test("ToolRetriever.selectForDomain returns tools in the given domain", () => {
  const { registry, index } = buildDefaultToolIndex();
  const retriever = new ToolRetriever(registry, index);

  const fsTools = retriever.selectForDomain("filesystem");
  assert.strictEqual(fsTools.length, 5);
  assert.ok(fsTools.every(t => t.domain === "filesystem"));

  const systemTools = retriever.selectForDomain("system");
  assert.strictEqual(systemTools.length, 1);
  assert.strictEqual(systemTools[0].name, "done");
});

test("ToolRetriever.selectForDomain returns empty array when domain has no tools", () => {
  const { registry, index } = buildDefaultToolIndex();
  const retriever = new ToolRetriever(registry, index);

  const networkTools = retriever.selectForDomain("network" as ToolDomain);
  assert.deepStrictEqual(networkTools, []);
});

// ---------------------------------------------------------------------------
// buildDefaultToolIndex
// ---------------------------------------------------------------------------

test("buildDefaultToolIndex registers 8 tools", () => {
  const { registry } = buildDefaultToolIndex();
  const all = registry.getAll();
  assert.strictEqual(all.length, 8);

  const names = all.map(t => t.name).sort();
  assert.deepStrictEqual(names, [
    "dir.search",
    "done",
    "file.create",
    "file.delete",
    "file.exists",
    "file.read",
    "patch.apply",
    "shell.run",
  ]);
});

test("buildDefaultToolIndex indexes all tags", () => {
  const { index } = buildDefaultToolIndex();
  const tags = index.getAllTags();

  // Verify all expected tags are present
  const expectedTags = [
    "check", "code", "command", "complete", "config",
    "create", "delete", "directory", "done", "edit",
    "execute", "file", "finish", "modify", "patch",
    "read", "remove", "run", "search", "shell",
    "write",
  ];
  for (const tag of expectedTags) {
    assert.ok(tags.includes(tag), `Expected tag "${tag}" to be indexed`);
  }

  assert.strictEqual(tags.length, expectedTags.length);
});
