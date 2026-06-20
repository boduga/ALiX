# P4.7 — Dynamic Capability Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed agent IDs in skills with capability-based runtime selection so the same skill can route to different agents based on the available registry.

**Architecture:** Extend `SkillStep` with `capability` + `resolve` fields. At runtime, `runWorkflowSkill()` calls the existing `CapabilityResolver` to select the best agent for each step. Hooks and evidence capture the resolution. No changes to the resolver or registry — those already work.

**Tech Stack:** TypeScript (TSX/ESM), existing `CardRegistry` (src/registry/), existing `CapabilityResolver`, existing `SkillStep`/`SkillDefinition`, P4.6 `WorkflowOrchestrator`, P4.6 `HookManager`.

## Global Constraints

- The existing `CapabilityResolver` and `CardRegistry` are not modified — P4.7 is additive.
- `SkillStep` gains optional `capability` and `resolve` fields. The `agent` field remains for backward compatibility.
- Resolution happens once per skill step at the start of `runWorkflowSkill()`.
- Two new evidence event types: `agent_resolved` and `capability_routed`.
- The `issue-lifecycle` skill is updated to use capabilities instead of hardcoded agent IDs.

---
### File Structure

| File | Action | Role |
|------|--------|------|
| `src/workflow/skill.ts` | **Modify** — Add `capability`, `resolve` to `SkillStep` |
| `src/workflow/workflow-skill.ts` | **Modify** — Add `CapabilityResolver` call in step dispatch |
| `src/workflow/evidence-writer.ts` | **Modify** — Add `recordAgentResolved()`, `recordCapabilityRouted()` |
| `src/security/evidence/evidence-types.ts` | **Modify** — Add `agent_resolved`, `capability_routed` |
| `.alix/skills/workflow/issue-lifecycle.json` | **Modify** — Switch to capability-based steps |
| `tests/workflow/workflow-skill.vitest.ts` | **Modify** — Add capability routing tests |
| `tests/workflow/evidence-writer.vitest.ts` | **Modify** — Add routing evidence tests |

---
## Task 1: P4.7a — Evidence Types for Capability Routing

**Files:**
- Modify: `src/security/evidence/evidence-types.ts` (add 2 event types)
- Modify: `src/workflow/evidence-writer.ts` (add 2 typed methods)
- Test: `tests/workflow/evidence-writer.vitest.ts` (extend)

**Interfaces:**
- Produces: `"agent_resolved"` and `"capability_routed"` in `EvidenceType` union
- Produces: `recordAgentResolved()`, `recordCapabilityRouted()` on `EvidenceEventWriter`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";

function tmpDir(): string {
  const dir = join("/tmp", "ev-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

describe("EvidenceEventWriter — capability routing", () => {
  let dir: string;
  let store: EvidenceStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
    writer = new EvidenceEventWriter((t, p) => store.append(t, p));
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("records agent_resolved", async () => {
    const r = await writer.recordAgentResolved(61, {
      capability: "workflow.planning",
      agentId: "workflow.planning",
      step: "plan",
    });
    expect(r).not.toBeNull();
    expect(r!.type).toBe("agent_resolved");
    expect(r!.payload.agentId).toBe("workflow.planning");
  });

  it("records capability_routed with candidate IDs", async () => {
    const r = await writer.recordCapabilityRouted(61, {
      capability: "workflow.review",
      resolvedAgent: "workflow.review",
      candidates: 3,
      candidateAgentIds: ["workflow.review", "workflow.review.v2"],
    });
    expect(r).not.toBeNull();
    expect(r!.type).toBe("capability_routed");
    expect(r!.payload.candidates).toBe(3);
    expect(r!.payload.candidateAgentIds).toEqual(["workflow.review", "workflow.review.v2"]);
  });

  it("both types are queryable", async () => {
    await writer.recordAgentResolved(61, { capability: "a", agentId: "x", step: "s" });
    await writer.recordCapabilityRouted(61, { capability: "b", resolvedAgent: "y", candidates: 1 });
    const query = await store.query({ limit: 10 });
    expect(query.records.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/routing-evidence.vitest.ts --config vitest.config.mts 2>&1 | head -10`
Expected: FAIL — `recordAgentResolved` not found.

- [ ] **Step 3: Add evidence types**

Add to `src/security/evidence/evidence-types.ts` in the `EvidenceType` union:
```typescript
  // P4.7 capability routing
  | "agent_resolved"
  | "capability_routed"
```

Add to `EVIDENCE_TYPES` set:
```typescript
  "agent_resolved",
  "capability_routed",
```

- [ ] **Step 4: Add typed methods to EvidenceEventWriter**

Add to `src/workflow/evidence-writer.ts` after the execution section:

```typescript
  // -----------------------------------------------------------------------
  // Capability routing
  // -----------------------------------------------------------------------

  async recordAgentResolved(
    issueNumber: number,
    payload: { capability: string; agentId: string; step: string; agentCardId?: string },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("agent_resolved", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  async recordCapabilityRouted(
    issueNumber: number,
    payload: { capability: string; resolvedAgent: string; candidates: number; candidateAgentIds?: string[] },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("capability_routed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/routing-evidence.vitest.ts --config vitest.config.mts 2>&1 | tail -5`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/security/evidence/evidence-types.ts src/workflow/evidence-writer.ts
git commit -m "feat(p4.7a): add agent_resolved and capability_routed evidence types"
```

---
## Task 2: P4.7b — Extend SkillStep with Capability Routing

**Files:**
- Modify: `src/workflow/skill.ts` (add `capability`, `resolve` to `SkillStep`)
- Modify: `src/workflow/workflow-skill.ts` (integrate `CapabilityResolver`)
- Modify: `.alix/skills/workflow/issue-lifecycle.json` (use capabilities)
- Test: Extend `tests/workflow/workflow-skill.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityResolver` from `src/registry/capability-resolver.ts`, `CardRegistry` from `src/registry/card-registry.ts`
- Produces: Updated `SkillStep` with optional `capability` + `resolve`, updated `runWorkflowSkill()` that resolves capabilities

- [ ] **Step 1: Write the failing test**

Add to `tests/workflow/workflow-skill.vitest.ts`:

```typescript
import { loadCardRegistry } from "../../src/registry/card-loader.js";

describe("capability routing in skills", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("resolves capability to agent and routes step", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));
    const registry = await loadCardRegistry(dir);

    const skill: SkillDefinition = {
      id: "test-capability",
      name: "Test",
      description: "Capability resolution test",
      steps: [
        { step: "intake", capability: "workflow.intake", resolve: true, action: "Intake" },
      ],
    };

    const result = await runWorkflowSkill(skill, {
      issueNumber: 61,
      issueTitle: "Cap routing test",
      body: "- [ ] AC",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer, registry });

    expect(result.success).toBe(true);
  });

  it("prefers capability-based routing over hardcoded agent", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));
    const registry = await loadCardRegistry(dir);

    // Step has both agent and capability — capability should win
    const skill: SkillDefinition = {
      id: "test-prefer-capability",
      name: "Test",
      description: "Prefer capability test",
      steps: [
        { step: "intake", agent: "some.other.agent", capability: "workflow.intake", resolve: true, action: "Intake" },
      ],
    };

    const result = await runWorkflowSkill(skill, {
      issueNumber: 61,
      issueTitle: "Prefer cap test",
      body: "- [ ] AC",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer, registry });

    expect(result.success).toBe(true);
  });

  it("reports missing capability as error", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));
    const registry = await loadCardRegistry(dir);

    const skill: SkillDefinition = {
      id: "test-missing-cap",
      name: "Test",
      description: "Missing capability",
      steps: [
        { step: "nope", capability: "capability.does.not.exist", resolve: true, action: "Nope" },
      ],
    };

    const result = await runWorkflowSkill(skill, {
      issueNumber: 61,
      issueTitle: "Missing",
      body: "",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer, registry });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("capability.does.not.exist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/workflow-skill.vitest.ts --config vitest.config.mts 2>&1 | head -15`
Expected: FAIL — `SkillContext` has no `registry` field.

- [ ] **Step 3: Update `src/workflow/skill.ts` — add fields to SkillStep**

```typescript
export interface SkillStep {
  /** Step identifier (e.g. "intake", "plan") */
  step: string;
  /** Agent card ID (e.g. "workflow.intake") — optional when capability+resolve is used */
  agent?: string;
  /** Capability to resolve at runtime (e.g. "workflow.planning") */
  capability?: string;
  /** If true, resolve capability via CardRegistry instead of using hardcoded agent */
  resolve?: boolean;
  /** Action the agent performs */
  action: string;
  /** Human gate before this step */
  requiresApproval?: boolean;
  /** Hooks to run before/after this step */
  hooks?: {
    pre?: string[];
    post?: string[];
  };
}
```

- [ ] **Step 4: Update `src/workflow/workflow-skill.ts` — add registry + resolve logic**

Change `SkillContext` to include optional `registry`:
```typescript
export interface SkillContext {
  coordinator: WorkflowCoordinator;
  writer: EvidenceEventWriter;
  hooks?: HookManager;
  registry?: CardRegistry;
}
```

Add import for CardRegistry:
```typescript
import type { CardRegistry } from "../registry/card-registry.js";
```

Add a resolver call in the step dispatch loop, before the `if/else if` chain:
```typescript
// Resolve capability to agent if configured
let resolvedAgent = step.agent;
if (step.resolve && step.capability && context.registry) {
  const { resolveCapabilities } = await import("../registry/capability-resolver.js");
  const resolution = resolveCapabilities({
    requiredCapabilities: [step.capability],
    registry: context.registry,
  });
  if (resolution.agents.length === 0) {
    return {
      success: false,
      issueNumber,
      error: `No agent found for capability "${step.capability}"`,
    };
  }
  resolvedAgent = resolution.agents[0].id;
  // Record capability routing evidence
  await context.writer.recordCapabilityRouted(issueNumber, {
    capability: step.capability,
    resolvedAgent: resolvedAgent,
    candidates: resolution.agents.length,
  });
  await context.writer.recordAgentResolved(issueNumber, {
    capability: step.capability,
    agentId: resolvedAgent,
    step: step.step,
  });
}
```

Then update the step dispatch conditions to use `resolvedAgent` instead of `step.agent`.

- [ ] **Step 5: Update `.alix/skills/workflow/issue-lifecycle.json` to use capabilities**

```json
{
  "id": "issue-lifecycle",
  "name": "Issue Lifecycle",
  "description": "Full issue lifecycle: intake, plan, review, execute, PR",
  "requiresCapabilities": ["workflow.intake", "workflow.planning", "workflow.review", "workflow.execution", "workflow.pr"],
  "steps": [
    { "step": "intake", "capability": "workflow.intake", "resolve": true, "action": "Read and validate issue, produce WorkPackage" },
    { "step": "plan", "capability": "workflow.planning", "resolve": true, "action": "Convert WorkPackage to ExecutionPlan" },
    { "step": "review-plan", "capability": "workflow.review", "resolve": true, "action": "Review ExecutionPlan for completeness and risk", "requiresApproval": true },
    { "step": "execute", "capability": "workflow.execution", "resolve": true, "action": "Execute each subtask with test gating", "requiresApproval": true },
    { "step": "review-code", "capability": "workflow.review", "resolve": true, "action": "Review completed code changes" },
    { "step": "pr", "capability": "workflow.pr", "resolve": true, "action": "Create draft PR with evidence links" }
  ]
}
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
npx vitest run tests/workflow/workflow-skill.vitest.ts tests/workflow/routing-evidence.vitest.ts tests/workflow/orchestrator-bridge.vitest.ts --config vitest.config.mts
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/workflow/skill.ts src/workflow/workflow-skill.ts .alix/skills/workflow/issue-lifecycle.json tests/workflow/workflow-skill.vitest.ts
git commit -m "feat(p4.7b): add capability-based routing to SkillStep and runWorkflowSkill"
```

---
## Task 3: P4.7c — Verification

- [ ] **Run full regression suite**

```bash
npx vitest run tests/workflow/ tests/cli/ tests/security/evidence/ --config vitest.config.mts
```
Expected: All tests pass.

- [ ] **Push branch and open PR**

```bash
git push origin feature/p4.7-dynamic-capability-routing
gh pr create --base main --head feature/p4.7-dynamic-capability-routing --title "P4.7: Dynamic Capability Routing — capability-based agent selection in skills" --body "Replaces hardcoded agent IDs in skills with capability-based runtime selection via the existing CapabilityResolver."
```

---
## Summary

After P4.7, skill steps can use either:

```json
{ "agent": "workflow.planning" }
```

or:

```json
{ "capability": "workflow.planning", "resolve": true }
```

The second form queries the CardRegistry at runtime and selects the best matching agent. This turns ALiX from a workflow engine with named agents into an orchestrated agent system with dynamic capability selection.
