# MCP Tool Search Deferral Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Replace eager full-schema loading of MCP tools with a deferred on-demand pattern — send only names + one-liners at session start, resolve full schemas only when the model calls a tool.

**Architecture:** A `McpToolDeferral` class holds a lightweight tool index (name, description, execName) and a schema cache. At session start it builds the index from the registry. When a tool is called, it resolves the full `ToolDef` from cache or registry. A fuzzy search fallback handles misspellings.

**Tech Stack:** Pure TypeScript, no new dependencies. Fuzzy search via weighted Levenshtein on tool names and descriptions.

---

### Task 1: Schema cache and fuzzy search utilities

**Files:**
- Create: `src/mcp/tool-cache.ts` — in-memory cache for resolved full schemas
- Create: `src/mcp/tool-search.ts` — weighted fuzzy search for tool name matching
- Test: `tests/mcp/tool-search.test.ts`

**Why separate files:** These are pure, stateless utilities with no MCP dependencies. They are independently testable.

- [x] **Step 1: Create src/mcp/tool-cache.ts**

```typescript
import type { ToolDef } from "../providers/types.js";

/**
 * Session-scoped cache for resolved MCP tool schemas.
 * Avoids re-fetching full input_schema on repeated tool calls.
 */
export class SchemaCache {
  private cache = new Map<string, ToolDef>();

  get(name: string): ToolDef | undefined {
    return this.cache.get(name);
  }

  set(name: string, schema: ToolDef): void {
    this.cache.set(name, schema);
  }

  has(name: string): boolean {
    return this.cache.has(name);
  }

  /** Remove all entries for a given server (called when server reconnects with new schemas) */
  clearPrefix(prefix: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}
```

- [x] **Step 2: Create src/mcp/tool-search.ts**

```typescript
export interface SearchResult<T> {
  item: T;
  score: number; // higher = better match, 0 = no match
}

/**
 * Simple Levenshtein distance (no external dep).
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

interface ScoredTool {
  name: string;
  description: string;
  [key: string]: unknown;
}

/**
 * Search tools by fuzzy matching on name and description.
 * Scoring: exact prefix > substring > Levenshtein distance.
 * Returns results sorted by score descending.
 */
export function searchTools<T extends ScoredTool>(
  query: string,
  tools: T[],
  options: { nameField?: string; descriptionField?: string } = {}
): SearchResult<T>[] {
  const nameField = options.nameField ?? "name";
  const descField = options.descriptionField ?? "description";
  const q = query.toLowerCase();

  const results: SearchResult<T>[] = [];

  for (const tool of tools) {
    const name = String(tool[nameField] ?? "").toLowerCase();
    const desc = String(tool[descField] ?? "").toLowerCase();

    let score = 0;

    // Exact match
    if (name === q || desc === q) {
      score = 100;
    }
    // Exact prefix
    else if (name.startsWith(q) || desc.startsWith(q)) {
      score = 80 + (name.startsWith(q) ? 10 : 0);
    }
    // Substring anywhere
    else if (name.includes(q) || desc.includes(q)) {
      score = 50 + (name.includes(q) ? 10 : 0);
    }
    // Levenshtein — only if lengths are similar enough (avoid costly calc on very different lengths)
    else {
      const maxLen = Math.max(name.length, q.length);
      if (maxLen <= 30 && Math.abs(name.length - q.length) <= 5) {
        const dist = levenshtein(name, q);
        // Score by relative distance: 0 = perfect, 1 = completely different
        const relative = dist / maxLen;
        if (relative <= 0.5) score = Math.round((1 - relative) * 40);
      }
    }

    if (score > 0) {
      results.push({ item: tool, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
```

- [x] **Step 3: Write failing tests for searchTools**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { searchTools } from "../../src/mcp/tool-search.js";

interface Tool { name: string; description: string; }

describe("searchTools", () => {
  const tools: Tool[] = [
    { name: "mcp_github_repos_list", description: "List repositories for a user or organization" },
    { name: "mcp_github_issues_list", description: "List issues in a repository" },
    { name: "mcp_fetch_web_page", description: "Fetch the content of a web page" },
  ];

  it("returns exact match with highest score", () => {
    const results = searchTools("mcp_github_repos_list", tools);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].item.name, "mcp_github_repos_list");
    assert.strictEqual(results[0].score, 100);
  });

  it("matches prefix", () => {
    const results = searchTools("mcp_github", tools);
    assert.ok(results.length >= 2);
    assert.strictEqual(results[0].score, 80);
  });

  it("matches substring", () => {
    const results = searchTools("repos", tools);
    assert.ok(results.some(r => r.item.name === "mcp_github_repos_list"));
  });

  it("finds typo 'guthu' -> 'github'", () => {
    const results = searchTools("mcp_guthu_repos_list", tools);
    assert.ok(results.length > 0, "Should find github with typo");
    assert.strictEqual(results[0].item.name, "mcp_github_repos_list");
    assert.ok(results[0].score > 0, "Should have positive score");
  });

  it("returns empty for no match", () => {
    const results = searchTools("nonexistent_tool_xyz", tools);
    assert.strictEqual(results.length, 0);
  });

  it("returns results sorted by score descending", () => {
    const results = searchTools("github", tools);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score);
    }
  });
});
```

- [x] **Step 4: Run tests to verify they fail**

Run: `node --test dist/tests/mcp/tool-search.test.js`
Expected: FAIL (searchTools not found — file doesn't exist yet)

- [x] **Step 5: Run tests to verify they pass**

Run: `node --test dist/tests/mcp/tool-search.test.js`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/mcp/tool-cache.ts src/mcp/tool-search.ts tests/mcp/tool-search.test.ts
git commit -m "feat(mcp): add schema cache and fuzzy tool search utilities"
```

---

### Task 2: McpToolDeferral class

**Files:**
- Create: `src/mcp/tool-deferral.ts` — the main deferral class
- Test: `tests/mcp/tool-deferral.test.ts`

**Why this is the core:** Every other component (manager, run.ts) only needs to call `buildIndex()` and `resolve()`. The internals (cache, search) are encapsulated.

- [x] **Step 1: Create src/mcp/tool-deferral.ts**

```typescript
import type { McpToolRegistry, RegisteredTool } from "./registry.js";
import type { ToolDef } from "../providers/types.js";
import { SchemaCache } from "./tool-cache.js";
import { searchTools, type SearchResult } from "./tool-search.js";

/**
 * A tool entry sent to the model at session start.
 * Contains only name + description — no input_schema.
 */
export interface DeferredToolEntry {
  name: string;       // mcp_github_repos_list — what the model uses
  execName: string;  // mcp.github.repos.list — internal executor name
  serverName: string;
  toolName: string;
  description: string;
}

/**
 * McpToolDeferral manages lazy loading of MCP tool schemas.
 *
 * At session start: only names + descriptions are sent to the model (lightweight).
 * On tool call: full ToolDef is resolved from cache or registry and cached.
 * On unknown name: fuzzy search finds the closest match.
 */
export class McpToolDeferral {
  private cache: SchemaCache;
  private _index: DeferredToolEntry[] | null = null;

  constructor(private registry: McpToolRegistry) {
    this.cache = new SchemaCache();
  }

  /**
   * Build the deferred tool index — names + descriptions only.
   * Called once at session start; result is sent to the model.
   */
  buildIndex(): DeferredToolEntry[] {
    if (this._index) return this._index;
    this._index = this.registry.listTools().map(tool => ({
      name: mcpToolName(tool.serverName, tool.toolName),
      execName: mcpToolExecName(tool.serverName, tool.toolName),
      serverName: tool.serverName,
      toolName: tool.toolName,
      description: tool.description ?? "",
    }));
    return this._index;
  }

  /**
   * Resolve the full ToolDef for a tool the model called.
   * Uses cache first; on miss, builds from registry and caches.
   */
  resolve(mcpName: string): ToolDef | undefined {
    if (this.cache.has(mcpName)) return this.cache.get(mcpName)!;

    const entry = this.findEntry(mcpName);
    if (!entry) return undefined;

    const tool = this.registry.getTool(`${entry.serverName}/${entry.toolName}`);
    if (!tool) return undefined;

    const def: ToolDef = {
      name: entry.name,
      description: entry.description,
      input_schema: tool.inputSchema as ToolDef["input_schema"],
    };

    this.cache.set(mcpName, def);
    return def;
  }

  /**
   * Fallback search when model uses an unknown or misspelled tool name.
   * Returns top matches from the deferred index.
   */
  search(query: string, limit = 3): SearchResult<DeferredToolEntry>[] {
    return searchTools(query, this.buildIndex()).slice(0, limit);
  }

  /**
   * Clear schema cache for a server (called when server reconnects with new schemas).
   */
  clearServerCache(serverName: string): void {
    this.cache.clearPrefix(`mcp_${serverName}_`);
    // Invalidate cached index so it rebuilds on next call
    this._index = null;
  }

  private findEntry(name: string): DeferredToolEntry | undefined {
    const idx = this.buildIndex();
    return idx.find(e =>
      e.name === name ||
      e.execName === name ||
      `${e.serverName}/${e.toolName}` === name
    );
  }
}

function mcpToolName(serverName: string, toolName: string): string {
  return "mcp_" + serverName + "_" + toolName.replace(/\./g, "_");
}

function mcpToolExecName(serverName: string, toolName: string): string {
  return "mcp." + serverName + "." + toolName;
}
```

- [x] **Step 2: Write failing tests for McpToolDeferral**

```typescript
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
import { McpToolDeferral } from "../../src/mcp/tool-deferral.js";

function makeFakeRegistry(tools: Array<{ fullName: string; serverName: string; toolName: string; description?: string; inputSchema: Record<string, unknown> }>) {
  return {
    listTools: () => tools,
    getTool: (fullName: string) => tools.find(t => t.fullName === fullName),
  };
}

describe("McpToolDeferral", () => {
  const fakeTools = [
    { fullName: "github/repos.list", serverName: "github", toolName: "repos.list", description: "List repos", inputSchema: { type: "object", properties: { org: { type: "string" } } } },
    { fullName: "github/issues.list", serverName: "github", toolName: "issues.list", description: "List issues", inputSchema: { type: "object", properties: { repo: { type: "string" } } } },
    { fullName: "fetch/web_page", serverName: "fetch", toolName: "web_page", description: "Fetch a URL", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
  ];

  it("buildIndex returns only names and descriptions, no input_schema", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);
    const index = deferral.buildIndex();

    assert.strictEqual(index.length, 3);
    assert.strictEqual(index[0].name, "mcp_github_repos_list");
    assert.strictEqual(index[0].execName, "mcp.github.repos.list");
    assert.strictEqual(index[0].description, "List repos");
    assert.ok(!("input_schema" in index[0]));
  });

  it("resolve returns full ToolDef from registry", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const def = deferral.resolve("mcp_github_repos_list");
    assert.ok(def !== undefined);
    assert.strictEqual(def.name, "mcp_github_repos_list");
    assert.strictEqual(def.description, "List repos");
    assert.deepStrictEqual(def.input_schema, { type: "object", properties: { org: { type: "string" } } });
  });

  it("resolve caches result for repeated calls", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const first = deferral.resolve("mcp_github_repos_list");
    const second = deferral.resolve("mcp_github_repos_list");
    assert.strictEqual(first, second); // same reference — from cache
  });

  it("resolve returns undefined for unknown tool", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const def = deferral.resolve("mcp_nonexistent_tool");
    assert.strictEqual(def, undefined);
  });

  it("search finds fuzzy matches", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const results = deferral.search("github_repo");
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].item.name, "mcp_github_repos_list");
  });

  it("search finds typo 'guthu' -> 'github'", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const results = deferral.search("mcp_guthu_repos_list");
    assert.ok(results.length > 0, "Should find github tool with typo");
  });

  it("clearServerCache invalidates cache and index", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    deferral.resolve("mcp_github_repos_list");
    assert.ok(deferral["cache"].has("mcp_github_repos_list"));

    deferral.clearServerCache("github");
    assert.ok(!deferral["cache"].has("mcp_github_repos_list"));
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `node --test dist/tests/mcp/tool-deferral.test.js`
Expected: FAIL with "Cannot find module"

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test dist/tests/mcp/tool-deferral.test.js`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/mcp/tool-deferral.ts tests/mcp/tool-deferral.test.ts
git commit -m "feat(mcp): add McpToolDeferral for on-demand schema resolution"
```

---

### Task 3: Wire McpToolDeferral into McpManager

**Files:**
- Modify: `src/mcp/manager.ts` — add `getDeferral()` method, clear cache on server reconnect

**Why this is needed:** `run.ts` needs access to the deferral instance, and the manager must clear the schema cache when a server reconnects (to pick up new/changed schemas).

- [x] **Step 1: Add deferral field and getDeferral() to McpManager**

Read the current `src/mcp/manager.ts` and add:

```typescript
import { McpToolDeferral } from "./tool-deferral.js";

// Inside class McpManager, add:
private _deferral: McpToolDeferral | null = null;

getDeferral(): McpToolDeferral {
  if (!this._deferral) this._deferral = new McpToolDeferral(this.registry);
  return this._deferral;
}
```

- [x] **Step 2: Clear schema cache on server reconnect**

In `connectServer` (around line 41-57), after successfully connecting:

```typescript
// Clear any stale schema cache for this server before registering new tools
if (this._deferral) {
  this._deferral.clearServerCache(config.name);
}
```

Also in `closeServer` (around line 104):

```typescript
async closeServer(name: string): Promise<void> {
  await this.registry.closeServer(name);
  this.capabilityRules.delete(name);
  if (this._deferral) this._deferral.clearServerCache(name);
}
```

- [x] **Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: SUCCESS

- [x] **Step 4: Commit**

```bash
git add src/mcp/manager.ts
git commit -m "feat(mcp): wire McpToolDeferral into McpManager"
```

---

### Task 4: Update run.ts to use deferred MCP tools

**Files:**
- Modify: `src/run.ts` — use `mcpManager.getDeferral().buildIndex()` at session start; pass deferred index to API calls

**Current flow:** `buildMcpTools(mcpManager.listTools())` returns full `ToolDef[]` with schemas, sent to model every call.

**New flow:** `deferral.buildIndex()` returns lightweight `DeferredToolEntry[]` (no schemas). When model calls a tool, `deferral.resolve()` loads the full schema for that specific tool.

- [x] **Step 1: Read current run.ts around lines 222-225 and 301, 321**

The key places to change:
- Line 222: `const mcpTools = buildMcpTools(mcpManager.listTools());`
- TOOL_NAME_MAP population (lines 223-225): `TOOL_NAME_MAP[mcpToolName(...)] = mcpToolExecName(...)`
- Line 301 and 321: `tools: [...TOOLS, ...mcpTools]`

- [x] **Step 2: Replace buildMcpTools call with deferral.buildIndex()**

Replace:
```typescript
const mcpTools = buildMcpTools(mcpManager.listTools());
for (const tool of mcpManager.listTools()) {
  TOOL_NAME_MAP[mcpToolName(tool.serverName, tool.toolName)] = mcpToolExecName(tool.serverName, tool.toolName);
}
```

With:
```typescript
const mcpDeferral = mcpManager.getDeferral();
const mcpToolIndex = mcpDeferral.buildIndex();
for (const entry of mcpToolIndex) {
  TOOL_NAME_MAP[entry.name] = entry.execName;
}
```

- [x] **Step 3: Update tools array in API calls**

Replace `tools: [...TOOLS, ...mcpTools]` with:
```typescript
tools: [...TOOLS, ...mcpToolIndex]
```

There are two occurrences (streaming path around line 301 and non-streaming around line 321).

**Important:** `mcpToolIndex` is `DeferredToolEntry[]` not `ToolDef[]`. The model only sees names + descriptions. When the model calls a tool, the tool name is looked up in `TOOL_NAME_MAP` to get the executor name (same as before). The deferred entry does not need `input_schema` at this stage.

- [x] **Step 4: Run build to verify no type errors**

Run: `npm run build`
Expected: SUCCESS

- [x] **Step 5: Commit**

```bash
git add src/run.ts
git commit -m "feat(mcp): use deferred tool index in run.ts"
```

---

### Task 5: Update TOOL_NAME_MAP resolution to use deferral

**Files:**
- Modify: `src/run.ts` — when the model calls an MCP tool, resolve its schema on-demand

**Current behavior:** `TOOL_NAME_MAP[toolCall.name]` maps model tool name to executor name. If the model calls a tool we haven't seen yet, `TOOL_NAME_MAP` doesn't have it and we fall back to `toolCall.name` directly.

**New behavior:** Add a helper that uses `mcpDeferral.resolve()` to check if an unknown tool name matches via fuzzy search, and inject the resolved name back.

- [x] **Step 1: Add tool resolution helper in run.ts**

Add near the `TOOL_NAME_MAP` definition (around line 50):

```typescript
/**
 * Resolve a tool name that may be misspelled or unknown.
 * Uses fuzzy search to find the closest match in the MCP tool index.
 * Returns the execName if found, or null if no match above threshold.
 */
function resolveMcpTool(mcpName: string, deferral: McpToolDeferral): string | null {
  // Already in the map — fast path
  if (TOOL_NAME_MAP[mcpName]) return TOOL_NAME_MAP[mcpName];

  // Try fuzzy search
  const matches = deferral.search(mcpName, 1);
  if (matches.length > 0 && matches[0].score >= 40) {
    const execName = matches[0].item.execName;
    TOOL_NAME_MAP[mcpName] = execName;
    return execName;
  }
  return null;
}
```

- [x] **Step 2: Update tool call resolution in the loop**

Find the tool call execution block (around line 356):
```typescript
const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
```

Replace with:
```typescript
// Try to resolve via deferral (handles misspellings and unknown tools)
const execName = resolveMcpTool(toolCall.name, mcpDeferral) ?? TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
```

- [x] **Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: SUCCESS

- [x] **Step 4: Commit**

```bash
git add src/run.ts
git commit -m "feat(mcp): resolve MCP tool names via fuzzy search fallback"
```

---

### Notes

- **`buildMcpTools` function can be removed** from `run.ts` after Task 4 — it's no longer used. Confirm no references remain before deleting.
- **Cache invalidation:** When `closeServer` is called, `clearServerCache` removes all cached schemas for that server. When `connectServer` reconnects, the same call clears stale entries so new schemas are picked up.
- **Deferred index is immutable per session:** `buildIndex()` caches the result in `_index`. If a server connects after session start, `clearServerCache` sets `_index = null` so the next `buildIndex()` call rebuilds with the new tools.
- **No new dependencies:** Levenshtein is implemented inline. Fuzzy search is a simple weighted algorithm, not a full fuzzy library.
- **Test coverage:** At least one test per public method on `McpToolDeferral` and `searchTools`.