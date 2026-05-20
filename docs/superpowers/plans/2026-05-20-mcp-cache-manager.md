# MCP CacheManager Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCP caching explicit via a `CacheManager` interface. Remove the hidden channel between `McpManager` and `McpToolDeferral`'s internal cache.

**Architecture:** `CacheManager` interface with `get`, `set`, `invalidate`, `clear` methods. `SchemaCache` becomes `InMemoryCacheManager`. `McpToolDeferral` takes a `CacheManager` in constructor. `McpManager` invalidates via the interface, not internal state.

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Extract CacheManager Interface

**Files:**
- Create: `src/utils/cache-manager.ts`
- Modify: `src/mcp/tool-deferral.ts`
- Test: `tests/mcp/tool-deferral.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("CacheManager.get returns stored value", () => {
  const cache = new InMemoryCacheManager();
  cache.set("key1", "value1");
  assert.equal(cache.get("key1"), "value1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/tool-deferral.test.ts`
Expected: FAIL

- [ ] **Step 3: Write CacheManager interface and implementation**

```typescript
// src/utils/cache-manager.ts
export interface CacheManager {
  get(key: string): string | null;
  set(key: string, value: string): void;
  has(key: string): boolean;
  invalidate(prefix: string): void;
  clear(): void;
  readonly size: number;
}

export class InMemoryCacheManager implements CacheManager {
  private cache = new Map<string, string>();

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  invalidate(prefix: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/tool-deferral.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/cache-manager.ts tests/mcp/tool-deferral.test.ts
git commit -m "feat(cache): extract CacheManager interface"
```

---

### Task 2: Adapt McpToolDeferral to Use CacheManager

**Files:**
- Modify: `src/mcp/tool-deferral.ts`
- Test: `tests/mcp/tool-deferral.test.ts`

- [ ] **Step 1: Update McpToolDeferral constructor**

```typescript
export class McpToolDeferral {
  constructor(
    private registry: McpToolRegistry,
    private cache: CacheManager,
    private cacheOptions?: { ttlMs?: number; maxSize?: number }
  ) {}
}
```

- [ ] **Step 2: Remove SchemaCache, use CacheManager directly**

Replace `this.cache.get()` / `this.cache.set()` with direct `CacheManager` calls.

- [ ] **Step 3: Update MCP Manager to inject cache**

Find where `McpToolDeferral` is created. Pass `new InMemoryCacheManager()` or `new PersistentCacheManager()`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/mcp/tool-deferral.test.ts 2>&1 | tail -10`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool-deferral.ts tests/mcp/tool-deferral.test.ts
git commit -m "refactor(mcp-deferral): use CacheManager interface"
```

---

### Task 3: Optionally Add PersistentCacheManager

**Files:**
- Create: `src/utils/cache-manager.ts` (extend)
- Test: `tests/utils/cache-manager.test.ts`

- [ ] **Step 1: Implement PersistentCacheManager**

```typescript
export class PersistentCacheManager implements CacheManager {
  constructor(private dir: string) {}

  get(key: string): string | null {
    const file = this.cacheFile(key);
    if (!existsSync(file)) return null;
    return readFileSync(file, "utf8");
  }

  set(key: string, value: string): void {
    writeFileSync(this.cacheFile(key), value, "utf8");
  }

  invalidate(prefix: string): void {
    // List files in cache dir, delete matching prefix
  }

  private cacheFile(key: string): string {
    return join(this.dir, `${key}.cache`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/cache-manager.ts tests/utils/cache-manager.test.ts
git commit -m "feat(cache): add PersistentCacheManager"
```