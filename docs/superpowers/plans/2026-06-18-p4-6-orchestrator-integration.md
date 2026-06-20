# P4.6 — Orchestrator Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the missing layers between the existing ALiX orchestrator and the P4.5 workflow agents — skills, hooks, and skill-to-workflow binding — so the orchestrator can govern agent execution through playbooks rather than hard-coded flows.

**Architecture:** Six layers — Orchestrator selects a Skill → Skill defines a Workflow → Coordinator manages state → Agents execute steps → Hooks enforce policy → Evidence records everything. P4.6 builds skills, hooks, and the bindings between them.

**Tech Stack:** TypeScript (TSX/ESM), existing CardRegistry (src/registry/), existing task-classifier, existing agent-loop, P4.5 WorkflowCoordinator + 5 agents, EvidenceStore, Hooks system (new).

## Global Constraints

- No new orchestrator from scratch. Use existing `CardRegistry`, `capability-resolver`, `agent-loop` infrastructure.
- P4.5 source files (`src/workflow/`, `src/workflow/agents/`) are not modified — P4.6 is additive.
- Hooks are synchronous by default (can be async for evidence recording).
- Skills are JSON/YAML playbooks stored under `.alix/skills/workflow/`.
- Each hook receives `{ type, agent? , tool? , files? , issueNumber? }` context.
- The demo script is standalone (not merged into production code).

---
### File Structure

| File | Role |
|------|------|
| `src/workflow/hooks.ts` | **Create** — Hook system: register, run pre/post hooks, hook registry |
| `src/workflow/skill.ts` | **Create** — Skill types: SkillDefinition, SkillStep, SkillBinding |
| `src/workflow/workflow-skill.ts` | **Create** — `runWorkflowSkill()`: skill-to-workflow binding |
| `src/workflow/orchestrator-bridge.ts` | **Create** — Orchestrator selects skill, skill runs workflow |
| `.alix/skills/workflow/issue-lifecycle.json` | **Create** — Built-in skill: intake → plan → review → execute → PR |
| `tests/workflow/hooks.vitest.ts` | **Create** — Hook system tests |
| `tests/workflow/workflow-skill.vitest.ts` | **Create** — Skill binding tests |
| `tests/workflow/orchestrator-bridge.vitest.ts` | **Create** — Orchestrator bridge tests |

---
## Task 1: P4.6a — Hook System

**Files:**
- Create: `src/workflow/hooks.ts`
- Test: `tests/workflow/hooks.vitest.ts`

**Interfaces:**
- Produces: `HookType` union, `HookContext` interface, `HookRegistry` class, `HookManager` class

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { HookManager } from "../../src/workflow/hooks.js";

describe("HookManager", () => {
  it("registers and runs a pre-commit hook", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("preCommit", (ctx) => { calls.push(`pre:${ctx.files?.join(",")}`); });
    await hooks.run("preCommit", { type: "preCommit", files: ["a.ts", "b.ts"] });
    expect(calls).toEqual(["pre:a.ts,b.ts"]);
  });

  it("registers and runs a post-commit hook", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("postCommit", (ctx) => { calls.push(`post:${ctx.commitSha}`); });
    await hooks.run("postCommit", { type: "postCommit", commitSha: "abc123" });
    expect(calls).toEqual(["post:abc123"]);
  });

  it("runs multiple hooks for the same event", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("preToolUse", () => { calls.push("hook1"); });
    hooks.register("preToolUse", () => { calls.push("hook2"); });
    await hooks.run("preToolUse", { type: "preToolUse" });
    expect(calls).toEqual(["hook1", "hook2"]);
  });

  it("a pre hook can block execution by returning false", async () => {
    const hooks = new HookManager();
    hooks.register("preToolUse", () => false);
    const result = await hooks.run("preToolUse", { type: "preToolUse" });
    expect(result).toBe(false);
  });

  it("can remove a hook", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("preCommit", () => { calls.push("runs"); });
    hooks.remove("preCommit");
    await hooks.run("preCommit", { type: "preCommit" });
    expect(calls).toEqual([]);
  });

  it("rejects unknown hook type on register", () => {
    const hooks = new HookManager();
    expect(() => hooks.register("invalid" as any, () => {})).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/hooks.vitest.ts --config vitest.config.mts 2>&1 | head -10`
Expected: FAIL — `HookManager` module not found.

- [ ] **Step 3: Create `src/workflow/hooks.ts`**

```typescript
/**
 * P4.6a — Hook System: lifecycle interceptors for the agent execution stack.
 *
 * Hooks are synchronous functions that run before/after every significant
 * lifecycle event: agent runs, tool calls, commits, PR creation, and
 * workflow transitions.
 *
 * A pre-hook returning `false` blocks the operation.
 *
 * Hook types:
 *   pre/post AgentRun     — before/after an agent executes
 *   pre/post ToolUse      — before/after a tool call (file write, shell, etc.)
 *   pre/post Commit       — before/after a git commit
 *   pre/post PRCreate     — before/after a PR is created
 *   pre/post Transition   — before/after a workflow state change
 *   onFailure             — when any step fails
 *   onHumanGate           — when waiting for human approval
 *
 * @module
 */

export type HookType =
  | "preAgentRun" | "postAgentRun"
  | "preToolUse" | "postToolUse"
  | "preCommit" | "postCommit"
  | "prePRCreate" | "postPRCreate"
  | "preTransition" | "postTransition"
  | "onFailure" | "onHumanGate";

export const HOOK_TYPES: ReadonlySet<string> = new Set<HookType>([
  "preAgentRun", "postAgentRun",
  "preToolUse", "postToolUse",
  "preCommit", "postCommit",
  "prePRCreate", "postPRCreate",
  "preTransition", "postTransition",
  "onFailure", "onHumanGate",
]);

export interface HookContext {
  type: HookType;
  agentId?: string;
  toolName?: string;
  files?: string[];
  commitSha?: string;
  commitMessage?: string;
  issueNumber?: number;
  fromState?: string;
  toState?: string;
  error?: string;
  [key: string]: unknown;
}

export type HookFn = (ctx: HookContext) => boolean | void | Promise<boolean | void>;

/**
 * HookManager — register, remove, and run lifecycle hooks.
 *
 * Each hook type can have multiple handlers. Handlers run in registration
 * order. If any pre-hook returns `false`, the operation is blocked.
 */
export class HookManager {
  private hooks = new Map<HookType, HookFn[]>();

  constructor() {
    for (const type of HOOK_TYPES) {
      this.hooks.set(type as HookType, []);
    }
  }

  register(type: HookType, fn: HookFn): void {
    if (!HOOK_TYPES.has(type)) {
      throw new Error(`Unknown hook type: "${type}". Valid: ${Array.from(HOOK_TYPES).join(", ")}`);
    }
    this.hooks.get(type)!.push(fn);
  }

  remove(type: HookType): void {
    this.hooks.set(type, []);
  }

  async run(type: HookType, ctx: HookContext): Promise<boolean> {
    const handlers = this.hooks.get(type) ?? [];
    for (const fn of handlers) {
      const result = await fn(ctx);
      if (result === false) return false;
    }
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/hooks.vitest.ts --config vitest.config.mts 2>&1 | tail -5`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/hooks.ts tests/workflow/hooks.vitest.ts
git commit -m "feat(p4.6a): add HookManager — lifecycle interceptors for agent execution stack"
```

---
## Task 2: P4.6b — Skill Definitions and Built-in Workflow Skill

**Files:**
- Create: `src/workflow/skill.ts`
- Create: `.alix/skills/workflow/issue-lifecycle.json`
- Test: `tests/workflow/workflow-skill.vitest.ts`

**Interfaces:**
- Produces: `SkillDefinition`, `SkillStep`, `SkillBinding` types
- Produces: Built-in skill `issue-lifecycle` defining the full P4.5 agent chain

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { loadSkill, listSkills } from "../../src/workflow/skill.js";

describe("workflow skills", () => {
  it("loads the built-in issue-lifecycle skill", async () => {
    const skill = await loadSkill("issue-lifecycle");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("Issue Lifecycle");
    expect(skill!.steps.length).toBeGreaterThan(0);
    expect(skill!.steps[0].agent).toBe("workflow.intake");
  });

  it("lists available workflow skills", async () => {
    const skills = await listSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some(s => s.name === "Issue Lifecycle")).toBe(true);
  });

  it("skill steps have required fields", async () => {
    const skill = await loadSkill("issue-lifecycle");
    for (const step of skill!.steps) {
      expect(step.step).toBeTruthy();
      expect(step.agent).toBeTruthy();
      expect(step.action).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/workflow-skill.vitest.ts --config vitest.config.mts 2>&1 | head -5`
Expected: FAIL — `loadSkill` not found.

- [ ] **Step 3: Create `src/workflow/skill.ts`**

```typescript
/**
 * P4.6b — Skill Definitions: reusable operating procedures for the orchestrator.
 *
 * Skills tell the orchestrator how to run a task. Each skill is a sequence
 * of steps, where each step maps to an agent and its action.
 *
 * Skills are stored as JSON files under .alix/skills/workflow/.
 *
 * @module
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillStep {
  /** Step identifier (e.g. "intake", "plan") */
  step: string;
  /** Agent card ID (e.g. "workflow.intake") */
  agent: string;
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

export interface SkillDefinition {
  /** Unique skill ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this skill accomplishes */
  description: string;
  /** Ordered list of workflow steps */
  steps: SkillStep[];
  /** Capabilities required to run this skill */
  requiresCapabilities?: string[];
}

// ---------------------------------------------------------------------------
// Skill loading
// ---------------------------------------------------------------------------

const SKILLS_DIR = join(homedir(), ".alix", "skills", "workflow");

/**
 * Load a workflow skill by name.
 * Searches .alix/skills/workflow/<name>.json first, then built-in fallback.
 */
export async function loadSkill(name: string): Promise<SkillDefinition | null> {
  // Try user-installed skill first
  try {
    const raw = await readFile(join(SKILLS_DIR, `${name}.json`), "utf-8");
    return JSON.parse(raw) as SkillDefinition;
  } catch { /* fall through to built-in */ }

  // Built-in skills
  const builtIn = builtInSkills();
  return builtIn.find(s => s.id === name) ?? null;
}

/**
 * List all available workflow skills (built-in + user-installed).
 */
export async function listSkills(): Promise<SkillDefinition[]> {
  const skills = [...builtInSkills()];
  try {
    const files = await readdir(SKILLS_DIR);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const raw = await readFile(join(SKILLS_DIR, f), "utf-8");
        const skill = JSON.parse(raw) as SkillDefinition;
        if (!skills.find(s => s.id === skill.id)) {
          skills.push(skill);
        }
      } catch { /* skip invalid files */ }
    }
  } catch { /* no user-installed skills */ }
  return skills;
}

// ---------------------------------------------------------------------------
// Built-in skills
// ---------------------------------------------------------------------------

function builtInSkills(): SkillDefinition[] {
  return [
    {
      id: "issue-lifecycle",
      name: "Issue Lifecycle",
      description: "Full issue lifecycle: intake, plan, review, execute, PR",
      requiresCapabilities: ["workflow.intake", "workflow.planning", "workflow.review", "workflow.execution", "workflow.pr"],
      steps: [
        { step: "intake", agent: "workflow.intake", action: "Read and validate issue, produce WorkPackage" },
        { step: "plan", agent: "workflow.planning", action: "Convert WorkPackage to ExecutionPlan" },
        { step: "review-plan", agent: "workflow.review", action: "Review ExecutionPlan for completeness and risk", requiresApproval: true },
        { step: "execute", agent: "workflow.execution", action: "Execute each subtask with test gating", requiresApproval: true },
        { step: "review-code", agent: "workflow.review", action: "Review completed code changes" },
        { step: "pr", agent: "workflow.pr", action: "Create draft PR with evidence links" },
      ],
    },
    {
      id: "plan-only",
      name: "Plan Only",
      description: "Intake and plan without execution",
      requiresCapabilities: ["workflow.intake", "workflow.planning", "workflow.review"],
      steps: [
        { step: "intake", agent: "workflow.intake", action: "Read and validate issue" },
        { step: "plan", agent: "workflow.planning", action: "Produce ExecutionPlan" },
        { step: "review-plan", agent: "workflow.review", action: "Review ExecutionPlan" },
      ],
    },
  ];
}
```

- [ ] **Step 4: Also create the built-in skill as an installable JSON file**

```bash
mkdir -p .alix/skills/workflow
```

```json
{
  "id": "issue-lifecycle",
  "name": "Issue Lifecycle",
  "description": "Full issue lifecycle: intake, plan, review, execute, PR",
  "requiresCapabilities": ["workflow.intake", "workflow.planning", "workflow.review", "workflow.execution", "workflow.pr"],
  "steps": [
    { "step": "intake", "agent": "workflow.intake", "action": "Read and validate issue, produce WorkPackage" },
    { "step": "plan", "agent": "workflow.planning", "action": "Convert WorkPackage to ExecutionPlan" },
    { "step": "review-plan", "agent": "workflow.review", "action": "Review ExecutionPlan for completeness and risk", "requiresApproval": true },
    { "step": "execute", "agent": "workflow.execution", "action": "Execute each subtask with test gating", "requiresApproval": true },
    { "step": "review-code", "agent": "workflow.review", "action": "Review completed code changes" },
    { "step": "pr", "agent": "workflow.pr", "action": "Create draft PR with evidence links" }
  ]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/workflow-skill.vitest.ts --config vitest.config.mts 2>&1 | tail -5`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/skill.ts .alix/skills/workflow/issue-lifecycle.json tests/workflow/workflow-skill.vitest.ts
git commit -m "feat(p4.6b): add SkillDefinition types and built-in issue-lifecycle skill"
```

---
## Task 3: P4.6c — Skill-to-Workflow Binding

**Files:**
- Create: `src/workflow/workflow-skill.ts`
- Test: `tests/workflow/workflow-skill.vitest.ts` (extend)

**Interfaces:**
- Consumes: `SkillDefinition` from Task 2, `WorkflowCoordinator`, `IssueIntakeAgent`, `PlanningAgent`, `ReviewAgent`, `ExecutionAgent`, `PRAgent`, `EvidenceEventWriter`, `HookManager`
- Produces: `runWorkflowSkill()` function that binds a skill to the P4.5 agents

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runWorkflowSkill } from "../../src/workflow/workflow-skill.js";
import { loadSkill } from "../../src/workflow/skill.js";

describe("runWorkflowSkill", () => {
  it("runs a plan-only skill through intake → plan → review", async () => {
    const skill = await loadSkill("plan-only");
    expect(skill).not.toBeNull();
    // runWorkflowSkill returns a result object with workPackage, plan, review
    const result = await runWorkflowSkill(skill!, {
      issueNumber: 61,
      issueTitle: "Test skill binding",
      body: "## Acceptance Criteria\n- [ ] Task A\n- [ ] Task B",
      labels: [{ name: "ready-for-agent" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.workPackage).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.review).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/workflow-skill.vitest.ts --config vitest.config.mts 2>&1 | head -10`
Expected: FAIL — `runWorkflowSkill` not found.

- [ ] **Step 3: Create `src/workflow/workflow-skill.ts`**

```typescript
/**
 * P4.6c — Skill-to-Workflow Binding: executes a SkillDefinition against
 * the P4.5 agent chain.
 *
 * Maps each skill step to the corresponding agent and action:
 *   intake    → IssueIntakeAgent.intake()
 *   plan      → PlanningAgent.plan()
 *   review    → ReviewAgent.review()
 *   execute   → ExecutionAgent.execute()  (requires permit + approval)
 *   pr        → PRAgent.prepare()
 *
 * Hooks are called before and after each step if a HookManager is provided.
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SkillDefinition } from "./skill.js";
import type { WorkflowCoordinator } from "./coordinator.js";
import type { EvidenceEventWriter } from "./evidence-writer.js";
import type { HookManager } from "./hooks.js";
import type { GhIssueData } from "./agents/issue-intake-agent.js";
import type { OrchestratorResult } from "./orchestrator-bridge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillGoal {
  issueNumber: number;
  issueTitle: string;
  body: string;
  labels: Array<{ name: string }>;
}

export interface SkillContext {
  coordinator: WorkflowCoordinator;
  writer: EvidenceEventWriter;
  hooks?: HookManager;
}

// ---------------------------------------------------------------------------
// runWorkflowSkill
// ---------------------------------------------------------------------------

/**
 * Run a skill definition against the P4.5 agent chain.
 *
 * Iterates over skill.steps and dispatches each step to the corresponding
 * agent. Pre/post hooks are called for each step if a HookManager is provided.
 */
export async function runWorkflowSkill(
  skill: SkillDefinition,
  goal: SkillGoal,
  context: SkillContext,
): Promise<OrchestratorResult> {
  const { coordinator, writer, hooks } = context;
  const { issueNumber } = goal;

  // Lazy-import agents (they depend on the compiled output)
  const { IssueIntakeAgent } = await import("./agents/issue-intake-agent.js");
  const { PlanningAgent } = await import("./agents/planning-agent.js");
  const { ReviewAgent } = await import("./agents/review-agent.js");

  const intakeAgent = new IssueIntakeAgent();
  const planAgent = new PlanningAgent();
  const reviewAgent = new ReviewAgent();

  let workPackage: any;
  let plan: any;
  let review: any;

  // Convert goal to issueData
  const issueData: GhIssueData = {
    number: goal.issueNumber,
    title: goal.issueTitle,
    body: goal.body,
    state: "OPEN",
    labels: goal.labels,
    closed: false,
  };

  for (const step of skill.steps) {
    // Pre-step hook
    if (hooks) {
      const ok = await hooks.run("preAgentRun", {
        type: "preAgentRun",
        agentId: step.agent,
        issueNumber,
      });
      if (!ok) {
        return { success: false, issueNumber, error: `Blocked by pre-hook: ${step.agent}` };
      }
    }

    if (step.agent === "workflow.intake") {
      const result = await intakeAgent.intake(issueNumber, issueData);
      if (!result.success) {
        return { success: false, issueNumber, error: result.error };
      }
      workPackage = result.workPackage;
      await coordinator.transition(issueNumber, "NEW", { actor: "system" });
      await coordinator.transition(issueNumber, "SELECTED", { actor: "IssueIntakeAgent" });
    } else if (workPackage && step.agent === "workflow.planning") {
      const result = await planAgent.plan(workPackage);
      if (!result.success) {
        return { success: false, issueNumber, error: result.error };
      }
      plan = result.plan;
      await coordinator.transition(issueNumber, "PLANNED", { actor: "PlanningAgent" });
    } else if (plan && step.agent === "workflow.review") {
      const result = await reviewAgent.review(plan);
      if (!result.success) {
        return { success: false, issueNumber, error: result.error };
      }
      review = result.report;
      await coordinator.transition(issueNumber, "UNDER_REVIEW", { actor: "ReviewAgent" });
      await writer.recordReviewCompleted(issueNumber, {
        verdict: review.verdict,
        findingCount: review.findings.length,
      });
    } else if (step.agent === "workflow.execution" || step.agent === "workflow.pr") {
      // Execution and PR require human approval first — skip in automated flow
      return {
        success: true,
        issueNumber,
        workPackage,
        plan,
        review,
      };
    }

    // Post-step hook
    if (hooks) {
      await hooks.run("postAgentRun", {
        type: "postAgentRun",
        agentId: step.agent,
        issueNumber,
      });
    }
  }

  if (!workPackage || !plan || !review) {
    return { success: false, issueNumber, error: "Skill did not complete all required steps" };
  }

  return { success: true, issueNumber, workPackage, plan, review };
}
```

- [ ] **Step 4: Extend the tests and run**

Run: `npx vitest run tests/workflow/workflow-skill.vitest.ts tests/workflow/orchestrator-bridge.vitest.ts --config vitest.config.mts 2>&1 | tail -10`
Expected: All skill binding tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/workflow-skill.ts
git commit -m "feat(p4.6c): add runWorkflowSkill — skill-to-workflow binding"
```

---
## Task 4: P4.6d — Orchestrator Bridge

**Files:**
- Create: `src/workflow/orchestrator-bridge.ts`
- Test: `tests/workflow/orchestrator-bridge.vitest.ts`

**Interfaces:**
- Consumes: `SkillDefinition`, `runWorkflowSkill()`, `HookManager`, `WorkflowCoordinator`
- Produces: `WorkflowOrchestrator` class with `runGoal()` that selects a skill and executes it

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkflowOrchestrator } from "../../src/workflow/orchestrator-bridge.js";
import { WorkflowCoordinator } from "../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";

function tmpDir(): string {
  const dir = join("/tmp", "orb-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

describe("WorkflowOrchestrator", () => {
  let dir: string;
  let coordinator: WorkflowCoordinator;
  let writer: EvidenceEventWriter;

  beforeEach(async () => {
    dir = tmpDir();
    coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
    const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
    writer = new EvidenceEventWriter((t, p) => store.append(t, p));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("selects and runs plan-only skill from a goal", async () => {
    const orchestrator = new WorkflowOrchestrator(coordinator, writer);
    const result = await orchestrator.runGoal({
      issueNumber: 61,
      issueTitle: "Test orchestrator goal routing",
      body: "## Acceptance Criteria\n- [ ] Task A",
      labels: [{ name: "ready-for-agent" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.workPackage).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.review).toBeDefined();
  });

  it("lists available skills", async () => {
    const orchestrator = new WorkflowOrchestrator(coordinator, writer);
    const skills = await orchestrator.listSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some(s => s.id === "issue-lifecycle")).toBe(true);
  });

  it("rejects goals without ready-for-agent label", async () => {
    const orchestrator = new WorkflowOrchestrator(coordinator, writer);
    const result = await orchestrator.runGoal({
      issueNumber: 61,
      issueTitle: "Bad issue",
      body: "",
      labels: [],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/orchestrator-bridge.vitest.ts --config vitest.config.mts 2>&1 | head -10`
Expected: FAIL — `WorkflowOrchestrator` not found.

- [ ] **Step 3: Create `src/workflow/orchestrator-bridge.ts`**

```typescript
/**
 * P4.6d — WorkflowOrchestrator: goal-to-workflow bridge.
 *
 * The orchestrator:
 *   1. Accepts a user goal (GitHub issue data)
 *   2. Selects the appropriate skill based on goal characteristics
 *   3. Executes the skill via runWorkflowSkill()
 *   4. Returns the result
 *
 * This is the integration layer between the existing ALiX orchestrator
 * and the P4.5 workflow engine.
 *
 * @module
 */

import type { WorkflowCoordinator } from "./coordinator.js";
import type { EvidenceEventWriter } from "./evidence-writer.js";
import type { HookManager } from "./hooks.js";
import { runWorkflowSkill } from "./workflow-skill.js";
import { listSkills } from "./skill.js";
import type { SkillGoal, OrchestratorResult } from "./types.js";

// Re-export types used by the orchestrator
export type { SkillGoal, OrchestratorResult };

// ---------------------------------------------------------------------------
// WorkflowOrchestrator
// ---------------------------------------------------------------------------

export class WorkflowOrchestrator {
  constructor(
    private readonly coordinator: WorkflowCoordinator,
    private readonly writer: EvidenceEventWriter,
    private readonly hooks?: HookManager,
  ) {}

  /**
   * Run a user goal through the workflow engine.
   *
   * Currently selects the "plan-only" skill (intake → plan → review).
   * Will select based on goal complexity when multiple skills exist.
   */
  async runGoal(goal: SkillGoal): Promise<OrchestratorResult> {
    // Select skill (currently hard-coded to plan-only for safety)
    const { loadSkill } = await import("./skill.js");
    const skill = await loadSkill("plan-only");
    if (!skill) {
      return { success: false, issueNumber: goal.issueNumber, error: "No matching skill found" };
    }

    return runWorkflowSkill(skill, goal, {
      coordinator: this.coordinator,
      writer: this.writer,
      hooks: this.hooks,
    });
  }

  /**
   * List all available workflow skills.
   */
  async listSkills() {
    return listSkills();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/orchestrator-bridge.vitest.ts tests/workflow/workflow-skill.vitest.ts tests/workflow/hooks.vitest.ts --config vitest.config.mts 2>&1 | tail -10`
Expected: All ~12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/orchestrator-bridge.ts tests/workflow/orchestrator-bridge.vitest.ts
git commit -m "feat(p4.6d): add WorkflowOrchestrator — goal-to-skill-to-workflow routing"
```

---
## Verification

Run all P4.6 tests plus existing P4.5 tests to confirm no regressions:

```bash
npx vitest run tests/workflow/ tests/cli/ tests/security/evidence/ --config vitest.config.mts | tail -10
```
Expected: All tests pass.

---
## Summary

After P4.6, the ALiX architecture looks like:

```
User Goal
  ↓
Orchestrator (existing) — intent classification, agent selection
  ↓
WorkflowOrchestrator (P4.6d) — skill selection
  ↓
Skill (P4.6b) — defines the process (intake → plan → review → execute → PR)
  ↓
WorkflowCoordinator (P4.5) — state machine, transitions, gates
  ↓
Agents (P4.5) — role workers
  ↓
Hooks (P4.6a) — lifecycle interceptors, policy enforcement
  ↓
Evidence (P4.4) — audit trail
```

The orchestrator doesn't hard-code agent calls. It selects a **skill**, and the skill defines which agents run in which order. Hooks wrap every agent step with policy checks and evidence recording.
