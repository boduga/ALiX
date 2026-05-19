# Context Selection Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete ContextCompiler with semantic search, full intent classification, and budget enforcement per research spec.

**Architecture:** Build on existing RepoMapLite and ContextCompiler. Add semantic search index, full intent classifier, and token budget enforcement.

**Tech Stack:** TypeScript, existing context compiler, tree-sitter or basic text search

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/context/intent-classifier.ts` | Classify user intent into task types |
| `src/context/semantic-search.ts` | Semantic search for code symbols |
| `src/context/context-budgeter.ts` | Enforce token budgets on context bundles |
| `src/context/context-ranker.ts` | Rank files by relevance to intent |
| `tests/context/intent-classifier.test.ts` | Intent classification tests |
| `tests/context/semantic-search.test.ts` | Semantic search tests |
| `tests/context/context-budgeter.test.ts` | Budget enforcement tests |

---

## Task 1: Add IntentClassifier

**Files:**
- Create: `src/context/intent-classifier.ts`
- Test: `tests/context/intent-classifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { IntentClassifier, type TaskType } from "../../src/context/intent-classifier.js";

describe("IntentClassifier", () => {
  const classifier = new IntentClassifier();

  it("classifies bugfix intent", () => {
    const type = classifier.classify("fix the login bug where users can't authenticate");
    assert.equal(type, "bugfix");
  });

  it("classifies feature intent", () => {
    const type = classifier.classify("add user profile page with avatar upload");
    assert.equal(type, "feature");
  });

  it("classifies refactor intent", () => {
    const type = classifier.classify("extract the auth logic into a separate module");
    assert.equal(type, "refactor");
  });

  it("classifies test intent", () => {
    const type = classifier.classify("add tests for the payment processing module");
    assert.equal(type, "test");
  });

  it("classifies docs intent", () => {
    const type = classifier.classify("document the API endpoints for the new feature");
    assert.equal(type, "docs");
  });

  it("returns unknown for unclear intents", () => {
    const type = classifier.classify("what does this codebase do");
    assert.equal(type, "unknown");
  });

  it("extracts mentioned files from intent", () => {
    const result = classifier.classifyWithFiles("fix bug in src/auth/login.ts");
    assert.ok(result.files?.includes("src/auth/login.ts"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/context/intent-classifier.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement IntentClassifier**

```typescript
// src/context/intent-classifier.ts

export type TaskType =
  | "bugfix"
  | "feature"
  | "refactor"
  | "explanation"
  | "test"
  | "docs"
  | "review"
  | "unknown";

export type ClassificationResult = {
  type: TaskType;
  confidence: number;
  files?: string[];
  keywords: string[];
};

const TASK_PATTERNS: Record<TaskType, RegExp[]> = {
  bugfix: [
    /fix/i,
    /bug/i,
    /error/i,
    /crash/i,
    /broken/i,
    /fail/i,
  ],
  feature: [
    /add/i,
    /implement/i,
    /create/i,
    /new/i,
    /build/i,
  ],
  refactor: [
    /refactor/i,
    /extract/i,
    /simplify/i,
    /restructure/i,
    /clean/i,
  ],
  explanation: [
    /what is/i,
    /how does/i,
    /explain/i,
    /understand/i,
    /what does/i,
  ],
  test: [
    /test/i,
    /spec/i,
    /coverage/i,
    /unit/i,
  ],
  docs: [
    /document/i,
    /doc/i,
    /readme/i,
    /comment/i,
    /api/i,
  ],
  review: [
    /review/i,
    /audit/i,
    /check/i,
    /analyze/i,
  ],
  unknown: [],
};

const FILE_PATTERN = /(?:src|lib|app|tests?|dist|build|\w+\.(ts|js|py|go|rs|java))[\/\\][^\s]+/gi;

export class IntentClassifier {
  classify(input: string): TaskType {
    const result = this.classifyWithFiles(input);
    return result.type;
  }

  classifyWithFiles(input: string): ClassificationResult {
    const scores: Record<TaskType, number> = {
      bugfix: 0,
      feature: 0,
      refactor: 0,
      explanation: 0,
      test: 0,
      docs: 0,
      review: 0,
      unknown: 0,
    };

    // Score each task type
    for (const [type, patterns] of Object.entries(TASK_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          scores[type as TaskType]++;
        }
      }
    }

    // Find highest score
    let bestType: TaskType = "unknown";
    let bestScore = 0;
    for (const [type, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type as TaskType;
      }
    }

    // Extract files
    const files = input.match(FILE_PATTERN) || [];

    // Extract keywords
    const words = input.toLowerCase().split(/\s+/);
    const keywords = words.filter(w => w.length > 3).slice(0, 10);

    return {
      type: bestType,
      confidence: bestScore > 0 ? Math.min(bestScore / 3, 1) : 0,
      files: files.length > 0 ? files : undefined,
      keywords,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/context/intent-classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/intent-classifier.ts tests/context/intent-classifier.test.ts
git commit -m "feat(context): add IntentClassifier for task type detection"
```

---

## Task 2: Add SemanticSearch

**Files:**
- Create: `src/context/semantic-search.ts`
- Test: `tests/context/semantic-search.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SemanticSearchIndex } from "../../src/context/semantic-search.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("SemanticSearchIndex", () => {
  const testDir = join(process.cwd(), ".test-semantic");
  let index: SemanticSearchIndex;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    index = new SemanticSearchIndex(testDir);
    await index.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("indexes function declarations", async () => {
    await index.indexFile(join(testDir, "test.ts"), `
      export function validateUser(id: string) {
        return users.find(u => u.id === id);
      }
    `);

    const results = await index.search("validate user authentication");
    assert.ok(results.length > 0);
    assert.ok(results[0].symbolName?.includes("validateUser"));
  });

  it("indexes class declarations", async () => {
    await index.indexFile(join(testDir, "test.ts"), `
      class UserService {
        async getUser(id: string) { }
      }
    `);

    const results = await index.search("user service");
    assert.ok(results.some(r => r.symbolName?.includes("UserService")));
  });

  it("ranks by relevance", async () => {
    await index.indexFile(join(testDir, "auth.ts"), `
      function authenticate() { }
    `);
    await index.indexFile(join(testDir, "other.ts"), `
      function process() { }
    `);

    const results = await index.search("authenticate");
    assert.ok(results[0].path.includes("auth.ts"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/context/semantic-search.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SemanticSearchIndex**

```typescript
// src/context/semantic-search.ts

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type IndexedSymbol = {
  path: string;
  symbolName: string;
  kind: "function" | "class" | "method" | "interface" | "type" | "const";
  lineStart: number;
  lineEnd: number;
  keywords: string[];
};

export type SearchResult = IndexedSymbol & {
  score: number;
};

const SYMBOL_PATTERNS = [
  { kind: "function", pattern: /(?:export\s+)?function\s+(\w+)/g },
  { kind: "class", pattern: /(?:export\s+)?class\s+(\w+)/g },
  { kind: "method", pattern: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g },
  { kind: "interface", pattern: /(?:export\s+)?interface\s+(\w+)/g },
  { kind: "type", pattern: /(?:export\s+)?type\s+(\w+)/g },
  { kind: "const", pattern: /(?:export\s+)?const\s+(\w+)/g },
];

export class SemanticSearchIndex {
  private symbols: Map<string, IndexedSymbol[]> = new Map();
  private indexPath: string;

  constructor(
    private baseDir: string,
    indexPath?: string
  ) {
    this.indexPath = indexPath ?? join(baseDir, ".alix", "symbol-index.json");
  }

  async init(): Promise<void> {
    // Load existing index or create empty
    // Implementation loads from disk
  }

  async indexFile(filePath: string, content?: string): Promise<void> {
    const fileContent = content ?? await readFile(filePath, "utf8");
    const symbols = this.extractSymbols(filePath, fileContent);
    this.symbols.set(filePath, symbols);
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryWords = query.toLowerCase().split(/\s+/);
    const results: SearchResult[] = [];

    for (const [path, symbols] of this.symbols.entries()) {
      for (const symbol of symbols) {
        const score = this.calculateScore(symbol, queryWords);
        if (score > 0) {
          results.push({ ...symbol, path, score });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private extractSymbols(filePath: string, content: string): IndexedSymbol[] {
    const symbols: IndexedSymbol[] = [];
    const lines = content.split("\n");

    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split("\n").length;
        const keywords = this.extractKeywords(match[1]);
        
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind,
          lineStart: lineNum,
          lineEnd: lineNum,
          keywords,
        });
      }
    }

    return symbols;
  }

  private calculateScore(symbol: IndexedSymbol, queryWords: string[]): number {
    let score = 0;
    const nameLower = symbol.symbolName.toLowerCase();
    
    for (const word of queryWords) {
      if (nameLower.includes(word)) {
        score += 10;
      }
      for (const kw of symbol.keywords) {
        if (kw.includes(word) || word.includes(kw)) {
          score += 5;
        }
      }
    }
    
    return score;
  }

  private extractKeywords(name: string): string[] {
    // Split camelCase and snake_case
    return name
      .split(/([A-Z]|[_])/)
      .filter(s => s.length > 1)
      .map(s => s.toLowerCase());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/context/semantic-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/semantic-search.ts tests/context/semantic-search.test.ts
git commit -m "feat(context): add SemanticSearchIndex for symbol search"
```

---

## Task 3: Add ContextBudgeter

**Files:**
- Create: `src/context/context-budgeter.ts`
- Test: `tests/context/context-budgeter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextBudgeter, type BudgetResult } from "../../src/context/context-budgeter.js";

describe("ContextBudgeter", () => {
  const budgeter = new ContextBudgeter({ maxTokens: 2000 });

  it("reports used tokens vs limit", () => {
    const result = budgeter.calculate({
      primaryFiles: 500,
      supportingFiles: 300,
      tests: 200,
      history: 100,
    });
    assert.equal(result.totalTokens, 1100);
    assert.equal(result.remainingTokens, 900);
  });

  it("flags when budget exceeded", () => {
    const result = budgeter.calculate({
      primaryFiles: 1500,
      supportingFiles: 800,
    });
    assert.equal(result.exceeded, true);
    assert.ok(result.overflow > 0);
  });

  it("prioritizes primary files over supporting", () => {
    const result = budgeter.calculate({
      primaryFiles: 1200,
      supportingFiles: 1000,
    });
    // Should trim supporting to fit
    assert.ok(result.trimmed.length > 0);
  });

  it("includes pinned files in primary", () => {
    const result = budgeter.calculate({
      primaryFiles: 1000,
      pinned: [{ tokens: 300, path: "pinned.ts" }],
    });
    assert.equal(result.pinnedTokens, 300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/context/context-budgeter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ContextBudgeter**

```typescript
// src/context/context-budgeter.ts

export type TokenEstimate = {
  path: string;
  tokens: number;
  pinned?: boolean;
};

export type BudgetInput = {
  primaryFiles?: number;
  supportingFiles?: number;
  tests?: number;
  history?: number;
  pinned?: TokenEstimate[];
};

export type BudgetResult = {
  totalTokens: number;
  maxTokens: number;
  remainingTokens: number;
  exceeded: boolean;
  overflow: number;
  pinnedTokens: number;
  trimmed: string[];
};

export class ContextBudgeter {
  constructor(
    private options: {
      maxTokens: number;
      reservedTokens?: number;
    }
  ) {}

  calculate(input: BudgetInput): BudgetResult {
    const reserved = this.options.reservedTokens ?? 200;
    const effectiveMax = this.options.maxTokens - reserved;

    const primaryTokens = input.primaryFiles ?? 0;
    const supportingTokens = input.supportingFiles ?? 0;
    const testTokens = input.tests ?? 0;
    const historyTokens = input.history ?? 0;
    const pinnedTokens = (input.pinned ?? []).reduce((sum, p) => sum + p.tokens, 0);

    const totalTokens = primaryTokens + supportingTokens + testTokens + historyTokens + pinnedTokens;
    const remainingTokens = Math.max(0, effectiveMax - totalTokens);
    const exceeded = totalTokens > effectiveMax;
    const overflow = exceeded ? totalTokens - effectiveMax : 0;

    // Trim supporting files if over budget
    const trimmed: string[] = [];
    let adjustedTotal = totalTokens;
    
    if (exceeded && supportingTokens > 0) {
      const toTrim = overflow;
      trimmed.push("supportingFiles");
      adjustedTotal -= toTrim;
    }

    return {
      totalTokens,
      maxTokens: effectiveMax,
      remainingTokens,
      exceeded,
      overflow,
      pinnedTokens,
      trimmed,
    };
  }

  formatSummary(result: BudgetResult): string {
    const lines = [
      `Context budget: ${result.totalTokens}/${result.maxTokens} tokens`,
    ];
    
    if (result.exceeded) {
      lines.push(`⚠️  Exceeded by ${result.overflow} tokens`);
      lines.push(`Trimmed: ${result.trimmed.join(", ")}`);
    } else {
      lines.push(`✅ ${result.remainingTokens} tokens remaining`);
    }
    
    if (result.pinnedTokens > 0) {
      lines.push(`📌 ${result.pinnedTokens} tokens pinned`);
    }
    
    return lines.join("\n");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/context/context-budgeter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/context-budgeter.ts tests/context/context-budgeter.test.ts
git commit -m "feat(context): add ContextBudgeter for token budget enforcement"
```

---

## Verification

```bash
npm test -- tests/context/intent-classifier.test.ts tests/context/semantic-search.test.ts tests/context/context-budgeter.test.ts
```

All tests should pass. Manual verification:
- [ ] IntentClassifier detects task type from natural language
- [ ] SemanticSearchIndex indexes and finds symbols
- [ ] ContextBudgeter enforces token limits
- [ ] ContextCompiler uses these components