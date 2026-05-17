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