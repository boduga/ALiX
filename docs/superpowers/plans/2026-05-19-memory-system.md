# Memory System Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete MemoryInspector and full memory layer implementation per research spec.

**Architecture:** Build on existing project/session memory. Add memory inspector CLI and full memory layer system.

**Tech Stack:** TypeScript, existing memory stores, event log

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/memory/memory-inspector.ts` | CLI tool to inspect memory state |
| `src/memory/user-preference-store.ts` | Store user preferences and settings |
| `src/memory/tool-cache.ts` | Cache command results and indexes |
| `src/memory/repo-index-store.ts` | Store generated repo indexes |
| `tests/memory/memory-inspector.test.ts` | Memory inspector tests |

---

## Task 1: Add MemoryInspector

**Files:**
- Create: `src/memory/memory-inspector.ts`
- Test: `tests/memory/memory-inspector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { MemoryInspector } from "../../src/memory/memory-inspector.js";

describe("MemoryInspector", () => {
  const inspector = new MemoryInspector(process.cwd());

  it("lists project memory", async () => {
    const result = await inspector.inspect("project");
    assert.ok(result.scope === "project");
    assert.ok(Array.isArray(result.records));
  });

  it("lists session memory", async () => {
    const result = await inspector.inspect("session");
    assert.ok(result.scope === "session");
  });

  it("shows memory stats", async () => {
    const stats = await inspector.getStats();
    assert.ok(typeof stats.projectRecords === "number");
    assert.ok(typeof stats.sessionRecords === "number");
    assert.ok(typeof stats.totalTokens === "number");
  });

  it("formats memory for display", async () => {
    const formatted = await inspector.format("project");
    assert.ok(typeof formatted === "string");
    assert.ok(formatted.length > 0);
  });

  it("deletes memory by scope", async () => {
    const before = await inspector.getStats();
    await inspector.clear("session");
    const after = await inspector.getStats();
    assert.ok(after.sessionRecords < before.sessionRecords);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/memory/memory-inspector.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement MemoryInspector**

```typescript
// src/memory/memory-inspector.ts

import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type MemoryRecord = {
  id: string;
  scope: "project" | "user" | "session" | "tool" | "repo";
  content: string;
  source: string;
  createdAt: string;
  expiresAt?: string;
};

export type MemoryStats = {
  projectRecords: number;
  sessionRecords: number;
  toolRecords: number;
  repoRecords: number;
  totalTokens: number;
};

export type InspectionResult = {
  scope: string;
  records: MemoryRecord[];
  totalTokens: number;
};

export class MemoryInspector {
  constructor(
    private baseDir: string,
    private memoryDir?: string
  ) {
    this.memoryDir = memoryDir ?? join(baseDir, ".alix", "memory");
  }

  async inspect(scope: string): Promise<InspectionResult> {
    const records = await this.loadRecords(scope);
    const totalTokens = this.estimateTokens(records);

    return {
      scope,
      records,
      totalTokens,
    };
  }

  async getStats(): Promise<MemoryStats> {
    const scopes = ["project", "session", "tool", "repo"] as const;
    const stats: MemoryStats = {
      projectRecords: 0,
      sessionRecords: 0,
      toolRecords: 0,
      repoRecords: 0,
      totalTokens: 0,
    };

    for (const scope of scopes) {
      const records = await this.loadRecords(scope);
      const key = `${scope}Records` as keyof MemoryStats;
      stats[key] = records.length;
      stats.totalTokens += this.estimateTokens(records);
    }

    return stats;
  }

  async format(scope: string): Promise<string> {
    const { records, totalTokens } = await this.inspect(scope);
    
    if (records.length === 0) {
      return `No ${scope} memory records`;
    }

    const lines = [
      `# ${scope.charAt(0).toUpperCase() + scope.slice(1)} Memory`,
      `Records: ${records.length} | Tokens: ~${totalTokens}`,
      "",
    ];

    for (const record of records) {
      lines.push(`## ${record.id}`);
      lines.push(`Source: ${record.source}`);
      lines.push(`Created: ${record.createdAt}`);
      if (record.expiresAt) {
        lines.push(`Expires: ${record.expiresAt}`);
      }
      lines.push("");
      lines.push(record.content.slice(0, 500));
      if (record.content.length > 500) {
        lines.push("... (truncated)");
      }
      lines.push("");
      lines.push("---");
    }

    return lines.join("\n");
  }

  async clear(scope: string): Promise<number> {
    const dir = join(this.memoryDir, scope);
    if (!existsSync(dir)) return 0;

    const files = await readdir(dir);
    let deleted = 0;

    for (const file of files) {
      if (file.endsWith(".json")) {
        await unlink(join(dir, file));
        deleted++;
      }
    }

    return deleted;
  }

  private async loadRecords(scope: string): Promise<MemoryRecord[]> {
    const dir = join(this.memoryDir, scope);
    if (!existsSync(dir)) return [];

    const records: MemoryRecord[] = [];
    const files = await readdir(dir);

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await readFile(join(dir, file), "utf8");
          const record = JSON.parse(content) as MemoryRecord;
          if (!record.expiresAt || new Date(record.expiresAt) > new Date()) {
            records.push(record);
          }
        } catch {
          // Skip invalid records
        }
      }
    }

    return records;
  }

  private estimateTokens(records: MemoryRecord[]): number {
    // Rough estimate: 4 chars per token
    return records.reduce((sum, r) => sum + Math.ceil(r.content.length / 4), 0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/memory/memory-inspector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/memory-inspector.ts tests/memory/memory-inspector.test.ts
git commit -m "feat(memory): add MemoryInspector for memory CLI"
```

---

## Task 2: Add UserPreferenceStore

**Files:**
- Create: `src/memory/user-preference-store.ts`
- Test: `tests/memory/user-preference-store.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { UserPreferenceStore } from "../../src/memory/user-preference-store.js";
import { join } from "node:path";

describe("UserPreferenceStore", () => {
  const testDir = join(process.cwd(), ".test-prefs");
  let store: UserPreferenceStore;

  beforeEach(async () => {
    store = new UserPreferenceStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("saves and loads preferences", async () => {
    await store.set("theme", "dark");
    const theme = await store.get("theme");
    assert.equal(theme, "dark");
  });

  it("returns default when key missing", async () => {
    const value = await store.get("missing", "default");
    assert.equal(value, "default");
  });

  it("lists all preferences", async () => {
    await store.set("key1", "value1");
    await store.set("key2", "value2");
    const all = await store.list();
    assert.ok(Object.keys(all).length >= 2);
  });

  it("deletes preference", async () => {
    await store.set("temp", "value");
    await store.delete("temp");
    const value = await store.get("temp");
    assert.equal(value, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/memory/user-preference-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement UserPreferenceStore**

```typescript
// src/memory/user-preference-store.ts

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export class UserPreferenceStore {
  private configPath: string;
  private prefs: Record<string, unknown> = {};

  constructor(
    private baseDir: string,
    filename = "preferences.json"
  ) {
    this.configPath = join(baseDir, ".alix", "config", filename);
  }

  async init(): Promise<void> {
    await mkdir(join(this.baseDir, ".alix", "config"), { recursive: true });
    
    if (existsSync(this.configPath)) {
      try {
        const content = await readFile(this.configPath, "utf8");
        this.prefs = JSON.parse(content);
      } catch {
        this.prefs = {};
      }
    }
  }

  async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    await this.init();
    return (this.prefs[key] as T) ?? defaultValue;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.init();
    this.prefs[key] = value;
    await this.save();
  }

  async delete(key: string): Promise<void> {
    await this.init();
    delete this.prefs[key];
    await this.save();
  }

  async list(): Promise<Record<string, unknown>> {
    await this.init();
    return { ...this.prefs };
  }

  async clear(): Promise<void> {
    this.prefs = {};
    await this.save();
  }

  private async save(): Promise<void> {
    await writeFile(this.configPath, JSON.stringify(this.prefs, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/memory/user-preference-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/user-preference-store.ts tests/memory/user-preference-store.test.ts
git commit -m "feat(memory): add UserPreferenceStore for user settings"
```

---

## Task 3: Add RepoIndexStore

**Files:**
- Create: `src/memory/repo-index-store.ts`
- Test: `tests/memory/repo-index-store.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { RepoIndexStore } from "../../src/memory/repo-index-store.js";
import { join } from "node:path";

describe("RepoIndexStore", () => {
  const testDir = join(process.cwd(), ".test-repo-index");
  let store: RepoIndexStore;

  beforeEach(async () => {
    store = new RepoIndexStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("stores and retrieves index", async () => {
    await store.save("symbols", { functions: ["fn1", "fn2"] });
    const index = await store.load("symbols");
    assert.ok(index);
    assert.ok((index as any).functions);
  });

  it("returns undefined for missing index", async () => {
    const index = await store.load("nonexistent");
    assert.equal(index, undefined);
  });

  it("checks if index is stale", async () => {
    await store.save("test", { data: "test" }, { maxAge: 3600 });
    const isStale = await store.isStale("test", { repoModified: Date.now() - 7200000 });
    assert.equal(isStale, true);
  });

  it("clears all indexes", async () => {
    await store.save("index1", { data: 1 });
    await store.save("index2", { data: 2 });
    await store.clearAll();
    const stats = await store.getStats();
    assert.equal(stats.indexCount, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/memory/repo-index-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement RepoIndexStore**

```typescript
// src/memory/repo-index-store.ts

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";

export type IndexMetadata = {
  createdAt: string;
  maxAge?: number;
  sourceFiles?: string[];
};

export type IndexStats = {
  indexCount: number;
  totalSize: number;
  oldestIndex?: string;
  newestIndex?: string;
};

export class RepoIndexStore {
  private indexDir: string;

  constructor(
    private baseDir: string,
    indexDir?: string
  ) {
    this.indexDir = indexDir ?? join(baseDir, ".alix", "repo-index");
  }

  async init(): Promise<void> {
    await mkdir(this.indexDir, { recursive: true });
  }

  async save(name: string, data: unknown, metadata?: Partial<IndexMetadata>): Promise<void> {
    await this.init();
    
    const indexPath = join(this.indexDir, `${name}.json`);
    const metaPath = join(this.indexDir, `${name}.meta.json`);

    const indexData = {
      name,
      data,
      updatedAt: new Date().toISOString(),
    };

    await writeFile(indexPath, JSON.stringify(indexData));

    if (metadata) {
      const fullMeta: IndexMetadata = {
        createdAt: new Date().toISOString(),
        ...metadata,
      };
      await writeFile(metaPath, JSON.stringify(fullMeta));
    }
  }

  async load(name: string): Promise<unknown | undefined> {
    const indexPath = join(this.indexDir, `${name}.json`);
    if (!existsSync(indexPath)) return undefined;

    try {
      const content = await readFile(indexPath, "utf8");
      const index = JSON.parse(content);
      return index.data;
    } catch {
      return undefined;
    }
  }

  async isStale(name: string, options: { repoModified?: number; maxAge?: number }): Promise<boolean> {
    const metaPath = join(this.indexDir, `${name}.meta.json`);
    if (!existsSync(metaPath)) return true;

    try {
      const content = await readFile(metaPath, "utf8");
      const meta = JSON.parse(content) as IndexMetadata;

      if (meta.maxAge && options.maxAge === undefined) {
        options.maxAge = meta.maxAge;
      }

      if (options.maxAge) {
        const indexStats = statSync(join(this.indexDir, `${name}.json`));
        const age = (Date.now() - indexStats.mtimeMs) / 1000;
        if (age > options.maxAge) return true;
      }

      if (options.repoModified) {
        const indexCreated = new Date(meta.createdAt).getTime();
        if (options.repoModified > indexCreated) return true;
      }
    } catch {
      return true;
    }

    return false;
  }

  async delete(name: string): Promise<void> {
    await rm(join(this.indexDir, `${name}.json`), { force: true });
    await rm(join(this.indexDir, `${name}.meta.json`), { force: true });
  }

  async clearAll(): Promise<void> {
    await rm(this.indexDir, { recursive: true, force: true });
  }

  async getStats(): Promise<IndexStats> {
    await this.init();
    const files = (await import("node:fs/promises")).readdir(this.indexDir);
    const indexes = (await files).filter(f => f.endsWith(".json") && !f.endsWith(".meta.json"));
    
    let totalSize = 0;
    let oldest: string | undefined;
    let newest: string | undefined;

    for (const file of indexes) {
      const stats = statSync(join(this.indexDir, file));
      totalSize += stats.size;
      
      if (!oldest || stats.mtimeMs < statSync(join(this.indexDir, oldest)).mtimeMs) {
        oldest = file;
      }
      if (!newest || stats.mtimeMs > statSync(join(this.indexDir, newest)).mtimeMs) {
        newest = file;
      }
    }

    return {
      indexCount: indexes.length,
      totalSize,
      oldestIndex: oldest?.replace(".json", ""),
      newestIndex: newest?.replace(".json", ""),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/memory/repo-index-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/repo-index-store.ts tests/memory/repo-index-store.test.ts
git commit -m "feat(memory): add RepoIndexStore for generated indexes"
```

---

## Verification

```bash
npm test -- tests/memory/memory-inspector.test.ts tests/memory/user-preference-store.test.ts tests/memory/repo-index-store.test.ts
```

All tests should pass. Manual verification:
- [ ] MemoryInspector shows all memory layers
- [ ] UserPreferenceStore persists user settings
- [ ] RepoIndexStore manages generated indexes
- [ ] CLI command `alix memory inspect` works