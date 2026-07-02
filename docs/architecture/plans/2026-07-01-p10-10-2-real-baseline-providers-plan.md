# P10.10.2 — Implementation Plan

> **Derived from:** `docs/architecture/specs/2026-07-01-p10-10-2-real-baseline-providers-design.md`
> **Branch:** `feature/p10-10-2-real-baseline-providers`

---

## Dependency Graph

```
Governance Provider
        │
Memory Provider
        │
        ▼
Registry Factory  ← registers Demo, Governance, MemoryHealth
        │
        ▼
Sentinel Update   ← allow fs imports for governance, memory adapter for memory
```

---

## Tasks

### Task 1 — Governance Baseline Provider

**Files:**
- `src/baseline/providers/governance-provider.ts`
- `tests/baseline/providers/governance-provider.vitest.ts`

**Deliverables:**
- `GovernanceBaselineProvider` implementing `BaselineProvider`
- subsystem: `"governance"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Observes persisted governance state from the governance store (currently JSON-backed)
- `captureBaseline()` reads current file state and stores it
- `captureCurrent()` re-reads files for comparison
- Graceful degradation for three failure cases:
  - Missing directory → 0 metrics
  - Missing individual files → 0 for that file's metrics
  - Malformed JSON → 0 for that file's metrics (parse error caught)

**Tests (9):**
- 1. subsystem returns "governance"
- 2. metadata: version, state, capabilities are all correct
- 3. baseline reads calibration count
- 4. baseline reads lens metrics
- 5. baseline reads coverage metrics
- 6. missing directory returns 0 metrics
- 7. missing individual file returns 0 for that file
- 8. malformed JSON file degrades gracefully (no throw)
- 9. current re-reads files (changed values reflected)

---

### Task 2 — Memory Health Provider

**Files:**
- `src/baseline/providers/memory-health-provider.ts`
- `tests/baseline/providers/memory-health-provider.vitest.ts`

**Deliverables:**
- `MemoryHealthProvider` implementing `BaselineProvider` (named to reflect runtime health sensor semantics)
- subsystem: `"memory"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- `captureBaseline()` captures runtime snapshot once and returns the same artifact on subsequent calls (baseline is immutable until process restarts)
- `captureCurrent()` calls `buildMemoryHealthReport()` each time
- Overrides `classifyDrift()` for metric-specific categories

**Tests (6):**
- 1. subsystem returns "memory"
- 2. metadata: version, state, capabilities are all correct
- 3. baseline captures once and returns same artifact on second call
- 4. current calls adapter and returns fresh data
- 5. version is non-empty
- 6. state is "ready"

---

### Task 3 — Update Factory + Registry Tests

**Files:**
- `src/baseline/baseline-registry.ts` (update factory)
- `tests/baseline/baseline-registry.vitest.ts` (update test)

**Deliverables:**
- `createDefaultBaselineRegistry()` registers Demo, Governance, MemoryHealth
- Remove manual registration from CLI handler

**Tests (1):**
- `discover()` returns 3 providers with expected names: Demo, Governance, Memory

---

### Task 4 — Sentinel Update

**Files:**
- `tests/baseline/baseline-sentinels.vitest.ts`

**Deliverables:**
- Governance provider may import from `node:fs` (file reading)
- Memory provider may import from `../../executive/adapters/memory-health`

---

## Dependency Graph

```
Task1 (governance provider)
  └─▶ Task3 (factory update)
Task2 (memory provider) ───┘
  └─▶ Task4 (sentinel update)
```

---

## Hard Boundaries

- No imports from Executive except memory-health adapter
- No changes to comparator, health-score, CLI, or types
- Demo provider remains unchanged
