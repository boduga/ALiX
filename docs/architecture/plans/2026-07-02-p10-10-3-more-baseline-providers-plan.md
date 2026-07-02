# P10.10.3 — Implementation Plan

> **Derived from:** `docs/architecture/specs/2026-07-02-p10-10-3-more-baseline-providers-design.md`
> **Branch:** `feature/p10-10-3-more-baseline-providers`

---

## Tasks

### Task 1 — Skills Baseline Provider

**Files:**
- `src/baseline/providers/skills-provider.ts`
- `tests/baseline/providers/skills-provider.vitest.ts`

**Deliverables:**
- `SkillsBaselineProvider` implementing `BaselineProvider`
- subsystem: `"skills"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Reads `.alix/skills/workflow/*.json` files, counts skills and steps
- Baseline cached on first capture; current re-reads directory
- Caches like Governance provider

**Tests (6):**
- 1. subsystem returns "skills"
- 2. metadata: version, state, capabilities
- 3. baseline reads skill files from temp dir
- 4. missing directory returns 0 metrics
- 5. baseline cached, current re-reads
- 6. malformed skill file degrades gracefully

---

### Task 2 — Agent Runtime Health Provider

**Files:**
- `src/baseline/providers/agent-runtime-health-provider.ts`
- `tests/baseline/providers/agent-runtime-health-provider.vitest.ts`

**Deliverables:**
- `AgentRuntimeHealthProvider` implementing `BaselineProvider`
- subsystem: `"agents"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Named to distinguish from a future configuration-based `AgentBaselineProvider`
- Calls `buildAgentHealth({ cwd })` from Executive adapter
- Baseline cached per process; current returns live data

**Tests (4):**
- 1. subsystem returns "agents"
- 2. metadata correct
- 3. baseline caches
- 4. current returns fresh artifact

---

### Task 3 — Workflow Runtime Health Provider

**Files:**
- `src/baseline/providers/workflow-runtime-health-provider.ts`
- `tests/baseline/providers/workflow-runtime-health-provider.vitest.ts`

**Deliverables:**
- `WorkflowRuntimeHealthProvider` implementing `BaselineProvider`
- subsystem: `"workflow"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Named to distinguish from a future configuration-based `WorkflowBaselineProvider`
- Calls `buildWorkflowHealth({ cwd })` from Executive adapter
- Baseline cached per process; current returns live data

**Tests (4):**
- 1. subsystem returns "workflow"
- 2. metadata correct
- 3. baseline caches
- 4. current returns fresh artifact

---

### Task 4 — Factory + Sentinel Update

**Files:**
- `src/baseline/baseline-registry.ts` (factory update)
- `tests/baseline/baseline-registry.vitest.ts` (test update)
- `tests/baseline/baseline-sentinels.vitest.ts` (allowlist)

**Deliverables:**
- Factory registers Skills, Agents, Workflow
- `discover()` returns 6 providers (Demo, Governance, MemoryHealth, Skills, Agents, Workflow)
- Sentinel: allowlist agents and workflow for their respective Executive adapters; skills for fs

**Tests (1):**
- Registry returns 6 providers with specific names: Demo, Governance, Memory, Skills, Agents, Workflow

---

## Dependency Graph

```
Skills Provider (file-based, no Executive deps)
        │
Agents Health Provider (depends on executive agent-health)
        │
Workflow Health Provider (depends on executive workflow-health)
        │
        ▼
Registry Factory  ← now 6 providers
        │
        ▼
Sentinel Update
```

---

## Hard Boundaries

- No framework changes (comparator, health-score, types, CLI untouched)
- Skills: no Executive imports (pure file I/O like Governance)
- Agents: may import `executive/adapters/agent-health` only
- Workflow: may import `executive/adapters/workflow-health` only
