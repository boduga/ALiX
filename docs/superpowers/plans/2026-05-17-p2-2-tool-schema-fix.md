# P2.2 Tool Schema Explosion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select only task-relevant MCP tools to send to the model each iteration, preventing context flooding. Tools are filtered by task keywords and token budget. Full schemas are resolved lazily on use.

**Architecture:** Three independent improvements. `ToolSelector` filters the `DeferredToolEntry[]` index by task type + keywords before sending to the model. `SchemaCache` gains TTL-based eviction. `ToolDiscovery` is a meta-tool that lets the model search for additional tools mid-session. No changes to the MCP transport or registry layers.

**Tech Stack:** Vanilla TypeScript, no new dependencies. Reuses existing `searchTools` fuzzy search, `SchemaCache`, and `McpToolDeferral`.

---

### Task 1: ToolSelector (Filter MCP Tools by Relevance)

**Files:**
- Create: `src/mcp/tool-selector.ts`
- Modify: `src/run.ts:367-371` (use ToolSelector instead of raw `buildIndex()`)
- Test: `tests/mcp/tool-selector.test.ts`

Currently ALL MCP tools are sent to the model every iteration via `mcpToolIndex`. The `buildIndex()` index is filtered only by task type (`docs` tasks skip verification). MCP tools can number in the hundreds — this floods context tokens and confuses the model.

`ToolSelector` takes the task description + a token budget, scores each tool by keyword overlap with task words, and returns only the top-N tools within budget.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/mcp/tool-selector.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolSelector } from "../../src/mcp/tool-selector.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

function makeTool(name: string, description: string, server = "test-server"): DeferredToolEntry {
  return {
    name: `mcp_${server}_${name.replace(/\./g, "_")}`,
    execName: `mcp.${server}.${name}`,
    serverName: server,
    toolName: name,
    description,
    input_schema: { type: "object" as const, properties: {} },
  };
}

describe("ToolSelector", () => {
  const tools: DeferredToolEntry[] = [
    makeTool("repos.list", "List GitHub repositories"),
    makeTool("repos.create", "Create a GitHub repository"),
    makeTool("issues.list", "List GitHub issues"),
    makeTool("issues.create", "Create a GitHub issue"),
    makeTool("pr.review", "Review a pull request"),
    makeTool("filesystem.read", "Read files from disk"),
    makeTool("filesystem.write", "Write files to disk"),
    makeTool("fetch.get", "Fetch HTTP URLs"),
    makeTool("calendar.events.list", "List calendar events"),
    makeTool("calendar.events.create", "Create calendar events"),
  ];

  it("returns all tools when task is broad and budget is large", () => {
    const selector = new ToolSelector(tools, { maxTools: 100, tokenBudget: 50000 });
    const task = "do everything";
    const selected = selector.select(task);
    assert.strictEqual(selected.length, tools.length);
  });

  it("filters to github tools for a github task", () => {
    const selector = new ToolSelector(tools, { maxTools: 5, tokenBudget: 50000 });
    const task = "list GitHub repositories and issues";
    const selected = selector.select(task);
    assert.ok(selected.length < tools.length, "should filter");
    assert.ok(selected.every(t => t.serverName === "test-server"), "all same server");
    // All github tools should be in top results
    const names = selected.map(t => t.name);
    assert.ok(names.includes("mcp_test-server_repos_list"), "should include repos.list");
    assert.ok(names.includes("mcp_test-server_issues_list"), "should include issues.list");
  });

  it("respects maxTools limit", () => {
    const selector = new ToolSelector(tools, { maxTools: 3, tokenBudget: 50000 });
    const selected = selector.select("github repos issues");
    assert.strictEqual(selected.length, 3);
  });

  it("respects token budget by estimating tokens", () => {
    const manyTools: DeferredToolEntry[] = Array.from({ length: 50 }, (_, i) =>
      makeTool(`tool${i}`, `Description for tool number ${i} with some extra words to increase size`)
    );
    // With a tiny budget, should limit to fewer tools
    const selector = new ToolSelector(manyTools, { maxTools: 100, tokenBudget: 100 });
    const selected = selector.select("something");
    // Should limit roughly by token budget (rough estimate: 5 tokens per tool)
    assert.ok(selected.length < manyTools.length, "should limit by budget");
  });

  it("always includes a safe fallback tool (filesystem.read) when no match", () => {
    const selector = new ToolSelector(tools, { maxTools: 3, tokenBudget: 50000 });
    const selected = selector.select("random gibberish xyz123");
    // Should include filesystem.read as safe fallback
    const names = selected.map(t => t.name);
    assert.ok(names.includes("mcp_test-server_filesystem_read"), "should include filesystem.read as fallback");
  });

  it("includes tools matching task keywords in name or description", () => {
    const selector = new ToolSelector(tools, { maxTools: 10, tokenBudget: 50000 });
    const selected = selector.select("calendar scheduling meeting");
    const names = selected.map(t => t.name);
    assert.ok(names.some(n => n.includes("calendar")), "should include calendar tools");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/babasola/Dev/Monolith && npm run build && npx vitest run tests/mcp/tool-selector.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the ToolSelector**

```typescript
// src/mcp/tool-selector.ts
import type { DeferredToolEntry } from "./tool-deferral.js";
import { searchTools } from "./tool-search.js";

const SAFE_FALLBACKS = ["filesystem.read", "fetch.get", "files.read", "http.request"];

export type ToolSelectorOptions = {
  maxTools: number;        // hard cap on tools per iteration
  tokenBudget: number;     // rough token budget for tool schemas
};

const TOKENS_PER_TOOL = 25; // rough estimate: name + description tokens

export class ToolSelector {
  constructor(
    private tools: DeferredToolEntry[],
    private options: ToolSelectorOptions
  ) {}

  select(taskDescription: string): DeferredToolEntry[] {
    const { maxTools, tokenBudget } = this.options;
    const maxByBudget = Math.floor(tokenBudget / TOKENS_PER_TOOL);
    const effectiveMax = Math.min(maxTools, maxByBudget, this.tools.length);

    if (effectiveMax >= this.tools.length) return [...this.tools];

    // Score each tool by keyword overlap with task description
    const taskWords = new Set(
      taskDescription.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );

    const scored = this.tools.map(tool => {
      const nameParts = tool.name.toLowerCase().split(/[_\.]/);
      const descWords = new Set(
        tool.description.toLowerCase().split(/\W+/).filter(w => w.length > 2)
      );

      // Score: number of task keywords present in tool name + description
      let score = 0;
      for (const word of taskWords) {
        if (nameParts.includes(word)) score += 3;
        else if (tool.name.toLowerCase().includes(word)) score += 1;
        if (descWords.has(word)) score += 1;
      }
      return { tool, score };
    });

    // Sort by score descending, then by serverName for stable order
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.tool.serverName.localeCompare(b.tool.serverName);
    });

    let result = scored.slice(0, effectiveMax);

    // Always ensure at least one safe fallback tool is included
    const hasFallback = result.some(t =>
      SAFE_FALLBACKS.some(fb => t.tool.name.includes(fb.replace(/\./g, "_")))
    );
    if (!hasFallback && result.length < this.tools.length) {
      const fallback = scored.find(s =>
        SAFE_FALLBACKS.some(fb => s.tool.name.includes(fb.replace(/\./g, "_")))
      );
      if (fallback) {
        // Replace the lowest-scoring tool with the fallback
        const lowestIdx = result.findIndex(r => r.score <= (fallback?.score ?? 0));
        if (lowestIdx !== -1) {
          result[lowestIdx] = fallback;
        } else {
          result.push(fallback);
        }
      }
    }

    return result.map(s => s.tool);
  }

  count(): number { return this.tools.length; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tool-selector.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into run.ts**

In `src/run.ts`, find lines 367-371:
```typescript
  const mcpDeferral = mcpManager.getDeferral();
  const mcpToolIndex = mcpDeferral.buildIndex();
  for (const entry of mcpToolIndex) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }
```

Replace with:
```typescript
  const mcpDeferral = mcpManager.getDeferral();
  const mcpToolIndex = mcpDeferral.buildIndex();
  const taskDescription = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
  const toolSelector = new ToolSelector(mcpToolIndex, { maxTools: 20, tokenBudget: 3000 });
  const selectedTools = toolSelector.select(taskDescription);
  for (const entry of selectedTools) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }
  await log.append({ sessionId, actor: "system", type: "mcp.tools_selected", payload: { total: mcpToolIndex.length, selected: selectedTools.length, taskPreview: taskDescription.slice(0, 100) } });
```

Add imports at top of `run.ts`:
```typescript
import { ToolSelector } from "./mcp/tool-selector.js";
```

**Important:** Only populate `TOOL_NAME_MAP` for selected tools. The executor already handles unknown tool names via `resolveMcpTool` fuzzy search (line 77). This means if the model calls a tool that wasn't in the selected set, it will still be resolved — the selection only controls what the model sees in context.

- [ ] **Step 6: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tool-selector.ts src/run.ts tests/mcp/tool-selector.test.ts
git commit -m "feat(mcp): add ToolSelector — filter MCP tools by task relevance and token budget"
```

---

### Task 2: SchemaCache TTL

**Files:**
- Modify: `src/mcp/tool-cache.ts`
- Test: `tests/mcp/tool-cache.test.ts`

The existing `SchemaCache` stores resolved tool schemas for the session. Add TTL-based eviction so schemas from dynamically-discovered servers (e.g., after a `discoverServer`) can expire and be refreshed.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/mcp/tool-cache.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchemaCache } from "../../src/mcp/tool-cache.js";
import type { ToolDef } from "../../src/providers/types.js";

function makeDef(name: string): ToolDef {
  return { name, description: "test", input_schema: { type: "object" as const, properties: {} } };
}

describe("SchemaCache TTL", () => {
  it("evicts entries after TTL expires", async () => {
    const cache = new SchemaCache({ ttlMs: 50 });
    cache.set("tool1", makeDef("tool1"));
    assert.ok(cache.has("tool1"));
    await new Promise(r => setTimeout(r, 60));
    // Access should trigger eviction
    assert.ok(!cache.has("tool1"), "should be evicted after TTL");
  });

  it("evicts oldest entries when maxSize is exceeded", () => {
    const cache = new SchemaCache({ maxSize: 3 });
    cache.set("t1", makeDef("t1"));
    cache.set("t2", makeDef("t2"));
    cache.set("t3", makeDef("t3"));
    assert.strictEqual(cache.size, 3);
    cache.set("t4", makeDef("t4"));
    assert.strictEqual(cache.size, 3);
    assert.ok(!cache.has("t1"), "oldest should be evicted");
    assert.ok(cache.has("t4"));
  });

  it("supports getSize and maxSize", () => {
    const cache = new SchemaCache({ maxSize: 5 });
    assert.strictEqual(cache.maxSize, 5);
    cache.set("a", makeDef("a"));
    cache.set("b", makeDef("b"));
    assert.strictEqual(cache.size, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tool-cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Update SchemaCache**

Replace `src/mcp/tool-cache.ts` with:

```typescript
import type { ToolDef } from "../providers/types.js";

export type SchemaCacheOptions = {
  ttlMs?: number;    // evict entries older than this (default: no TTL)
  maxSize?: number;  // evict oldest when size exceeds this (default: no limit)
};

interface CacheEntry {
  schema: ToolDef;
  timestamp: number;
}

/**
 * Session-scoped cache for resolved MCP tool schemas.
 * Eviction: TTL-based (by timestamp) and/or LRU-style (by access order).
 */
export class SchemaCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = []; // LRU order

  constructor(private options: SchemaCacheOptions = {}) {}

  get(name: string): ToolDef | undefined {
    const entry = this.cache.get(name);
    if (!entry) return undefined;

    // Check TTL
    if (this.options.ttlMs !== undefined) {
      if (Date.now() - entry.timestamp > this.options.ttlMs) {
        this.cache.delete(name);
        this.accessOrder = this.accessOrder.filter(k => k !== name);
        return undefined;
      }
    }

    // Update LRU order
    this.accessOrder = this.accessOrder.filter(k => k !== name);
    this.accessOrder.push(name);

    return entry.schema;
  }

  set(name: string, schema: ToolDef): void {
    // Evict oldest if at capacity
    if (this.options.maxSize !== undefined && this.cache.size >= this.options.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(name, { schema, timestamp: Date.now() });
    this.accessOrder.push(name);
  }

  has(name: string): boolean {
    // Check TTL on has() too
    if (this.options.ttlMs !== undefined) {
      const entry = this.cache.get(name);
      if (entry && Date.now() - entry.timestamp > this.options.ttlMs) {
        this.cache.delete(name);
        this.accessOrder = this.accessOrder.filter(k => k !== name);
        return false;
      }
    }
    return this.cache.has(name);
  }

  clearPrefix(prefix: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.accessOrder = this.accessOrder.filter(k => k !== key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }

  get maxSize(): number | undefined {
    return this.options.maxSize;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }
}
```

Also update `McpToolDeferral` constructor in `src/mcp/tool-deferral.ts` to pass options to `SchemaCache`. The deferral currently creates `new SchemaCache()` with no args. Update line 28:
```typescript
// Add ttlMs and maxSize to McpToolDeferral constructor
constructor(private registry: McpToolRegistry, private cacheOptions?: { ttlMs?: number; maxSize?: number }) {
  this.cache = new SchemaCache(this.cacheOptions);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tool-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tool-cache.ts src/mcp/tool-deferral.ts tests/mcp/tool-cache.test.ts
git commit -m "feat(mcp): add TTL and maxSize to SchemaCache with LRU eviction"
```

---

### Task 3: Tool Provenance Tracking

**Files:**
- Modify: `src/mcp/tool-deferral.ts` (add provenance to events)
- Modify: `src/run.ts:717-719` (log MCP tool provenance in event log)

Track which MCP tools were used in the session and surface them in the event log and session summary. This gives visibility into which tools were selected vs. discovered vs. used.

- [ ] **Step 1: No new test needed** — this is event logging, covered by the integration tests.

- [ ] **Step 2: Add provenance tracking to McpToolDeferral**

In `src/mcp/tool-deferral.ts`, add a `usedTools` set and a `discoveredTools` set:

```typescript
// In McpToolDeferral class, add:
private _usedTools = new Set<string>();
private _discoveredTools = new Set<string>();

// After resolve() succeeds, record usage:
this._usedTools.add(mcpName);

// After search() returns results (discovered via fuzzy match), record discovery:
this._discoveredTools.add(name);

// Add public accessors:
getUsedTools(): string[] { return [...this._usedTools]; }
getDiscoveredTools(): string[] { return [...this._discoveredTools]; }
```

- [ ] **Step 3: Log MCP tool events in run.ts**

In `src/run.ts`, after the tool call resolution section (around line 633-634), add:

```typescript
// Track MCP tool provenance
if (execName.startsWith("mcp.")) {
  const mcpName = toolCall.name;
  // mcpDeferral tracks used + discovered tools
  await log.append({
    sessionId, actor: "system", type: "mcp.tool_used",
    payload: { toolName: mcpName, execName, sessionToolsTotal: toolSelector.count(), sessionToolsSelected: selectedTools.length }
  });
}
```

Note: `mcpDeferral` is accessible here. `toolSelector` is the `ToolSelector` instance from Task 1.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tool-deferral.ts src/run.ts
git commit -m "feat(mcp): add tool provenance tracking — used and discovered tools in event log"
```

---

### Task 4: ToolDiscovery Meta-Tool (Discover Additional Tools Mid-Session)

**Files:**
- Modify: `src/run.ts:341-344` (add searchMetaTool to provider tools)
- Create: `src/mcp/tool-discovery.ts`
- Test: `tests/mcp/tool-discovery.test.ts`

The model can discover new MCP tools mid-session via a `mcp_search_tools` meta-tool. When the model calls this tool with a query, it searches the full MCP tool index (not just the selected subset) and returns matching tools that weren't in the original context.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/mcp/tool-discovery.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolDiscovery } from "../../src/mcp/tool-discovery.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";
import type { ToolResult } from "../../src/tools/types.js";

function makeTool(name: string, description: string): DeferredToolEntry {
  return {
    name: `mcp_srv_${name.replace(/\./g, "_")}`,
    execName: `mcp.srv.${name}`,
    serverName: "srv",
    toolName: name,
    description,
    input_schema: { type: "object" as const, properties: {} },
  };
}

describe("ToolDiscovery", () => {
  const tools: DeferredToolEntry[] = [
    makeTool("repos.list", "List repositories"),
    makeTool("repos.create", "Create a repository"),
    makeTool("issues.list", "List issues"),
    makeTool("filesystem.read", "Read files"),
  ];

  it("returns matching tools for a query", async () => {
    const discovery = new ToolDiscovery(tools);
    const result = await discovery.search("github repos");
    assert.ok(result.kind === "success");
    assert.ok(result.output!.includes("repos"));
    assert.ok(!result.output!.includes("filesystem"));
  });

  it("returns all tools when query is empty", async () => {
    const discovery = new ToolDiscovery(tools);
    const result = await discovery.search("");
    assert.ok(result.kind === "success");
    assert.ok(result.output!.includes("4 tools"));
  });

  it("returns a helpful error when no matches", async () => {
    const discovery = new ToolDiscovery(tools);
    const result = await discovery.search("xyznonexistent123");
    assert.ok(result.kind === "success");
    assert.ok(result.output!.includes("No tools found"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tool-discovery.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the ToolDiscovery meta-tool**

Create `src/mcp/tool-discovery.ts`:

```typescript
import type { DeferredToolEntry } from "./tool-deferral.js";
import { searchTools } from "./tool-search.js";
import type { ToolResult } from "../tools/types.js";

export class ToolDiscovery {
  constructor(private allTools: DeferredToolEntry[]) {}

  async search(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      const list = this.allTools.map(t => `  - ${t.name}: ${t.description}`).join("\n");
      return {
        kind: "success",
        output: `Available MCP tools (${this.allTools.length}):\n${list}`,
      };
    }

    const matches = searchTools(query, this.allTools).slice(0, 10);

    if (matches.length === 0) {
      return {
        kind: "success",
        output: `No tools found matching "${query}". Try a different keyword.`,
      };
    }

    const lines = matches.map(m =>
      `  - ${m.item.name}: ${m.item.description}\n    Use as: ${m.item.execName}`
    );
    return {
      kind: "success",
      output: `Found ${matches.length} tool(s) matching "${query}":\n${lines.join("\n")}\n\nThese tools are now available for use.`,
    };
  }
}
```

Now wire it into `run.ts`. In the tool executor section (around line 634 where `execName` is resolved), add handling for `mcp_search_tools`:

```typescript
// Add ToolDiscovery import at top of run.ts
import { ToolDiscovery } from "./mcp/tool-discovery.js";

// In run.ts after the mcpDeferral and toolSelector setup, create the discovery instance:
const mcpDiscovery = new ToolDiscovery(mcpToolIndex); // mcpToolIndex is the FULL index, not selectedTools
```

Then in the tool call loop (around line 633), add before the executor call:

```typescript
// Handle mcp_search_tools meta-tool
if (execName === "mcp_search_tools") {
  const query = (toolCall.args.query as string) ?? "";
  const result = await mcpDiscovery.search(query);
  // Log the discovery event
  await log.append({ sessionId, actor: "system", type: "mcp.tool_discovered", payload: { query, result: "success" } });
  sessionState.messages.push({ role: "user", content: `[Tool Result]\n${result.output ?? result.message}` });
  continue;
}
```

Add to `TOOL_NAME_MAP` at the top:
```typescript
const TOOL_NAME_MAP: Record<string, string> = {
  // ... existing entries ...
  "mcp_search_tools": "mcp_search_tools",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tool-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tool-discovery.ts src/run.ts tests/mcp/tool-discovery.test.ts
git commit -m "feat(mcp): add ToolDiscovery meta-tool — let model search for additional tools mid-session"
```

---

### Self-Review Checklist

1. **Spec coverage:** Can I point to a task for each of the 4 missing pieces?
   - `ToolSelector` (filter by relevance + budget) → Task 1 ✅
   - `SchemaCache` TTL + LRU → Task 2 ✅
   - Tool provenance tracking → Task 3 ✅
   - `ToolDiscovery` meta-tool → Task 4 ✅

2. **Placeholder scan:** No "TBD", "TODO", or "implement later" in the plan.

3. **Type consistency:** `DeferredToolEntry`, `SchemaCache`, `ToolResult`, `searchTools` all referenced from existing types.

4. **Backwards compatibility:** Does not change how MCP servers connect or how tool schemas are resolved. Selection only affects what the model sees in context.

5. **No circular dependencies:** `tool-selector.ts` imports from `tool-deferral.ts` and `tool-search.ts`. `tool-deferral.ts` imports `SchemaCache`. No cycles.

---

**Execution:** Tasks 1 and 2 are independent. Tasks 3 and 4 depend on Tasks 1 and 2 for context. Recommended approach: subagent-driven development, Tasks 1+2 in parallel (two subagents), then Tasks 3+4.