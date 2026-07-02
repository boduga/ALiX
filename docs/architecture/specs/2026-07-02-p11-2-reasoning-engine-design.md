# P11.2 — Reasoning Engine Design Spec

> **Status:** Draft
> **Phase:** P11.2
> **Consumes:** `CorrelationGraph` (P11.1)
> **Produces:** `RootCauseAnalysis`
> **Determinism:** Core inference deterministic; probabilistic refinement reserved for future P11.X phases

---

## 1. Context

P11.1 Correlation Engine produces a `CorrelationGraph` — a directed graph of statistical relationships between subsystem health series. It answers *"what moves together"* but not *"why"* or *"what should we do about it."*

P11.2 Reasoning Engine consumes the `CorrelationGraph` and produces a `RootCauseAnalysis`: per-degraded-subsystem findings that name the most likely causes, the mechanism of causation, the driving metric, and a recommended action. This is the first P11 stage that reasons about causality rather than correlation.

### Stage boundary rule

P11.2's output `RootCauseAnalysis` is itself a typed, persisted artifact consumed by P11.3 (Planning Engine). P11.2 does not mutate anything — it reads the current correlation graph and writes a new analysis. The analysis is advisory; it does not trigger any action.

---

## 2. Type Model

### 2.1 Causal Mechanisms

```typescript
/**
 * The mechanism by which one subsystem's state affects another's.
 *
 * Deterministically inferred from CorrelationEdge properties
 * (direction, temporalLag, confidence).
 */
export type CausalMechanism =
  | "temporal_cascade"       // A degrades → B degrades later (lag > 0, positive direction)
  | "concurrent_degradation" // A and B degrade together (lag === 0, positive, high co-occurrence)
  | "inverse_correlation"    // A improves while B degrades (negative direction)
  | "degradation_chain";     // A→B→C inferred across multiple edges (indirect)
```

### 2.2 LikelyCause

```typescript
export interface LikelyCause {
  /** The subsystem identified as a likely cause of the primary subsystem's degradation. */
  causeSubsystem: CorrelationSubsystemId;
  /**
   * Confidence score 0–1 propagated from CorrelationEdge confidence values.
   *
   * Single edge: edge.correlationConfidence (bumped +0.10 if temporalLag >= 1
   *   — temporal precedence strengthens causal signal).
   * Multiple edges: noisy-OR combination (1 - ∏(1 - ci)) limited to 0.95 max.
   * Chain: product of confidences along the path, limited to 0.95 max.
   */
  confidence: number;
  /** The causal mechanism inferred from the edge properties. */
  mechanism: CausalMechanism;
  /** Trend snapshot IDs supporting this cause (from edge.evidenceIds + node.evidenceIds). */
  evidenceIds: string[];
  /** Drift item IDs from the cause subsystem node that contribute to the degradation. */
  driftItemIds: string[];
}
```

### 2.3 CausalFinding

```typescript
export interface CausalFinding {
  /** The degraded subsystem being analyzed. */
  primarySubsystem: CorrelationSubsystemId;
  /** Current health score of the primary subsystem (0–100). */
  currentScore: number;
  /** Ranked list of likely causes (most likely first). */
  likelyCauses: LikelyCause[];
  /**
   * The single drift metric most responsible for the degradation, if any.
   * Selected as the drift item with the largest |delta| from the primary subsystem's
   * node.drift[].
   */
  drivingMetric: string | null;
  /**
   * Strategic recommendation text generated from the top cause + mechanism.
   *
   * Template-based, deterministic:
   *   temporal_cascade: "Consider inspecting {causeSubsystem} changes — they may have
   *     triggered the {primarySubsystem} degradation ({confidence} confidence)."
   *   concurrent_degradation: "Investigate common root cause affecting {causeSubsystem}
   *     and {primarySubsystem} — they degrade together."
   *   inverse_correlation: "Review whether improvements to {causeSubsystem} are
   *     adversely affecting {primarySubsystem}."
   *   degradation_chain: "Trace the degradation chain: {chain}."
   *   no_cause_found: "{primarySubsystem} is degraded but no statistically significant
   *     causal relationship was found from other subsystems."
   */
  recommendedAction: string;
}
```

### 2.4 RootCauseAnalysis

```typescript
export type AnalysisStatus = "ok" | "no_degradation" | "insufficient_edges" | "stale";

export interface RootCauseAnalysis {
  schemaVersion: "p11.2.0";
  generatedAt: string;
  /** ID of the CorrelationGraph this analysis was derived from. */
  correlationGraphId: string;
  /** Overall status of the analysis. */
  status: AnalysisStatus;
  /** Per-degraded-subsystem findings. Empty if no degradation detected. */
  findings: CausalFinding[];
  meta: {
    totalSubsystemsExamined: number;
    degradedSubsystems: number;
    totalEdgesAnalyzed: number;
  };
}
```

### 2.5 ReasoningEngineConfig

```typescript
export interface ReasoningEngineConfig {
  /**
   * Minimum correlation confidence for an edge to be considered as causal evidence.
   * Default: 0.40 (slightly above P11.1's minEdgeConfidence=0.35 to prefer higher
   * certainty for causal claims vs statistical association).
   */
  minCauseConfidence: number;
  /**
   * Maximum number of likely causes to report per degraded subsystem.
   * Default: 3.
   */
  maxCausesPerSubsystem: number;
  /**
   * Score threshold below which a subsystem is considered degraded.
   * Default: 40 (corresponds to "warning" boundary in CorrelationNodeStatus).
   */
  degradationThreshold: number;
}
```

### 2.6 Errors

```typescript
export class RootCauseAnalysisError extends Error {
  readonly code = "ROOT_CAUSE_ANALYSIS_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "RootCauseAnalysisError";
  }
}
```

---

## 3. Algorithm: `buildRootCauseAnalysis()`

### 3.1 Signature

```typescript
function buildRootCauseAnalysis(
  graph: CorrelationGraph,
  config: ReasoningEngineConfig,
): RootCauseAnalysis
```

Pure function, no side effects, no I/O. Fully deterministic.

### 3.2 Steps

**Step 1 — Status check**

If `graph.status === "insufficient_history"` or `graph.status === "stale"`:
- Return analysis with `status: "stale"` and empty findings.
- The caller (engine orchestrator) surfaces this to the CLI.

**Step 2 — Identify degraded subsystems**

Filter `graph.nodes` where `node.status === "warning"` or `node.status === "critical"`.
Also include nodes where `status === "unknown"` AND `score < degradationThreshold` (0).

If no degraded subsystems: return `status: "no_degradation"`, empty `findings`.

**Step 3 — Build adjacency index**

Index `graph.edges` by target subsystem for fast lookup:
```
Map<CorrelationSubsystemId, CorrelationEdge[]>
```

Also index edges by source subsystem for chain detection.

**Step 4 — For each degraded subsystem, find likely causes**

For each degraded subsystem `target`:

a. Find incoming edges where:
   - `edge.target === target`
   - `edge.correlationConfidence >= config.minCauseConfidence`

b. For each qualifying edge, determine mechanism and adjusted confidence:

   | edge properties | mechanism | confidence adjustment |
   |---|---|---|
   | `direction === "positive"`, `temporalLag >= 1` | `temporal_cascade` | `min(edge.correlationConfidence + 0.10, 0.95)` |
   | `direction === "positive"`, `temporalLag === 0`, `coOccurrenceRate >= 0.5` | `concurrent_degradation` | `edge.correlationConfidence` |
   | `direction === "negative"` | `inverse_correlation` | `edge.correlationConfidence * 0.8` (weaker causal signal) |

c. Check for indirect (chain) causes: walk outgoing edges from each direct cause
   to find second-order relationships. For chain paths of length 2:
   - `confidence = edge1.confidence * edge2.confidence`, capped at 0.95
   - mechanism = `degradation_chain`
   
   Only include chains where the intermediate node exists in the graph (not missing).

d. Merge duplicate causes (same `causeSubsystem` appearing via direct and chain paths):
   - Keep the highest confidence
   - Merge evidence IDs (dedup)
   - If mechanisms differ, prefer the direct mechanism

e. Sort by confidence descending, take top `config.maxCausesPerSubsystem`.

**Step 5 — Determine driving metric**

For each degraded subsystem, find the drift item with the largest `|delta|`
from `node.drift[]`. If the node has no drift items, `drivingMetric` is `null`.

**Step 6 — Generate recommendation text**

Deterministic template-based recommendation:

| Scenario | Template |
|---|---|
| Top cause has `temporal_cascade` | `"Consider inspecting {cause} changes — they may have triggered the {target} degradation ({confidence}% confidence)."` |
| Top cause has `concurrent_degradation` | `"Investigate common root cause affecting {cause} and {target} — they degrade together ({coOccurrenceRate} co-occurrence)."` |
| Top cause has `inverse_correlation` | `"Review whether improvements to {cause} are adversely affecting {target}."` |
| Top cause has `degradation_chain` | `"Trace the degradation chain: {chainStr}. Consider inspecting the chain for cascading failures."` |
| No causes found | `"{target} is degraded but no statistically significant causal relationship was found from other subsystems. Investigate independently."` |

**Step 7 — Assemble and return**

---

## 4. Engine Orchestrator: `ReasoningEngine`

### 4.1 Interface

```typescript
export class ReasoningEngine {
  constructor(
    private readonly correlationGraphStore: CorrelationGraphStore,
    private readonly rootCauseStore: RootCauseStore,
    private readonly config: ReasoningEngineConfig,
  ) {}

  async run(): Promise<RootCauseAnalysis> { ... }
  async loadLatest(): Promise<RootCauseAnalysis | null> { ... }
}
```

### 4.2 `run()` flow

1. Load latest `CorrelationGraph` via `correlationGraphStore.loadLatest()`
2. If null: throw `RootCauseAnalysisError("No correlation graph available. Run 'alix executive correlate' first.")`
3. Call `buildRootCauseAnalysis(graph, config)` — pure function
4. Save analysis via `rootCauseStore.save(analysis)`
5. Return analysis

### 4.3 `loadLatest()` flow

Delegates to `RootCauseStore.loadLatest()` — reads the last persisted analysis without re-running.

---

## 5. Persistence: `RootCauseStore`

### 5.1 Storage format

Append-only JSONL at `.alix/correlation/root-causes.jsonl`. Each line is one `RootCauseAnalysis` JSON object.

Same pattern as `ExecutiveTrendStore` (JSONL append-only):
- `save(analysis)` — append line to JSONL
- `loadLatest()` — read last line, parse, return
- `loadById(id)` — scan for matching ID (for future P11.3 consumption)
- `list()` — return metadata for all analyses (for CLI)

### 5.2 Read optimizations

Unlike P11.1's single-file overwrite, P11.2 uses JSONL because:
- Historical analyses matter for P11.3 Planning Engine (it needs to see what was recommended before)
- Append-only is simpler and sufficient for the expected volume

### 5.3 Validation on load

- Parse JSON
- Verify `schemaVersion === "p11.2.0"`
- Verify `findings` is an array
- Verify each finding has a valid `primarySubsystem`
- Throw `RootCauseAnalysisError` on invalid data (fail-closed)

---

## 6. CLI: `alix executive reason`

### 6.1 Command structure

```
alix executive reason [--json] [--latest]
```

### 6.2 Modes

| Flag | Behavior |
|---|---|
| (no flags) | Run reasoning engine (load correlation graph → analyze → save → print summary) |
| `--json` | Run reasoning engine, save, print full JSON analysis |
| `--latest` | Load last saved analysis without re-running, print summary |
| `--latest --json` | Load last saved analysis, print full JSON |

### 6.3 Summary output

```
Root Cause Analysis
Status: ok
Generated: 2026-07-02T12:00:00.000Z
Correlation graph: <graph-generatedAt>
Findings: 2 degraded subsystems

  subsystem | score | top cause             | confidence | mechanism
  workflow  | 38    | agents                | 0.81       | temporal_cascade
  skills    | 55    | memory                | 0.64       | concurrent_degradation
```

### 6.4 Error handling

- `RootCauseAnalysisError` → print error message, exit 1
- No correlation graph → print "Run 'alix executive correlate' first.", exit 1
- Corrupted JSONL → print error, exit 1

### 6.5 Registration

Add `case "reason"` to `src/cli/commands/executive.ts` with dynamic import pattern:
```typescript
case "reason": {
  const { handleReasonCommand } = await import("./executive-reason-handler.js");
  return handleReasonCommand(rest);
}
```

Update the `default` case's available subcommands list.

---

## 7. Test Plan

### 7.1 Pure function tests (`build-root-cause-analysis.vitest.ts`)

| # | Test | Verifies |
|---|---|---|
| T1 | Returns `no_degradation` when all nodes are healthy | Status check |
| T2 | Identifies `temporal_cascade` from positive correlation with lag | Mechanism detection |
| T3 | Identifies `concurrent_degradation` from zero-lag high co-occurrence | Mechanism detection |
| T4 | Identifies `inverse_correlation` from negative direction | Mechanism detection |
| T5 | Detects `degradation_chain` across two edges | Chain inference |
| T6 | Returns empty findings for `stale` or `insufficient_history` graph | Input validation |
| T7 | Filters low-confidence edges below `minCauseConfidence` | Confidence gate |
| T8 | Limits causes to `maxCausesPerSubsystem` | Output bound |
| T9 | Generates correct recommendation templates | Text output |
| T10 | Deduplicates causes from direct + chain paths | Merge logic |
| T11 | Selects driving metric from largest |drift.delta| | Metric selection |

### 7.2 Engine tests (`reasoning-engine.vitest.ts`)

| # | Test | Verifies |
|---|---|---|
| T12 | Returns analysis when correlation graph exists | Happy path |
| T13 | Throws when no correlation graph exists | Error handling |
| T14 | loadLatest returns null when no analyses exist | Empty state |

### 7.3 Store tests (`root-cause-store.vitest.ts`)

| # | Test | Verifies |
|---|---|---|
| T15 | Save + loadLatest round-trips correctly | Persistence |
| T16 | loadLatest returns last saved analysis | JSONL ordering |
| T17 | Throws on invalid schema version | Validation |
| T18 | Returns null when file does not exist | Empty state |

### 7.4 CLI handler test (`executive-reason-handler.vitest.ts`)

| # | Test | Verifies |
|---|---|---|
| T19 | `--latest` without saved analysis prints message | Graceful fallback |
| T20 | Default mode runs engine and prints summary | Integration |

---

## 8. Non-Goals

- **LLM-based reasoning**: P11.2 is deterministic. Probabilistic (LLM) refinement is deferred to a future P11.X phase.
- **Multi-graph temporal analysis**: Only operates on the latest CorrelationGraph. Cross-graph trend analysis is a P11.4 concern.
- **Plan generation**: Recommendations are advisory text, not executable plans. P11.3 Planning Engine converts findings to plans.
- **Real-time analysis**: On-demand only (`alix executive reason`). No watch mode.
- **Feedback loop**: P11.2 does not incorporate outcome data. Outcome-aware confidence calibration is P11.4.
- **Root cause verification**: The analysis is probabilistic; it does not attempt to prove causation.
- **Priority ordering across subsystems**: Each degraded subsystem gets independent findings. Cross-subsystem priority ordering is P11.3.

---

## 9. File Map

| File | Purpose |
|---|---|
| `src/reasoning/reasoning-types.ts` | Type definitions: `RootCauseAnalysis`, `CausalFinding`, `LikelyCause`, `CausalMechanism`, `ReasoningEngineConfig`, `AnalysisStatus`, `RootCauseAnalysisError` |
| `src/reasoning/reasoning-config.ts` | Default config export |
| `src/reasoning/build-root-cause-analysis.ts` | Pure function `buildRootCauseAnalysis(graph, config) → RootCauseAnalysis` |
| `src/reasoning/root-cause-store.ts` | Append-only JSONL store with `save`, `loadLatest`, `loadById`, `list` |
| `src/reasoning/reasoning-engine.ts` | Orchestrator: loads graph → calls pure function → saves |
| `src/cli/commands/executive-reason-handler.ts` | CLI handler for `alix executive reason` |
| `tests/reasoning/build-root-cause-analysis.vitest.ts` | 11 pure function tests |
| `tests/reasoning/reasoning-engine.vitest.ts` | 3 engine tests |
| `tests/reasoning/root-cause-store.vitest.ts` | 4 store tests |
| `tests/reasoning/executive-reason-handler.vitest.ts` | 2 CLI tests |
