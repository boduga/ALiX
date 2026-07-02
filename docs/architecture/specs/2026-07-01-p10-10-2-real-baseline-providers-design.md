# P10.10.2 — Real Baseline Providers Design

> **Status:** Proposed
> **Phase:** P10.10.2
> **Goal:** Replace the demo provider with real subsystem baseline providers that read actual ALiX state.

---

## 1. Problem

P10.10.1 established the framework: `BaselineProvider` interface, `BaselineRegistry`, `NumericComparator`, health scoring, CLI. But the only registered provider is `DemoBaselineProvider` — an in-memory fixture that proves the framework works but produces no real data.

Without real providers, `alix baseline health` always returns the same demo score.

---

## 2. Scope

### In scope

| Provider | Subsystem | Data source |
|----------|-----------|-------------|
| Governance | `governance` | `.alix/governance/*.json` files |
| Memory | `memory` | Executive memory health adapters |
| Demo | `demo` | Keep as smoke-test fixture |

### Out of scope

- Workbook, Agents, Tools, Security, Adaptation providers
- Executive integration (P10.10.4)
- File I/O safety enforcement (M-series concern)

---

## 3. Governance Baseline Provider

### Data sources

Reads from `.alix/governance/`:

| File | Content | Metrics |
|------|---------|---------|
| `calibration.json` | Calibration entries with targets and values | calibrationCount, avgCalibrationValue, activeCalibrations |
| `lens-registry.json` | Lens definitions with status and enabled flags | totalLenses, activeLenses, demotedLenses, retiredLenses |
| `policy-coverage.json` | Coverage percentages | currentCoverage, targetCoverage |

### Metrics extracted

```json
{
  "calibrationCount": 5,
  "activeCalibrations": 3,
  "avgCalibrationValue": 0.72,
  "totalLenses": 8,
  "activeLenses": 6,
  "demotedLenses": 1,
  "retiredLenses": 1,
  "currentCoverage": 60,
  "coverageGap": 20
}
```

### Baseline vs Current

- **Baseline**: Captured once from current file state
- **Current**: Re-reads files on each call
- **Comparison**: NumericComparator detects any file changes

---

## 4. Memory Baseline Provider

### Data sources

Reads from Executive memory health adapters (`src/executive/adapters/memory-health.ts`).

### Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| `vectorCount` | Memory health report | Total stored vectors |
| `fragmentation` | Memory health report | Fragmentation percentage |
| `recallRate` | Memory health report | Query recall success rate |
| `avgLatency` | Memory health report | Average query latency |

### Baseline vs Current

- **Baseline**: Captured on first call, stored in-memory
- **Current**: Calls `buildMemoryHealthReport()` on each capture
- **Comparison**: NumericComparator with drift classification overrides:
  - `latency` → `performance` category
  - `fragmentation` → `structural` category
  - `recallRate` → `behavior` category

---

## 5. File Map

```
src/baseline/providers/
  governance-provider.ts    — GovernanceBaselineProvider (reads .alix/governance/)
  memory-provider.ts        — MemoryBaselineProvider (reads memory health)
  demo-provider.ts          — unchanged (kept as fixture)

src/baseline/
  baseline-registry.ts      — factory updated: register Governance + Memory
```

---

## 6. Design Decisions

**Governance is file-based.** The provider reads `.alix/governance/*.json` files. This means baseline data is as current as the files. No Executive dependency — the provider reads raw JSON, not through GovernanceStore.

**Memory is adapter-based.** The provider calls `buildMemoryHealthReport()` from the existing Executive memory health adapter. This is the only Executive dependency we accept — the memory adapter is a pure data collector.

**Factory updated.** `createDefaultBaselineRegistry()` now registers all three providers (Demo, Governance, Memory). The CLI registers nothing manually.

---

## 7. Hard Boundaries

- Governance provider must not import `Executive` types
- Memory provider may import the memory health adapter only (not Executive orchestration)
- No changes to `baseline-comparator.ts`, `health-score.ts`, `baseline-registry.ts` API surface
- Sentinels updated to allow the memory adapter import

---

## 8. Test Strategy

| Provider | Test | Method |
|----------|------|--------|
| Governance | Reads calibration file | Temp dir with fixture files |
| Governance | Missing file returns 0 metrics | Temp dir without files |
| Governance | Metrics computed correctly | Assert numeric values |
| Memory | Returns expected shape | Mock memory health adapter |
| Memory | Version is non-empty | String assertion |
| Registry | Factory registers all 3 | `discover().length === 3` |
