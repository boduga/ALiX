# P13.2 — Governance Failure Pattern Clustering Design Spec

**Date:** 2026-07-05
**Status:** Design — implementation deferred.

## Purpose

P13.2 groups P12.5 failure memory records into clusters by `failureType`, extracts common keywords from failure details, identifies recurring file paths and associated policies, and surfaces the dominant failure pattern. This makes failure memory actionable for human operators without requiring them to manually cross-reference `failure-memory.jsonl`.

P13.1 answers "what happened across all runs." P13.2 answers "what's failing and what's the pattern."

## Core invariant

**Cluster failure evidence, don't change how failures are recorded.**

P13.2 reads failure memory and analyses it. It never:
- Writes to failure memory
- Modifies policy rules or risk thresholds
- Blocks or delays any run
- Changes how `FileFailureMemoryStore` records data

## Architecture

```
Failure Memory ──→ P13.2 Failure Clustering ──→ P13.3 Policy Suggestions
(file JSONL)         (field grouping)              (cross-reference)
                       │
                       └──→ P13.5 Governance Report CLI
```

P13.2 is a pure transformation: `FailureRecord[] → FailureAnalysis`. The CLI reads the store, passes records to the pure function, and renders output. No intermediate persistence.

## Types

```typescript
// --- Exported (from P13.2 failure-clustering.ts) ---

interface FailureCluster {
  failureType: FailureType;          // e.g. "test_failure"
  count: number;                     // records in this group
  recentTimestamp: string;           // max timestamp in cluster
  commonDetailKeywords: string[];    // top-5 frequent words
  commonFilePaths: string[];         // top-5 frequent file paths
  associatedPolicyIds: string[];     // deduplicated policy IDs
}

interface FailureAnalysis {
  total: number;                     // total records analysed
  clusters: FailureCluster[];        // sorted by count descending
  dominantType: FailureType | null;  // largest cluster, null if empty
  recurringFilePaths: string[];      // paths in 2+ records, across all clusters
  recurringFilePathCounts: Record<string, number>;  // occurrence count per recurring path
  timeframeDays: number;             // min-max timestamp span of actual data
}
```

## Display-only severity mapping

The terminal renderer maps `FailureType` to a severity label for colored output. This is a deterministic mapping used only for rendering — it is not part of the analysis data model:

| FailureType | Severity | Color |
|-------------|----------|-------|
| `approval_denied` | high | Red |
| `pr_rejected` | high | Red |
| `policy_denied` | medium | Yellow |
| `file_scope_violation` | medium | Yellow |
| `blocked_command` | medium | Yellow |
| `verification_timeout` | low | Green |
| `test_failure` | low | Green |

```typescript
function failureSeverityForType(type: FailureType): "high" | "medium" | "low" {
  // deterministic mapping, no data dependency
}
```

## Pure functions

### `computeFailureAnalysis(records: FailureRecord[]): FailureAnalysis`

**Grouping:** Records are grouped by `failureType` (7 possible values). Each group produces one `FailureCluster`.

**Keyword extraction:** All `detail` strings in a cluster are concatenated, tokenized on non-alphanumeric boundaries, words < 4 chars and stop words filtered, remaining tokens counted by frequency, top-5 returned. Stop word list covers ~50 common English words (determiners, prepositions, common verbs).

**File paths:** `commonFilePaths` collects all `filePaths` across records in a cluster, counts frequency, returns top-5 descending. `recurringFilePaths` does the same across ALL records but only includes paths appearing in ≥2 records.

**Policy IDs:** `associatedPolicyIds` collects all `policyIds` across records in a cluster, deduplicates, sorts alphabetically.

**Timeframe:** `computeTimeframeDays` calculates the day span between the earliest and latest `timestamp` values — order-agnostic min/max.

**Dominant type:** The cluster with the highest count. Tie-break: alphabetical by `failureType`. Null when no records.

### `computeTimeframeDays(records: FailureRecord[]): number`

Same implementation as P13.1's `computeTimeframeDays`. Returns 0 for empty array.

## CLI

```bash
alix governance failure-analysis [--window N] [--json]
```

Reads from `FileFailureMemoryStore` (P12.5), applies window filter (default 90 days), passes records to `computeFailureAnalysis`, renders colored terminal output or JSON.

**Terminal output:**
```
Governance Failure Analysis
═══════════════════════════════════════════════════════════════
Total Records:  24
Window:   90 days (requested)
Data Span:  12 days (actual records)
Dominant Failure:  test_failure (8 records)

By Cluster:
  test_failure (8)
    Keywords: assertion, timeout, build, snapshot, config
    File paths: src/test/foo.test.ts, src/test/bar.test.ts
  policy_denied (6)
    Keywords: blocked, command, rejected, scope, policy
  verification_timeout (5)
  ...

Recurring File Paths (2+ records):
  src/test/foo.test.ts (4)
  src/core/handler.ts (3)
```

**JSON output:**
```json
{
  "failureAnalysis": {
    "total": 24,
    "clusters": [...],
    "dominantType": "test_failure",
    "recurringFilePaths": ["src/test/foo.test.ts", "src/core/handler.ts"],
    "recurringFilePathCounts": {
      "src/test/foo.test.ts": 4,
      "src/core/handler.ts": 3
    },
    "timeframeDays": 90
  }
}
```

## Verification

```bash
pnpm build
node --test dist/tests/governance/failure-clustering.test.js
pnpm test:vitest
node bin/alix.js governance failure-analysis --json
```

## Non-goals

- **No ML clustering** — grouping is exact-match on `failureType` enum
- **No NLP** — keyword extraction is simple word frequency, no stemming or embeddings
- **No time-series analysis** — only simple min/max timeframe
- **No cross-referencing with run ledger** — that's P13.3

## Files

```
src/governance/failure-clustering.ts    # Create
tests/governance/failure-clustering.test.ts  # Create
src/cli/commands/governance.ts            # Amend (add failure-analysis subcommand)
docs/architecture/plans/2026-07-05-p13-2-failure-clustering.md  # Plan
```
