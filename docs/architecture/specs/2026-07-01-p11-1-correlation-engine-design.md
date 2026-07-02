# P11.1 — Cross-Subsystem Correlation Engine

> **Status:** Design — approved implementation
> **Phase:** P11.1
> **Spoke to:** P11.0 (Cognitive Architecture Design Brief)
> **Depends on:** P10.10 baseline providers, ExecutiveTrendStore
> **Protected files touched:** None (no ADR-0004 schema changes)

---

## Goal

Build the Correlation Engine — the first stage of the P11 cognitive pipeline. It consumes `BaselineComparison[]` from the P10 baseline providers plus historical `ExecutiveTrendSnapshot[]`, and emits a typed, persisted `CorrelationGraph` as structured evidence for P11.2 (Reasoning Engine).

P10 taught Executive **how to observe**. P11 teaches Executive **how to think**. P11.1 is the first thinking layer: detecting cross-subsystem relationships.

---

## Architecture

```
BaselineRegistry.runAll()  ExecutiveTrendStore
        │                          │
        ▼                          ▼
  BaselineComparison[]    ExecutiveTrendSnapshot[]
        │                          │
        └────────┬─────────────────┘
                 ▼
   normalizeSubsystemIds()
                 │
                 ▼
   buildScoreSeries() → delta vectors per subsystem
                 │
                 ▼
   computeEdges() → pairwise score correlation
                 │
                 ▼
   CorrelationGraph (typed, persisted)
                 │
                 ▼
            P11.2 Reasoning Engine (next phase)
```

The Correlation Engine is a **pure function** (`buildCorrelationGraph`) wrapped in a thin orchestrator (`CorrelationEngine.run()`). This preserves the P11 architectural rule that every stage is independently testable: typed input → typed output, no side effects.

---

## Section 1: Subsystem Identity

### Canonical Subsystem Set

P11.1 defines a canonical subsystem vocabulary aligned with the P10.10 baseline provider layer:

```typescript
export type CorrelationSubsystemId =
  | "memory"
  | "workflow"
  | "skills"
  | "agents"
  | "tools"
  | "security"
  | "governance"
  | "adaptation";

export type BaselineSubsystemId = CorrelationSubsystemId | "demo";
```

**Rule:** The 8 production subsystems form the canonical graph node set. The `"demo"` provider is available for registry/sentinel coverage but is excluded from production CorrelationGraph unless explicitly requested by a test or debug option.

### ExecutiveTrendStore Name Normalization

Historical Executive trend snapshots use different naming. At ingestion, names are normalized via:

```typescript
const EXECUTIVE_TO_CORRELATION: Record<string, CorrelationSubsystemId> = {
  memory: "memory",
  workflow: "workflow",
  learning: "skills",
  agents: "agents",
  tools: "tools",
  security: "security",
  governance: "governance",
  adaptation: "adaptation",
};
```

Unknown legacy names are silently ignored; there are no known legacy aliases beyond this table. Missing subsystem scores produce `"unknown"` node status or safe skip.

---

## Section 2: Type Model

```typescript
export type CorrelationDirection = "positive" | "negative" | "none";

export type CorrelationGraphStatus =
  | "ok"
  | "insufficient_history"
  | "stale";

export type CorrelationNodeStatus =
  | "excellent"
  | "healthy"
  | "warning"
  | "critical"
  | "unknown";
```

### CorrelationEdge

```typescript
export interface CorrelationEdge {
  source: CorrelationSubsystemId;
  target: CorrelationSubsystemId;
  coOccurrenceRate: number;       // 0-1
  temporalLag: number;            // windows
  correlationDirection: CorrelationDirection;
  correlationConfidence: number;  // 0-1
  evidenceIds: string[];          // refs to trend snapshot IDs
}
```

### CorrelationNode

```typescript
export interface CorrelationNode {
  subsystem: CorrelationSubsystemId;
  score: number;                  // 0-100
  status: CorrelationNodeStatus;
  drift: DriftItem[];             // node-level evidence only
  evidenceIds: string[];          // refs to baseline comparison IDs
}
```

### CorrelationGraph

```typescript
export interface CorrelationGraph {
  schemaVersion: "p11.1.0";
  generatedAt: string;            // ISO-8601
  windowSize: number;
  status: CorrelationGraphStatus;
  nodes: CorrelationNode[];
  edges: CorrelationEdge[];
  meta: {
    totalSnapshotsExamined: number;
    minConfidenceThreshold: number;
    maxLagExamined: number;
    degradationThreshold: number;
    canonicalSubsystems: CorrelationSubsystemId[];
    excludedSubsystems: string[];
  };
}
```

### Configuration

```typescript
export interface CorrelationEngineConfig {
  windowSize: number;                // default 12
  minSamples: number;                // default 6
  maxTemporalLag: number;            // default 3
  degradationDeltaThreshold: number; // default -5
  minEdgeConfidence: number;         // default 0.35
  staleAfterWindows: number;         // default 3
  canonicalSubsystems: CorrelationSubsystemId[];
  excludedSubsystems: string[];
}
```

---

## Section 3: Edge Construction Strategy

P11.1 uses **deterministic windowed score correlation** as the primary edge-construction algorithm. Current drift items are attached to graph nodes as supporting evidence but are **not** used for metric-level edge inference in P11.1.

### Algorithm

For each ordered pair A → B:

```
1. Build delta series:
     delta[t] = score[t] - score[t - 1]

2. Compute co-occurrence rate:
     degraded = delta <= degradationDeltaThreshold  (default -5)
     if aDegradedWindows === 0: coOccurrenceRate = 0
     else: coOccurrenceRate = count(A degraded AND B degraded) / count(A degraded)

3. Find best temporal lag:
     bestLag = argmax over lag 0..maxTemporalLag of
       abs(similarity(A_delta[t], B_delta[t + lag]))
   (cosine similarity on overlapping window pairs)

4. Determine direction:
     meanProduct = mean(A_delta[t] * B_delta[t + bestLag])
     direction = "positive" if meanProduct > epsilon
               = "negative" if meanProduct < -epsilon
               = "none"     otherwise

5. Compute confidence (bounded 0-1):
     similarityStrength = abs(bestSimilarity)
     sampleRatio = effectiveSamples / maxSamples
     lagStrength = max(0, bestLagSimilarity - lag0Similarity)
     correlationConfidence = clamp01(
       0.4 * coOccurrenceRate +
       0.3 * similarityStrength +
       0.2 * sampleRatio +
       0.1 * lagStrength
     )

6. Emit edge if correlationConfidence >= minEdgeConfidence
```

### Guardrails

| Constant | Value | Purpose |
|----------|-------|---------|
| `windowSize` | 12 | Number of snapshots in a correlation window |
| `minSamples` | 6 | Minimum samples before emitting edges |
| `maxTemporalLag` | 3 | Maximum lag windows to examine |
| `degradationDeltaThreshold` | -5 | Score drop to qualify as "degraded" |
| `minEdgeConfidence` | 0.35 | Minimum confidence to include an edge |
| `staleAfterWindows` | 3 | Windows before graph is considered stale |

### Graceful Degradation

- **Insufficient history** (< `minSamples` samples): graph status `"insufficient_history"`, edges `[]`, nodes still populated from current comparisons
- **Stale data** (latest snapshot older than `staleAfterWindows`): graph status `"stale"`, edges omitted or marked unreliable
- **Demo subsystem** excluded from production graph nodes by default

### Deferred Approaches

Metric-level drift correlation (Approach B) and event-triggered transition correlation (Approach C) are intentionally deferred. They may augment the graph in later phases after provider metrics share a normalized taxonomy and transition events are persisted consistently.

---

## Section 4: Engine Design

### Pure Function (core algorithm)

```typescript
export function buildCorrelationGraph(
  comparisons: BaselineComparison[],
  snapshots: ExecutiveTrendSnapshot[],
  config: CorrelationEngineConfig,
): CorrelationGraph
```

A pure, deterministic function. Every test case can be constructed with synthetic arrays. No I/O, no side effects, no mocks.

### Orchestrator (thin wrapper)

```typescript
export class CorrelationEngine {
  constructor(
    private readonly trendStore: ExecutiveTrendStore,
    private readonly registry: BaselineRegistry,
    private readonly config: CorrelationEngineConfig,
  ) {}

  async run(): Promise<CorrelationGraph> {
    const comparisons = await this.registry.runAll();
    const snapshots = await this.loadTrendHistory();
    return buildCorrelationGraph(comparisons, snapshots, this.config);
  }

  private async loadTrendHistory(): Promise<ExecutiveTrendSnapshot[]> {
    // Load up to windowSize snapshots from ExecutiveTrendStore
    // Normalize names from Executive naming to CorrelationSubsystemId
  }
}
```

### Store

```typescript
export class CorrelationGraphStore {
  constructor(private readonly rootDir = ".alix/correlation") {}

  async save(graph: CorrelationGraph): Promise<void>;
  async loadLatest(opts?: { staleAfterMs?: number }): Promise<CorrelationGraph | null>;
  async exists(): Promise<boolean>;
}
```

- Writes atomically: `graph.json.tmp` → fsync → rename to `graph.json`
- Validates `schemaVersion`, node/edge structure, subsystem IDs, confidence bounds on read
- Returns `null` for missing file
- Throws `CorrelationGraphLoadError` (typed) for invalid/malformed files

---

## Section 5: Persistence

```
.alix/correlation/graph.json
```

**Write behavior:**
- Full graph serialized to JSON, overwritten on each `run()`
- Atomic write (tmp + fsync + rename) prevents partial artifact exposure
- Failed or interrupted `run()` leaves previous graph intact

**Read behavior:**
- `CorrelationGraphStore.loadLatest()` returns the latest full artifact
- Validates schema version and structural integrity on read
- `staleAfterMs` option checks reader-side staleness from `generatedAt`

**No edge history in P11.1.** Edge `evidenceIds` reference historical trend snapshots already stored by ExecutiveTrendStore. The graph file is bounded and fully recomputed each cycle.

---

## Section 6: CLI

```bash
alix executive correlate          # compute + persist + print summary
alix executive correlate --json   # compute + persist + print full JSON
alix executive correlate --status # read saved graph, no recomputation
```

### Output (default)

```
Correlation Graph
Status: ok
Generated: 2026-07-01T18:22:41.000Z
Nodes: 8
Edges: 5
Window size: 12
Snapshots examined: 18

Top correlations:
1. skills → workflow      confidence 0.81  lag 2  positive
2. memory → agents        confidence 0.67  lag 1  positive
3. tools → workflow       confidence 0.58  lag 0  positive
```

### Exit codes

| Condition | Exit code |
|-----------|-----------|
| `ok` | 0 |
| `insufficient_history` | 0 (valid graph state) |
| `stale` | 0 (valid graph state) |
| Operational failure (unreadable store, registry failure) | non-zero |

### Scope boundary

The P11.1 CLI does **not** call P11.2 reasoning, mutate trend history, or execute remediation/planning. P11.2 will get its own command in the next phase.

---

## Section 7: Testing

### Pure function tests (`buildCorrelationGraph`)

| Case | Input | Expected |
|------|-------|----------|
| Normal correlation | 8 subsystems, known relationships | Correct confidence, direction, lag |
| Insufficient history | < 6 samples | `"insufficient_history"`, empty edges |
| Stale data | Latest snapshot beyond stale window | `"stale"` status |
| No degradation | All scores stable | No edges |
| Isolated degradation | One subsystem degrades alone | No edges for that subsystem |
| Perfect co-occurrence | A and B degrade identically | `coOccurrenceRate: 1.0` |
| Negative correlation | A↑ while B↓ | `direction: "negative"` |
| Demo subsystem | Comparison includes `"demo"` | Filtered from graph |
| Executive name normalization | Legacy names map through `EXECUTIVE_TO_CORRELATION` | Mapped correctly; unknown names ignored |

### Confidence/math boundary tests

| Case | Input | Expected |
|------|-------|----------|
| Confidence clamped | Extreme values | Bounded 0-1 |
| Zero vectors | All deltas = 0 | No NaN/Infinity |
| Lag bound safety | Lag search near array edges | No out-of-bounds |
| Min samples enforced | Edge near `minSamples` boundary | Correct inclusion/exclusion |

### Store tests (`CorrelationGraphStore`)

| Case | Expected |
|------|----------|
| `save()` writes graph.json atomically | Atomic write pattern |
| Failed write leaves previous graph | Previous file intact |
| `loadLatest()` on missing store | Returns null |
| `loadLatest()` wrong schemaVersion | Throws `CorrelationGraphLoadError` |
| `loadLatest()` invalid subsystem IDs | Throws `CorrelationGraphLoadError` |
| `loadLatest()` with `staleAfterMs` | Marks graph stale from generatedAt |

### CLI tests

| Command | Expected |
|---------|----------|
| `alix executive correlate` | Computes + persists + prints summary |
| `alix executive correlate --json` | Computes + persists + prints full JSON |
| `alix executive correlate --status` | Reads saved without recomputing |
| `alix executive correlate` (insufficient history) | Exit 0 |
| `alix executive correlate --status` (malformed graph) | Exit non-zero |

### Integration tests

- `CorrelationEngine.run()` with test trend store + test registry
- End-to-end: synthetic trend data → computed graph → persisted → loaded

---

## Section 8: Non-Goals (Deferred)

- **Metric-level drift correlation** (Approach B) — deferred until providers share a normalized metric taxonomy
- **Event-triggered transition correlation** (Approach C) — deferred for alert layer later
- **P11.2 reasoning / causal inference** — separate phase, separate command
- **P11.3+ planning, learning, forecasting** — future phases
- **LLM usage** — not allowed in correlation. P11.1 is fully deterministic
- **Real-time anomaly detection** — not in scope for P11
- **Automated plan execution** — strategic plans remain advisory

---

## File Map

| File | Purpose |
|------|---------|
| `src/correlation/correlation-types.ts` | Type definitions |
| `src/correlation/correlation-config.ts` | Config + defaults |
| `src/correlation/correlation-engine.ts` | Orchestrator (`CorrelationEngine.run()`) |
| `src/correlation/build-correlation-graph.ts` | Pure function |
| `src/correlation/correlation-graph-store.ts` | Atomic read/write |
| `src/correlation/normalize-subsystem.ts` | Name mapping |
| `src/cli/commands/executive-correlate-handler.ts` | CLI handler (`handleCorrelateCommand`) |
| `src/correlation/__tests__/` | Test directory |
