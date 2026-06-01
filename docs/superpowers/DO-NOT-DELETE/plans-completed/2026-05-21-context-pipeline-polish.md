# Context Pipeline Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure ContextPipeline did not regress earlier context richness.

**Architecture:** Compare current ContextPipeline behavior with expected features.

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Audit ContextPipeline Features

**Files:**
- Read: `src/repomap/context-pipeline.ts`
- Read: `src/repomap/context-compiler.ts`
- Read: `tests/repomap/context-pipeline.test.ts`

- [ ] **Step 1: List expected features**

From the plan:
1. **Dependency-related files** — include files that are dependencies of mentioned files
2. **Symbol matches** — include symbols mentioned in task
3. **Git activity** — boost recent files
4. **Semantic search** — (future, may not be implemented)
5. **Pinned files** — respect pinned file hints
6. **Budget ordering** — respect token budget

- [ ] **Step 2: Check each feature in ContextPipeline**

Read context-pipeline.ts and verify each feature is implemented.

---

### Task 2: Verify Dependency-Related Files

**Files:**
- Modify: `src/repomap/context-pipeline.ts`

- [ ] **Step 1: Check RankingStage**

Find where dependencies are added. Should be after task-mentioned files.

```typescript
// In RankingStage.process():
// 5. Add dependencies for mentioned source files
const mentionedPaths = new Set(
  items.filter(i => i.kind === "file" || i.kind === "symbol").map(i => i.path)
);
for (const mentioned of mentionedPaths) {
  const deps = input.dependencyGraph.dependenciesOf(mentioned);
  // ... add dependency files
}
```

- [ ] **Step 2: Fix if missing**

If dependency files are not being added, add the logic.

---

### Task 3: Verify Symbol Matches

**Files:**
- Modify: `src/repomap/context-pipeline.ts`

- [ ] **Step 1: Check symbol matching**

Find where symbols are matched to task mentions.

```typescript
// Should be in RankingStage:
if (input.symbols.length > 0) {
  const taskLower = task.toLowerCase();
  for (const sym of input.symbols) {
    if (sym.name.toLowerCase().includes(taskLower) || taskLower.includes(sym.name.toLowerCase())) {
      // ... add symbol context
    }
  }
}
```

- [ ] **Step 2: Fix if missing**

Add symbol matching logic if not present.

---

### Task 4: Verify Git Activity Boosting

**Files:**
- Modify: `src/repomap/context-pipeline.ts`

- [ ] **Step 1: Check git activity scoring**

Check if gitActivity Map is used to boost recent files.

```typescript
// Should boost files based on gitActivity:
for (const sf of input.sourceFiles) {
  const gitScore = input.gitActivity.get(sf) ?? 0;
  // ... incorporate into scoring
}
```

- [ ] **Step 2: Fix if missing**

Git activity boosting is optional but recommended. Add if not present.

---

### Task 5: Verify Pinned Files

**Files:**
- Modify: `src/repomap/context-pipeline.ts`

- [ ] **Step 1: Check pinned file handling**

Find where pinnedPaths are handled.

```typescript
// Should be in RankingStage:
for (const pinned of pinnedPaths) {
  if (!items.some(i => i.path === pinned)) {
    // ... add pinned file with high score
  }
}
```

- [ ] **Step 2: Verify score is 200 (highest)**

Pinned files should have score: 200 to appear first.

---

### Task 6: Verify Budget Ordering

**Files:**
- Modify: `src/repomap/context-pipeline.ts`

- [ ] **Step 1: Check BudgetingStage**

Verify it:
1. Sorts items by score descending
2. Adds items until token budget is exhausted
3. Categorizes into primaryFiles, supportingFiles, tests, pinned

```typescript
// In BudgetingStage.process():
for (const item of input.items) {
  if (usedTokens + item.tokenEstimate > maxTokens && budgeted.length > 0) break;
  budgeted.push(item);
  usedTokens += item.tokenEstimate;
}
```

- [ ] **Step 2: Fix if missing**

Add budget ordering logic.

---

### Task 7: Write Regression Tests

**Files:**
- Create: `tests/repomap/context-pipeline-features.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/repomap/context-pipeline-features.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextPipeline, RankingStage, BudgetingStage } from "../../src/repomap/context-pipeline.js";
import { buildRepoMap } from "../../src/repomap/context-pipeline.js";

describe("ContextPipeline feature regression", () => {
  it("includes dependency-related files", async () => {
    // Create test repo with import relationships
    // Verify mentioned file's dependencies are included
  });

  it("includes symbol matches", async () => {
    // Create test repo with functions
    // Verify mentioning function name includes the file
  });

  it("respects pinned files with highest score", async () => {
    // Verify pinned files appear first with score 200
  });

  it("respects token budget", async () => {
    // Verify budget.usedTokens <= budget.maxTokens
  });

  it("orders by score descending", async () => {
    // Verify all items sorted by score
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add src/repomap/context-pipeline.ts tests/repomap/context-pipeline-features.test.ts
git commit -m "test(pipeline): add regression tests for context features

- Verify dependency-related files included
- Verify symbol matches included
- Verify pinned files have highest score
- Verify budget ordering
- Verify score ordering

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```