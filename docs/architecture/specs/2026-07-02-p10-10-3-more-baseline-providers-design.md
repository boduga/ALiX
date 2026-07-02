# P10.10.3 — Skills, Agents, Workflow Baseline Providers

> **Status:** Proposed
> **Phase:** P10.10.3
> **Goal:** Add three more subsystem baseline providers — Skills (persistent), Agents (ephemeral), Workflow (ephemeral).

---

## 1. Problem

P10.10.2 added Governance (persistent) and MemoryHealth (ephemeral) providers. But `alix baseline health` still only shows 3 subsystems. Adding Skills, Agents, and Workflow brings coverage to 5/8 production subsystems.

---

## 2. Providers

| Provider | Subsystem | Type | Data source |
|----------|-----------|------|-------------|
| Skills | `skills` | Persistent | `.alix/skills/workflow/*.json` files |
| Agents | `agents` | Ephemeral | `buildAgentHealth()` adapter |
| Workflow | `workflow` | Ephemeral | `buildWorkflowHealth()` adapter |

Skills follows the Governance pattern (file-based persistent baseline). Agents and Workflow follow the MemoryHealth pattern (adapter-based ephemeral health).

---

## 3. Skills Provider

### Data source

Reads from `.alix/skills/workflow/` directory — counts installed skill definition files and their steps.

### Metrics

```json
{
  "skillCount": 3,
  "invalidSkills": 0,
  "totalSteps": 12,
  "avgStepsPerSkill": 4
}
```

`invalidSkills` tracks malformed JSON files that exist in the skills directory but can't be parsed. This distinguishes "no skills installed" from "corrupted skill definitions" — a form of configuration drift.

### Baseline vs Current

- **Baseline**: First capture, cached
- **Current**: Re-reads directory on each call
- **Comparison**: NumericComparator detects file additions/removals

---

## 4. Agent Runtime Health Provider

Named `AgentRuntimeHealthProvider` to distinguish runtime health (adapter-based, ephemeral) from a future `AgentBaselineProvider` (configuration-based, persistent).

### Data source

Calls `buildAgentHealth({ cwd })` from Executive adapter.

### Metrics

```json
{
  "healthScore": 85,
  "issueCount": 2
}
```

Same pattern as MemoryHealthProvider.

**Note:** A future `AgentBaselineProvider` may capture agent card definitions, capabilities, and routing configuration. The registry will need to support multiple providers per subsystem at that point.

---

## 5. Workflow Runtime Health Provider

Named `WorkflowRuntimeHealthProvider` to distinguish runtime health from a future configuration-based `WorkflowBaselineProvider`.

### Data source

Calls `buildWorkflowHealth({ cwd })` from Executive adapter.

### Metrics

```json
{
  "healthScore": 92,
  "issueCount": 1
}
```

Same pattern as MemoryHealthProvider.

---

## 6. File Map

```
src/baseline/providers/
  skills-provider.ts       — SkillsBaselineProvider (reads .alix/skills/)
  agents-health-provider.ts — AgentsHealthProvider (adapter-based)
  workflow-health-provider.ts — WorkflowHealthProvider (adapter-based)

src/baseline/
  baseline-registry.ts     — factory updated: register Skills, Agents, Workflow

tests/baseline/providers/
  skills-provider.vitest.ts
  agents-health-provider.vitest.ts
  workflow-health-provider.vitest.ts

tests/baseline/
  baseline-sentinels.vitest.ts  — allowlist updated
```

---

## 7. Hard Boundaries

- Skills provider: no Executive imports (file-based like Governance)
- Agents provider: may import `agent-health` adapter only
- Workflow provider: may import `workflow-health` adapter only
- No framework changes (comparator, health-score, types, CLI untouched)
- Skills provider must track `invalidSkills` metric separately from `skillCount`

---

## 8. Test Strategy

| Provider | Tests | Method |
|----------|-------|--------|
| Skills | 7 | Temp dir with fixture skill files, missing dir, baseline cache, current re-reads, malformed JSON |
| AgentRuntime | 4 | Metadata, baseline caching, current returns fresh data |
| WorkflowRuntime | 4 | Metadata, baseline caching, current returns fresh data |
| Registry | 1 | Asserts specific provider names: Demo, Governance, Memory, Skills, Agents, Workflow |
