# Tool Schema Explosion Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ToolCatalog, ToolProvenanceTracker, and MetaToolExecutor per research spec. Enable lazy tool loading and category-based selection.

**Architecture:** Build on existing ToolSelector, ToolDiscovery, and SchemaCache. Add provenance tracking to event log and category-based tool catalog.

**Tech Stack:** TypeScript, existing MCP tools, event log

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/mcp/tool-catalog.ts` | Categorized tool registry |
| `src/mcp/provenance.ts` | Track tool source and trust level |
| `src/mcp/meta-tool.ts` | Meta-tool for tool discovery and invocation |
| `tests/mcp/tool-catalog.test.ts` | Tool catalog tests |
| `tests/mcp/provenance.test.ts` | Provenance tracking tests |

---

## Task 1: Add ToolCatalog with Category Grouping

**Files:**
- Create: `src/mcp/tool-catalog.ts`
- Test: `tests/mcp/tool-catalog.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolCatalog, type ToolCategory } from "../../src/mcp/tool-catalog.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

describe("ToolCatalog", () => {
  it("groups tools by category", () => {
    const catalog = new ToolCatalog();
    catalog.register({
      name: "file.read",
      description: "Read a file",
      serverName: "filesystem",
      category: "file",
      capabilities: ["file.read"],
      trustLevel: "builtin",
    } as unknown as DeferredToolEntry);
    
    catalog.register({
      name: "shell.run",
      description: "Run a shell command",
      serverName: "shell",
      category: "shell",
      capabilities: ["shell.run"],
      trustLevel: "builtin",
    } as unknown as DeferredToolEntry);
    
    const categories = catalog.listCategories();
    assert.ok(categories.includes("file"));
    assert.ok(categories.includes("shell"));
  });

  it("filters by category", () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: "file.read", serverName: "fs", category: "file" } as unknown as DeferredToolEntry);
    catalog.register({ name: "shell.run", serverName: "sh", category: "shell" } as unknown as DeferredToolEntry);
    
    const fileTools = catalog.byCategory("file");
    assert.equal(fileTools.length, 1);
    assert.equal(fileTools[0].name, "file.read");
  });

  it("filters by trust level", () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: "builtin_tool", serverName: "core", trustLevel: "builtin" } as unknown as DeferredToolEntry);
    catalog.register({ name: "remote_tool", serverName: "remote", trustLevel: "remote" } as unknown as DeferredToolEntry);
    
    const trusted = catalog.byTrustLevel("builtin");
    assert.equal(trusted.length, 1);
    assert.equal(trusted[0].name, "builtin_tool");
  });

  it("lists all available tool names", () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: "file.read", serverName: "fs", category: "file" } as unknown as DeferredToolEntry);
    catalog.register({ name: "file.write", serverName: "fs", category: "file" } as unknown as DeferredToolEntry);
    
    const names = catalog.listToolNames();
    assert.ok(names.includes("file.read"));
    assert.ok(names.includes("file.write"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mcp/tool-catalog.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement ToolCatalog**

```typescript
// src/mcp/tool-catalog.ts

import type { DeferredToolEntry } from "./tool-deferral.js";

export type ToolCategory = 
  | "file" 
  | "shell" 
  | "git" 
  | "network" 
  | "browser" 
  | "mcp" 
  | "custom";

export type TrustLevel = "builtin" | "project" | "user" | "remote";

export type ToolDescriptor = {
  tool: DeferredToolEntry;
  category: ToolCategory;
  capabilities: string[];
  trustLevel: TrustLevel;
  registeredAt: string;
};

export type CatalogOptions = {
  includeCategories?: ToolCategory[];
  excludeCategories?: ToolCategory[];
  requireApproval?: TrustLevel[];
};

const DEFAULT_CATEGORIES: ToolCategory[] = ["file", "shell", "git", "network", "browser", "mcp", "custom"];

function inferCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();
  if (name.includes("file") || name.includes("read") || name.includes("write")) return "file";
  if (name.includes("shell") || name.includes("exec") || name.includes("run")) return "shell";
  if (name.includes("git")) return "git";
  if (name.includes("http") || name.includes("fetch") || name.includes("network")) return "network";
  if (name.includes("browser") || name.includes("web")) return "browser";
  if (name.includes("mcp_")) return "mcp";
  return "custom";
}

function inferTrustLevel(serverName: string): TrustLevel {
  if (["builtin", "filesystem", "shell", "git"].includes(serverName)) return "builtin";
  if (serverName.includes("project")) return "project";
  return "remote";
}

export class ToolCatalog {
  private descriptors: Map<string, ToolDescriptor> = new Map();

  register(tool: DeferredToolEntry & { category?: ToolCategory; trustLevel?: TrustLevel }): void {
    const name = tool.name;
    const category = tool.category ?? inferCategory(name);
    const trustLevel = tool.trustLevel ?? inferTrustLevel(tool.serverName);
    
    this.descriptors.set(name, {
      tool,
      category,
      capabilities: [name],
      trustLevel,
      registeredAt: new Date().toISOString(),
    });
  }

  listCategories(): ToolCategory[] {
    const cats = new Set<ToolCategory>();
    for (const d of this.descriptors.values()) {
      cats.add(d.category);
    }
    return [...cats];
  }

  byCategory(category: ToolCategory): DeferredToolEntry[] {
    return [...this.descriptors.values()]
      .filter(d => d.category === category)
      .map(d => d.tool);
  }

  byTrustLevel(level: TrustLevel): DeferredToolEntry[] {
    return [...this.descriptors.values()]
      .filter(d => d.trustLevel === level)
      .map(d => d.tool);
  }

  byCategories(categories: ToolCategory[]): DeferredToolEntry[] {
    return [...this.descriptors.values()]
      .filter(d => categories.includes(d.category))
      .map(d => d.tool);
  }

  listToolNames(): string[] {
    return [...this.descriptors.keys()];
  }

  getDescriptor(name: string): ToolDescriptor | undefined {
    return this.descriptors.get(name);
  }

  filter(options: CatalogOptions): DeferredToolEntry[] {
    let tools = [...this.descriptors.values()].map(d => d.tool);

    if (options.includeCategories?.length) {
      tools = tools.filter(t => {
        const d = this.descriptors.get(t.name);
        return d && options.includeCategories!.includes(d.category);
      });
    }

    if (options.excludeCategories?.length) {
      tools = tools.filter(t => {
        const d = this.descriptors.get(t.name);
        return d && !options.excludeCategories!.includes(d.category);
      });
    }

    if (options.requireApproval?.length) {
      tools = tools.filter(t => {
        const d = this.descriptors.get(t.name);
        return d && options.requireApproval!.includes(d.trustLevel);
      });
    }

    return tools;
  }

  get size(): number {
    return this.descriptors.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mcp/tool-catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool-catalog.ts tests/mcp/tool-catalog.test.ts
git commit -m "feat(mcp): add ToolCatalog with category grouping"
```

---

## Task 2: Add ToolProvenanceTracker

**Files:**
- Create: `src/mcp/provenance.ts`
- Test: `tests/mcp/provenance.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolProvenanceTracker, type ProvenanceEntry } from "../../src/mcp/provenance.js";

describe("ToolProvenanceTracker", () => {
  it("tracks tool source", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin", invokedAt: new Date().toISOString() });
    
    const provenance = tracker.getProvenance("file.read");
    assert.ok(provenance);
    assert.equal(provenance?.source, "builtin");
  });

  it("records invocation count", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });
    tracker.record("file.read", { source: "builtin" });
    tracker.record("file.read", { source: "builtin" });
    
    const provenance = tracker.getProvenance("file.read");
    assert.equal(provenance?.invocationCount, 3);
  });

  it("exports for event logging", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });
    
    const exportData = tracker.exportForEvent();
    assert.ok(Array.isArray(exportData));
    assert.ok(exportData.some(e => e.toolName === "file.read"));
  });

  it("clears session data", () => {
    const tracker = new ToolProvenanceTracker();
    tracker.record("file.read", { source: "builtin" });
    
    tracker.clearSession();
    const provenance = tracker.getProvenance("file.read");
    assert.equal(provenance?.invocationCount, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mcp/provenance.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ToolProvenanceTracker**

```typescript
// src/mcp/provenance.ts

import type { TrustLevel } from "./tool-catalog.js";

export type ProvenanceEntry = {
  toolName: string;
  source: "builtin" | "mcp" | "plugin" | "user";
  trustLevel: TrustLevel;
  invocationCount: number;
  lastInvokedAt?: string;
  createdAt: string;
  sessionId: string;
};

export type ProvenanceExport = {
  toolName: string;
  source: string;
  trustLevel: TrustLevel;
  invocationCount: number;
  sessionId: string;
};

export class ToolProvenanceTracker {
  private provenance = new Map<string, ProvenanceEntry>();
  private _sessionId: string;

  constructor(sessionId?: string) {
    this._sessionId = sessionId ?? `session_${Date.now()}`;
  }

  record(
    toolName: string, 
    info: { source: ProvenanceEntry["source"]; trustLevel?: TrustLevel }
  ): void {
    const existing = this.provenance.get(toolName);
    
    if (existing) {
      existing.invocationCount++;
      existing.lastInvokedAt = new Date().toISOString();
    } else {
      this.provenance.set(toolName, {
        toolName,
        source: info.source,
        trustLevel: info.trustLevel ?? "builtin",
        invocationCount: 1,
        createdAt: new Date().toISOString(),
        sessionId: this._sessionId,
      });
    }
  }

  getProvenance(toolName: string): ProvenanceEntry | undefined {
    return this.provenance.get(toolName);
  }

  getAllProvenance(): ProvenanceEntry[] {
    return [...this.provenance.values()];
  }

  exportForEvent(): ProvenanceExport[] {
    return [...this.provenance.values()].map(p => ({
      toolName: p.toolName,
      source: p.source,
      trustLevel: p.trustLevel,
      invocationCount: p.invocationCount,
      sessionId: p.sessionId,
    }));
  }

  get sessionId(): string {
    return this._sessionId;
  }

  clearSession(): void {
    for (const entry of this.provenance.values()) {
      entry.invocationCount = 0;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mcp/provenance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/provenance.ts tests/mcp/provenance.test.ts
git commit -m "feat(mcp): add ToolProvenanceTracker for tool audit trail"
```

---

## Task 3: Add MetaToolExecutor

**Files:**
- Create: `src/mcp/meta-tool.ts`
- Test: `tests/mcp/meta-tool.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { MetaToolExecutor, type MetaToolCommand } from "../../src/mcp/meta-tool.js";

describe("MetaToolExecutor", () => {
  it("executes catalog.list command", async () => {
    const executor = new MetaToolExecutor({
      catalog: { listCategories: () => ["file", "shell"] } as any,
    });
    
    const result = await executor.execute({
      command: "catalog.list",
      args: {},
    });
    
    assert.ok(result.includes("file"));
    assert.ok(result.includes("shell"));
  });

  it("executes tools.search command", async () => {
    const executor = new MetaToolExecutor({
      discovery: { search: async (q: string) => ({ kind: "success", output: `Found: ${q}` }) } as any,
    });
    
    const result = await executor.execute({
      command: "tools.search",
      args: { query: "file" },
    });
    
    assert.ok(result.includes("file"));
  });

  it("rejects unknown commands", async () => {
    const executor = new MetaToolExecutor({} as any);
    
    try {
      await executor.execute({
        command: "unknown.command",
        args: {},
      });
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e instanceof Error);
      assert.ok(e.message.includes("Unknown meta-tool command"));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mcp/meta-tool.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MetaToolExecutor**

```typescript
// src/mcp/meta-tool.ts

import type { ToolCatalog } from "./tool-catalog.js";
import type { ToolDiscovery } from "./tool-discovery.js";
import type { SchemaCache } from "./tool-cache.js";

export type MetaToolCommand = 
  | "catalog.list"
  | "catalog.by_category"
  | "tools.search"
  | "tools.invoke"
  | "schema.get"
  | "schema.list";

export type MetaToolArgs = {
  "catalog.list": Record<string, never>;
  "catalog.by_category": { category: string };
  "tools.search": { query: string };
  "tools.invoke": { toolName: string; args: Record<string, unknown> };
  "schema.get": { toolName: string };
  "schema.list": Record<string, never>;
};

export class MetaToolExecutor {
  constructor(
    private deps: {
      catalog?: ToolCatalog;
      discovery?: ToolDiscovery;
      schemaCache?: SchemaCache;
    }
  ) {}

  async execute<C extends MetaToolCommand>(
    cmd: { command: C; args: MetaToolArgs[C] }
  ): Promise<string> {
    switch (cmd.command) {
      case "catalog.list":
        return this.listCategories();
      case "catalog.by_category":
        return this.byCategory(cmd.args.category);
      case "tools.search":
        return this.searchTools(cmd.args.query);
      case "schema.get":
        return this.getSchema(cmd.args.toolName);
      case "schema.list":
        return this.listSchemas();
      default:
        throw new Error(`Unknown meta-tool command: ${cmd.command}`);
    }
  }

  private listCategories(): string {
    const catalog = this.deps.catalog;
    if (!catalog) return "ToolCatalog not available";
    
    const categories = catalog.listCategories();
    const lines = categories.map(c => {
      const tools = catalog.byCategory(c as any);
      return `  ${c} (${tools.length} tools)`;
    });
    return `Available categories:\n${lines.join("\n")}`;
  }

  private byCategory(category: string): string {
    const catalog = this.deps.catalog;
    if (!catalog) return "ToolCatalog not available";
    
    const tools = catalog.byCategory(category as any);
    if (tools.length === 0) {
      return `No tools in category: ${category}`;
    }
    
    const lines = tools.map(t => `  - ${t.name}: ${t.description}`);
    return `Tools in ${category}:\n${lines.join("\n")}`;
  }

  private async searchTools(query: string): Promise<string> {
    const discovery = this.deps.discovery;
    if (!discovery) return "ToolDiscovery not available";
    
    const result = await discovery.search(query);
    return result.output;
  }

  private getSchema(toolName: string): string {
    const cache = this.deps.schemaCache;
    if (!cache) return "SchemaCache not available";
    
    const schema = cache.get(toolName);
    if (!schema) {
      return `Schema not found for: ${toolName}`;
    }
    
    return JSON.stringify(schema, null, 2);
  }

  private listSchemas(): string {
    const cache = this.deps.schemaCache;
    if (!cache) return "SchemaCache not available";
    
    return `Cached schemas: ${cache.size} tools`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mcp/meta-tool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/meta-tool.ts tests/mcp/meta-tool.test.ts
git commit -m "feat(mcp): add MetaToolExecutor for tool discovery"
```

---

## Verification

```bash
npm test -- tests/mcp/tool-catalog.test.ts tests/mcp/provenance.test.ts tests/mcp/meta-tool.test.ts
```

All tests should pass. Manual verification:
- [ ] ToolCatalog groups tools by category
- [ ] ToolProvenanceTracker records tool invocations
- [ ] MetaToolExecutor executes catalog commands
- [ ] Unknown commands are rejected
- [ ] Lazy tool loading works via tool discovery