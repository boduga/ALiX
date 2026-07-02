# P10.10 — Implementation Plan (Revised)

> **Derived from:** `docs/architecture/specs/2026-07-01-p10-10-baseline-intelligence-design.md`
> **Branch:** `feature/p10-10-baseline-intelligence`

---

## Tasks

### Task 1 — Types

**Files:**
- `src/baseline/baseline-types.ts`

**Deliverables:**
- `BaselineArtifact<T>` generic interface with `subsystem`, `capturedAt`, `data: T`, `metadata?`
- `DriftCategory` union (6 categories)
- `DriftItem` with `id`, `category`, `metric`, `baselineValue`, `currentValue`, `delta`, `severity`
- `HealthStatus` union (4 statuses)
- `BaselineComparison` with `subsystem`, `score`, `status`, `drift`, `recommendations`
- Full JSDoc on every type

**Tests:** None (pure type definitions).

---

### Task 2 — Provider Interface + Demo Provider

**Files:**
- `src/baseline/baseline-provider.ts` — `BaselineProvider` interface
- `src/baseline/providers/demo-provider.ts` — `DemoBaselineProvider`

**Deliverables:**
- `BaselineProvider` with `subsystem`, `version`, `description` readonly props + `captureBaseline()`, `captureCurrent()` methods
- No `compare()` on provider (framework-owned)
- Demo provider with fixture data:
  - subsystem: `"demo"`, version: `"1.0.0"`
  - baseline: `{ uptime: 100, responseTime: 200, errorRate: 0 }`
  - current: `{ uptime: 95, responseTime: 350, errorRate: 2 }`

**Tests:** `tests/baseline/demo-provider.vitest.ts`
- 1. subsystem returns "demo"
- 2. version returns "1.0.0"
- 3. description is non-empty
- 4. baseline has expected data shape
- 5. current has expected data shape

---

### Task 3 — Comparator

**Files:**
- `src/baseline/baseline-comparator.ts`

**Deliverables:**
- `BaselineComparator` interface with `compare(baseline, current): BaselineComparison`
- Default numeric implementation that:
  - Extracts numeric fields from `BaselineArtifact.data`
  - Computes per-metric deltas
  - Calls `computeHealthScore()` for overall score
  - Returns `BaselineComparison` with drift items + recommendations

**Tests:** `tests/baseline/baseline-comparator.vitest.ts`
- 1. identical artifacts → score 100, no drift
- 2. small delta → warning status
- 3. multiple metrics each drift correctly
- 4. custom metric extraction via override

---

### Task 4 — Health Score

**Files:**
- `src/baseline/health-score.ts`

**Deliverables:**
- `computeHealthScore(drift, weights?)` pure function
- Equal-weight default
- Status band mapping
- Zero-division safe

**Tests:** `tests/baseline/health-score.vitest.ts`
- 1. no drift → 100 excellent
- 2. small drift → healthy
- 3. moderate drift → warning
- 4. large drift → critical
- 5. custom weights skew score
- 6. zero baseline value → 0 score

---

### Task 5 — Registry + Factory

**Files:**
- `src/baseline/baseline-registry.ts`

**Deliverables:**
- `BaselineRegistry` class: `register()`, `discover()`, `get()`, `runAll()`, `runOne()`
- `createDefaultBaselineRegistry()` factory that registers DemoProvider
- `runAll()` sequentially captures + compares each provider
- `runOne()` does the same for a single provider

**Tests:** `tests/baseline/baseline-registry.vitest.ts`
- 1. register adds provider
- 2. register duplicate throws
- 3. discover returns all
- 4. get returns correct provider
- 5. get missing throws
- 6. runAll captures + compares all
- 7. runOne captures + compares one
- 8. createDefaultBaselineRegistry has demo provider

---

### Task 6 — CLI

**Files:**
- `src/cli/commands/baseline.ts`

**Deliverables:**
- Routes: `list`, `registry`, `discover`, `health`, `show <subsystem>`
- `list` — prints subsystem names
- `registry` — prints table (subsystem, version, status)
- `discover` — prints provider details (subsystem, version, description)
- `health` — runs all, prints score table sorted descending
- `show <sub>` — runs one, prints detailed drift report
- `--json` on health and show
- Uses `createDefaultBaselineRegistry()` internally
- Wire into top-level CLI dispatcher

**Tests:** `tests/cli/commands/baseline-cli.vitest.ts`
- 1. list shows demo
- 2. registry shows demo row
- 3. discover shows demo details
- 4. health prints score table
- 5. show demo prints drift report
- 6. show missing subsystem errors
- 7. health --json valid JSON
- 8. show --json valid JSON

---

## Dependency Graph

```
Task1 (types)
  ├─▶ Task2 (provider interface + demo)
  ├─▶ Task3 (comparator)
  │     └─▶ Task4 (health score) ──▶ Task3 completes
  └─▶ Task5 (registry)
        └─▶ Task6 (CLI) ── depends on Task2 + Task3 + Task5
```

---

## Hard Boundaries

- No imports from `src/executive/` or `src/adaptation/`
- No real subsystem providers
- No file I/O
- No dashboard/plan/recommendation changes
