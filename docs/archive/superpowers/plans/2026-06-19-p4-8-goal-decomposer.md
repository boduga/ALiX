# P4.8 — Goal Decomposer / Outcome Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "What capabilities are needed to achieve this outcome?" by decomposing natural-language goals into structured plans with required capabilities, then routing to the appropriate skill or workflow.

**Architecture:** User gives an outcome → GoalDecomposer produces a GoalPlan with required capabilities → capability extraction identifies needed skills → dynamic skill selection picks the best workflow → CapabilityResolver routes to agents. Governance-first: plan requires human approval before execution.

**Tech Stack:** TypeScript (TSX/ESM), existing `SkillDefinition`/`SkillStep`, existing `CapabilityResolver`, existing `CardRegistry`, existing `WorkflowOrchestrator`, P4.6 `HookManager`, P4.4 `EvidenceStore`.

## Global Constraints

- No autonomous execution — the decomposer produces a plan, human approves it, then the workflow runs.
- GoalPlan replaces none of the existing stack — it's an additive layer above skills.
- The existing `CapabilityResolver` and `CardRegistry` are unchanged.
- Output is a structured JSON plan, not agent calls.

---
### File Structure

| File | Action | Role |
|------|--------|------|
| `src/workflow/goal-types.ts` | **Create** | GoalPlan schema: OutcomeNode, CapabilityRequirement, GoalPlan |
| `src/workflow/goal-decomposer.ts` | **Create** | GoalDecomposer: natural language → GoalPlan |
| `src/workflow/goal-skill-router.ts` | **Create** | Maps GoalPlan capabilities to existing skills |
| `tests/workflow/goal-decomposer.vitest.ts` | **Create** | Tests for decomposer |
| `tests/workflow/goal-skill-router.vitest.ts` | **Create** | Tests for skill routing |

---
## Task 1: P4.8a — GoalPlan Schema

**Files:**
- Create: `src/workflow/goal-types.ts`

**Interfaces:**
- Produces: `GoalPlan`, `OutcomeNode`, `CapabilityRequirement`, `GoalVerdict` types

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type { GoalPlan, OutcomeNode, CapabilityRequirement } from "../../src/workflow/goal-types.js";

describe("GoalPlan types", () => {
  it("constructs a valid GoalPlan", () => {
    const plan: GoalPlan = {
      goal: "Add workflow status dashboard",
      outcomeNodes: [
        {
          id: "node-1",
          description: "Create status page component",
          requiredCapabilities: ["ui.react", "ui.routing"],
          estimatedEffort: "medium",
        },
      ],
      requiredCapabilities: ["ui.react", "ui.routing", "api.read"],
      suggestedSkill: "feature-development",
      riskFlags: [],
      requiresApproval: true,
    };
    expect(plan.goal).toBeTruthy();
    expect(plan.outcomeNodes.length).toBe(1);
    expect(plan.requiredCapabilities).toContain("ui.react");
    expect(plan.requiresApproval).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/goal-decomposer.vitest.ts --config vitest.config.mts 2>&1 | head -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/workflow/goal-types.ts`**

```typescript
export interface CapabilityRequirement {
  capability: string;
  reason: string;
  priority: "required" | "optional";
}

export interface OutcomeNode {
  id: string;
  description: string;
  requiredCapabilities: string[];
  estimatedEffort: "small" | "medium" | "large" | "unknown";
  dependencies?: string[];
  acceptanceCriteria?: string[];
}

export interface GoalPlan {
  /** The original natural-language goal */
  goal: string;
  /** Decomposed outcome nodes */
  outcomeNodes: OutcomeNode[];
  /** All capabilities required across all nodes */
  requiredCapabilities: string[];
  /** Suggested skill or workflow ID */
  suggestedSkill?: string;
  /** Risk flags identified during decomposition */
  riskFlags: string[];
  /** If true, human approval is required before execution */
  requiresApproval: boolean;
  /** Justification for the decomposition */
  reasoning?: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/goal-decomposer.vitest.ts --config vitest.config.mts 2>&1 | tail -5`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/goal-types.ts
git commit -m "feat(p4.8a): add GoalPlan, OutcomeNode, CapabilityRequirement types"
```

---
## Task 2: P4.8b — GoalDecomposer

**Files:**
- Create: `src/workflow/goal-decomposer.ts`
- Test: Extend `tests/workflow/goal-decomposer.vitest.ts`

**Interfaces:**
- Consumes: nothing (standalone analysis component)
- Produces: `GoalDecomposer` class with `decompose(goal: string): GoalPlan`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { GoalDecomposer } from "../../src/workflow/goal-decomposer.js";

describe("GoalDecomposer", () => {
  it("decomposes a simple feature goal", async () => {
    const decomposer = new GoalDecomposer();
    const plan = await decomposer.decompose("Add a workflow status dashboard showing active workflows and their current state");
    expect(plan.goal).toBeTruthy();
    expect(plan.outcomeNodes.length).toBeGreaterThan(0);
    expect(plan.requiredCapabilities.length).toBeGreaterThan(0);
    expect(plan.requiresApproval).toBe(true);
  });

  it("decomposes a bug-fix goal", async () => {
    const decomposer = new GoalDecomposer();
    const plan = await decomposer.decompose("Fix the evidence query endpoint returning 500 errors on empty store");
    expect(plan.outcomeNodes.length).toBeGreaterThan(0);
    expect(plan.riskFlags.some(f => f.toLowerCase().includes("bug") || f.toLowerCase().includes("fix"))).toBe(true);
  });

  it("sets risk flags for infrastructure goals", async () => {
    const decomposer = new GoalDecomposer();
    const plan = await decomposer.decompose("Migrate the database from SQLite to PostgreSQL");
    expect(plan.riskFlags.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/goal-decomposer.vitest.ts --config vitest.config.mts 2>&1 | head -10`
Expected: FAIL — `GoalDecomposer` not found.

- [ ] **Step 3: Create `src/workflow/goal-decomposer.ts`**

The decomposer is a rule-based planner that analyzes goal text to extract:
- Outcome nodes (sub-goals)
- Required capabilities (from keywords and patterns)
- Risk flags (from keywords like "migrate", "rewrite", "security")
- Effort estimation (from scope indicators)

```typescript
import type { GoalPlan, OutcomeNode } from "./goal-types.js";

export class GoalDecomposer {
  async decompose(goal: string): Promise<GoalPlan> {
    const nodes = this.decomposeNodes(goal);
    const caps = this.extractCapabilities(goal, nodes);
    const risks = this.detectRisks(goal, caps);

    return {
      goal,
      outcomeNodes: nodes,
      requiredCapabilities: [...new Set(caps)],
      riskFlags: risks,
      requiresApproval: true,
      reasoning: this.buildReasoning(goal, nodes, risks),
    };
  }

  private decomposeNodes(goal: string): OutcomeNode[] {
    const nodes: OutcomeNode[] = [];
    const lower = goal.toLowerCase();

    // Detect domain from keywords and generate appropriate nodes
    const domains = this.detectDomains(lower);

    let nodeId = 0;
    for (const domain of domains) {
      nodes.push(this.buildNode(++nodeId, domain, goal));
    }

    // Always include a review node
    nodes.push(this.buildNode(++nodeId, "review", goal));

    return nodes;
  }

  private detectDomains(lower: string): string[] {
    const domains: string[] = [];

    if (/dashboard|ui|page|view|component|frontend/.test(lower)) domains.push("frontend");
    if (/api|endpoint|route|backend|server/.test(lower)) domains.push("backend");
    if (/query|database|store|data|migration|schema/.test(lower)) domains.push("data");
    if (/test|testing|coverage|spec/.test(lower)) domains.push("testing");
    if (/deploy|ci|cd|pipeline|infra/.test(lower)) domains.push("infrastructure");
    if (/doc|readme|documentation|comment/.test(lower)) domains.push("documentation");
    if (/security|auth|permission|encrypt/.test(lower)) domains.push("security");
    if (/config|configuration|setting/.test(lower)) domains.push("configuration");

    // Default to general if nothing matched
    if (domains.length === 0) domains.push("general");

    return domains;
  }

  private buildNode(id: number, domain: string, goal: string): OutcomeNode {
    const capMap: Record<string, string[]> = {
      frontend: ["ui.development", "ui.testing"],
      backend: ["api.development", "api.testing"],
      data: ["data.modeling", "data.migration", "data.testing"],
      testing: ["test.unit", "test.integration"],
      infrastructure: ["infra.config", "infra.deploy"],
      documentation: ["docs.writing"],
      security: ["security.review", "security.testing"],
      configuration: ["config.management"],
      review: ["code.review", "governance.check"],
      general: ["analysis", "implementation", "testing"],
    };

    return {
      id: `node-${id}`,
      description: `${domain}: ${goal.slice(0, 80)}`,
      requiredCapabilities: capMap[domain] ?? ["analysis"],
      estimatedEffort: "medium",
      acceptanceCriteria: [`Verify ${domain} changes meet requirements`],
    };
  }

  private extractCapabilities(goal: string, nodes: OutcomeNode[]): string[] {
    const caps = new Set<string>();
    for (const node of nodes) {
      for (const c of node.requiredCapabilities) caps.add(c);
    }

    const lower = goal.toLowerCase();
    if (/test|testing|coverage/.test(lower)) caps.add("test.execution");
    if (/deploy|release/.test(lower)) caps.add("deploy.management");
    if (/doc|readme/.test(lower)) caps.add("docs.generation");

    return [...caps];
  }

  private detectRisks(goal: string, capabilities: string[]): string[] {
    const risks: string[] = [];
    const lower = goal.toLowerCase();

    if (/migrate|migration/.test(lower)) risks.push("data migration risk");
    if (/rewrite|refactor|redesign/.test(lower)) risks.push("significant refactor");
    if (/security|auth|permission/.test(lower)) risks.push("security relevant");
    if (/database|schema/.test(lower)) risks.push("data schema change");
    if (/api|breaking/.test(lower)) risks.push("API change");
    if (/deadline|urgent|critical/.test(lower)) risks.push("time sensitive");
    if (capabilities.length > 5) risks.push("cross-domain scope");

    return risks;
  }

  private buildReasoning(goal: string, nodes: OutcomeNode[], risks: string[]): string {
    const parts = [`Decomposed goal into ${nodes.length} outcome node(s).`];
    if (risks.length > 0) parts.push(`Identified ${risks.length} risk factor(s): ${risks.join(", ")}.`);
    return parts.join(" ");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/goal-decomposer.vitest.ts --config vitest.config.mts 2>&1 | tail -5`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/goal-decomposer.ts tests/workflow/goal-decomposer.vitest.ts
git commit -m "feat(p4.8b): add GoalDecomposer — natural language to structured GoalPlan"
```

---
## Task 3: P4.8c — Goal-to-Skill Router

**Files:**
- Create: `src/workflow/goal-skill-router.ts`
- Test: `tests/workflow/goal-skill-router.vitest.ts`

**Interfaces:**
- Consumes: `GoalPlan`, existing `SkillDefinition[]` from skill.ts
- Produces: `GoalSkillRouter` class with `route(plan): GoalRouteResult`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { GoalSkillRouter } from "../../src/workflow/goal-skill-router.js";
import type { GoalPlan } from "../../src/workflow/goal-types.js";

describe("GoalSkillRouter", () => {
  it("matches existing skills to goal capabilities", async () => {
    const router = new GoalSkillRouter();
    const plan: GoalPlan = {
      goal: "Add a new feature",
      outcomeNodes: [],
      requiredCapabilities: ["workflow.intake", "workflow.planning", "workflow.review"],
      riskFlags: [],
      requiresApproval: true,
    };
    const result = await router.route(plan);
    expect(result.matchedSkill).toBe("issue-lifecycle");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("returns low confidence for unfamiliar capabilities", async () => {
    const router = new GoalSkillRouter();
    const plan: GoalPlan = {
      goal: "Custom ML pipeline",
      outcomeNodes: [],
      requiredCapabilities: ["ml.training", "ml.deploy", "data.pipeline"],
      riskFlags: [],
      requiresApproval: true,
    };
    const result = await router.route(plan);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/goal-skill-router.vitest.ts --config vitest.config.mts 2>&1 | head -10`
Expected: FAIL — `GoalSkillRouter` not found.

- [ ] **Step 3: Create `src/workflow/goal-skill-router.ts`**

```typescript
import type { GoalPlan } from "./goal-types.js";
import { listSkills } from "./skill.js";
import type { SkillDefinition } from "./skill.js";

export interface GoalRouteResult {
  matchedSkill: string | null;
  confidence: number;
  alternatives: Array<{ id: string; score: number }>;
  unmatchedCapabilities: string[];
}

export class GoalSkillRouter {
  async route(plan: GoalPlan): Promise<GoalRouteResult> {
    const skills = await listSkills();
    const required = plan.requiredCapabilities;

    let bestSkill: SkillDefinition | null = null;
    let bestScore = 0;
    const alternatives: Array<{ id: string; score: number }> = [];

    for (const skill of skills) {
      const score = this.matchScore(skill, required);
      alternatives.push({ id: skill.id, score });

      if (score > bestScore) {
        bestScore = score;
        bestSkill = skill;
      }
    }

    const matched = bestSkill?.requiresCapabilities ?? [];
    const unmatched = required.filter(c => !matched.includes(c));

    return {
      matchedSkill: bestSkill?.id ?? null,
      confidence: bestScore,
      alternatives: alternatives.sort((a, b) => b.score - a.score),
      unmatchedCapabilities: unmatched,
    };
  }

  private matchScore(skill: SkillDefinition, required: string[]): number {
    const skillCaps = skill.requiresCapabilities ?? [];
    if (skillCaps.length === 0) return 0;

    let matches = 0;
    for (const cap of required) {
      if (skillCaps.includes(cap)) matches++;
    }

    return matches / Math.max(skillCaps.length, required.length);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/goal-skill-router.vitest.ts --config vitest.config.mts 2>&1 | tail -5`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/goal-skill-router.ts tests/workflow/goal-skill-router.vitest.ts
git commit -m "feat(p4.8c): add GoalSkillRouter — matches GoalPlan capabilities to existing skills"
```

---
## Verification

- [ ] **Run full regression suite**

```bash
npx vitest run tests/workflow/ tests/cli/ tests/security/evidence/ --config vitest.config.mts
```
Expected: All tests pass.

- [ ] **Push and open PR**

```bash
git push origin feature/p4.8-goal-decomposer
gh pr create --base main --head feature/p4.8-goal-decomposer --title "P4.8: Goal Decomposer — natural language goals to capability-based plans"
```

---
## Summary

After P4.8, ALiX can:

```
"Add a workflow status dashboard"
  ↓
GoalDecomposer → GoalPlan with outcome nodes + required capabilities
  ↓
GoalSkillRouter → matches to existing skills with confidence score
  ↓
CapabilityResolver → routes to agents
  ↓
Human approves → workflow executes
```

This is the first step toward P5 autonomy: ALiX stops asking "which workflow?" and starts asking "what outcome do you want?"
