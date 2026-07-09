# P13.2 — Failure Pattern Clustering Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans. Steps use checkbox syntax.

**Goal:** Add read-only failure pattern clustering from the P12.5 failure memory store — compute `FailureAnalysis` and `FailureCluster[]`, expose via `alix governance failure-analysis`.

**Architecture:** Pure analysis functions in `failure-clustering.ts` consume `FailureRecord[]` from `FileFailureMemoryStore` and return computed clusters. CLI handler in `governance.ts` reads the store, calls pure functions, renders terminal output or JSON. No writes, no side effects.

**Tech Stack:** Node.js TypeScript, `node:test` + `node:assert/strict`, ANSI terminal output.

## Global Constraints

- P13 never mutates P12 stores — no writes to failure memory, run ledger, policy files, or approval settings
- Clustering is simple field-grouping by `failureType` — no ML, no NLP, no embeddings
- `commonDetailKeywords` = top-N most frequent words in `detail` across each cluster (basic word frequency, tokenize by whitespace/punctuation, filter short/stop words)
- All functions must be pure (no side effects, no I/O)
- Build-first test execution: `pnpm build && node --test dist/tests/governance/failure-clustering.test.js`

---

### Task 1: Implement failure-clustering.ts

**Files:**
- Create: `src/governance/failure-clustering.ts`
- Test: `tests/governance/failure-clustering.test.ts`

**Interfaces:**
- Consumes: `FailureType`, `FailureRecord` from `./failure-memory.js`
- Produces: `computeFailureAnalysis(records: FailureRecord[]): FailureAnalysis`
  - `computeTimeframeDays(records: FailureRecord[]): number`

**Key types:**
```typescript
export interface FailureCluster {
  failureType: FailureType;
  count: number;
  recentTimestamp: string;
  commonDetailKeywords: string[];
  commonFilePaths: string[];
  associatedPolicyIds: string[];
}

export interface FailureAnalysis {
  total: number;
  clusters: FailureCluster[];
  dominantType: FailureType | null;
  recurringFilePaths: string[];
  recurringFilePathCounts: Record<string, number>;
  timeframeDays: number;
}
```

**computeFailureAnalysis:**
1. Group records by `failureType`
2. For each group, build a `FailureCluster`:
   - `count` = number of records
   - `recentTimestamp` = max `timestamp` in group
   - `commonDetailKeywords` = extract top-5 most frequent words from `detail` fields (tokenize, lowercase, filter words < 4 chars, filter common stop words: "the", "this", "that", "with", "from", "was", "were", "have", "been", "not", "for", "are", "has", "had", "but", "can", "all", "its", "not", "any", "out", "one", "use", "may", "see", "set", "two", "use", "way", "who", "now", "how", "then", "than", "just", "also", "over", "such", "each", "when", "what", "which", "file", "could", "would", "should", "about")
   - `commonFilePaths` = collect all `filePaths` across records, return top-5 by frequency
   - `associatedPolicyIds` = collect all `policyIds` across records, deduplicate, sort
3. `dominantType` = failureType with highest count (null if empty); tie-break: alphabetical
4. `recurringFilePaths` = file paths appearing in 2+ records across ALL clusters, sorted by frequency descending, then path ascending for tie-breaks; `recurringFilePathCounts` populated from same data
5. `timeframeDays` = `computeTimeframeDays(records)`
6. Clusters sorted by count descending, then failureType ascending for deterministic tie-breaks

**Deterministic sort rules (applied everywhere):**
- `commonDetailKeywords`: frequency descending, keyword ascending
- `commonFilePaths`: frequency descending, path ascending
- `clusters`: count descending, failureType ascending
- `recurringFilePaths`: frequency descending, path ascending
- `associatedPolicyIds`: alphabetical ascending

**computeTimeframeDays:** same order-agnostic min/max approach as P13.1.

**Test cases:**
1. Empty records returns zero-safe analysis
2. Groups records by failureType
3. Counts correctly per cluster
4. dominantType is the largest cluster
5. commonDetailKeywords extracts top frequent words
6. commonFilePaths collects from records
7. associatedPolicyIds deduplicates
8. recurringFilePaths detects paths in 2+ records
9. timeframeDays computed correctly
10. Single record gives one cluster
11. All 7 failure types present produces 7 clusters
12. Deterministic for identical input
13. Stop words filtered from keywords
14. recentTimestamp is the max timestamp in cluster
15. dominantType tie-breaks alphabetically when counts are equal
16. clusters with equal counts sort alphabetically by failureType
17. recurringFilePaths with equal counts sort alphabetically
18. keyword ties sort alphabetically after frequency

---

### Task 2: Add CLI subcommand

**Files:**
- Modify: `src/cli/commands/governance.ts`

**Changes:**
1. Add type import for `FailureAnalysis` (and optionally `FailureCluster` if needed by renderer)
2. Add `case "failure-analysis":` to switch statement
3. Add `runFailureAnalysis` handler:
   - Uses `FileFailureMemoryStore` from `../../governance/failure-memory.js`
   - Calls `computeFailureAnalysis` from `../../governance/failure-clustering.js`
   - Window filter on timestamps
   - JSON mode: `JSON.stringify({ failureAnalysis })`
4. Add renderer: colored output with cluster counts, dominant type, keywords, file paths

---

### Task 3: Final verification

1. Run GitNexus detect-changes
2. Full build and test suite
3. CLI smoke check (JSON + human-readable)
4. Create PR
