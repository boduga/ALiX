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
        output: `Available ${this.allTools.length} MCP tools:\n${list}`,
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