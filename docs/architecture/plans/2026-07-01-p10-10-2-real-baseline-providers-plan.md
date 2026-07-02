# P10.10.2 — Implementation Plan

> **Derived from:** `docs/architecture/specs/2026-07-01-p10-10-2-real-baseline-providers-design.md`
> **Branch:** `feature/p10-10-2-real-baseline-providers`

---

## Tasks

### Task 1 — Governance Baseline Provider

**Files:**
- `src/baseline/providers/governance-provider.ts`
- `tests/baseline/providers/governance-provider.vitest.ts`

**Deliverables:**
- `GovernanceBaselineProvider` implementing `BaselineProvider`
- subsystem: `"governance"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Reads `.alix/governance/calibration.json`, `lens-registry.json`, `policy-coverage.json`
- `captureBaseline()` reads current file state
- `captureCurrent()` re-reads files
- Missing files produce 0 values (graceful degradation)

**Tests (6):**
- 1. subsystem returns "governance"
- 2. baseline reads calibration count
- 3. baseline reads lens metrics
- 4. baseline reads coverage metrics
- 5. missing directory returns 0 metrics
- 6. current re-reads files (changed values reflected)

---

### Task 2 — Memory Baseline Provider

**Files:**
- `src/baseline/providers/memory-provider.ts`
- `tests/baseline/providers/memory-provider.vitest.ts`

**Deliverables:**
- `MemoryBaselineProvider` implementing `BaselineProvider`
- subsystem: `"memory"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Calls `buildMemoryHealthReport()` for current state
- Stores baseline on first `captureBaseline()` call
- Overrides `classifyDrift()` for metric-specific categories

**Tests (5):**
- 1. subsystem returns "memory"
- 2. baseline captures once
- 3. current calls adapter
- 4. version is non-empty
- 5. state is "ready"

---

### Task 3 — Update Factory + Registry Tests

**Files:**
- `src/baseline/baseline-registry.ts` (update factory)
- `tests/baseline/baseline-registry.vitest.ts` (update test)

**Deliverables:**
- `createDefaultBaselineRegistry()` registers Demo, Governance, Memory
- Remove manual registration from CLI handler

**Tests (1):**
- `discover()` returns 3 providers

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
