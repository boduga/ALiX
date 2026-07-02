# P10.10 — Baseline Intelligence Framework Design

> **Status:** Proposed (revised per review)
> **Phase:** P10.10 (Executive Health Intelligence)
> **Goal:** Plugin architecture for subsystem baseline intelligence, not the actual subsystem providers yet.

---

## 1. Problem

P10 Executive can plan, execute, remediate, and observe — but it has no unified model of what "healthy" means per subsystem. Health signals today are derived from generic dashboard KPIs, not from subsystem-specific baselines.

P10.10 establishes the **contract** between Executive and subsystem health intelligence. No real subsystem providers yet — just the framework they'll implement.

---

## 2. Conceptual Model: Providers as Sensors

Each subsystem exposes a **sensor** (the provider). Executive never talks to Memory directly — it talks to the Memory sensor.

```
Memory
  │
  ▼
MemoryBaselineProvider      ← sensor
  │
  ▼
BaselineArtifact<MemoryData>
  │
  ▼
BaselineComparator           ← framework-owned
  │
  ▼
DriftItem[]
  │
  ▼
HealthScore engine           ← framework-owned
  │
  ▼
Score + Status
  │
  ▼
Executive (P10)
```

This abstraction makes P12 (live monitoring) nearly free — sensors don't care whether they're polled on schedule or on demand.

---

## 3. Scope

### In scope (P10.10)

| Component | Description |
|-----------|-------------|
| `BaselineProvider` interface | Sensor contract — capture only, not comparison |
| `BaselineComparator` interface | Framework-owned comparison logic |
| `BaselineRegistry` | Register, discover, run providers |
| `BaselineArtifact<T>` | Generic artifact container |
| `BaselineComparison` | Comparison output with drift + score |
| `HealthStatus` / scoring | Normalized 0–100 scoring with status labels |
| `DriftItem` / `DriftCategory` | Structured drift taxonomy |
| `createDefaultBaselineRegistry()` | Factory matching RemediatorRegistry pattern |
| CLI skeleton | `list`, `registry`, `discover`, `health`, `show` |
| Demo provider | Fake provider for testing the framework |
| Pure functions | `compareArtifacts`, `computeHealthScore` |
| Tests | Registry, comparator, health score, CLI, demo |

### Out of scope (P10.10)

- ❌ Real Governance/Memory/Skills providers
- ❌ Comparison Engine (P11.2)
- ❌ P10 Executive integration (dashboard, plan generation, recommendations)
- ❌ Persistence (baselines live in-memory)
- ❌ Provider lifecycle (Registered→Loaded→Ready→Running→Failed→Disabled)

---

## 4. Types

### BaselineArtifact (generic)

```typescript
interface BaselineArtifact<T = Record<string, number>> {
  subsystem: string;
  capturedAt: string; // ISO-8601
  data: T;
  metadata?: Record<string, unknown>;
}
```

Providers own their schemas:

```typescript
// Memory provider
type MemoryBaseline = { vectorCount: number; fragmentation: number; latency: number };
// => BaselineArtifact<MemoryBaseline>

// Skill provider
type SkillBaseline = { stepCount: number; accuracy: number; maxIterations: number };
// => BaselineArtifact<SkillBaseline>
```

### DriftItem

```typescript
type DriftCategory =
  | "configuration"
  | "performance"
  | "behavior"
  | "structural"
  | "capability"
  | "policy";

interface DriftItem {
  id: string;               // e.g. "memory.fragmentation", "workflow.max_iterations"
  category: DriftCategory;
  metric: string;
  baselineValue: number;
  currentValue: number;
  delta: number;
  severity: "low" | "medium" | "high" | "critical";
}
```

IDs enable cross-referencing from recommendations.

### BaselineComparison

```typescript
type HealthStatus = "excellent" | "healthy" | "warning" | "critical";

interface BaselineComparison {
  subsystem: string;
  score: number;
  status: HealthStatus;
  drift: DriftItem[];
  recommendations: string[];
}
```

---

## 5. Provider Interface (Sensor)

Providers are responsible only for **capturing data**, not comparison.

```typescript
interface BaselineProvider {
  /** Canonical subsystem name (e.g. "memory", "skills"). */
  readonly subsystem: string;

  /** Semantic version of this provider implementation. */
  readonly version: string;

  /** Human-readable description of what this provider measures. */
  readonly description: string;

  /** Capture a baseline snapshot. */
  captureBaseline(): Promise<BaselineArtifact>;

  /** Capture the current snapshot. */
  captureCurrent(): Promise<BaselineArtifact>;
}
```

No `compare()` on the provider. Comparison is framework-owned.

---

## 6. Comparator (Framework-Owned)

```typescript
interface BaselineComparator<T = Record<string, number>> {
  /**
   * Compare two artifacts and produce structured drift items.
   * The comparator knows how to extract numeric metrics from T
   * and compute deltas. This is the only place drift is computed.
   */
  compare(
    baseline: BaselineArtifact<T>,
    current: BaselineArtifact<T>,
  ): BaselineComparison;
}
```

P11.1 includes a **default numeric comparator** that works on `Record<string, number>`. P11.2 will introduce subsystem-specific comparators.

The comparator:
1. Extracts metrics from `data` (numeric fields by default, or via a provided `extractMetrics` function)
2. Computes per-metric deltas
3. Calls `computeHealthScore()` to get the overall score
4. Returns `BaselineComparison` with drift items

This keeps providers **dumb sensors** and the framework **smart about health**.

---

## 7. Health Score

Pure function, framework-owned:

```
computeHealthScore(drift: DriftItem[], weights?: Record<string, number>): { score: number; status: HealthStatus }
```

Scoring (each drift item contributes equally by default):

1. For each drift item: `1 - min(|delta| / max(baselineValue, currentValue), 1)`
2. Clamp each to [0, 1]
3. Average across items (or weighted if `weights` provided)
4. Multiply by 100, round to integer

Status bands:

| Range | Status |
|-------|--------|
| 90–100 | `excellent` |
| 70–89 | `healthy` |
| 40–69 | `warning` |
| 0–39 | `critical` |

---

## 8. Registry

```typescript
class BaselineRegistry {
  register(provider: BaselineProvider): void;            // throws if duplicate
  discover(): BaselineProvider[];                        // all registered
  get(subsystem: string): BaselineProvider;              // throws if not found
  runAll(): Promise<BaselineComparison[]>;               // capture + compare all
  runOne(subsystem: string): BaselineComparison;         // capture + compare one
}
```

### Factory (matching RemediatorRegistry pattern)

```typescript
function createDefaultBaselineRegistry(): BaselineRegistry;
```

Internally registers the DemoProvider. Later P11.3 phases will register MemoryProvider, SkillProvider, etc. No CLI changes needed — the factory evolves, the CLI reads from the registry.

---

## 9. CLI

```
alix baseline list            — list registered subsystems (names only)
alix baseline registry        — show provider table (subsystem, version, status)
alix baseline discover        — show provider details (subsystem, version, description)
alix baseline health          — runAll, print health table sorted by score desc
alix baseline show <sub>      — runOne, print detailed comparison + drift items
```

`--json` flag on health and show. Plain text by default.

---

## 10. Demo Provider

```typescript
subsystem:   "demo"
version:     "1.0.0"
description: "Demo baseline provider for framework testing"
```

Baseline data:
```json
{ "uptime": 100, "responseTime": 200, "errorRate": 0 }
```

Current state:
```json
{ "uptime": 95, "responseTime": 350, "errorRate": 2 }
```

Expected comparison: score ~61 (warning), 3 drift items (performance, performance, behavior).

No I/O. No real subsystem data. Pure in-memory fixture.

---

## 11. File Map

```
src/baseline/
  baseline-types.ts          — BaselineArtifact<T>, DriftItem, BaselineComparison, HealthStatus
  baseline-provider.ts       — BaselineProvider interface
  baseline-comparator.ts     — BaselineComparator interface + default numeric implementation
  baseline-registry.ts       — BaselineRegistry + createDefaultBaselineRegistry()
  health-score.ts            — computeHealthScore pure function
  providers/
    demo-provider.ts         — DemoBaselineProvider

src/cli/commands/
  baseline.ts                — CLI dispatcher

tests/baseline/
  baseline-registry.vitest.ts
  baseline-comparator.vitest.ts
  health-score.vitest.ts
  demo-provider.vitest.ts

tests/cli/commands/
  baseline-cli.vitest.ts
```

---

## 12. Hard Boundaries

- No imports from `src/executive/` or `src/adaptation/`
- No imports from real subsystem providers
- No file I/O for baselines (in-memory only)
- No changes to Executive dashboard, plan generation, or recommendation pipeline
- No P10 Executive integration yet (P10.10 feeds P10 in P11.4)
- Provider interface exposes `capture` only — no `compare`

---

## 13. P11.x Roadmap (Reference)

```
P11.1  Framework + Registry + CLI + Demo       ← you are here
P11.2  Comparison Engine + Drift Engine + Health Engine
P11.3  Real Providers (Memory, Skills, Agents, Governance, etc.)
P11.4  Executive Integration (Dashboard, Plans, Recommendations)
P11.5  Predictive Intelligence (trend analysis, adaptive baselines, forecasting)
```
