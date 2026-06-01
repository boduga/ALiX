# ContextPipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `ContextCompiler` into a `ContextPipeline` with discrete stages. Each stage is independently testable. `warm()` becomes the `RepoMapStage` instead of hidden initialization.

**Architecture:** Pipeline with ordered stages: `RepoMapStage` → `RankingStage` → `BudgetingStage`. Each stage consumes the previous output. Stages own their caching. The pipeline manages orchestration and event emission.

**Tech Stack:** TypeScript, node:test, existing fixture setup.

---

### Task 1: Define ContextStage Interface

**Files:**
- Create: `src/repomap/context-pipeline.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/repomap/context-pipeline.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextStage } from "../../src/repomap/context-pipeline.js";

describe("ContextPipeline", () => {
  it("has a run method", () => {
    const pipeline = new ContextPipeline([]);
    assert.equal(typeof pipeline.run, "function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/repomap/context-pipeline.ts
export interface ContextStage<I, O> {
  name: string;
  process(input: I): Promise<O>;
}

export class ContextPipeline {
  constructor(private stages: ContextStage<unknown, unknown>[] = []) {}

  async run(input: unknown): Promise<unknown> {
    let result = input;
    for (const stage of this.stages) {
      result = await stage.process(result);
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-pipeline.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-pipeline): define ContextStage interface"
```

---

### Task 2: Implement RepoMapStage

**Files:**
- Modify: `src/repomap/context-pipeline.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("RepoMapStage builds repo map", async () => {
  const stage = new RepoMapStage({ root: "/tmp/test-repo" });
  const result = await stage.process({ root: "/tmp/test-repo" });
  assert.ok(result.files);
  assert.ok(Array.isArray(result.files));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
export type RepoMapInput = { root: string };
export type RepoMapOutput = {
  sourceFiles: string[];
  testFiles: string[];
  configFiles: string[];
  docsFiles: string[];
  fileEntries: Map<string, FileEntry>;
  dependencyGraph: DependencyGraph;
  symbols: ExtractedSymbol[];
  gitActivity: Map<string, number>;
};

export class RepoMapStage implements ContextStage<RepoMapInput, RepoMapOutput> {
  name = "repo-map";

  constructor(
    private options: { root: string; loadFromCache?: boolean } = { root: "." }
  ) {}

  async process(input: RepoMapInput): Promise<RepoMapOutput> {
    const root = input.root || this.options.root;
    return buildRepoMap(root);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-pipeline.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-pipeline): implement RepoMapStage"
```

---

### Task 3: Implement RankingStage

**Files:**
- Modify: `src/repomap/context-pipeline.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("RankingStage sorts files by relevance", async () => {
  const stage = new RankingStage({ task: "fix bug in auth", taskType: "bugfix" });
  const repoMap = createMockRepoMap();
  const result = await stage.process(repoMap);
  assert.ok(result.items.length > 0);
  // Highest score first
  assert.ok(result.items[0].score >= result.items[1].score);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
export type RankingInput = RepoMapOutput;
export type RankingOutput = {
  items: ContextItem[];
  repoMap: RepoMapOutput;
};

export class RankingStage implements ContextStage<RankingInput, RankingOutput> {
  name = "ranking";

  constructor(private options: { task: string; taskType: TaskType; pinnedPaths?: string[] } = { task: "", taskType: "unknown" }) {}

  async process(input: RankingInput): Promise<RankingOutput> {
    const mentions = extractTaskMentions(this.options.task);
    const items: ContextItem[] = [];

    // Score and rank files (moved from ContextCompiler.compile())
    for (const file of input.sourceFiles) {
      const entry = input.fileEntries.get(file);
      if (!entry) continue;
      const score = scoreMention(file, mentions);
      if (score > 0) {
        items.push({ path: file, kind: "file", score, tokenEstimate: estimateFileTokens(file, entry.lineCount ?? 100, true), reason: "task_mention" });
      }
    }

    items.sort((a, b) => b.score - a.score);
    return { items, repoMap: input };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-pipeline.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-pipeline): implement RankingStage"
```

---

### Task 4: Implement BudgetingStage

**Files:**
- Modify: `src/repomap/context-pipeline.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("BudgetingStage respects maxTokens", async () => {
  const stage = new BudgetingStage({ maxTokens: 500 });
  const ranked: RankingOutput = {
    items: [{ path: "a.ts", kind: "file", score: 100, tokenEstimate: 300, reason: "" }, { path: "b.ts", kind: "file", score: 90, tokenEstimate: 300, reason: "" }],
    repoMap: null as any,
  };
  const result = await stage.process(ranked);
  // Only first item fits within 500 token budget (300 + 300 > 500, so only first)
  assert.equal(result.bundle.primaryFiles.length, 1);
  assert.equal(result.bundle.budget.usedTokens, 300);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
export type BudgetingInput = RankingOutput;
export type BudgetingOutput = { bundle: ContextBundle };

export class BudgetingStage implements ContextStage<BudgetingInput, BudgetingOutput> {
  name = "budgeting";

  constructor(private options: { maxTokens: number } = { maxTokens: 20000 }) {}

  async process(input: BudgetingInput): Promise<BudgetingOutput> {
    let usedTokens = 0;
    const budgeted: ContextItem[] = [];

    for (const item of input.items) {
      if (usedTokens + item.tokenEstimate > this.options.maxTokens && budgeted.length > 0) break;
      budgeted.push(item);
      usedTokens += item.tokenEstimate;
    }

    return {
      bundle: {
        id: `bundle-${Date.now()}`,
        taskType: "unknown",
        budget: { maxTokens: this.options.maxTokens, usedTokens },
        primaryFiles: budgeted.filter(i => i.kind === "file" || i.kind === "symbol"),
        supportingFiles: budgeted.filter(i => i.kind === "config" || i.kind === "doc"),
        tests: budgeted.filter(i => i.kind === "test"),
        pinned: [],
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repomap/context-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-pipeline.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-pipeline): implement BudgetingStage"
```

---

### Task 5: Wire Pipeline into ContextCompiler

**Files:**
- Modify: `src/repomap/context-compiler.ts`
- Test: Existing context-compiler tests

- [ ] **Step 1: Verify existing tests pass**

Run: `node --test dist/tests/repomap/context-compiler.test.js 2>&1 | tail -10`
Expected: All pass

- [ ] **Step 2: Refactor ContextCompiler**

Replace `warm()` and `compile()` with pipeline calls:

```typescript
export class ContextCompiler {
  private pipeline: ContextPipeline;
  private pipelineInput: { root: string; task: string; taskType: TaskType; maxTokens: number };

  constructor(options: ContextCompilerOptions) {
    this.pipeline = new ContextPipeline([
      new RepoMapStage({ root: options.root }),
      new RankingStage({ task: "", taskType: "unknown" }),
      new BudgetingStage({ maxTokens: options.maxTokens ?? 20000 }),
    ]);
  }

  async warm(): Promise<RepoMapOutput> {
    const result = await this.pipeline.run({ root: this.options.root });
    this.pipelineInput = { root: this.options.root, task: "", taskType: "unknown", maxTokens: this.options.maxTokens ?? 20000 };
    return result as RepoMapOutput;
  }

  async compile(task: string, taskType: TaskType, maxTokens: number, pinnedPaths?: string[]): Promise<ContextBundle> {
    // Re-run pipeline with task context
    const rankingStage = this.pipeline.stages[1] as RankingStage;
    rankingStage.update({ task, taskType, pinnedPaths });
    const result = await this.pipeline.run({ root: this.options.root });
    return (result as BudgetingOutput).bundle;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `node --test dist/tests/repomap/context-compiler.test.js 2>&1 | tail -10`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/repomap/context-compiler.ts
git commit -m "refactor(context-compiler): delegate to ContextPipeline"
```