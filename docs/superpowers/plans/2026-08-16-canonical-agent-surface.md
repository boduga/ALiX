# Canonical NLP Agent Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** #560
**Goal:** Collapse the two parallel agent definitions—the NLP `SubagentRole` delegate runtime and the legacy NLP agent cards—into one canonical NLP delegate surface while preserving runtime behavior and keeping workflow/control-plane surfaces architecturally separate.

**Status:** Implementation-ready
**Date:** 2026-08-16

---

## 1. Executive Summary

ALiX currently has multiple representations of "agents":

1. The runtime `SubagentRole` system used by `delegate` and `SubagentManager`.
2. Agent cards in `src/registry/card-loader.ts`.
3. Workflow cards representing the P4.5 workflow pipeline.
4. Control-plane roles such as `operator`, `governor`, `executor`, and `verifier`.

This plan does **not** collapse all of those into one universal agent registry.

Instead, it establishes the correct architectural boundary:

```text
                         ALiX PROJECT
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
             NLP DELEGATES  WORKFLOWS   CONTROL PLANE
                 │            │            │
                 ▼            ▼            ▼
          agent-registry   workflow     governance/
                           surface      execution/
                 │            │            │
                 └────────────┼────────────┘
                              │
                              ▼
                     CAPABILITIES / TOOLS
                              │
                              ▼
                       POLICY / EXECUTOR
                              │
                              ▼
                         EVIDENCE
```

The canonical NLP registry will contain exactly six ephemeral delegate roles:

```text
explorer
reviewer
test_investigator
docs_researcher
worker
researcher
```

`auto` remains a routing sentinel and is intentionally absent from the registry.

The five P4.5 workflow cards remain a separate surface:

```text
workflow.intake
workflow.planning
workflow.review
workflow.execution
workflow.pr
```

The control-plane roles remain architectural layers rather than registry entries:

```text
operator
governor
executor
verifier
```

---

# 2. Architectural Contract

## 2.1 Canonical NLP registry

Create:

```text
src/agents/agent-registry.ts
```

This becomes the **single authoritative metadata source** for the six ephemeral NLP delegate roles.

It owns:

* display name
* description
* instructions
* tool category
* execution mode
* model style
* capability metadata
* optional execution profile

It does **not** own execution.

---

## 2.2 Runtime contract remains unchanged

The existing:

```text
src/config/schema.ts
```

continues to own:

```ts
SubagentRole
SubagentRoleConfig
SubagentStyle
```

The `SubagentRole` union is **not moved**.

The registry consumes the runtime type.

It does not replace it.

---

## 2.3 Cross-surface composition

A project may use NLP delegates, workflow agents, and control-plane components within the same execution.

These surfaces may coordinate through their existing orchestration boundaries, but their:

* identities
* registries
* lifecycle semantics
* activation mechanisms

remain distinct.

A large project may therefore legitimately execute:

```text
workflow.execution
      │
      ▼
delegate → researcher
      │
      ▼
worker
      │
      ▼
ToolExecutor
      │
      ▼
verifier
      │
      ▼
workflow.review
```

This is **composition**, not taxonomy collapse.

---

## 2.4 Activation boundary

Agent cards are metadata/catalog projections only.

Presence in:

```ts
defaultAgentCards()
```

or:

```ts
defaultWorkflowAgentCards()
```

does **not** instantiate or activate an agent.

### NLP activation

NLP delegates are activated through:

```text
delegate
  ↓
classifyTask
  ↓
recommendRole
  ↓
SubagentManager.spawn
```

### Workflow activation

Workflow agents are activated by the existing P4.5 workflow orchestration surface.

This plan does **not** introduce a new workflow execution engine.

### Control-plane activation

Control-plane components are activated through the governed execution/runtime architecture.

---

## 2.5 Registry scope

`src/agents/agent-registry.ts` MUST contain only the six ephemeral `SubagentRole` delegates.

It MUST NOT contain:

```text
workflow.intake
workflow.planning
workflow.review
workflow.execution
workflow.pr
```

It MUST NOT contain:

```text
operator
governor
executor
verifier
```

It MUST NOT become a universal ALiX agent registry.

---

## 2.6 `auto` is a router sentinel

`auto` remains in:

```ts
SubagentRole
```

but is absent from:

```ts
AGENT_REGISTRY
```

Its existing:

```ts
DEFAULT_SUBAGENT_INSTRUCTIONS
```

remains unchanged.

`auto` continues to represent:

> infer the appropriate concrete delegate role from the task.

It is not a concrete agent definition.

---

## 2.7 Workflow cards are a separate surface

The five workflow cards move verbatim into:

```ts
defaultWorkflowAgentCards()
```

They are not folded into the NLP registry.

`defaultAgentCards()` is an **aggregate catalog/display surface**:

```text
6 NLP cards
+
5 workflow cards
=
11 cards
```

This aggregation does not merge runtime identities or activation mechanisms.

---

## 2.8 Control-plane roles remain separate

The following are not registry entries:

```text
operator
governor
executor
verifier
```

They are existing ALiX architectural layers involving:

* session/runtime loop
* `PolicyGate`
* `ApprovalStore`
* governance
* `ToolExecutor`
* evidence
* verification

They must not be added to `AGENT_REGISTRY`.

---

# 3. Runtime-Preservation Contract

The refactor must preserve:

### `ROLE_INSTRUCTIONS`

Existing instruction strings must remain **byte-identical**.

### `getToolPolicy`

Existing policy object shapes must remain unchanged.

The only intentional functional addition is that `researcher` receives its existing intended research policy bucket.

### Delegate execution

The following path must not change semantically:

```text
delegate
→ classifyTask
→ recommendRole
→ SubagentManager.spawn
```

### `auto`

`auto` must remain a router sentinel and retain:

```text
DEFAULT_SUBAGENT_INSTRUCTIONS
```

### Researcher

`researcher` must become reachable through:

```text
recommendRole("research", ...)
```

with:

```text
role: "researcher"
confidence: "high"
```

### Card count

The total remains:

```text
6 NLP + 5 workflow = 11
```

---

# 4. Canonical Capability IDs

The registry uses the canonical capability IDs established by #559:

```text
filesystem.read
filesystem.search
filesystem.write
shell.exec
web.search
web.fetch
```

No alternate tool/capability vocabulary may be introduced.

---

# 5. File Structure

## New files

```text
src/agents/agent-registry.ts

tests/agents/agent-registry.vitest.ts
tests/agents/agent-taxonomy-sentinel.vitest.ts
```

## Modified files

```text
src/agents/subagent-cli.ts
src/agents/tool-policy.ts
src/config/defaults.ts
src/registry/card-loader.ts
src/agents/role-mapper.ts

tests/registry/card-loader.test.ts
tests/agents/tool-policy.test.ts
tests/agents/role-mapper.test.ts

docs/user-manual.md
```

---

# Task 1: Create the Canonical Agent Registry

## Files

**Create:**

```text
src/agents/agent-registry.ts
tests/agents/agent-registry.vitest.ts
```

## Interfaces

Consumes:

```ts
SubagentRole
SubagentRoleConfig
SubagentStyle
```

from:

```text
src/config/schema.ts
```

Produces:

```ts
AgentCapability
AGENT_REGISTRY
getAgentDefinition()
ROLE_INSTRUCTIONS
DEFAULT_SUBAGENT_INSTRUCTIONS
getToolCategory()
defaultRoleConfigs()
```

---

## Step 1: Write the failing test

Create:

```text
tests/agents/agent-registry.vitest.ts
```

```ts
import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY,
  ROLE_INSTRUCTIONS,
  DEFAULT_SUBAGENT_INSTRUCTIONS,
  getAgentDefinition,
  getToolCategory,
  defaultRoleConfigs,
} from "../../src/agents/agent-registry.js";

describe("canonical agent registry", () => {
  it("has exactly 6 entries covering the concrete SubagentRoles", () => {
    expect(AGENT_REGISTRY).toHaveLength(6);

    const roles = AGENT_REGISTRY.map((a) => a.role).sort();

    expect(roles).toEqual([
      "docs_researcher",
      "explorer",
      "researcher",
      "reviewer",
      "test_investigator",
      "worker",
    ]);
  });

  it("ROLE_INSTRUCTIONS is derived from the registry for every concrete role", () => {
    for (const def of AGENT_REGISTRY) {
      expect(ROLE_INSTRUCTIONS[def.role]).toBe(def.instructions);
    }
  });

  it("auto keeps its default instructions string", () => {
    expect(DEFAULT_SUBAGENT_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(ROLE_INSTRUCTIONS["auto"]).toBe(DEFAULT_SUBAGENT_INSTRUCTIONS);
  });

  it("getToolCategory returns the tool category per role", () => {
    expect(getToolCategory("worker")).toBe("write");
    expect(getToolCategory("researcher")).toBe("research");
    expect(getToolCategory("explorer")).toBe("read");
    expect(getToolCategory("auto")).toBeUndefined();
  });

  it("defaultRoleConfigs returns 6 entries including researcher with fast/read_only", () => {
    const configs = defaultRoleConfigs();

    expect(configs).toHaveLength(6);

    const researcher = configs.find((c) => c.role === "researcher")!;

    expect(researcher).toMatchObject({
      role: "researcher",
      mode: "read_only",
      style: "fast",
    });
  });

  it("getAgentDefinition returns the definition for a role and undefined for auto", () => {
    expect(getAgentDefinition("worker")?.instructions).toContain(
      "worker subagent",
    );

    expect(getAgentDefinition("auto")).toBeUndefined();
  });
});
```

---

## Step 2: Verify failure

Run:

```bash
pnpm vitest run --config vitest.config.mts tests/agents/agent-registry.vitest.ts
```

Expected:

```text
FAIL
module ../../src/agents/agent-registry.js not found
```

---

## Step 3: Implement the registry

Create:

```text
src/agents/agent-registry.ts
```

```ts
/**
 * agent-registry.ts -- Canonical NLP subagent (delegate) registry.
 *
 * Single authoritative source of metadata for the ephemeral delegate roles
 * spawned by the NLP `delegate` tool.
 *
 * Metadata only — no execution.
 *
 * The control-plane roles (operator / governor / executor / verifier) are
 * architectural layers and are intentionally not registry entries.
 *
 * The workflow.* cards are a separate P4.5 workflow surface and are
 * intentionally not registry entries.
 *
 * `auto` is a router sentinel and is intentionally absent from the registry.
 */

import type {
  SubagentRole,
  SubagentRoleConfig,
  SubagentStyle,
} from "../config/schema.js";

export type AgentToolCategory = "read" | "write" | "research";

export type AgentCapability = {
  role: SubagentRole;
  name: string;
  description: string;
  instructions: string;
  toolCategory: AgentToolCategory;
  mode: "read_only" | "write";
  style: SubagentStyle;
  capabilities: string[];
  executionProfile?: "research";
};

export const DEFAULT_SUBAGENT_INSTRUCTIONS =
  "You are an autonomous subagent. Adapt your behavior based on context — read files, analyze code, and apply changes as needed. Be efficient and self-directed.";

export const AGENT_REGISTRY: readonly AgentCapability[] = [
  {
    role: "explorer",
    name: "Explorer",
    description:
      "Read-only codebase exploration: find files, trace code paths, summarize structure.",
    instructions:
      "You are an explorer subagent. Understand code regions and report your findings concisely. Use file references, summarize structure, identify key symbols.",
    toolCategory: "read",
    mode: "read_only",
    style: "fast",
    capabilities: ["filesystem.read", "filesystem.search"],
  },
  {
    role: "reviewer",
    name: "Code Reviewer",
    description:
      "Independent code/design review for correctness, quality, and risks.",
    instructions:
      "You are a code reviewer. Analyze code quality, style, and potential issues. Be constructive and specific. Flag risks and suggest improvements.",
    toolCategory: "read",
    mode: "read_only",
    style: "critic",
    capabilities: [],
  },
  {
    role: "test_investigator",
    name: "Test Investigator",
    description:
      "Map tests to code, diagnose failures, and suggest fixes.",
    instructions:
      "You are a test investigator. Map tests to code, diagnose failures, and suggest fixes. Be precise. Use test names and file paths.",
    toolCategory: "read",
    mode: "read_only",
    style: "thinking",
    capabilities: ["filesystem.read", "filesystem.search"],
  },
  {
    role: "docs_researcher",
    name: "Docs Researcher",
    description:
      "Find and summarize relevant documentation; cite sources.",
    instructions:
      "You are a docs researcher. Find and summarize relevant documentation. Cite file paths and sources. Be thorough.",
    toolCategory: "read",
    mode: "read_only",
    style: "fast",
    capabilities: ["filesystem.read"],
  },
  {
    role: "worker",
    name: "Worker",
    description:
      "Implementation worker that applies changes to owned files.",
    instructions:
      "You are a worker subagent. Apply changes to owned files only. Do NOT delete files you create — leave them in place. Always explain what you changed.",
    toolCategory: "write",
    mode: "write",
    style: "coding",
    capabilities: ["filesystem.write", "shell.exec"],
  },
  {
    role: "researcher",
    name: "Researcher",
    description:
      "External research and synthesis using web search; cite sources.",
    instructions:
      "You are a researcher subagent. Search for information, analyze findings, and report concisely. Use web search for external knowledge. Cite sources.",
    toolCategory: "research",
    mode: "read_only",
    style: "fast",
    capabilities: ["web.search", "web.fetch"],
    executionProfile: "research",
  },
];

export function getAgentDefinition(
  role: SubagentRole,
): AgentCapability | undefined {
  return AGENT_REGISTRY.find((a) => a.role === role);
}

export function getToolCategory(
  role: SubagentRole,
): AgentToolCategory | undefined {
  return getAgentDefinition(role)?.toolCategory;
}

export const ROLE_INSTRUCTIONS: Readonly<Record<SubagentRole, string>> = {
  auto: DEFAULT_SUBAGENT_INSTRUCTIONS,
  ...(Object.fromEntries(
    AGENT_REGISTRY.map((a) => [a.role, a.instructions]),
  ) as Record<string, string>),
} as Record<SubagentRole, string>;

export function defaultRoleConfigs(): SubagentRoleConfig[] {
  return AGENT_REGISTRY.map((a) => ({
    role: a.role,
    mode: a.mode,
    style: a.style,
    retryCount: a.role === "worker" ? 0 : 1,
  }));
}
```

---

## Step 4: Verify

```bash
pnpm vitest run --config vitest.config.mts tests/agents/agent-registry.vitest.ts
```

Expected:

```text
PASS
6 tests
```

---

## Step 5: Commit

```bash
git add tests/agents/agent-registry.vitest.ts src/agents/agent-registry.ts
git commit -m "feat(agents): add canonical NLP delegate registry"
```

---

# Task 2: Derive `ROLE_INSTRUCTIONS`

## Files

Modify:

```text
src/agents/subagent-cli.ts
```

---

## Step 1: Import the canonical instructions

Add:

```ts
import { ROLE_INSTRUCTIONS } from "./agent-registry.js";
```

---

## Step 2: Remove the inline map

Delete the existing inline:

```ts
const ROLE_INSTRUCTIONS = {
  ...
};
```

The existing runtime use remains unchanged:

```ts
ROLE_INSTRUCTIONS[role] ?? "You are a subagent."
```

No execution behavior changes.

---

## Step 3: Test

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/subagent-cli.test.ts \
  tests/agents/agent-registry.vitest.ts
```

Expected:

```text
PASS
```

---

## Step 4: Typecheck and build

```bash
pnpm typecheck && pnpm build
```

Expected:

```text
clean
```

---

## Step 5: Commit

```bash
git add src/agents/subagent-cli.ts
git commit -m "refactor(agents): derive ROLE_INSTRUCTIONS from canonical registry"
```

---

# Task 3: Derive `getToolPolicy` Buckets

## Files

Modify:

```text
src/agents/tool-policy.ts
tests/agents/tool-policy.test.ts
tests/agents/agent-taxonomy-sentinel.vitest.ts
```

---

## Step 1: Create Sentinel L

Create:

```text
tests/agents/agent-taxonomy-sentinel.vitest.ts
```

```ts
import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY,
  getToolCategory,
} from "../../src/agents/agent-registry.js";
import { getToolPolicy } from "../../src/agents/tool-policy.js";

describe("agent taxonomy architecture sentinels", () => {
  it("Sentinel L: getToolPolicy buckets match registry toolCategory", () => {
    const expectedByCategory: Record<string, string[]> = {
      read: ["read"],
      write: ["read", "write", "mcp"],
      research: ["read", "mcp"],
    };

    for (const def of AGENT_REGISTRY) {
      const category = getToolCategory(def.role)!;

      expect(
        getToolPolicy(def.role).allowedCategories,
        def.role,
      ).toEqual(expectedByCategory[category]);
    }
  });
});
```

---

## Step 2: Verify failure

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/agent-taxonomy-sentinel.vitest.ts
```

Expected:

```text
FAIL
researcher receives fallback/read policy
```

---

## Step 3: Derive buckets

In:

```text
src/agents/tool-policy.ts
```

import:

```ts
import {
  AGENT_REGISTRY,
  getToolCategory,
} from "./agent-registry.js";
```

Replace the manually maintained role arrays with:

```ts
const READ_ONLY_ROLES: SubagentRole[] = AGENT_REGISTRY
  .filter((a) => getToolCategory(a.role) === "read")
  .map((a) => a.role);

const WRITE_ROLES: SubagentRole[] = AGENT_REGISTRY
  .filter((a) => getToolCategory(a.role) === "write")
  .map((a) => a.role);

const RESEARCH_ROLES: SubagentRole[] = AGENT_REGISTRY
  .filter((a) => getToolCategory(a.role) === "research")
  .map((a) => a.role);
```

Keep the existing policy objects/shapes unchanged.

The fallback behavior for `auto` remains unchanged.

---

## Step 4: Verify

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/agent-taxonomy-sentinel.vitest.ts \
  tests/agents/tool-policy.test.ts
```

Expected:

```text
PASS
```

---

## Step 5: Add researcher and auto tests

Append:

```ts
test("getToolPolicy returns research access for researcher role", () => {
  const policy = getToolPolicy("researcher");

  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
});

test("getToolPolicy returns read-only fallback for auto", () => {
  const policy = getToolPolicy("auto");

  assert.deepEqual(policy.allowedCategories, ["read"]);
  assert.equal(policy.maxIterations, 3);
});
```

---

## Step 6: Verify

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/tool-policy.test.ts && \
pnpm typecheck
```

---

## Step 7: Commit

```bash
git add \
  src/agents/tool-policy.ts \
  tests/agents/tool-policy.test.ts \
  tests/agents/agent-taxonomy-sentinel.vitest.ts

git commit -m "refactor(agents): derive tool policy buckets from canonical registry"
```

---

# Task 4: Derive `SubagentRoleConfig` Defaults

## Files

Modify:

```text
src/config/defaults.ts
```

---

## Step 1: Import

```ts
import { defaultRoleConfigs } from "../agents/agent-registry.js";
```

---

## Step 2: Replace inline defaults

Replace:

```ts
roles: [
  ...
]
```

with:

```ts
subagents: {
  enabled: true,
  roles: defaultRoleConfigs(),
},
```

`PERMIT_ALL_CONFIG` remains unchanged.

---

## Step 3: Verify cycle safety

```bash
pnpm typecheck
```

Expected:

```text
clean
```

The dependency direction is:

```text
config/schema
     ↑
agent-registry
     ↑
config/defaults
```

There must be no reverse dependency from the registry into defaults.

---

## Step 4: Test

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/agent-registry.vitest.ts \
  tests/config/
```

Expected:

```text
PASS
```

---

## Step 5: Commit

```bash
git add src/config/defaults.ts
git commit -m "refactor(config): derive subagent role defaults from canonical registry"
```

---

# Task 5: Derive NLP Agent Cards and Separate Workflow Cards

## Files

Modify:

```text
src/registry/card-loader.ts
tests/registry/card-loader.test.ts
tests/agents/agent-taxonomy-sentinel.vitest.ts
docs/user-manual.md
```

---

## Step 1: Update card-loader test

Replace the existing expected-set test with:

```ts
it("defaultAgentCards returns expected set", () => {
  const cards = defaultAgentCards();

  // 6 NLP delegate roles + 5 workflow agents = 11
  assert.equal(cards.length, 11);

  // NLP-derived card ids == registry role ids
  for (const id of [
    "explorer",
    "reviewer",
    "test_investigator",
    "docs_researcher",
    "worker",
    "researcher",
  ]) {
    assert.ok(cards.find((c) => c.id === id), `missing NLP card ${id}`);
  }

  // workflow cards remain present
  assert.ok(cards.find((c) => c.id === "workflow.execution"));

  // dead + legacy display cards retired
  for (const id of [
    "orchestrator.core",
    "planner.graph",
    "memory.curator",
    "research.scout",
    "critic.general",
    "artifact.writer",
  ]) {
    assert.ok(
      !cards.find((c) => c.id === id),
      `dead card ${id} should be retired`,
    );
  }

  // workflow cards remain a separate surface
  const workflowCards = cards.filter((c) =>
    c.id.startsWith("workflow."),
  );

  assert.equal(workflowCards.length, 5);
});
```

Import:

```ts
import {
  loadCardRegistry,
  defaultAgentCards,
  defaultToolCards,
  defaultWorkflowAgentCards,
} from "../../src/registry/card-loader.js";
```

---

## Step 2: Verify failure

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/registry/card-loader.test.ts
```

Expected:

```text
FAIL
```

because legacy cards still exist.

---

## Step 3: Add registry import

In:

```text
src/registry/card-loader.ts
```

add:

```ts
import { AGENT_REGISTRY } from "../agents/agent-registry.js";
```

---

## Step 4: Implement workflow card projection

Add:

```ts
/**
 * The 5 P4.5 workflow agents.
 *
 * This is catalog metadata only. It does not activate or instantiate
 * workflow agents. Runtime activation remains owned by the P4.5
 * workflow orchestration surface.
 */
export function defaultWorkflowAgentCards(): AgentCard[] {
  return [
    {
      id: "workflow.intake",
      name: "Issue Intake Agent",
      description:
        "Reads GitHub issues, validates labels, estimates priority/complexity",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.intake"],
      enabled: true,
    },
    {
      id: "workflow.planning",
      name: "Planning Agent",
      description:
        "Converts WorkPackages into ExecutionPlans with subtask decomposition",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.planning"],
      enabled: true,
    },
    {
      id: "workflow.review",
      name: "Review Agent",
      description:
        "Reviews ExecutionPlans for completeness, governance, and risk",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.review"],
      enabled: true,
    },
    {
      id: "workflow.execution",
      name: "Execution Agent",
      description:
        "Executes one subtask at a time with test gating and permit validation",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.execution"],
      enabled: true,
    },
    {
      id: "workflow.pr",
      name: "PR Agent",
      description:
        "Creates draft PRs with issue links, evidence fingerprints, and review findings",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.pr"],
      enabled: true,
    },
  ];
}
```

---

## Step 5: Implement NLP card projection

Add:

```ts
/**
 * NLP delegate cards are a display projection of the canonical
 * agent registry. They do not instantiate delegates.
 */
export function deriveNlpAgentCards(): AgentCard[] {
  return AGENT_REGISTRY.map((def) => ({
    id: def.role,
    name: def.name,
    description: def.description,
    version: "1.0.0",
    domains: [
      def.toolCategory === "research"
        ? "research"
        : "general",
    ],
    capabilities: def.capabilities,
    ...(def.executionProfile
      ? { executionProfile: def.executionProfile }
      : {}),
    enabled: true,
  }));
}
```

---

## Step 6: Aggregate the catalog

Implement:

```ts
/**
 * Aggregate catalog surface:
 *
 * 6 canonical NLP delegate cards
 * +
 * 5 separate workflow cards
 * =
 * 11 default cards.
 *
 * This aggregation does not merge runtime taxonomies.
 */
export function defaultAgentCards(): AgentCard[] {
  return [
    ...deriveNlpAgentCards(),
    ...defaultWorkflowAgentCards(),
  ];
}
```

---

## Step 7: Add Sentinel M

In:

```text
tests/agents/agent-taxonomy-sentinel.vitest.ts
```

add:

```ts
import {
  defaultAgentCards,
  defaultWorkflowAgentCards,
} from "../../src/registry/card-loader.js";

it("Sentinel M: defaultAgentCards is derived; no dead cards; workflow is separate", () => {
  const cards = defaultAgentCards();
  const nlpIds = AGENT_REGISTRY.map((a) => a.role);

  for (const id of nlpIds) {
    expect(
      cards.find((c) => c.id === id),
      `missing derived card ${id}`,
    ).toBeDefined();
  }

  for (const id of [
    "orchestrator.core",
    "planner.graph",
    "memory.curator",
  ]) {
    expect(
      cards.find((c) => c.id === id),
      `${id} must not reappear`,
    ).toBeUndefined();
  }

  const workflow = defaultWorkflowAgentCards();

  expect(workflow).toHaveLength(5);

  for (const card of workflow) {
    expect(card.id.startsWith("workflow.")).toBe(true);
  }

  // Workflow cards must not be generated by the NLP registry projection.
  expect(
    deriveNlpAgentCards().some((c) => c.id.startsWith("workflow.")),
  ).toBe(false);
});
```

Import `deriveNlpAgentCards` as needed.

---

## Step 8: Update documentation

Update §11 of:

```text
docs/user-manual.md
```

to document:

```md
| Agents | Tools |
|--------|-------|
| explorer | web_search |
| reviewer | file_read |
| test_investigator | file_write |
| docs_researcher | shell_exec |
| worker | |
| researcher | |

The 6 delegate cards derive from the canonical NLP agent registry
(`src/agents/agent-registry.ts`).

The 5 `workflow.*` cards are a separate P4.5 workflow surface and also
appear in `alix registry agents`.

Agent cards are catalog metadata; they do not themselves activate an
NLP delegate or workflow execution.
```

---

## Step 9: Run tests

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/registry/card-loader.test.ts \
  tests/agents/agent-taxonomy-sentinel.vitest.ts \
  tests/integration/smoke.test.ts \
  tests/server/server.test.ts \
  tests/registry/card-registry.test.ts
```

Expected:

```text
PASS
```

The total remains:

```text
11
```

---

## Step 10: Commit

```bash
git add \
  src/registry/card-loader.ts \
  tests/registry/card-loader.test.ts \
  tests/agents/agent-taxonomy-sentinel.vitest.ts \
  docs/user-manual.md

git commit -m "refactor(registry): derive NLP agent cards and separate workflow surface"
```

---

# Task 6: Fix the `research → researcher` Routing Gap

## Files

Modify:

```text
src/agents/role-mapper.ts
tests/agents/role-mapper.test.ts
```

---

## Step 1: Failing test

Append:

```ts
it("maps research to researcher with high confidence", () => {
  const result = recommendRole(
    "research",
    "research auth tokens",
  );

  assert.equal(result.role, "researcher");
  assert.equal(result.confidence, "high");
});
```

---

## Step 2: Verify failure

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/role-mapper.test.ts
```

Expected:

```text
FAIL
```

Current behavior routes research to `explorer`.

---

## Step 3: Add explicit routing

Before the default return:

```ts
if (taskType === "research") {
  return {
    role: "researcher",
    confidence: "high",
    reason:
      "research tasks require the researcher subagent",
  };
}
```

---

## Step 4: Verify related execution

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/role-mapper.test.ts \
  tests/agents/delegate-tool.test.ts \
  tests/task-classifier.test.ts
```

Expected:

```text
PASS
```

---

## Step 5: Commit

```bash
git add \
  src/agents/role-mapper.ts \
  tests/agents/role-mapper.test.ts

git commit -m "fix(agents): route research tasks to researcher delegate"
```

---

# Task 7: Architecture Sentinels

The following invariants must remain permanently enforced.

## Sentinel K — Registry cardinality and identity

`AGENT_REGISTRY` contains exactly:

```text
explorer
reviewer
test_investigator
docs_researcher
worker
researcher
```

No:

```text
auto
workflow.*
operator
governor
executor
verifier
```

---

## Sentinel L — Policy derivation

Every concrete NLP role's policy category must derive from:

```ts
AGENT_REGISTRY
```

rather than a second manually maintained role list.

Expected mapping:

```text
read
  → ["read"]

write
  → ["read", "write", "mcp"]

research
  → ["read", "mcp"]
```

`auto` continues using the existing fallback.

---

## Sentinel M — Card derivation

NLP cards must derive from:

```ts
AGENT_REGISTRY
```

Workflow cards must remain separate.

The aggregate card surface must contain:

```text
6 NLP
+
5 workflow
=
11
```

Dead cards must never return.

---

# Task 8: Full Verification

## Step 1: Dead-card grep

Run:

```bash
grep -rn \
  "orchestrator.core\|planner.graph\|memory.curator" \
  src tests
```

Expected:

```text
no hits
```

Historical references under:

```text
docs/archive/
```

may remain.

---

## Step 2: Verify no workflow/control-plane contamination

Run:

```bash
grep -R \
  "workflow\.intake\|workflow\.planning\|workflow\.review\|workflow\.execution\|workflow\.pr" \
  src/agents/agent-registry.ts
```

Expected:

```text
no hits
```

Also verify:

```bash
grep -R \
  "operator\|governor\|executor\|verifier" \
  src/agents/agent-registry.ts
```

Expected:

```text
no role definitions
```

Comments explaining their exclusion are acceptable.

---

## Step 3: Full typecheck/build

```bash
pnpm typecheck && pnpm build
```

Expected:

```text
clean
```

---

## Step 4: Focused test matrix

```bash
pnpm vitest run \
  --config vitest.config.mts \
  tests/agents/agent-registry.vitest.ts \
  tests/agents/agent-taxonomy-sentinel.vitest.ts \
  tests/agents/tool-policy.test.ts \
  tests/agents/role-mapper.test.ts \
  tests/agents/subagent-cli.test.ts \
  tests/agents/subagent-manager.test.ts \
  tests/agents/delegate-tool.test.ts \
  tests/registry/card-loader.test.ts \
  tests/registry/card-registry.test.ts \
  tests/integration/smoke.test.ts \
  tests/server/server.test.ts \
  tests/tools/taxonomy-sentinel.vitest.ts
```

Expected:

```text
PASS
```

---

## Step 5: Full Vitest

```bash
pnpm test:vitest
```

Expected:

```text
PASS
```

---

## Step 6: Node tests

```bash
pnpm test:node
```

Expected:

```text
PASS
```

If the known pre-existing:

```text
graph-executor.test.js
```

timeout reproduces on unmodified `main`, record it as unrelated and do not expand #560 scope.

---

## Step 7: Manual registry smoke

Run:

```bash
pnpm build && node dist/src/cli.js registry agents
```

Expected output contains:

```text
explorer
reviewer
test_investigator
docs_researcher
worker
researcher

workflow.intake
workflow.planning
workflow.review
workflow.execution
workflow.pr
```

Expected absent:

```text
orchestrator.core
planner.graph
memory.curator
research.scout
critic.general
artifact.writer
```

---

# 6. Final Expected Architecture

After #560:

```text
                         ALiX
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
        NLP AGENTS     WORKFLOWS    CONTROL PLANE
            │             │             │
            │             │             │
            ▼             ▼             ▼
 agent-registry       P4.5 runtime    governance
            │             │             │
            │             │             │
     ┌──────┼──────┐      │        ┌────┼────┐
     │      │      │      │        │    │    │
 explorer worker researcher ...   governor executor verifier
     │      │      │
     └──────┼──────┘
            │
            ▼
       delegate runtime
            │
            ▼
       Tool / Capability
          Registry
            │
            ▼
        Policy Gate
            │
            ▼
       Tool Executor
            │
            ▼
          Evidence
```

---

# 7. Resulting Taxonomy

| Surface             | Canonical authority                      | Members                             | Activation                   |
| ------------------- | ---------------------------------------- | ----------------------------------- | ---------------------------- |
| NLP delegates       | `src/agents/agent-registry.ts`           | 6 concrete roles                    | `delegate → SubagentManager` |
| NLP router sentinel | `SubagentRole`                           | `auto`                              | routing only                 |
| Workflow            | P4.5 workflow surface                    | 5 `workflow.*` cards                | workflow orchestration       |
| Control plane       | Existing runtime/governance architecture | operator/governor/executor/verifier | governed runtime             |
| Tools               | `src/tools/tool-registry.ts`             | canonical tools                     | tool execution               |
| Capabilities        | Capability platform                      | capability IDs/lifecycle            | PolicyGate/governance        |

---

# 8. What This Plan Does **Not** Do

This issue must **not**:

* create a universal agent registry;
* move `SubagentRole` out of `src/config/schema.ts`;
* add `auto` to `AGENT_REGISTRY`;
* add workflow agents to `AGENT_REGISTRY`;
* add control-plane roles to `AGENT_REGISTRY`;
* redesign the P4.5 workflow engine;
* change workflow activation semantics;
* change `SubagentManager.spawn()` behavior;
* change the `delegate` tool contract;
* redesign capability governance;
* change the canonical tool taxonomy;
* introduce a second capability vocabulary;
* change existing workflow execution;
* make cards executable;
* introduce cross-surface implicit activation.

---

# 9. End-to-End Example

A project using every surface may legitimately execute:

```text
Project
  │
  ▼
workflow.planning
  │
  ▼
ExecutionPlan
  │
  ▼
workflow.execution
  │
  ├── delegate → researcher
  │                 │
  │                 └── web.search
  │
  ├── delegate → explorer
  │                 │
  │                 └── filesystem.search
  │
  └── delegate → worker
                    │
                    ├── filesystem.write
                    └── shell.exec
                              │
                              ▼
                         PolicyGate
                              │
                              ▼
                         ToolExecutor
                              │
                              ▼
                           Evidence
                              │
                              ▼
                           verifier
                              │
                              ▼
                       workflow.review
                              │
                              ▼
                         workflow.pr
```

This is the intended architecture.

The fact that all these components participate in one project does **not** mean they belong in one taxonomy.

---

# 10. Final Invariants

When #560 is complete, the following must all be true:

### INV-1 — One canonical NLP metadata source

```text
src/agents/agent-registry.ts
```

is the sole authoritative metadata source for the six concrete NLP delegates.

### INV-2 — Runtime contract remains in schema

```text
SubagentRole
```

remains owned by:

```text
src/config/schema.ts
```

### INV-3 — Exactly six concrete registry entries

```text
explorer
reviewer
test_investigator
docs_researcher
worker
researcher
```

### INV-4 — `auto` remains a sentinel

It is in the runtime union but absent from the registry.

### INV-5 — Instructions are derived

`ROLE_INSTRUCTIONS` comes from the registry, with `auto` retaining its existing default.

### INV-6 — Tool policies are derived

Role policy buckets come from registry metadata rather than parallel role lists.

### INV-7 — Role defaults are derived

`defaultRoleConfigs()` is the source for default subagent role configuration.

### INV-8 — NLP cards are derived

NLP agent cards come from `AGENT_REGISTRY`.

### INV-9 — Workflow remains separate

The five `workflow.*` cards remain a separate P4.5 surface.

### INV-10 — Control plane remains separate

`operator`, `governor`, `executor`, and `verifier` do not become registry agents.

### INV-11 — Cards do not activate agents

Catalog presence never implies runtime instantiation.

### INV-12 — Cross-surface composition remains legal

A single project can use:

```text
workflow
+
NLP delegates
+
control plane
+
capabilities
+
tools
```

without collapsing their identities or activation mechanisms.

### INV-13 — Aggregate card count remains 11

```text
6 NLP + 5 workflow = 11
```

### INV-14 — Legacy cards remain retired

```text
orchestrator.core
planner.graph
memory.curator
research.scout
critic.general
artifact.writer
```

must not return.

### INV-15 — Research auto-routing works

```text
research → researcher
```

with high confidence.

### INV-16 — Runtime behavior remains preserved

Aside from the explicitly intended `research → researcher` routing correction and canonicalization, the existing delegate execution semantics remain unchanged.

---

# 11. Definition of Done

The implementation is complete only when:

* [ ] `agent-registry.ts` exists and contains exactly six concrete roles.
* [ ] `SubagentRole` remains unchanged in `schema.ts`.
* [ ] `ROLE_INSTRUCTIONS` is registry-derived.
* [ ] `getToolPolicy` buckets are registry-derived.
* [ ] `defaultRoleConfigs()` is registry-derived.
* [ ] NLP cards are registry-derived.
* [ ] `defaultWorkflowAgentCards()` exists separately.
* [ ] `defaultAgentCards()` returns exactly 11 cards.
* [ ] All six legacy/dead cards are retired.
* [ ] `auto` remains absent from the registry.
* [ ] Workflow roles remain absent from the registry.
* [ ] Control-plane roles remain absent from the registry.
* [ ] `research` routes to `researcher`.
* [ ] Sentinels K/L/M pass.
* [ ] Typecheck passes.
* [ ] Build passes.
* [ ] Focused test matrix passes.
* [ ] Full Vitest passes.
* [ ] Node suite passes or only reproduces the documented pre-existing failure.
* [ ] `registry agents` shows the six NLP + five workflow cards.
* [ ] No workflow activation behavior was changed.
* [ ] No control-plane behavior was changed.
* [ ] No tool taxonomy was duplicated.
* [ ] Final working tree is clean after the implementation commits.

---

## Final architectural outcome

**#560 should leave ALiX with a canonical NLP agent surface—not a universal agent taxonomy.**

The clean boundary is:

```text
                 WHAT EXISTS?
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       NLP agents  Workflows   Control plane
          │           │           │
          ▼           ▼           ▼
      registry     P4.5        governance
          │           │           │
          └───────────┼───────────┘
                      ▼
                orchestration
                      │
                      ▼
             capabilities / tools
```

That is the architecture the implementation should enforce.

