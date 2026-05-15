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