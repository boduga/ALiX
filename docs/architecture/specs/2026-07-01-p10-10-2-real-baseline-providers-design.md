# P10.10.2 — Real Baseline Providers Design

> **Status:** Proposed (revised)
> **Phase:** P10.10.2
> **Goal:** Replace the demo provider with real subsystem baseline providers that read actual ALiX state.

---

## 1. Problem

P10.10.1 established the framework: `BaselineProvider` interface, `BaselineRegistry`, `NumericComparator`, health scoring, CLI. But the only registered provider is `DemoBaselineProvider` — an in-memory fixture that proves the framework works but produces no real data.

Without real providers, `alix baseline health` always returns the same demo score.

---

## 2. Two Kinds of Providers

Not all providers are baselines in the same sense. Two distinct categories:

### Persistent Baseline Providers

Configuration-driven subsystems with durable state on disk:

| Provider | Data source | Baseline is... |
|----------|-------------|----------------|
| Governance | `.alix/governance/*.json` | File state at capture time |
| Skills | `.alix/skills/**/*.json` | File state at capture time |
| Agents | Agent cards | Registered configuration |
| Workflow | Workflow definitions | Stored definitions |
| Security | Policy files | Policy state at capture time |

Baseline survives process restarts because it lives in files.

### Ephemeral Health Providers

Runtime metrics that measure subsystem health at a point in time:

| Provider | Data source | Baseline is... |
|----------|-------------|----------------|
| Memory | Runtime memory health report | Snapshot of current runtime state |
| Tools | Runtime tool registry | Snapshot of current configuration |

Baseline is ephemeral — it resets on process restart. The provider always captures current state; the registry decides when to store a "baseline" snapshot.

### Both share the same interface

Despite the semantic difference, both categories implement `BaselineProvider`. The registry doesn't distinguish them — it simply calls `captureBaseline()` and `captureCurrent()`. The difference is documented here for provider authors.

**Architectural boundary (documented):**

```
Provider captures state.
Comparator determines drift.
Health engine determines health.
Executive determines action.
```

---

## 3. Scope

### In scope (P10.10.2)

| Provider | Subsystem | Type | Data source |
|----------|-----------|------|-------------|
| Governance | `governance` | Persistent | `.alix/governance/*.json` files |
| MemoryHealth | `memory` | Ephemeral | Executive memory health adapters |
| Demo | `demo` | Fixture | In-memory |

### Out of scope (future phases)

```
P10.10.3 — Skills, Agents, Workflow providers
P10.10.4 — Tools, Security, Adaptation providers
P10.10.5 — Executive integration (P10.10.4 → P10 dashboard)
```

---

## 4. Governance Baseline Provider

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

- **Baseline**: Reads files once, stores values
- **Current**: Re-reads files on each call
- **Comparison**: NumericComparator detects any file changes

---

## 5. MemoryHealth Provider

Named `MemoryHealthProvider` rather than `MemoryBaselineProvider` to reflect its nature as a runtime health sensor.

### Data sources

Reads from Executive memory health adapters (`src/executive/adapters/memory-health.ts`). This is the only Executive dependency — the adapter is a pure data collector, not orchestration.

### Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| `vectorCount` | Memory health report | Total stored vectors |
| `fragmentation` | Memory health report | Fragmentation percentage |
| `recallRate` | Memory health report | Query recall success rate |
| `avgLatency` | Memory health report | Average query latency |

### Baseline vs Current

- **Baseline**: Captured on first call, stored in-memory (ephemeral — resets with process)
- **Current**: Calls `buildMemoryHealthReport()` on each capture
- **Comparison**: NumericComparator with drift classification overrides:
  - `latency` → `performance` category
  - `fragmentation` → `structural` category
  - `recallRate` → `behavior` category

### Persistence note

Because Memory is ephemeral, baseline resets on process restart. The first comparison after restart will show identity (current == baseline). Over time, as the process runs and memory state shifts, drift will accumulate. This is acceptable for P10.10.2. Persistent baselines (file-backed) will be possible once the provider interface supports optional storage (future phase).

---

## 6. File Map

```
src/baseline/providers/
  governance-provider.ts    — GovernanceBaselineProvider (reads .alix/governance/)
  memory-health-provider.ts — MemoryHealthProvider (reads memory health)
  demo-provider.ts          — unchanged (kept as fixture)

src/baseline/
  baseline-registry.ts      — factory updated: register Demo + Governance + MemoryHealth
```

---

## 7. Design Decisions

**Governance is persistent.** File-backed baseline survives restarts. No Executive dependency — reads raw JSON, not through GovernanceStore.

**Memory is ephemeral.** Runtime health snapshot. Accepts one Executive dependency (memory-health adapter) which is a pure data collector with no orchestration logic.

**Memory naming.** Called `MemoryHealthProvider` to distinguish it from persistent providers. Implements `BaselineProvider` like everything else.

**Factory updated.** `createDefaultBaselineRegistry()` registers all three. CLI unchanged.

**Future `capture()` unification (noted).** A future phase may unify `captureBaseline()` and `captureCurrent()` into a single `capture()` method, letting the registry call it twice. This would remove duplicate code from every provider. Not implemented in P10.10.2 to keep scope small.

---

## 8. Hard Boundaries

- Governance provider must not import Executive types
- Memory provider may import `src/executive/adapters/memory-health` only
- No changes to `baseline-comparator.ts`, `health-score.ts`, `baseline-registry.ts` API surface
- Sentinels updated to allow the memory adapter import (narrow exception)

---

## 9. Test Strategy

| Provider | Test | Method |
|----------|------|--------|
| Governance | Reads calibration file | Temp dir with fixture files |
| Governance | Missing file returns 0 metrics | Temp dir without files |
| Governance | Metrics computed correctly | Assert numeric values |
| MemoryHealth | Returns expected shape | Mock memory health adapter |
| MemoryHealth | Version is non-empty | String assertion |
| Registry | Factory registers all 3 | `discover().length === 3` |
