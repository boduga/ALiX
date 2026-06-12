# M0.67 Tool Capability Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A searchable/retrievable tool registry that lets ALiX choose the right tool surface based on task intent, instead of stuffing every tool into every decision. Pure data layer — no execution changes.

**Architecture:** One new module in `src/tools/` — `ToolRegistry` (register/lookup/search tools by name, capabilityId, domain, risk), `CapabilityIndex` (tag tools by intent), and `ToolRetriever` (select relevant tools for a given task intent). Compatible with existing `CompositeToolRouter` and `ToolName` types. No runtime integration yet. Pure TypeScript, no I/O.

**Tech Stack:** TypeScript, existing `ToolRouter`/`ToolName`/`ToolArgs` types, `node:test`.

---

## File Structure

### Create
- `src/tools/tool-registry.ts` — `ToolRegistry`, `CapabilityIndex`, `ToolRetriever`
- `tests/tools/tool-registry.test.ts` — 15+ test cases

### Modify (none)
- No changes to existing ToolRouter, CompositeToolRouter, executor.ts, or PolicyGate.

---

### Task 1: Define tool capability metadata types

**Files:**
- Create: `src/tools/tool-registry.ts`

- [ ] **Step 1: Define the capability metadata types at the top of the file**

```typescript
/**
 * tool-registry.ts — Searchable tool capability index.
 *
 * Provides structured metadata for every tool so the system can select
 * the right tool surface based on task intent. Pure data — no execution.
 */

import type { ToolName } from "./types.js";

/**
 * Risk level for a tool capability. Used by PolicyGate and the
 * capability index to decide whether a tool requires approval.
 */
export type CapabilityRisk = "low" | "medium" | "high" | "critical";

/**
 * Domain category for a tool. Helps group tools by functional area.
 */
export type ToolDomain =
  | "filesystem"
  | "shell"
  | "network"
  | "code"
  | "search"
  | "agent"
  | "memory"
  | "policy"
  | "system"
  | "mcp";

/**
 * Tool capability descriptor.
 * Each tool has one canonical capability registered in the index.
 */
export type ToolCapability = {
  /** Canonical tool name (e.g. "file.read", "shell.run") */
  name: ToolName;

  /** Capability ID for policy enforcement (e.g. "filesystem.read", "shell.exec") */
  capabilityId: string;

  /** Human-readable description of what this tool does */
  description: string;

  /** Risk level for policy evaluation */
  risk: CapabilityRisk;

  /** Functional domain */
  domain: ToolDomain;

  /** Whether this tool can mutate state */
  mutates: boolean;

  /** Whether this tool should always be available (inject into every prompt) */
  alwaysInclude: boolean;

  /** Tags for intent-based retrieval */
  tags: string[];
};
```

---

### Task 2: Implement ToolRegistry

**Files:**
- Continue in: `src/tools/tool-registry.ts`

- [ ] **Step 1: Add the ToolRegistry class**

```typescript
/**
 * Registry of all available tool capabilities.
 * Tools are registered once at startup and looked up by name or capability.
 */
export class ToolRegistry {
  private tools = new Map<ToolName, ToolCapability>();

  /** Register a tool capability. Overwrites if already registered. */
  register(capability: ToolCapability): void {
    this.tools.set(capability.name, capability);
  }

  /** Look up a tool by its canonical name. Returns undefined if not found. */
  lookup(name: ToolName): ToolCapability | undefined {
    return this.tools.get(name);
  }

  /** Look up a tool by string name (safe for dynamic lookup). */
  lookupByName(name: string): ToolCapability | undefined {
    return this.tools.get(name as ToolName);
  }

  /** Get all registered tools. */
  getAll(): ToolCapability[] {
    return Array.from(this.tools.values());
  }

  /** Get tools matching a specific domain. */
  getByDomain(domain: ToolDomain): ToolCapability[] {
    return this.getAll().filter(t => t.domain === domain);
  }

  /** Get tools matching a specific risk level. */
  getByRisk(risk: CapabilityRisk): ToolCapability[] {
    return this.getAll().filter(t => t.risk === risk);
  }

  /** Get tools that mutate state. */
  getMutating(): ToolCapability[] {
    return this.getAll().filter(t => t.mutates);
  }

  /** Get tools that should always be included in prompts. */
  getEssential(): ToolCapability[] {
    return this.getAll().filter(t => t.alwaysInclude);
  }
}
```

- [ ] **Step 2: Add the CapabilityIndex class**

```typescript
/**
 * Intent-based tool tag index. Maps task intent keywords to tool names
 * so the retriever can select relevant tools without stuffing every tool
 * into every prompt.
 */
export type IntentTag = string;

export class CapabilityIndex {
  private tagToTools = new Map<IntentTag, ToolName[]>();

  /** Index a tool's tags. Call after registering in ToolRegistry. */
  index(capability: ToolCapability): void {
    for (const tag of capability.tags) {
      const existing = this.tagToTools.get(tag) ?? [];
      if (!existing.includes(capability.name)) {
        existing.push(capability.name);
        this.tagToTools.set(tag, existing);
      }
    }
  }

  /** Find tools that match a given tag. Returns empty array if none. */
  findByTag(tag: IntentTag): ToolName[] {
    return this.tagToTools.get(tag) ?? [];
  }

  /** Find tools matching any of the given tags. */
  findByTags(tags: IntentTag[]): ToolName[] {
    const results = new Set<ToolName>();
    for (const tag of tags) {
      for (const tool of this.findByTag(tag)) {
        results.add(tool);
      }
    }
    return Array.from(results);
  }

  /** Get all known tags. */
  getAllTags(): IntentTag[] {
    return Array.from(this.tagToTools.keys());
  }
}
```

- [ ] **Step 3: Build the default tool index**

After the classes, add a factory function that registers all built-in tools:

```typescript
/**
 * Build the default tool index with all built-in ALiX tools.
 * Returns a { registry, index } pair ready for use.
 */
export function buildDefaultToolIndex(): { registry: ToolRegistry; index: CapabilityIndex } {
  const registry = new ToolRegistry();
  const idx = new CapabilityIndex();

  const defaults: ToolCapability[] = [
    { name: "file.read", capabilityId: "filesystem.read", description: "Read the contents of a file", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: ["read", "file", "code", "config"] },
    { name: "file.create", capabilityId: "filesystem.write", description: "Create or overwrite a file", risk: "medium", domain: "filesystem", mutates: true, alwaysInclude: false, tags: ["write", "file", "create"] },
    { name: "file.delete", capabilityId: "filesystem.write", description: "Delete a file", risk: "high", domain: "filesystem", mutates: true, alwaysInclude: false, tags: ["delete", "file", "remove"] },
    { name: "file.exists", capabilityId: "filesystem.read", description: "Check if a file exists", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: false, tags: ["read", "file", "check"] },
    { name: "dir.search", capabilityId: "file.search", description: "Search directory for files matching a pattern", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: ["search", "file", "directory", "code"] },
    { name: "shell.run", capabilityId: "shell.exec", description: "Execute a shell command", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: ["shell", "command", "run", "execute"] },
    { name: "patch.apply", capabilityId: "code.patch", description: "Apply a structured patch to the codebase", risk: "high", domain: "code", mutates: true, alwaysInclude: false, tags: ["patch", "code", "edit", "modify"] },
    { name: "done", capabilityId: "task.complete", description: "Signal that the task is complete", risk: "low", domain: "system", mutates: false, alwaysInclude: true, tags: ["done", "complete", "finish"] },
  ];

  for (const cap of defaults) {
    registry.register(cap);
    idx.index(cap);
  }

  return { registry, index };
}
```

- [ ] **Step 4: Add the ToolRetriever class**

```typescript
/**
 * Selects relevant tools for a given task intent.
 * Returns tools that match by tag, with essential tools always included.
 */
export class ToolRetriever {
  constructor(
    private registry: ToolRegistry,
    private index: CapabilityIndex,
  ) {}

  /**
   * Select tools relevant to the given intent keywords.
   * Always includes essential tools (alwaysInclude: true).
   * Adds tools matching any of the intent tags.
   */
  selectForIntent(intentKeywords: string[]): ToolCapability[] {
    const selected = new Map<ToolName, ToolCapability>();

    // Always include essential tools
    for (const tool of this.registry.getEssential()) {
      selected.set(tool.name, tool);
    }

    // Add tools matching intent tags
    const matched = this.index.findByTags(intentKeywords);
    for (const name of matched) {
      const tool = this.registry.lookup(name);
      if (tool) selected.set(tool.name, tool);
    }

    return Array.from(selected.values());
  }

  /**
   * Select tools for a given domain only.
   * Useful for narrowing scope (e.g. "only filesystem tools").
   */
  selectForDomain(domain: ToolDomain): ToolCapability[] {
    return this.registry.getByDomain(domain);
  }
}
```

---

### Task 3: Write tests

**Files:**
- Create: `tests/tools/tool-registry.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, CapabilityIndex, ToolRetriever, buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { ToolCapability, ToolDomain, CapabilityRisk, IntentTag } from "../../src/tools/tool-registry.js";

describe("ToolRegistry", () => {
  it("register and lookup a tool", () => {
    const registry = new ToolRegistry();
    const tool: ToolCapability = { name: "file.read", capabilityId: "filesystem.read", description: "Read a file", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: ["read"] };
    registry.register(tool);
    assert.equal(registry.lookup("file.read")?.name, "file.read");
    assert.equal(registry.lookupByName("file.read")?.capabilityId, "filesystem.read");
  });

  it("lookup returns undefined for unknown tool", () => {
    const registry = new ToolRegistry();
    assert.equal(registry.lookup("file.read" as any), undefined);
    assert.equal(registry.lookupByName("nonexistent"), undefined);
  });

  it("getAll returns all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: [] });
    registry.register({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: [] });
    assert.equal(registry.getAll().length, 2);
  });

  it("getByDomain filters correctly", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: [] });
    registry.register({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: [] });
    assert.equal(registry.getByDomain("filesystem").length, 1);
    assert.equal(registry.getByDomain("filesystem")[0].name, "file.read");
  });

  it("getByRisk filters correctly", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: [] });
    registry.register({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: [] });
    assert.equal(registry.getByRisk("high").length, 1);
  });

  it("getMutating returns only mutating tools", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: [] });
    registry.register({ name: "file.create", description: "Create", risk: "medium", domain: "filesystem", mutates: true, alwaysInclude: false, tags: [] });
    const mutating = registry.getMutating();
    assert.equal(mutating.length, 1);
    assert.equal(mutating[0].name, "file.create");
  });

  it("getEssential returns always-include tools", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: [] });
    registry.register({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: [] });
    assert.equal(registry.getEssential().length, 1);
  });
});

describe("CapabilityIndex", () => {
  it("findByTag returns tools with that tag", () => {
    const idx = new CapabilityIndex();
    idx.index({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: ["read", "file"] });
    idx.index({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: ["shell", "run"] });
    assert.ok(idx.findByTag("read").includes("file.read"));
    assert.ok(!idx.findByTag("read").includes("shell.run"));
  });

  it("findByTags unions results from multiple tags", () => {
    const idx = new CapabilityIndex();
    idx.index({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: ["read", "file"] });
    idx.index({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: ["shell", "run"] });
    idx.index({ name: "file.create", description: "Create", risk: "medium", domain: "filesystem", mutates: true, alwaysInclude: false, tags: ["write", "file"] });
    const results = idx.findByTags(["read", "write"]);
    assert.ok(results.includes("file.read"));
    assert.ok(results.includes("file.create"));
    assert.ok(!results.includes("shell.run"));
  });

  it("getAllTags returns all known tags", () => {
    const idx = new CapabilityIndex();
    idx.index({ name: "file.read", description: "Read", risk: "low", domain: "filesystem", mutates: false, alwaysInclude: true, tags: ["read", "file"] });
    idx.index({ name: "shell.run", description: "Shell", risk: "high", domain: "shell", mutates: true, alwaysInclude: false, tags: ["shell"] });
    assert.ok(idx.getAllTags().includes("read"));
    assert.ok(idx.getAllTags().includes("shell"));
    assert.equal(idx.getAllTags().length, 3); // read, file, shell
  });

  it("findByTag returns empty array for unknown tag", () => {
    const idx = new CapabilityIndex();
    assert.deepEqual(idx.findByTag("nonexistent"), []);
  });
});

describe("ToolRetriever", () => {
  it("selectForIntent includes essential tools plus tag matches", () => {
    const { registry, index } = buildDefaultToolIndex();
    const retriever = new ToolRetriever(registry, index);
    const tools = retriever.selectForIntent(["shell", "command"]);
    // Essential: file.read, dir.search, done
    // Tag match: shell.run
    assert.ok(tools.some(t => t.name === "file.read"), "must include essential file.read");
    assert.ok(tools.some(t => t.name === "shell.run"), "must include tag-matched shell.run");
    assert.ok(tools.some(t => t.name === "done"), "must include essential done");
  });

  it("selectForIntent with write tags returns write tools", () => {
    const { registry, index } = buildDefaultToolIndex();
    const retriever = new ToolRetriever(registry, index);
    const tools = retriever.selectForIntent(["write", "edit"]);
    assert.ok(tools.some(t => t.name === "file.create"), "must include file.create for write intent");
  });

  it("selectForDomain returns tools in that domain", () => {
    const { registry, index } = buildDefaultToolIndex();
    const retriever = new ToolRetriever(registry, index);
    const tools = retriever.selectForDomain("filesystem");
    assert.ok(tools.length >= 3, "must include multiple filesystem tools");
    assert.ok(tools.every(t => t.domain === "filesystem"), "all must be filesystem domain");
  });

  it("selectForDomain returns empty for unknown domain", () => {
    const { registry, index } = buildDefaultToolIndex();
    const retriever = new ToolRetriever(registry, index);
    const tools = retriever.selectForDomain("mcp" as any);
    assert.equal(tools.length, 0);
  });
});

describe("buildDefaultToolIndex", () => {
  it("registers all built-in tools", () => {
    const { registry, index } = buildDefaultToolIndex();
    assert.equal(registry.getAll().length, 8);
    assert.ok(registry.lookup("file.read"));
    assert.ok(registry.lookup("shell.run"));
    assert.ok(registry.lookup("done"));
  });

  it("indexes all tags from default tools", () => {
    const { registry, index } = buildDefaultToolIndex();
    const allTags = index.getAllTags();
    assert.ok(allTags.length > 5, "should have many tags");
    assert.ok(allTags.includes("read"));
    assert.ok(allTags.includes("write"));
    assert.ok(allTags.includes("shell"));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run build && node --test dist/tests/tools/tool-registry.test.js
```

Expected: 18/18 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tools/tool-registry.test.js` — 18/18 pass
3. Full suite — no regressions (no existing files changed)
4. Git diff shows only the 2 intended files
5. No changes to executor.ts, PolicyGate, or any existing tool router
