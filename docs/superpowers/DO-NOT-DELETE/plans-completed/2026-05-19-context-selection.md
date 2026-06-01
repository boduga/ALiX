# Context Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement context selection components to rank and prioritize code artifacts for LLM context windows

**Architecture:** RepoMapIndexer discovers files, SymbolExtractor and DependencyGraph analyze relationships, GitActivityReader tracks recent changes, ContextRanker scores relevance, ContextBundleBuilder assembles the final bundle.

**Tech Stack:** TypeScript, GitNexus knowledge graph, existing src/repomap/ and src/events/ modules

---

## Context Selection Components

### Task 1: RepoMapIndexer Enhancement

**Files:**
- Modify: `src/repomap/repomap-lite.ts` - existing implementation
- Test: `tests/repomap/repomap-lite.test.ts`

- [ ] **Step 1: Add filter capabilities to RepoMapLite**

```typescript
// Add to RepoMapLite class
filter(predicate: (file: FileNode) => boolean): RepoMapLite {
  const filtered = new Map<string, FileNode>();
  for (const [path, node] of this.files) {
    if (predicate(node)) {
      filtered.set(path, node);
    }
  }
  return new RepoMapLite(filtered, this.config);
}
```

- [ ] **Step 2: Add glob pattern matching**

```typescript
matchGlob(patterns: string[]): RepoMapLite {
  const { minimatch } = await import('minimatch');
  return this.filter(node => 
    patterns.some(p => minimatch(node.path, p))
  );
}
```

- [ ] **Step 3: Add dependency-aware filtering**

```typescript
filterByDependencyScope(depth: number, roots: string[]): RepoMapLite {
  const graph = new DependencyGraph(this);
  const reachable = new Set<string>();
  
  const queue = [...roots];
  let currentDepth = 0;
  
  while (queue.length > 0 && currentDepth < depth) {
    const nextLevel = [];
    for (const file of queue) {
      if (!reachable.has(file)) {
        reachable.add(file);
        nextLevel.push(...graph.dependenciesOf(file));
      }
    }
    queue.length = 0;
    queue.push(...nextLevel);
    currentDepth++;
  }
  
  return this.filter(node => reachable.has(node.path));
}
```

- [ ] **Step 4: Run tests to verify changes**

Run: `npm test -- tests/repomap/repomap-lite.test.ts`
Expected: PASS (existing tests + new filter tests)

- [ ] **Step 5: Commit**

```bash
git add src/repomap/repomap-lite.ts tests/repomap/repomap-lite.test.ts
git commit -m "feat(context-selection): add filtering to RepoMapLite"
```

---

### Task 2: SymbolExtractor

**Files:**
- Create: `src/repomap/symbol-extractor.ts`
- Create: `tests/repomap/symbol-extractor.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/repomap/symbol-extractor.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { SymbolExtractor } from "../../src/repomap/symbol-extractor.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("SymbolExtractor", () => {
  it("extracts function and class definitions", async () => {
    const dir = await mkdir(join(tmpdir(), "symbol-test"), { recursive: true });
    await writeFile(join(dir, "test.ts"), `
      export function calculateTotal(items: Item[]): number {
        return items.reduce((sum, item) => sum + item.price, 0);
      }
      
      export class Cart {
        private items: Item[] = [];
        add(item: Item): void { this.items.push(item); }
      }
      
      interface Item { price: number; }
    `);
    
    const extractor = new SymbolExtractor();
    const symbols = await extractor.extractFromDir(dir);
    
    assert.ok(symbols.find(s => s.name === "calculateTotal" && s.kind === "function"));
    assert.ok(symbols.find(s => s.name === "Cart" && s.kind === "class"));
    assert.ok(symbols.find(s => s.name === "Item" && s.kind === "interface"));
  });

  it("extracts symbols from file with AST", async () => {
    const extractor = new SymbolExtractor();
    const code = `
      const foo = 42;
      type UserId = string;
      enum Status { Active, Inactive }
    `;
    const symbols = await extractor.extractFromCode(code, "test.ts");
    
    assert.ok(symbols.find(s => s.name === "foo"));
    assert.ok(symbols.find(s => s.name === "UserId"));
    assert.ok(symbols.find(s => s.name === "Status"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/repomap/symbol-extractor.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement SymbolExtractor**

```typescript
// src/repomap/symbol-extractor.ts
import { parse } from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/types";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExtractedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const" | "variable";
  file: string;
  line: number;
  exports: boolean;
}

export class SymbolExtractor {
  async extractFromDir(dir: string, extensions = [".ts", ".tsx", ".js", ".jsx"]): Promise<ExtractedSymbol[]> {
    const symbols: ExtractedSymbol[] = [];
    const files = await this.findFiles(dir, extensions);
    
    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const fileSymbols = await this.extractFromCode(content, file);
      symbols.push(...fileSymbols);
    }
    
    return symbols;
  }

  async extractFromCode(code: string, filename: string): Promise<ExtractedSymbol[]> {
    const ast = parse(code, { sourceType: "module", ecmaVersion: "latest" });
    const symbols: ExtractedSymbol[] = [];
    
    this.traverse(ast, (node) => {
      const symbol = this.extractSymbol(node, filename);
      if (symbol) symbols.push(symbol);
    });
    
    return symbols;
  }

  private traverse(node: TSESTree.Node, visitor: (node: TSESTree.Node) => void): void {
    visitor(node);
    for (const key in node) {
      const child = (node as any)[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && "type" in item) {
              this.traverse(item as TSESTree.Node, visitor);
            }
          }
        } else if ("type" in child) {
          this.traverse(child as TSESTree.Node, visitor);
        }
      }
    }
  }

  private extractSymbol(node: TSESTree.Node, filename: string): ExtractedSymbol | null {
    const line = node.loc?.start.line ?? 0;
    
    switch (node.type) {
      case "FunctionDeclaration":
        return {
          name: (node as any).id?.name ?? "anonymous",
          kind: "function",
          file: filename,
          line,
          exports: this.isExported(node),
        };
      case "ClassDeclaration":
        return {
          name: (node as any).id?.name ?? "AnonymousClass",
          kind: "class",
          file: filename,
          line,
          exports: this.isExported(node),
        };
      case "TSInterfaceDeclaration":
        return {
          name: (node as any).id?.name ?? "AnonymousInterface",
          kind: "interface",
          file: filename,
          line,
          exports: this.isExported(node),
        };
      case "TSTypeAliasDeclaration":
        return {
          name: (node as any).id?.name ?? "AnonymousType",
          kind: "type",
          file: filename,
          line,
          exports: this.isExported(node),
        };
      case "TSEnumDeclaration":
        return {
          name: (node as any).id?.name ?? "AnonymousEnum",
          kind: "enum",
          file: filename,
          line,
          exports: this.isExported(node),
        };
      default:
        return null;
    }
  }

  private isExported(node: TSESTree.Node): boolean {
    const parent = (node as any).parent;
    return parent?.type === "ExportNamedDeclaration";
  }

  private async findFiles(dir: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...await this.findFiles(fullPath, extensions));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/repomap/symbol-extractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repomap/symbol-extractor.ts tests/repomap/symbol-extractor.test.ts
git commit -m "feat(context-selection): add SymbolExtractor for AST-based symbol discovery"
```

---

### Task 3: DependencyGraph Enhancement

**Files:**
- Modify: `src/repomap/dependency-graph.ts` - extend existing
- Test: `tests/repomap/dependency-graph.test.ts`

- [ ] **Step 1: Add test for new features**

```typescript
it("finds transitive dependencies", () => {
  const graph = new DependencyGraph(repoMap);
  const transitive = graph.transitiveDependenciesOf("src/main.ts", 3);
  assert.ok(transitive.length >= graph.dependenciesOf("src/main.ts").length);
});

it("detects circular dependencies", () => {
  const graph = new DependencyGraph(repoMap);
  const cycles = graph.findCycles();
  assert.ok(Array.isArray(cycles));
});

it("calculates impact score", () => {
  const graph = new DependencyGraph(repoMap);
  const score = graph.impactScore("src/utils.ts");
  assert.ok(score >= 0);
});
```

- [ ] **Step 2: Implement new methods**

```typescript
transitiveDependenciesOf(file: string, maxDepth = 10): string[] {
  const visited = new Set<string>();
  const queue: { file: string; depth: number }[] = [{ file, depth: 0 }];
  
  while (queue.length > 0) {
    const { file: current, depth } = queue.shift()!;
    if (visited.has(current) || depth > maxDepth) continue;
    visited.add(current);
    
    const deps = this.dependenciesOf(current);
    for (const dep of deps) {
      if (!visited.has(dep)) {
        queue.push({ file: dep, depth: depth + 1 });
      }
    }
  }
  
  visited.delete(file);
  return [...visited];
}

findCycles(): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  
  const dfs = (node: string): boolean => {
    if (stack.has(node)) {
      const cycle = [...stack].slice(stack.has(node) ? [...stack].indexOf(node) : 0);
      cycle.push(node);
      cycles.push(cycle);
      return true;
    }
    if (visited.has(node)) return false;
    
    visited.add(node);
    stack.add(node);
    
    for (const dep of this.dependenciesOf(node)) {
      dfs(dep);
    }
    
    stack.delete(node);
    return false;
  };
  
  for (const file of this.files) {
    dfs(file);
  }
  
  return cycles;
}

impactScore(file: string): number {
  const directDependents = this.dependentsOf(file).length;
  const transitiveDependents = this.transitiveDependenciesOf(file, 5).length;
  return directDependents + (transitiveDependents * 0.5);
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test -- tests/repomap/dependency-graph.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/repomap/dependency-graph.ts tests/repomap/dependency-graph.test.ts
git commit -m "feat(context-selection): add transitive deps, cycle detection, impact scoring"
```

---

### Task 4: GitActivityReader

**Files:**
- Create: `src/events/git-activity-reader.ts`
- Create: `tests/events/git-activity-reader.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/events/git-activity-reader.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { GitActivityReader } from "../../src/events/git-activity-reader.js";

describe("GitActivityReader", () => {
  it("reads recent commits", async () => {
    const reader = new GitActivityReader({ cwd: process.cwd() });
    const commits = await reader.getRecentCommits({ limit: 5 });
    assert.ok(Array.isArray(commits));
    assert.ok(commits.length <= 5);
    if (commits.length > 0) {
      assert.ok("hash" in commits[0]);
      assert.ok("message" in commits[0]);
    }
  });

  it("gets changed files from recent commits", async () => {
    const reader = new GitActivityReader({ cwd: process.cwd() });
    const commits = await reader.getRecentCommits({ limit: 3 });
    if (commits.length > 0) {
      const files = await reader.getChangedFiles(commits[0].hash);
      assert.ok(Array.isArray(files));
    }
  });

  it("detects hot paths by frequency", async () => {
    const reader = new GitActivityReader({ cwd: process.cwd() });
    const hotPaths = await reader.getHotPaths({ days: 30, minChanges: 2 });
    assert.ok(Array.isArray(hotPaths));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/events/git-activity-reader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement GitActivityReader**

```typescript
// src/events/git-activity-reader.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: Date;
  filesChanged: number;
}

export interface HotPath {
  path: string;
  changeCount: number;
  lastChanged: Date;
}

export interface GitActivityReaderOptions {
  cwd?: string;
  author?: string;
}

export class GitActivityReader {
  private cwd: string;

  constructor(options: GitActivityReaderOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  async getRecentCommits(options: { limit?: number; author?: string } = {}): Promise<CommitInfo[]> {
    const limit = options.limit ?? 10;
    const authorFilter = options.author ? `--author="${options.author}"` : "";
    
    const { stdout } = await execAsync(
      `git log ${authorFilter} --format="%H|%s|%an|%ad|%ct" -n ${limit}`,
      { cwd: this.cwd }
    );
    
    return stdout.trim().split("\n")
      .filter(line => line.trim())
      .map(line => {
        const [hash, message, author, dateStr, timestamp] = line.split("|");
        return {
          hash,
          message,
          author,
          date: new Date(dateStr),
          filesChanged: 0,
        };
      });
  }

  async getChangedFiles(ref: string): Promise<string[]> {
    const { stdout } = await execAsync(
      `git diff-tree --no-commit-id --name-only -r ${ref}`,
      { cwd: this.cwd }
    );
    
    return stdout.trim().split("\n").filter(line => line.trim());
  }

  async getHotPaths(options: { days?: number; minChanges?: number } = {}): Promise<HotPath[]> {
    const days = options.days ?? 30;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    
    const { stdout } = await execAsync(
      `git log --since="${sinceDate}" --name-only --format=""`,
      { cwd: this.cwd }
    );
    
    const counts = new Map<string, number>();
    const lastChanged = new Map<string, Date>();
    
    const lines = stdout.trim().split("\n").filter(line => line.trim());
    for (const path of lines) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    
    const result: HotPath[] = [];
    for (const [path, count] of counts) {
      if (count >= (options.minChanges ?? 1)) {
        result.push({
          path,
          changeCount: count,
          lastChanged: lastChanged.get(path) ?? new Date(),
        });
      }
    }
    
    return result.sort((a, b) => b.changeCount - a.changeCount);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/events/git-activity-reader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/git-activity-reader.ts tests/events/git-activity-reader.test.ts
git commit -m "feat(context-selection): add GitActivityReader for git history analysis"
```

---

### Task 5: ContextRanker

**Files:**
- Create: `src/context/context-ranker.ts`
- Create: `tests/context/context-ranker.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context/context-ranker.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextRanker } from "../../src/context/context-ranker.js";
import type { ExtractedSymbol } from "../../src/repomap/symbol-extractor.js";

describe("ContextRanker", () => {
  it("ranks files by relevance score", () => {
    const ranker = new ContextRanker();
    const files = [
      { path: "src/main.ts", score: 0.5 },
      { path: "src/utils.ts", score: 0.8 },
      { path: "tests/main.test.ts", score: 0.3 },
    ];
    
    const ranked = ranker.rankFiles(files);
    assert.equal(ranked[0].path, "src/utils.ts");
    assert.equal(ranked[2].path, "tests/main.test.ts");
  });

  it("boosts recently modified files", () => {
    const ranker = new ContextRanker({ recencyBoost: 0.3 });
    const now = Date.now();
    const files = [
      { path: "old.ts", score: 0.5, modifiedAt: new Date(now - 86400000 * 30) },
      { path: "recent.ts", score: 0.5, modifiedAt: new Date(now - 86400000) },
    ];
    
    const ranked = ranker.rankFiles(files);
    assert.ok(ranked[0].path === "recent.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/context/context-ranker.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ContextRanker**

```typescript
// src/context/context-ranker.ts
export interface RankableFile {
  path: string;
  score?: number;
  modifiedAt?: Date;
  changeCount?: number;
  exports?: number;
}

export interface RankedFile extends RankableFile {
  finalScore: number;
  rank: number;
  factors: { name: string; value: number; weight: number }[];
}

export interface ContextRankerOptions {
  recencyBoost?: number;
  recencyWindowDays?: number;
  hotPathBoost?: number;
  exportBoost?: number;
  maxFiles?: number;
}

export class ContextRanker {
  private options: Required<ContextRankerOptions>;

  constructor(options: ContextRankerOptions = {}) {
    this.options = {
      recencyBoost: options.recencyBoost ?? 0.2,
      recencyWindowDays: options.recencyWindowDays ?? 30,
      hotPathBoost: options.hotPathBoost ?? 0.15,
      exportBoost: options.exportBoost ?? 0.1,
      maxFiles: options.maxFiles ?? 100,
    };
  }

  rankFiles(files: RankableFile[]): RankedFile[] {
    const now = Date.now();
    const maxAge = this.options.recencyWindowDays * 24 * 60 * 60 * 1000;
    
    const scored = files.map(file => {
      const factors: { name: string; value: number; weight: number }[] = [];
      
      const baseScore = file.score ?? 0.5;
      factors.push({ name: "base", value: baseScore, weight: 1 });
      
      if (file.modifiedAt) {
        const age = now - file.modifiedAt.getTime();
        const recency = Math.max(0, 1 - age / maxAge);
        const recencyScore = 1 + (recency * this.options.recencyBoost);
        factors.push({ name: "recency", value: recencyScore, weight: this.options.recencyBoost });
      }
      
      if (file.changeCount && file.changeCount > 1) {
        const hotScore = 1 + Math.min(0.5, file.changeCount * this.options.hotPathBoost);
        factors.push({ name: "hotPath", value: hotScore, weight: this.options.hotPathBoost });
      }
      
      if (file.exports && file.exports > 5) {
        const exportScore = 1 + (Math.min(0.3, file.exports * this.options.exportBoost));
        factors.push({ name: "exports", value: exportScore, weight: this.options.exportBoost });
      }
      
      const finalScore = factors.reduce((sum, f) => sum + f.value * f.weight, 0) /
        factors.reduce((sum, f) => sum + f.weight, 0);
      
      return { ...file, finalScore, rank: 0, factors };
    });
    
    return scored
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, this.options.maxFiles)
      .map((file, index) => ({ ...file, rank: index + 1 }));
  }

  rankSymbols(symbols: ExtractedSymbol[]): ExtractedSymbol[] {
    const symbolMap = new Map<string, ExtractedSymbol[]>();
    for (const symbol of symbols) {
      const existing = symbolMap.get(symbol.file) ?? [];
      existing.push(symbol);
      symbolMap.set(symbol.file, existing);
    }
    
    const files = [...symbolMap.entries()].map(([path, syms]) => ({
      path,
      exports: syms.length,
    }));
    
    const ranked = this.rankFiles(files);
    const fileRanks = new Map(ranked.map(f => [f.path, f.rank]));
    
    return symbols.sort((a, b) => {
      const rankA = fileRanks.get(a.file) ?? 999;
      const rankB = fileRanks.get(b.file) ?? 999;
      return rankA - rankB;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/context/context-ranker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/context-ranker.ts tests/context/context-ranker.test.ts
git commit -m "feat(context-selection): add ContextRanker for relevance-based file ranking"
```

---

### Task 6: ContextBundleBuilder

**Files:**
- Create: `src/context/context-bundle-builder.ts`
- Create: `tests/context/context-bundle-builder.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context/context-bundle-builder.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextBundleBuilder } from "../../src/context/context-bundle-builder.js";
import { RepoMapLite } from "../../src/repomap/repomap-lite.js";
import { ContextRanker } from "../../src/context/context-ranker.js";

describe("ContextBundleBuilder", () => {
  it("builds context bundle within token limit", async () => {
    const builder = new ContextBundleBuilder({ maxTokens: 50000 });
    const repoMap = new RepoMapLite(/* ... */);
    const bundle = await builder.buildBundle(repoMap);
    
    assert.ok(bundle.files.length > 0);
    assert.ok(bundle.totalTokens <= 50000);
    assert.ok(bundle.metadata);
  });

  it("prioritizes high-rank files", async () => {
    const builder = new ContextBundleBuilder({ maxTokens: 10000 });
    const repoMap = new RepoMapLite(/* ... */);
    const bundle = await builder.buildBundle(repoMap);
    
    assert.ok(bundle.files[0].rank <= bundle.files[1].rank);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/context/context-bundle-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ContextBundleBuilder**

```typescript
// src/context/context-bundle-builder.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RepoMapLite } from "../repomap/repomap-lite.js";
import { ContextRanker } from "./context-ranker.js";
import { DependencyGraph } from "../repomap/dependency-graph.js";

export interface ContextBundle {
  files: {
    path: string;
    content: string;
    tokens: number;
    rank: number;
  }[];
  totalTokens: number;
  metadata: {
    generatedAt: Date;
    maxTokens: number;
    fileCount: number;
    excludedFiles: string[];
  };
}

export interface ContextBundleBuilderOptions {
  maxTokens?: number;
  priorityExtensions?: string[];
  excludePatterns?: string[];
}

export class ContextBundleBuilder {
  private options: Required<ContextBundleBuilderOptions>;
  private ranker: ContextRanker;

  constructor(options: ContextBundleBuilderOptions = {}) {
    this.options = {
      maxTokens: options.maxTokens ?? 100000,
      priorityExtensions: options.priorityExtensions ?? [".ts", ".tsx", ".js", ".jsx"],
      excludePatterns: options.excludePatterns ?? ["node_modules", ".test.", ".spec."],
    };
    this.ranker = new ContextRanker();
  }

  async buildBundle(repoMap: RepoMapLite, context?: string): Promise<ContextBundle> {
    const files = repoMap.getAllFiles();
    const ranked = this.ranker.rankFiles(files);
    
    const selected: ContextBundle["files"] = [];
    let totalTokens = 0;
    const excluded: string[] = [];
    
    for (const file of ranked) {
      if (this.shouldExclude(file.path)) {
        excluded.push(file.path);
        continue;
      }
      
      const content = await this.readFileContent(repoMap, file.path);
      const tokens = this.estimateTokens(content);
      
      if (totalTokens + tokens <= this.options.maxTokens) {
        selected.push({
          path: file.path,
          content,
          tokens,
          rank: file.rank,
        });
        totalTokens += tokens;
      } else {
        excluded.push(file.path);
      }
    }
    
    return {
      files: selected,
      totalTokens,
      metadata: {
        generatedAt: new Date(),
        maxTokens: this.options.maxTokens,
        fileCount: selected.length,
        excludedFiles: excluded,
      },
    };
  }

  private async readFileContent(repoMap: RepoMapLite, filePath: string): Promise<string> {
    const fullPath = join(repoMap.rootDir, filePath);
    return readFile(fullPath, "utf-8").catch(() => "");
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private shouldExclude(path: string): boolean {
    return this.options.excludePatterns.some(pattern => path.includes(pattern));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/context/context-bundle-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/context-bundle-builder.ts tests/context/context-bundle-builder.test.ts
git commit -m "feat(context-selection): add ContextBundleBuilder for token-aware context assembly"
```

---

## Execution Options

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**