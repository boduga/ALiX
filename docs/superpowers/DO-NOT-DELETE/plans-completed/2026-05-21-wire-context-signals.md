# Wire Pending Context Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire SemanticSearchIndex and readGitActivity into ContextCompiler so they're consumed by the ranking pipeline.

**Architecture:**
1. Add `SemanticSearchStage` to `ContextPipeline` — runs semantic search over indexed symbols, adds matches as high-priority context items
2. Wire `readGitActivity` into `ContextCompiler.warm()` and pass `gitActivity` map to `RankingStage` for recency-based boosting
3. Both features already exist but aren't connected; this plan connects the dots

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Add SemanticSearchStage to ContextPipeline

**Files:**
- Modify: `src/repomap/context-pipeline.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Read SemanticSearchIndex API**

```typescript
// src/context/semantic-search.ts exports:
export class SemanticSearchIndex {
  constructor(baseDir: string, indexPath?: string);
  async init(): Promise<void>;
  async indexFile(filePath: string, content?: string): Promise<void>;
  async search(query: string, limit?: number): Promise<SearchResult[]>;
}
```

- [ ] **Step 2: Create SemanticSearchStage**

Add after line 50 in `context-pipeline.ts`:

```typescript
import { SemanticSearchIndex } from "../context/semantic-search.js";

export class SemanticSearchStage implements ContextStage<RepoMapOutput, RepoMapOutput> {
  name = "semantic-search";
  private searchIndex: SemanticSearchIndex;
  private indexed: boolean = false;

  constructor(private options: { root: string; task: string }) {
    this.searchIndex = new SemanticSearchIndex(options.root);
  }

  async process(input: RepoMapOutput): Promise<RepoMapOutput> {
    await this.searchIndex.init();
    // Index source files if not already done
    if (!this.indexed) {
      for (const [path, entry] of input.fileEntries) {
        if (entry.kind === "source" && entry.content) {
          try {
            await this.searchIndex.indexFile(path, entry.content);
          } catch { /* skip indexing errors */ }
        }
      }
      this.indexed = true;
    }
    // Return unchanged input — this stage enriches via side-effect in RankingStage
    return input;
  }

  getSearchIndex(): SemanticSearchIndex {
    return this.searchIndex;
  }
}
```

- [ ] **Step 3: Update RankingStage to accept SemanticSearchStage**

Modify `RankingStage` constructor to accept optional `SemanticSearchStage`:

```typescript
export class RankingStage implements ContextStage<RankingInput, RankingOutput> {
  name = "ranking";

  constructor(
    private options: {
      task: string;
      taskType: TaskType;
      pinnedPaths?: string[];
      gitActivity?: Map<string, number>;
      semanticSearchStage?: SemanticSearchStage;
    } = { task: "", taskType: "unknown" }
  ) {}

  async process(input: RankingInput): Promise<RankingOutput> {
    // ... existing code ...

    // Get search index and run search
    if (this.options.semanticSearchStage) {
      const searchIndex = this.options.semanticSearchStage.getSearchIndex();
      const searchResults = await searchIndex.search(this.options.task, 20);
      for (const result of searchResults) {
        if (!items.some(i => i.path === result.path)) {
          const entry = input.fileEntries.get(result.path);
          if (entry) {
            items.push({
              path: result.path,
              kind: entry.kind === "test" ? "test" : entry.kind === "config" ? "config" : "file",
              symbolName: result.symbolName,
              lineStart: result.lineStart,
              lineEnd: result.lineEnd,
              score: result.score, // semantic score used directly
              tokenEstimate: estimateFileTokens(result.path, entry.lineCount ?? 100, entry.kind === "source"),
              reason: `semantic_match:${result.symbolName}`,
            });
          }
        }
      }
    }

    // ... rest of existing code ...
  }
}
```

- [ ] **Step 4: Write regression test**

Add to `tests/repomap/context-pipeline.test.ts`:

```typescript
it("semantic search stage indexes source files", async () => {
  const fs = await import("node:fs/promises");
  const tmpDir = await fs.mkdtemp("/tmp/semantic-stage-test-");
  const testFile = join(tmpDir, "test.ts");
  await fs.writeFile(testFile, "export function hello() { return 'hi'; }");

  const repoMap = await buildRepoMap(tmpDir);
  const stage = new SemanticSearchStage({ task: tmpDir });
  const result = await stage.process(repoMap);

  assert.ok(result.fileEntries.has("test.ts"));
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/repomap/context-pipeline.test.ts 2>&1 | tail -10`

```bash
git add src/repomap/context-pipeline.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-pipeline): add SemanticSearchStage to index symbols
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Wire Git Activity into RankingStage

**Files:**
- Modify: `src/repomap/context-pipeline.ts`
- Modify: `src/repomap/context-compiler.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Read readGitActivity API**

```typescript
// src/repomap/git-activity.ts exports:
export async function readGitActivity(root: string, options?: GitActivityOptions): Promise<Map<string, number>>;
```

- [ ] **Step 2: Update RankingStage to boost by git activity**

Add to step 1 (Task-mentioned files) scoring in `RankingStage.process()`:

```typescript
// Add git activity boost to task-mentioned files
    if (this.options.gitActivity && this.options.gitActivity.size > 0) {
      const gitScore = this.options.gitActivity.get(sf) ?? 0;
      if (gitScore > 0) {
        score += Math.min(gitScore * 2, 20); // Up to 20 point boost for recent files
        reason = score >= 100 ? "task_mention_exact" : "task_mention_fuzzy_with_git_activity";
      }
    }
```

- [ ] **Step 3: Wire readGitActivity into ContextCompiler.warm()**

Modify `src/repomap/context-compiler.ts`:

```typescript
import { readGitActivity } from "./git-activity.js";

// In ContextCompiler class:
async warm(): Promise<RepoMapOutput> {
  const stage = new RepoMapStage();
  this.repoMap = await stage.process({ root: this.options.root });
  this.embeddingCache = new EmbeddingCache(this.options.root);

  // Read git activity for recency boosting in ranking
  const gitActivity = await readGitActivity(this.options.root);
  this.repoMap.gitActivity = gitActivity;

  // Build embeddings in background (non-blocking)
  this.buildEmbeddings().catch(() => {});
  // ... rest unchanged
}
```

- [ ] **Step 4: Update RepoMapOutput type to include gitActivity**

Verify `src/repomap/context-pipeline.ts` line 69 has:

```typescript
export type RepoMapOutput = {
  // ... existing fields ...
  gitActivity: Map<string, number>;
  // ...
};
```

- [ ] **Step 5: Write regression test**

Add to `tests/repomap/context-pipeline.test.ts`:

```typescript
it("ranking stage boosts files by git activity", async () => {
  const fs = await import("node:fs/promises");
  const tmpDir = await fs.mkdtemp("/tmp/git-activity-test-");
  await fs.writeFile(join(tmpDir, "recent.txt"), "export const x = 1;");
  await fs.writeFile(join(tmpDir, "old.txt"), "export const y = 2;");

  const repoMap = await buildRepoMap(tmpDir);
  const gitActivity = new Map<string, number>([
    ["recent.txt", 5],
    ["old.txt", 0],
  ]);
  repoMap.gitActivity = gitActivity;

  const rankingStage = new RankingStage({
    task: "recent.txt",
    taskType: "code",
    gitActivity,
  });

  const result = await rankingStage.process(repoMap);
  const recentItem = result.items.find(i => i.path === "recent.txt");
  const oldItem = result.items.find(i => i.path === "old.txt");

  assert.ok(recentItem);
  assert.ok(oldItem);
  assert.ok(recentItem!.score > oldItem!.score, "Recent file should score higher");

  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/repomap/context-pipeline.test.ts 2>&1 | tail -10`

```bash
git add src/repomap/context-pipeline.ts src/repomap/context-compiler.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-compiler): wire git activity into ranking
- readGitActivity called in warm(), results passed to RankingStage
- Files with recent git activity get up to 20 point score boost
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Integration — Connect SemanticSearchStage to ContextCompiler

**Files:**
- Modify: `src/repomap/context-compiler.ts`
- Test: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: Update compileContext to include both stages**

Modify `ContextCompiler.compileContext()`:

```typescript
import { SemanticSearchStage } from "./context-pipeline.js";

async compileContext(
  task: string,
  taskType: TaskType,
  pinnedPaths?: string[]
): Promise<ContextBundle> {
  const maxTokens = this.options.maxTokens ?? 20000;

  if (!this.repoMap) {
    await this.warm();
  }

  const semanticStage = new SemanticSearchStage({ task, root: this.options.root });

  const pipeline = new ContextPipeline([
    new RankingStage({
      task,
      taskType,
      pinnedPaths: pinnedPaths ?? [],
      gitActivity: this.repoMap!.gitActivity,
      semanticSearchStage: semanticStage,
    }),
    new BudgetingStage({ maxTokens }),
  ]);

  const result = await pipeline.run(this.repoMap!) as { bundle: ContextBundle };
  return result.bundle;
}
```

- [ ] **Step 2: Run all context tests**

Run: `npm test -- tests/repomap/ 2>&1 | tail -15`

- [ ] **Step 3: Commit**

```bash
git add src/repomap/context-compiler.ts tests/repomap/context-pipeline.test.ts
git commit -m "feat(context-compiler): wire SemanticSearchStage into compileContext
- Semantic search runs alongside ranking for symbol-aware context
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Update post-mvp-backlog

**Files:**
- Modify: `docs/post-mvp-backlog.md`

- [ ] **Step 1: Mark semantic search and git activity as implemented**

Update the "Pending (not yet implemented)" section:

```markdown
Pending (not yet implemented):
- None — all context signals are wired

Future upgrades (completed):
- Semantic search — SemanticSearchIndex wired into ContextPipeline via SemanticSearchStage
- Git activity boosting — readGitActivity wired into warm(), scores passed to RankingStage
```

- [ ] **Step 2: Commit**

```bash
git add docs/post-mvp-backlog.md
git commit -m "docs: mark semantic search and git activity as implemented
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

**Files:**
- Run: full test suite

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -10`

- [ ] **Step 2: Verify no regressions**

Expected: All tests pass (910+)

- [ ] **Step 3: Commit final fix**

```bash
git add .
git commit -m "chore: final test verification
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```