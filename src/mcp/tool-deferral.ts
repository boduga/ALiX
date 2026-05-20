import type { McpToolRegistry, RegisteredTool } from "./registry.js";
import type { ToolDef } from "../providers/types.js";
import { InMemoryCacheManager, type CacheManager } from "../utils/cache-manager.js";
import { searchTools, type SearchResult } from "./tool-search.js";

export interface DeferredToolEntry {
  name: string;       // mcp_github_repos_list — what the model uses
  execName: string;  // mcp.github.repos.list — internal executor name
  serverName: string;
  toolName: string;
  description: string;
  input_schema?: { type: "object"; properties: Record<string, unknown> };
  [key: string]: string | number | boolean | object | undefined;
}

/**
 * McpToolDeferral manages lazy loading of MCP tool schemas.
 *
 * At session start: only names + descriptions are sent to the model (lightweight).
 * On tool call: full ToolDef is resolved from cache or registry and cached.
 * On unknown name: fuzzy search finds the closest match.
 */
export class McpToolDeferral {
  private _index: DeferredToolEntry[] | null = null;
  private _usedTools = new Set<string>();
  private _discoveredTools = new Set<string>();

  constructor(
    private registry: McpToolRegistry,
    private cache: CacheManager = new InMemoryCacheManager(),
    private cacheOptions?: { ttlMs?: number; maxSize?: number }
  ) {}

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
      input_schema: { type: "object" as const, properties: {} },
    }));
    return this._index;
  }

  /**
   * Resolve the full ToolDef for a tool the model called.
   * Uses cache first; on miss, builds from registry and caches.
   */
  resolve(mcpName: string): ToolDef | undefined {
    if (this.cache.has(mcpName)) {
      const cached = this.cache.get(mcpName);
      if (cached) return JSON.parse(cached) as ToolDef;
    }

    const entry = this.findEntry(mcpName);
    if (!entry) return undefined;

    const tool = this.registry.getTool(`${entry.serverName}/${entry.toolName}`);
    if (!tool) return undefined;

    const def: ToolDef = {
      name: entry.name,
      description: entry.description,
      input_schema: tool.inputSchema as ToolDef["input_schema"],
    };

    this.cache.set(mcpName, JSON.stringify(def));
    this._usedTools.add(mcpName);
    return def;
  }

  /**
   * Fallback search when model uses an unknown or misspelled tool name.
   * Returns top matches from the deferred index.
   */
  search(query: string, limit = 3): SearchResult<DeferredToolEntry>[] {
    const results = searchTools(query, this.buildIndex()).slice(0, limit);
    for (const r of results) {
      this._discoveredTools.add(r.item.name);
    }
    return results;
  }

  /**
   * Clear schema cache for a server (called when server reconnects with new schemas).
   */
  clearServerCache(serverName: string): void {
    this.cache.invalidate(`mcp_${serverName}_`);
    this._index = null;
  }

  getUsedTools(): string[] { return [...this._usedTools]; }
  getDiscoveredTools(): string[] { return [...this._discoveredTools]; }

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