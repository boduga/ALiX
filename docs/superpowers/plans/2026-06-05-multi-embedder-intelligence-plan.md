# Multi-Embedder Intelligence Implementation Plan

**Date:** 2026-06-05
**Source:** "The Calculus of Association" (Royse, 2026) — multi-embedder panels, kernel compression, cosine guardrails
**Goal:** Add three features inspired by multi-embedder intelligence theory: (A) multi-embedder search with weighted fusion, (B) kernel/grounding-set file selection, (C) cosine guardrails for output validation.

---

## Feature A: Multi-Embedder Search + Weighted Fusion

**Based on:** Multi-embedder panels + weighted vector search from the paper.

**Current ALiX:** One embedding model (`all-MiniLM-L6-v2`, 68MB) is loaded but its `search()` method is **never called** from the context pipeline. The pipeline uses a keyword-based symbol index instead.

**Target:** Wire the existing `EmbeddingCache.search()` into the pipeline, add a second code-specific model, and fuse both with keyword scores using per-query configurable weights.

### Architecture

```
Task Query
  │
  ├─→ Keyword Search (existing) ──────→ {path, score: 80+}
  │     (SemanticSearchIndex)
  │
  ├─→ Semantic Embedder (all-MiniLM) ──→ {path, score: 0-1}
  │     (EmbeddingCache.search)
  │
  └─→ Code Embedder (codebert-base) ───→ {path, score: 0-1}
        (new EmbeddingCache2 instance)
         │
         ▼
    WeightedFusion
      weight.kw = 0.4 + (0.1 if task mentions symbols)
      weight.sem = 0.3 + (0.1 if task is "explain"/"docs")
      weight.code = 0.3 + (0.1 if task is "fix"/"implement"/"refactor")
      │
      ▼
    finalScore = kw.normalized * weight.kw +
                 sem.similarity * weight.sem +
                 code.similarity * weight.code
      │
      ▼
    RankingStage (existing) picks top-N
```

### Files to Modify

| File | Change |
|------|--------|
| `src/repomap/embedding-cache.ts` | Add model config (modelName parameter), support multiple instances |
| `src/repomap/context-pipeline.ts` | Add `MultiEmbedderStage` between RepoMapStage and RankingStage |
| `src/repomap/context-ranker.ts` | Add fusion scoring with task-type weights |
| `src/context/semantic-search.ts` | Normalize keyword scores to 0-1 for compatibility with fusion |
| `src/repomap/context-compiler.ts` | Wire MultiEmbedderStage into the pipeline |
| `tests/repomap/multi-embedder.test.ts` | New tests |

### Key Implementation Details

**embedding-cache.ts changes:**
```typescript
export type EmbedderConfig = {
  modelName: string;
  pooling?: "mean" | "cls";
  normalize?: boolean;
  cacheDir?: string;
  label: string;  // "semantic" | "code" | "custom"
};

export class EmbeddingCache {
  constructor(root: string, config: EmbedderConfig) {
    // Use config.modelName instead of hardcoded Xenova/all-MiniLM-L6-v2
    // Use label for cache directory: .alix/embeddings/semantic/, .alix/embeddings/code/
  }
}
```

**New MultiEmbedderStage in context-pipeline.ts:**
```typescript
export class MultiEmbedderStage implements ContextStage<RepoMapOutput, RepoMapOutput> {
  private embedders: EmbeddingCache[];
  private weights: { label: string; weight: number }[];

  async process(input: RepoMapOutput): Promise<RepoMapOutput> {
    const sourceFiles = [...input.fileEntries.values()]
      .filter(e => e.kind === "source" && e.content);

    // Run all embedders in parallel
    const allResults = await Promise.all(
      this.embedders.map(ec => ec.search(task, 10, sourceFiles))
    );

    // Fuse scores
    for (const [idx, results] of allResults.entries()) {
      const weight = this.weights[idx].weight;
      for (const r of results) {
        r.score *= weight;  // Apply embedder weight
      }
    }

    // Merge and sort
    input.semanticScores = mergeScores(allResults);
    return input;
  }
}
```

**Weighted fusion function:**
```typescript
function computeWeights(taskType: TaskType, task: string): EmbedderWeights {
  const w: EmbedderWeights = { keyword: 0.4, semantic: 0.3, code: 0.3 };
  if (["bugfix", "refactor"].includes(taskType)) w.code += 0.15;
  if (["research", "docs"].includes(taskType)) w.semantic += 0.15;
  if (task.match(/\b\w+\b/g)?.every(w => w.length < 20)) w.keyword += 0.1;
  // Normalize to sum to 1.0
  const total = w.keyword + w.semantic + w.code;
  w.keyword /= total; w.semantic /= total; w.code /= total;
  return w;
}
```

**Test plan:**
- `"fix null pointer in auth.ts"` → keyword weight high (file mentioned), code weight medium
- `"explain how caching works"` → semantic weight high (documentation/explanation)
- `"refactor the payment service"` → code weight high (refactoring code)

---

## Feature B: Kernel / Grounding Set File Selection

**Based on:** Kernel / Minimum Grounding Set from the paper.

**Current ALiX:** Context pipeline scores every file, then greedily picks top-N. All files are treated equally — no awareness that some files are "kernel" (high connectivity, referenced by many others) and most are "leaf" (low connectivity, referenced by few).

**Target:** Identify the **minimum grounding set** — the files that, if included in context, make everything else understandable by association. Prioritize kernel files over leaf files.

### How to Identify Kernel Files

The dependency graph (`src/repomap/dependency-graph.ts`) already tracks which files import which. Use it to compute:

```
kernelScore(file) = 
  transitive_dependents(file).length × 0.5 +   // how many files depend on this
  direct_imports(file).length × 0.3 +           // how many things it imports
  exports(file).length × 0.2                     // how much it exposes
```

Files with high kernel scores (top 10%) are "grounding set" — they define the vocabulary every other file uses. These get boosted during ranking.

### Formula

```typescript
function computeKernelScore(
  file: string,
  graph: DependencyGraph,
  symbols: ExtractedSymbol[]
): number {
  // Count dependents: how many files would break if this file changed
  const transitiveDependents = countTransitiveDependents(file, graph);
  // Count imports: how connected this file is to the rest
  const imports = graph.dependenciesOf(file).length;
  // Count exports: how much API surface this file exposes
  const exports = symbols.filter(s => s.file === file).length;

  return transitiveDependents * 0.5 + imports * 0.3 + exports * 0.2;
}
```

### Files to Modify

| File | Change |
|------|--------|
| `src/repomap/context-pipeline.ts` | Add `kernelScore` to `RepoMapOutput`, add `KernelStage` |
| `src/repomap/dependency-graph.ts` | Export `countTransitiveDependents` (exists but may be private) |
| `src/repomap/context-ranker.ts` | Add kernelScore as a ranking factor (+0 to +30) |

**KernelStage:**
```typescript
export class KernelStage implements ContextStage<RepoMapOutput, RepoMapOutput> {
  async process(input: RepoMapOutput): Promise<RepoMapOutput> {
    const scores = new Map<string, number>();
    for (const file of input.sourceFiles) {
      const k = computeKernelScore(file, input.dependencyGraph, input.symbols);
      scores.set(file, k);
    }
    // Normalize scores to 0-30 range
    input.kernelScores = normalize(scores, 0, 30);
    return input;
  }
}
```

In `RankingStage.process()`, add kernel boost:
```typescript
const kernelBoost = input.kernelScores?.get(sf) ?? 0;
finalScore += kernelBoost;  // Files with high connectivity get +0 to +30
```

**Effect:** A utility file like `src/utils/helpers.ts` that 40 files import from gets a +15-25 boost. A leaf file like `src/pages/settings/theme.tsx` that nothing imports gets +0. The grounding set rises to the top naturally.

---

## Feature C: Cosine Guardrails

**Based on:** Cosine similarity guardrails / Teleological Constellation Training from the paper.

**Current ALiX:** No validation that a generated output "belongs" to the expected domain before applying it.

**Target:** Before executing a tool call from the model, check whether the output (file content, patch) is within an expected **behavior constellation** — a pre-computed region of embedding space that represents "this kind of change is safe for this kind of file."

### How It Works

1. **Build guardrails** per file type during `warm()`:
   - For each source file, compute its embedding
   - Record the base embedding as the "constellation center"
   - Compute a cosine similarity threshold (e.g., 0.85) as the guardrail boundary

2. **Check before tool execution** (in `task-loop.ts`, before `file.create` / `patch.apply`):
   - Embed the proposed new content
   - Compare to the original file's embedding
   - If cosine similarity < threshold, warn or require approval

### Formula

```typescript
function checkGuardrail(
  originalContent: string,
  proposedContent: string,
  embedder: EmbeddingCache,
  threshold: number = 0.85
): { passed: boolean; similarity: number } {
  const original = await embedder.getEmbedding(originalContent.slice(0, 2000));
  const proposed = await embedder.getEmbedding(proposedContent.slice(0, 2000));
  const similarity = cosineSimilarity(original, proposed);
  return { passed: similarity >= threshold, similarity };
}
```

### Files to Modify

| File | Change |
|------|--------|
| `src/repomap/embedding-cache.ts` | Add `cosineSimilarity()` as public method |
| `src/tools/tool-router.ts` | Add guardrail check in `file.create` and `patch.apply` handlers |
| `src/agent/agent.ts` | Pass guardrail config to executor |
| `tests/repomap/guardrails.test.ts` | New tests |

### Thresholds by Operation

| Operation | Threshold | Reasoning |
|-----------|-----------|-----------|
| `file.create` | 0.70 | New files are new — lower threshold allows creativity |
| `patch.apply` (modify) | 0.85 | Existing files should stay recognizably related |
| `patch.apply` (refactor) | 0.60 | Major refactors intentionally diverge |

### Test Plan

```typescript
// A small change to a file should be within guardrail
const original = "export function foo() { return 1; }";
const proposed = "export function foo() { return 2; }";
const result = await checkGuardrail(original, proposed, embedder);
assert.ok(result.passed); // Similarity > 0.85

// A completely different file should fail guardrail
const totallyDifferent = "import React from 'react'; ...";
const result2 = await checkGuardrail(original, totallyDifferent, embedder);
assert.ok(!result2.passed); // Similarity < 0.70
```

---

## Implementation Order

| Priority | Feature | Effort | Why First |
|----------|---------|--------|-----------|
| 1 | **A: Multi-embedder + Fusion** | ~3 hr | Core — without embeddings there's nothing to fuse or guard |
| 2 | **B: Kernel Selection** | ~2 hr | Depends on A (uses embedder scores) |
| 3 | **C: Cosine Guardrails** | ~2 hr | Depends on A (uses embedding comparison) |

Each feature is independent enough to be done as a separate PR/merge. B and C both depend on A (they need an working embedder), so A must come first.

---

## Self-Review

- [x] Feature A: Multi-embedder with weighted fusion — model config, search wiring, per-query weights
- [x] Feature B: Kernel/grounding set — dependency-based connectivity scoring, ranking boost
- [x] Feature C: Cosine guardrails — pre-execution similarity check, operation-specific thresholds
- [x] All three have concrete formulas, file paths, and test plans
- [x] No pseudoscience — only measurable, testable changes
- [x] Order respects dependencies (A → B, A → C)
