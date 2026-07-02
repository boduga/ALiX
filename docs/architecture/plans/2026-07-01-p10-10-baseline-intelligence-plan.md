# P10.10 — Implementation Plan (Final)

> **Derived from:** `docs/architecture/specs/2026-07-01-p10-10-baseline-intelligence-design.md`
> **Branch:** `feature/p10-10-baseline-intelligence`

---

## Dependency Graph

```
Task1 (types)
  └─▶ Task2 (provider interface)
        └─▶ Task3 (health score)
              └─▶ Task4 (comparator) — depends on health score
                    └─▶ Task5 (registry)
                          └─▶ Task6 (demo provider)
                                └─▶ Task7 (CLI)
```

---

## Tasks

### Task 1 — Types

**Files:**
- `src/baseline/baseline-types.ts`

**Deliverables:**
- `BaselineArtifact<T>` generic interface with `subsystem`, `capturedAt`, `data: T`, `metadata?`
- `BaselineSubsystem` union type: `"memory" | "workflow" | "skills" | "agents" | "tools" | "security" | "governance" | "adaptation" | "demo"`
- `ProviderState`: `"registered" | "ready" | "unavailable"`
- `DriftCategory` union (6 categories)
- `DriftItem` with `id`, `category`, `metric`, `baselineValue`, `currentValue`, `delta`, `severity`
- `HealthStatus` union (4 statuses)
- `BaselineComparison` with `subsystem`, `score`, `status`, `drift` (no recommendations)
- `ProviderInfo` metadata object: `{ subsystem, version, description, capabilities, state }`
- Full JSDoc on every type

**Tests:** None (pure type definitions).

---

### Task 2 — Provider Interface

**Files:**
- `src/baseline/baseline-provider.ts`

**Deliverables:**
- `BaselineProvider` interface with:
  - `readonly subsystem: BaselineSubsystem`
  - `readonly version: string`
  - `readonly description: string`
  - `readonly capabilities: string[]`
  - `readonly state: ProviderState`
  - `captureBaseline(): Promise<BaselineArtifact>`
  - `captureCurrent(): Promise<BaselineArtifact>`
- No `compare()` on provider (framework-owned)

**Tests:** None (interface only).

---

### Task 3 — Health Score

**Files:**
- `src/baseline/health-score.ts`

**Deliverables:**
- `computeHealthScore(drift: DriftItem[], weights?): { score: number; status: HealthStatus }` pure function
- Equal-weight default
- Status band mapping: 90-100 excellent, 70-89 healthy, 40-69 warning, 0-39 critical
- Zero-division safe
- No dependencies on provider or comparison logic

**Tests:** `tests/baseline/health-score.vitest.ts`
- 1. no drift → 100 excellent
- 2. small drift → healthy
- 3. moderate drift → warning
- 4. large drift → critical
- 5. custom weights skew score
- 6. zero baseline value → 0 score

---

### Task 4 — Comparator

**Files:**
- `src/baseline/baseline-comparator.ts`

**Deliverables:**
- `BaselineComparator` interface with `compare(baseline, current): BaselineComparison`
- Default numeric implementation with internal helpers:
  - `extractMetrics(data)` — pulls numeric fields from artifact data
  - `buildDriftItems(baseline, current, metrics)` — computes per-metric deltas
  - `buildComparison(subsystem, baseline, current, driftItems)` — assembles result, calls `computeHealthScore()`
- No recommendations in comparison output

**Tests:** `tests/baseline/baseline-comparator.vitest.ts`
- 1. identical artifacts → score 100, no drift
- 2. small delta → warning status
- 3. multiple metrics each drift correctly
- 4. custom metric extraction via override

---

### Task 5 — Registry + Factory

**Files:**
- `src/baseline/baseline-registry.ts`

**Deliverables:**
- `BaselineRegistry` class:
  - `register(provider)` — stores provider, throws on duplicate subsystem
  - `discover()` — returns all providers
  - `get(subsystem)` — returns provider by name, throws if not found
  - `describe(subsystem)` — returns `ProviderInfo` for CLI display
  - `runAll()` — sequentially captures + compares each provider
  - `runOne(subsystem)` — same for a single provider
- `createDefaultBaselineRegistry()` factory (registers nothing yet — demo provider added in Task 6)

**Tests:** `tests/baseline/baseline-registry.vitest.ts`
- 1. register adds provider
- 2. register duplicate throws
- 3. discover returns all
- 4. get returns correct provider
- 5. get missing throws
- 6. describe returns ProviderInfo
- 7. runAll captures + compares all
- 8. runOne captures + compares one

---

### Task 6 — Demo Provider

**Files:**
- `src/baseline/providers/demo-provider.ts`

**Deliverables:**
- Implements `BaselineProvider`
- subsystem: `"demo"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Baseline fixture: `{ uptime: 100, responseTime: 200, errorRate: 0 }`
- Current fixture: `{ uptime: 95, responseTime: 350, errorRate: 2 }`

**Tests:** `tests/baseline/demo-provider.vitest.ts`
- 1. subsystem returns "demo"
- 2. version returns "1.0.0"
- 3. description is non-empty
- 4. capabilities includes "capture"
- 5. state is "ready"
- 6. baseline has expected data shape
- 7. current has expected data shape

---

### Task 7 — CLI

**Files:**
- `src/cli/commands/baseline.ts`

**Deliverables:**
- Routes: `list`, `providers`, `health`, `show <subsystem>`
- `list` — prints subsystem names
- `providers` — prints table (subsystem, version, capabilities, state)
- `health` — runs all, prints score table sorted descending:
  ```
  Subsystem      Score     Status
  demo            61       Warning
  ```
- `show <sub>` — runs one, prints detailed drift report
- `--json` on health and show
- Uses `createDefaultBaselineRegistry()` internally
- Wire into top-level CLI dispatcher

**Tests:** `tests/cli/commands/baseline-cli.vitest.ts`
- 1. list shows demo
- 2. providers shows demo row
- 3. providers shows state column
- 4. health prints score table
- 5. show demo prints drift report
- 6. show missing subsystem errors
- 7. health --json valid JSON
- 8. show --json valid JSON

---

## Hard Boundaries

- No imports from `src/executive/` or `src/adaptation/`
- No real subsystem providers
- No file I/O
- No dashboard/plan/recommendation changes
