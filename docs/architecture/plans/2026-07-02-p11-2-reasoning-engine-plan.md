# P11.2 — Reasoning Engine Implementation Plan

> **Status:** Draft
> **Phase:** P11.2
> **Depends on:** P11.1 (CorrelationEngine, CorrelationGraphStore, CorrelationGraph type)
> **Total tasks:** 8

---

## Task 1 — Types and config

**Files:** `src/reasoning/reasoning-types.ts`, `src/reasoning/reasoning-config.ts`

### Steps

1. Create `src/reasoning/reasoning-types.ts` with:
   - `CausalMechanism` type union
   - `LikelyCause` interface (with optional `chainPath`, optional `coOccurrenceRate` for concurrent_degradation template)
   - `CausalFinding` interface
   - `AnalysisStatus` type union: `"ok" | "no_degradation" | "insufficient_history" | "insufficient_edges" | "stale"`
   - `RootCauseAnalysis` interface (schemaVersion "p11.2.0", `analysisId`, `correlationGraphId` via SHA-256 hash)
   - `ReasoningEngineConfig` interface
   - `RootCauseAnalysisError` class (extends Error, code "ROOT_CAUSE_ANALYSIS_ERROR")

2. Create `src/reasoning/reasoning-config.ts` with:
   - `DEFAULT_REASONING_CONFIG` export (minCauseConfidence=0.40, maxCausesPerSubsystem=3, degradationThreshold=40)

### Verification

- `npx tsc --noEmit` passes
- Confirm types are importable and self-consistent

---

## Task 2 — Pure function: `buildRootCauseAnalysis()`

**File:** `src/reasoning/build-root-cause-analysis.ts`

### Steps

1. Implement `buildRootCauseAnalysis(graph: CorrelationGraph, config: ReasoningEngineConfig): RootCauseAnalysis`
2. Logic:
   - Step 1: Map graph.status — insufficient_history → analysis status insufficient_history, stale → stale. Return early with empty findings for either.
   - Step 2: Filter degraded nodes (warning/critical status, or unknown with score < threshold)
   - Step 3: Build target-indexed edge map (Map<target, edges[]>). Source index is optional — chain detection only walks incoming edges into each direct cause, so target index is sufficient.
   - Step 4: For each degraded subsystem, find incoming edges above minCauseConfidence
   - Step 5: Classify each cause by mechanism + adjust confidence. For concurrent_degradation causes, store `coOccurrenceRate` from the source edge on `LikelyCause` for the recommendation template.
   - Step 6: Walk incoming edges into each direct cause (A→B→T) for 2-hop indirect causes
   - Step 7: Deduplicate, sort, take top maxCausesPerSubsystem
   - Step 8: Determine driving metric from largest |drift delta|
   - Step 9: Generate recommendation text via template
   - Step 10: Post-check — if any subsystem was degraded but no finding has likelyCauses, set status to insufficient_edges
   - Step 11: Assemble RootCauseAnalysis

### Key design decisions

- Confidence bump for temporal_cascade: +0.10, capped at 0.95
- Inverse correlation penalty: multiply by 0.8
- Chain confidence: product of edge confidences, capped at 0.95
- Chain depth: max 2 hops (A→B→C). Deeper chains have too many false positives.
- Confidences never exceed 0.95 (reserve 0.05 ceiling for future human-in-the-loop)
- `degradation_chain` mechanism assigned to the whole chain, not per-edge
- Recommendation templates format confidence as percentage: `(confidence * 100).toFixed(0) + "%"`, e.g. 0.81 → `"81%"`
- Chain detection walks **incoming** edges into the direct cause (A→B→T, not B→X)
- `graph.status === "insufficient_history"` maps to analysis status `"insufficient_history"` (not collapsed into `"stale"`)
- `graph.status === "stale"` maps to analysis status `"stale"` (separate from insufficient_history)
- `insufficient_edges` status set when subsystems degraded but no qualifying causal edges found
- `correlationGraphId` = SHA-256 hash of graph content (no P11.1 schema change needed)
- `analysisId` = `"reason-" + generatedAt`
- Confidence formatting: `0.81` displays as `81%` in recommendation templates (multiply by 100)
- `LikelyCause` stores `coOccurrenceRate?: number` so the concurrent_degradation template can use `{coOccurrenceRate}` without holding onto the source edge
- Chain detection only needs a target-indexed edge map; source-indexed map is optional (not needed for the implementation)

### Verification

- `npx tsc --noEmit` passes
- All 11 pure function tests pass

---

## Task 3 — Store: `RootCauseStore`

**File:** `src/reasoning/root-cause-store.ts`

### Steps

1. Implement `RootCauseStore` class:
   - `constructor(dir: string)` — `.alix/reasoning` as default
   - `save(analysis: RootCauseAnalysis): Promise<void>` — append JSON line to `root-causes.jsonl`
   - `loadLatest(): Promise<RootCauseAnalysis | null>` — read last line from JSONL
   - `loadById(id: string): Promise<RootCauseAnalysis | null>` — scan for matching ID
   - `list(): Promise<RootCauseAnalysisMeta[]>` — return metadata for all analyses
   - Validation on load: schemaVersion check, findings array check
   - Throws `RootCauseAnalysisError` on invalid data

2. `RootCauseAnalysisMeta` type:
   ```typescript
   interface RootCauseAnalysisMeta {
     analysisId: string;
     status: AnalysisStatus;
     generatedAt: string;
     findings: number; // count of findings in this analysis
   }
   ```

### Verification

- `npx tsc --noEmit` passes
- All 4 store tests pass

---

## Task 4 — Engine orchestrator: `ReasoningEngine`

**File:** `src/reasoning/reasoning-engine.ts`

### Steps

1. Implement `ReasoningEngine` class:
   - `constructor(correlationGraphStore, rootCauseStore, config?)`
   - `run(): Promise<RootCauseAnalysis>` — load graph → pure function → save → return
   - `loadLatest(): Promise<RootCauseAnalysis | null>` — delegate to store
   - Error: no correlation graph → throw `RootCauseAnalysisError`
   - Error: stale graph → set analysis status stale, still produce analysis

2. Test with mock CorrelationGraphStore returning known graphs

### Verification

- `npx tsc --noEmit` passes
- All 3 engine tests pass

---

## Task 5 — CLI handler

**File:** `src/cli/commands/executive-reason-handler.ts`

### Steps

1. Implement `handleReasonCommand(args: string[])`:
   - Parse `--json`, `--latest` flags
   - `--latest` mode: load latest analysis, print summary or JSON
   - Default mode: construct engine, run, save, print summary
   - Error handling: `RootCauseAnalysisError` for structured errors, generic catch-all

2. `printReasonSummary(analysis, isJson)` function:
   - JSON mode: full JSON dump
   - Summary mode: table format matching P11.1's correlate handler style

3. Register in `src/cli/commands/executive.ts`:
   - Add `case "reason":` with dynamic import
   - Add "reason" to the default-case available subcommands list

### Verification

- `npx tsc --noEmit` passes
- CLI smoke test: `npx tsx src/cli/alix.ts executive reason --latest` prints helpful message
- `npx tsx src/cli/alix.ts executive reason --json --latest` outputs JSON (or error about no data)

---

## Task 6 — Pure function tests (11 tests)

**File:** `tests/reasoning/build-root-cause-analysis.vitest.ts`

### Test cases

| # | Test | Input | Expected |
|---|---|---|---|
| T1 | no_degradation when all healthy | 8 healthy nodes, no warning/critical | status=no_degradation, findings empty |
| T2 | temporal_cascade detection | One warning node with incoming edge, lag=1, positive | mechanism=temporal_cascade |
| T3 | concurrent_degradation detection | One warning node with incoming edge, lag=0, coOccurrenceRate=0.8 | mechanism=concurrent_degradation |
| T4 | inverse_correlation detection | One warning node with incoming edge, negative direction | mechanism=inverse_correlation |
| T5 | degradation_chain detection | A→B with temporal_cascade, B→C concurrent. C is degraded. | chain finding for C includes A via chain |
| T6 | stale graph returns stale | Graph with status=stale | analysis status=stale, findings empty |
| T7 | insufficient_history returns own status | Graph with status=insufficient_history | analysis status=insufficient_history, findings empty |
| T8 | low-confidence edges filtered | Edge below minCauseConfidence | Not included in likelyCauses |
| T9 | maxCausesPerSubsystem respected | 5 qualifying edges, maxCausesPerSubsystem=3 | At most 3 causes |
| T10 | driving metric from largest delta | Node with drift items [-3, +7, -15] | drivingMetric from delta=-15 |
| T11 | dedup direct + chain causes | Same subsystem appears as direct + chain cause | Merged, highest confidence kept |

### Helper utilities

- `makeGraph(config?)` — build a CorrelationGraph with specified nodes/edges for testing
- `makeDegradedNode(name, score, drifts?)` — convenience factory
- `makeEdge(src, tgt, props)` — convenience factory

---

## Task 7 — Store and engine tests (7 tests)

**Files:** `tests/reasoning/root-cause-store.vitest.ts` (4 tests), `tests/reasoning/reasoning-engine.vitest.ts` (3 tests)

### RootCauseStore tests

| # | Test | Expected |
|---|---|---|
| T15 | save + loadLatest round-trip | Returns same analysis |
| T16 | loadLatest returns last of two saves | Returns second save |
| T17 | loadLatest from non-existent file | Returns null |
| T18 | invalid JSON throws RootCauseAnalysisError | Error thrown |

### ReasoningEngine tests

| # | Test | Expected |
|---|---|---|
| T12 | run returns analysis when graph exists | Analysis with correct status |
| T13 | run throws when no graph | RootCauseAnalysisError |
| T14 | loadLatest returns null when empty | null |

---

## Task 8 — CLI handler test (2 tests)

**File:** `tests/reasoning/executive-reason-handler.vitest.ts`

| # | Test | Expected |
|---|---|---|
| T19 | --latest without saved file prints message | Prints helpful message, no crash |
| T20 | Default mode runs and prints summary | Prints analysis summary |

---

## Execution Order

```
Task 1 (types + config)
  └── Task 2 (pure function)
  └── Task 3 (store)
       └── Task 4 (orchestrator)
            └── Task 5 (CLI handler)
  ├── Task 6 (pure function tests)
  ├── Task 7 (store + engine tests)
  └── Task 8 (CLI handler tests)
```

Tasks 2 and 3 are independent after Task 1. Task 4 depends on both. Task 4 and 6 can run in parallel. Tasks 7-8 are the final verification layer.

---

## Smoke Test

After all tasks:
```bash
npx tsc --noEmit
npx vitest run tests/reasoning/ 2>&1 | tail -10
npx tsx src/cli/alix.ts executive reason --latest
npx tsx src/cli/alix.ts executive reason --json --latest
```

Expected: typecheck clean, 20 tests passing, CLI prints helpful "no analysis" message.
