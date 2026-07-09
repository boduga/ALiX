# P19 Governance Automation Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, read-only pipeline that classifies approved P17 plans, semantically simulates them, evaluates readiness policy, and reports operator-visible readiness without adding execution or persistence.

**Architecture:** Implement four isolated governance modules connected as `approved plan → classify → simulate → gate → report`. Domain functions accept immutable P17/P18 values and return deterministic projections. CLI commands read an explicit JSON bundle, derive P18 visibility through existing workbench code, compute all P19 artifacts in memory, and print text or JSON.

**Tech Stack:** TypeScript 5.9, Node.js 24 `node:test`, `node:crypto`, existing ALiX governance types and CLI, pnpm.

**Design spec:** `docs/architecture/specs/2026-07-08-p19-0-governance-automation-readiness-design.md`

---

## Implementation Boundaries

Never add:

- execution adapters or executor imports;
- shell, network, MCP, browser, fetch, or subprocess calls;
- readiness stores or write paths;
- audit emitter imports;
- policy mutation;
- automatic or background invocation;
- alternate approval or lifecycle state;
- operator ranking.

Every P19 computation requires a matching approved P17 approval. Every gate decision requires matching P18 lifecycle visibility. `controlledExecutionAuthorization` always equals `"not_available_in_p19"`.

## Verified Repository Contracts

- Package manager: `pnpm@11.9.0`; use package scripts through `pnpm`.
- `ExecutionActionKind` is exported from `src/governance/execution-plans.ts`. If that export changes before implementation, derive it as `GovernanceExecutionAction["kind"]` rather than duplicating its union.
- `WorkbenchLifecycleTrace`, `GovernanceWorkbenchInput`, and `buildLifecycleTrace` are exported from `src/governance/governance-workbench.ts`.
- `GovernanceWorkbenchInput.investigations` exists and is optional.
- Feature-branch work may create P19 report/checkpoint commits, but the final P19 tag must be created from verified `main` after PR merge.

## File Map

| File | Responsibility |
|---|---|
| `src/governance/execution-readiness.ts` | P19.1 validation, readiness facts, precedence, deterministic assessment |
| `tests/governance/execution-readiness.test.ts` | P19.1 behavior, determinism, immutability |
| `src/governance/dry-run-simulator.ts` | P19.2 semantic action projections only |
| `tests/governance/dry-run-simulator.test.ts` | P19.2 statuses, notes, fail-closed behavior |
| `src/governance/readiness-policy-gate.ts` | P19.3 immutable policy and P18 visibility evaluation |
| `tests/governance/readiness-policy-gate.test.ts` | P19.3 disposition and hard-boundary tests |
| `src/governance/execution-readiness-report.ts` | P19.4 time-windowed read-only report |
| `tests/governance/execution-readiness-report.test.ts` | P19.4 joins, counts, sorting, visibility |
| `src/cli/commands/governance.ts` | Delimited P19 readiness dispatcher and renderers |
| `tests/cli/governance-readiness-cli.test.ts` | CLI fixture bundle, text/JSON/errors, source sentinels |
| `src/governance/AGENTS.md` | Governance subsystem DOX contract |
| `AGENTS.md` | Add governance child DOX index entry |
| `docs/architecture/reports/p19-governance-automation-readiness-report.md` | Final phase evidence |
| `docs/architecture/checkpoints/2026-07-08-p19-governance-automation-readiness-complete.md` | Seal record |

## Task 1: P19.1 Execution Readiness Classifier

**Files:**

- Create: `src/governance/execution-readiness.ts`
- Create: `tests/governance/execution-readiness.test.ts`

- [ ] **Step 1: Write fixture builders and failing validation tests**

Create test fixtures using actual P17 types. Keep fixtures local so tests expose public contracts rather than shared mutable helpers.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExecutionReadiness,
  ReadinessClassificationError,
} from "../../src/governance/execution-readiness.js";
import type {
  GovernanceExecutionAction,
  GovernanceExecutionPlan,
} from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";

const NOW = "2026-07-08T12:00:00.000Z";

function action(
  actionId: string,
  overrides: Partial<GovernanceExecutionAction> = {},
): GovernanceExecutionAction {
  return {
    actionId,
    kind: "investigate_anomaly",
    description: `Action ${actionId}`,
    target: { type: "anomaly", id: null },
    expectedEffect: "Evidence documented",
    mutationRequired: false,
    externalSideEffect: false,
    approvalRequired: true,
    reversible: true,
    rollbackHint: null,
    ...overrides,
  };
}

function plan(
  actions: GovernanceExecutionAction[],
  overrides: Partial<GovernanceExecutionPlan> = {},
): GovernanceExecutionPlan {
  return {
    planId: "plan-1",
    remediationId: "rem-1",
    sourceProposalId: "rem-1",
    status: "draft",
    title: "Plan",
    summary: "Summary",
    proposedActions: actions,
    riskLevel: "medium",
    requiresRollbackPlan: false,
    rollbackPlan: null,
    createdAt: NOW,
    createdBy: "system",
    approvedAt: null,
    approvedBy: null,
    executionAttemptIds: [],
    auditRefs: [],
    ...overrides,
  };
}

function approval(
  p: GovernanceExecutionPlan,
  approvedActionIds = p.proposedActions.map((item) => item.actionId),
  overrides: Partial<GovernanceExecutionApproval> = {},
): GovernanceExecutionApproval {
  return {
    approvalId: "approval-1",
    planId: p.planId,
    remediationId: p.remediationId,
    decision: "approved",
    rationale: "Reviewed",
    operatorId: "operator-1",
    createdAt: NOW,
    approvedActionIds,
    auditRefs: [],
    ...overrides,
  };
}

describe("classifyExecutionReadiness validation", () => {
  it("rejects non-approved approval", () => {
    const p = plan([action("a")]);
    assert.throws(
      () => classifyExecutionReadiness(
        p,
        approval(p, [], { decision: "rejected" }),
        { now: NOW },
      ),
      ReadinessClassificationError,
    );
  });

  for (const [name, override] of [
    ["plan ID", { planId: "other" }],
    ["remediation ID", { remediationId: "other" }],
  ] as const) {
    it(`rejects ${name} mismatch`, () => {
      const p = plan([action("a")]);
      assert.throws(
        () => classifyExecutionReadiness(
          p,
          approval(p, ["a"], override),
          { now: NOW },
        ),
        ReadinessClassificationError,
      );
    });
  }

  it("rejects empty and unknown approved action IDs", () => {
    const p = plan([action("a")]);
    assert.throws(
      () => classifyExecutionReadiness(p, approval(p, []), { now: NOW }),
      ReadinessClassificationError,
    );
    assert.throws(
      () => classifyExecutionReadiness(p, approval(p, ["missing"]), { now: NOW }),
      ReadinessClassificationError,
    );
  });
});
```

- [ ] **Step 2: Build and run classifier test to verify RED**

Run:

```bash
pnpm build
```

Expected: TypeScript fails with `Cannot find module '../../src/governance/execution-readiness.js'`.

- [ ] **Step 3: Implement public classifier types and shared validation**

Create `src/governance/execution-readiness.ts`:

```typescript
import { createHash } from "node:crypto";
import type {
  GovernanceExecutionAction,
  GovernanceExecutionPlan,
} from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";

export type ExecutionReadinessLevel =
  | "external_side_effecting"
  | "irreversible"
  | "reversible"
  | "dry_run_capable"
  | "manual_only";

export interface ExecutionReadinessFacts {
  approvedActionCount: number;
  mutationRequired: boolean;
  reversible: boolean;
  externalSideEffect: boolean;
  rollbackPlanPresent: boolean;
  rollbackCoverageComplete: boolean;
  simulatorCoverageComplete: boolean;
}

export type ExecutionReadinessReasonCode =
  | "external_side_effect"
  | "irreversible_action"
  | "reversible_mutation"
  | "semantic_simulation_supported"
  | "manual_action_required"
  | "rollback_plan_missing"
  | "rollback_coverage_incomplete";

export interface ExecutionReadinessReason {
  code: ExecutionReadinessReasonCode;
  actionIds: string[];
  summary: string;
}

export interface ExecutionReadinessAssessment {
  assessmentId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  readinessLevel: ExecutionReadinessLevel;
  facts: ExecutionReadinessFacts;
  reasons: ExecutionReadinessReason[];
  assessedAt: string;
}

export class ReadinessClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessClassificationError";
  }
}

export function approvedActionsFor(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
): GovernanceExecutionAction[] {
  if (approval.decision !== "approved") {
    throw new ReadinessClassificationError("approval decision must be approved");
  }
  if (approval.planId !== plan.planId) {
    throw new ReadinessClassificationError(
      `approval planId "${approval.planId}" does not match plan "${plan.planId}"`,
    );
  }
  if (approval.remediationId !== plan.remediationId) {
    throw new ReadinessClassificationError(
      `approval remediationId "${approval.remediationId}" does not match remediation "${plan.remediationId}"`,
    );
  }
  if (approval.approvedActionIds.length === 0) {
    throw new ReadinessClassificationError("approvedActionIds must be non-empty");
  }

  const byId = new Map(plan.proposedActions.map((item) => [item.actionId, item]));
  return approval.approvedActionIds.map((actionId) => {
    const item = byId.get(actionId);
    if (!item) {
      throw new ReadinessClassificationError(
        `approved action "${actionId}" does not exist in plan "${plan.planId}"`,
      );
    }
    return item;
  });
}
```

- [ ] **Step 4: Add failing precedence, rollback, determinism, and immutability tests**

Append:

```typescript
describe("classifyExecutionReadiness precedence", () => {
  const cases: Array<{
    name: string;
    actions: GovernanceExecutionAction[];
    level: string;
  }> = [
    {
      name: "external side effect wins",
      actions: [
        action("mutation", { mutationRequired: true }),
        action("external", { externalSideEffect: true, reversible: false }),
      ],
      level: "external_side_effecting",
    },
    {
      name: "irreversible wins over reversible",
      actions: [
        action("reversible", { mutationRequired: true }),
        action("irreversible", { reversible: false }),
      ],
      level: "irreversible",
    },
    {
      name: "reversible mutation wins over dry run",
      actions: [action("mutation", { mutationRequired: true, reversible: true })],
      level: "reversible",
    },
    {
      name: "supported read-only action is dry-run capable",
      actions: [action("inspect", { kind: "investigate_anomaly" })],
      level: "dry_run_capable",
    },
    {
      name: "manual action is manual only",
      actions: [action("manual", { kind: "manual_action" })],
      level: "manual_only",
    },
  ];

  for (const item of cases) {
    it(item.name, () => {
      const p = plan(item.actions);
      const result = classifyExecutionReadiness(p, approval(p), { now: NOW });
      assert.equal(result.readinessLevel, item.level);
    });
  }

  it("uses approved actions only", () => {
    const p = plan([
      action("approved"),
      action("not-approved", { externalSideEffect: true }),
    ]);
    const result = classifyExecutionReadiness(
      p,
      approval(p, ["approved"]),
      { now: NOW },
    );
    assert.equal(result.readinessLevel, "dry_run_capable");
    assert.equal(result.facts.approvedActionCount, 1);
  });

  it("detects complete rollback coverage", () => {
    const p = plan(
      [action("mutation", { mutationRequired: true })],
      {
        requiresRollbackPlan: true,
        rollbackPlan: {
          rollbackId: "rb-1",
          summary: "Rollback",
          reversibleActions: ["mutation"],
          nonReversibleActions: [],
          operatorInstructions: ["Restore prior value"],
          riskNotes: [],
        },
      },
    );
    const result = classifyExecutionReadiness(p, approval(p), { now: NOW });
    assert.equal(result.facts.rollbackCoverageComplete, true);
  });

  it("is deterministic and does not mutate inputs", () => {
    const p = plan([action("b"), action("a")]);
    const a = approval(p, ["b", "a"]);
    const before = JSON.stringify({ p, a });
    const first = classifyExecutionReadiness(p, a, { now: NOW });
    const second = classifyExecutionReadiness(p, a, { now: NOW });
    assert.deepEqual(first, second);
    assert.equal(first.assessmentId.length, 16);
    assert.equal(JSON.stringify({ p, a }), before);
  });
});
```

- [ ] **Step 5: Implement precedence, facts, reasons, and delimited hash**

Append to the source:

```typescript
const FULLY_SIMULATED_KINDS = new Set([
  "investigate_anomaly",
  "review_policy",
  "update_config",
]);

function reason(
  code: ExecutionReadinessReasonCode,
  actions: GovernanceExecutionAction[],
  summary: string,
): ExecutionReadinessReason {
  return {
    code,
    actionIds: actions.map((item) => item.actionId).sort(),
    summary,
  };
}

export function classifyExecutionReadiness(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  options: { now?: string } = {},
): ExecutionReadinessAssessment {
  const actions = approvedActionsFor(plan, approval);
  const assessedAt = options.now ?? new Date().toISOString();
  const external = actions.filter((item) => item.externalSideEffect);
  const irreversible = actions.filter((item) => !item.reversible);
  const mutations = actions.filter((item) => item.mutationRequired);
  const unsupported = actions.filter(
    (item) => !FULLY_SIMULATED_KINDS.has(item.kind),
  );
  const rollbackPlanPresent = plan.rollbackPlan !== null;
  const covered = new Set(plan.rollbackPlan?.reversibleActions ?? []);
  const reversibleMutations = mutations.filter((item) => item.reversible);
  const rollbackCoverageComplete = reversibleMutations.every(
    (item) => covered.has(item.actionId),
  );
  const simulatorCoverageComplete = unsupported.length === 0;

  let readinessLevel: ExecutionReadinessLevel;
  if (external.length > 0) readinessLevel = "external_side_effecting";
  else if (irreversible.length > 0) readinessLevel = "irreversible";
  else if (mutations.length > 0) readinessLevel = "reversible";
  else if (simulatorCoverageComplete) readinessLevel = "dry_run_capable";
  else readinessLevel = "manual_only";

  const reasons: ExecutionReadinessReason[] = [];
  if (external.length > 0) {
    reasons.push(reason("external_side_effect", external, "Approved action has an external side effect"));
  }
  if (irreversible.length > 0) {
    reasons.push(reason("irreversible_action", irreversible, "Approved action is irreversible"));
  }
  if (mutations.length > 0 && irreversible.length === 0) {
    reasons.push(reason("reversible_mutation", mutations, "Approved action requires reversible mutation"));
  }
  if (simulatorCoverageComplete) {
    reasons.push(reason("semantic_simulation_supported", actions, "All approved actions support semantic simulation"));
  }
  if (unsupported.length > 0) {
    reasons.push(reason("manual_action_required", unsupported, "Approved action requires manual handling"));
  }
  if (plan.requiresRollbackPlan && !rollbackPlanPresent) {
    reasons.push(reason("rollback_plan_missing", reversibleMutations, "Required rollback plan is missing"));
  } else if (plan.requiresRollbackPlan && !rollbackCoverageComplete) {
    reasons.push(reason("rollback_coverage_incomplete", reversibleMutations, "Rollback plan does not cover every reversible mutation"));
  }
  reasons.sort((left, right) => left.code.localeCompare(right.code));

  const assessmentId = createHash("sha256")
    .update(
      ["p19.1", plan.planId, approval.approvalId, readinessLevel, assessedAt].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    assessmentId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    readinessLevel,
    facts: {
      approvedActionCount: actions.length,
      mutationRequired: mutations.length > 0,
      reversible: irreversible.length === 0,
      externalSideEffect: external.length > 0,
      rollbackPlanPresent,
      rollbackCoverageComplete,
      simulatorCoverageComplete,
    },
    reasons,
    assessedAt,
  };
}
```

- [ ] **Step 6: Build and run P19.1 tests**

Run:

```bash
pnpm build
node --test dist/tests/governance/execution-readiness.test.js
```

Expected: build succeeds; P19.1 suite passes.

- [ ] **Step 7: Commit P19.1**

Before commit:

```text
Run gitnexus_detect_changes(scope="staged") after staging.
Expected: execution-readiness symbols only; no unexpected execution flows.
```

Then:

```bash
git add src/governance/execution-readiness.ts tests/governance/execution-readiness.test.ts
git commit -m "feat(governance): classify execution readiness"
```

## Task 2: P19.2 Semantic Dry-Run Simulator

**Files:**

- Create: `src/governance/dry-run-simulator.ts`
- Create: `tests/governance/dry-run-simulator.test.ts`

- [ ] **Step 1: Write failing simulator tests**

Copy the exact `action`, `plan`, and `approval` fixture builders from Task 1 into this test file, then assert each semantic result:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateExecutionPlan } from "../../src/governance/dry-run-simulator.js";
import { classifyExecutionReadiness } from "../../src/governance/execution-readiness.js";

describe("simulateExecutionPlan", () => {
  it("semantically simulates supported read-only actions", () => {
    const p = plan([
      action("investigate", { kind: "investigate_anomaly" }),
      action("policy", { kind: "review_policy" }),
    ]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

    assert.equal(result.status, "complete");
    assert.equal(result.explicitlyNonExecuting, true);
    assert.deepEqual(
      result.actionProjections.map((item) => item.actionId),
      ["investigate", "policy"],
    );
    assert.ok(result.actionProjections.every((item) => item.status === "simulated"));
  });

  it("marks manual action as manual required", () => {
    const p = plan([action("manual", { kind: "manual_action" })]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });
    assert.equal(result.status, "partial");
    assert.equal(result.actionProjections[0]!.status, "manual_required");
  });

  for (const level of ["external_side_effecting", "irreversible"] as const) {
    it(`blocks ${level} assessment`, () => {
      const p = plan([
        action("blocked", {
          externalSideEffect: level === "external_side_effecting",
          reversible: level !== "irreversible",
        }),
      ]);
      const a = approval(p);
      const assessment = classifyExecutionReadiness(p, a, { now: NOW });
      const result = simulateExecutionPlan(p, a, assessment, { now: NOW });
      assert.equal(result.status, "blocked");
      assert.equal(result.actionProjections[0]!.status, "blocked");
    });
  }

  it("adds rollback notes for reversible mutation", () => {
    const p = plan(
      [action("config", {
        kind: "update_config",
        mutationRequired: true,
        rollbackHint: "Restore prior value",
      })],
      {
        rollbackPlan: {
          rollbackId: "rb-1",
          summary: "Restore config",
          reversibleActions: ["config"],
          nonReversibleActions: [],
          operatorInstructions: ["Restore prior value"],
          riskNotes: [],
        },
      },
    );
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });
    assert.deepEqual(result.rollbackNotes, ["Restore prior value"]);
  });
});
```

- [ ] **Step 2: Build to verify RED**

Run `pnpm build`.

Expected: missing `dry-run-simulator.js` module error.

- [ ] **Step 3: Implement simulator types, correlation validation, and projections**

```typescript
import { createHash } from "node:crypto";
import type {
  ExecutionActionKind,
  GovernanceExecutionAction,
  GovernanceExecutionPlan,
} from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import {
  approvedActionsFor,
  type ExecutionReadinessAssessment,
} from "./execution-readiness.js";

export type DryRunActionStatus =
  | "simulated"
  | "manual_required"
  | "blocked"
  | "unsupported";

export interface DryRunActionProjection {
  actionId: string;
  kind: ExecutionActionKind;
  status: DryRunActionStatus;
  target: { type: string; id: string | null };
  expectedEffect: string;
  preconditions: string[];
  risks: string[];
  rollbackNotes: string[];
}

export interface DryRunSimulation {
  simulationId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  status: "complete" | "partial" | "blocked";
  actionProjections: DryRunActionProjection[];
  expectedEffects: string[];
  riskNotes: string[];
  rollbackNotes: string[];
  simulatedAt: string;
  explicitlyNonExecuting: true;
}

export class DryRunSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunSimulationError";
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function projectAction(
  action: GovernanceExecutionAction,
  blocked: boolean,
): DryRunActionProjection {
  if (blocked) {
    return {
      actionId: action.actionId,
      kind: action.kind,
      status: "blocked",
      target: { ...action.target },
      expectedEffect: action.expectedEffect,
      preconditions: ["Approved P17 plan and matching P18 visibility required"],
      risks: ["Readiness level blocks semantic simulation"],
      rollbackNotes: [],
    };
  }

  const common = {
    actionId: action.actionId,
    kind: action.kind,
    target: { ...action.target },
    expectedEffect: action.expectedEffect,
  };
  switch (action.kind) {
    case "investigate_anomaly":
      return {
        ...common,
        status: "simulated",
        preconditions: ["Evidence source remains readable"],
        risks: [],
        rollbackNotes: [],
      };
    case "review_policy":
      return {
        ...common,
        status: "simulated",
        preconditions: ["Policy is inspected read-only"],
        risks: ["Any policy change requires a separate proposal"],
        rollbackNotes: [],
      };
    case "update_config":
      return {
        ...common,
        status: "simulated",
        preconditions: ["Operator performs any future config change manually"],
        risks: ["Config mutation is not performed by this simulation"],
        rollbackNotes: action.rollbackHint ? [action.rollbackHint] : [],
      };
    case "manual_action":
      return {
        ...common,
        status: "manual_required",
        preconditions: ["Operator review required"],
        risks: ["No machine simulation available"],
        rollbackNotes: action.rollbackHint ? [action.rollbackHint] : [],
      };
  }
}

export function simulateExecutionPlan(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  assessment: ExecutionReadinessAssessment,
  options: { now?: string } = {},
): DryRunSimulation {
  const actions = approvedActionsFor(plan, approval);
  if (
    assessment.planId !== plan.planId ||
    assessment.remediationId !== plan.remediationId ||
    assessment.approvalId !== approval.approvalId
  ) {
    throw new DryRunSimulationError("assessment correlation does not match plan and approval");
  }

  const blocked =
    assessment.readinessLevel === "external_side_effecting" ||
    assessment.readinessLevel === "irreversible";
  const actionProjections = actions
    .map((item) => projectAction(item, blocked))
    .sort((left, right) => left.actionId.localeCompare(right.actionId));
  const simulatedCount = actionProjections.filter(
    (item) => item.status === "simulated",
  ).length;
  const status = blocked
    ? "blocked"
    : simulatedCount === actionProjections.length
      ? "complete"
      : "partial";
  const simulatedAt = options.now ?? new Date().toISOString();
  const simulationId = createHash("sha256")
    .update(
      [
        "p19.2",
        plan.planId,
        approval.approvalId,
        assessment.assessmentId,
        status,
        simulatedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    simulationId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    assessmentId: assessment.assessmentId,
    status,
    actionProjections,
    expectedEffects: sortedUnique(actionProjections.map((item) => item.expectedEffect)),
    riskNotes: sortedUnique(actionProjections.flatMap((item) => item.risks)),
    rollbackNotes: sortedUnique(actionProjections.flatMap((item) => item.rollbackNotes)),
    simulatedAt,
    explicitlyNonExecuting: true,
  };
}
```

- [ ] **Step 4: Add determinism, unsupported runtime input, correlation, and immutability tests**

Use a runtime cast for future unknown action kinds:

```typescript
it("fails closed for an unknown future action kind", () => {
  const unknown = action("future", {
    kind: "future_kind" as GovernanceExecutionAction["kind"],
  });
  const p = plan([unknown]);
  const a = approval(p);
  const assessment = {
    ...classifyExecutionReadiness(p, a, { now: NOW }),
    readinessLevel: "manual_only" as const,
  };
  assert.throws(
    () => simulateExecutionPlan(p, a, assessment, { now: NOW }),
    DryRunSimulationError,
  );
});

it("rejects mismatched assessment and preserves inputs", () => {
  const p = plan([action("a")]);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const before = JSON.stringify({ p, a, assessment });
  assert.throws(
    () => simulateExecutionPlan(
      p,
      a,
      { ...assessment, planId: "other" },
      { now: NOW },
    ),
    DryRunSimulationError,
  );
  assert.equal(JSON.stringify({ p, a, assessment }), before);
});

it("produces deterministic output", () => {
  const p = plan([action("a")]);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  assert.deepEqual(
    simulateExecutionPlan(p, a, assessment, { now: NOW }),
    simulateExecutionPlan(p, a, assessment, { now: NOW }),
  );
});
```

Update `projectAction` with a `default` branch that throws:

```typescript
    default:
      throw new DryRunSimulationError(
        `unsupported execution action kind "${String(action.kind)}"`,
      );
```

- [ ] **Step 5: Build and run P19.1–P19.2 tests**

```bash
pnpm build
node --test \
  dist/tests/governance/execution-readiness.test.js \
  dist/tests/governance/dry-run-simulator.test.js
```

Expected: both suites pass.

- [ ] **Step 6: Commit P19.2**

Stage files, run `gitnexus_detect_changes(scope="staged")`, review changed symbols, then:

```bash
git add src/governance/dry-run-simulator.ts tests/governance/dry-run-simulator.test.ts
git commit -m "feat(governance): simulate execution readiness"
```

## Task 3: P19.3 Policy Gate Evaluator

**Files:**

- Create: `src/governance/readiness-policy-gate.ts`
- Create: `tests/governance/readiness-policy-gate.test.ts`

- [ ] **Step 1: Write failing gate tests for P17/P18 correlation and blocking**

Build a real `WorkbenchLifecycleTrace` fixture containing proposal, plan, and approval hops:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadinessGate,
  type ExecutionReadinessPolicy,
  type WorkbenchVisibilityEvidence,
} from "../../src/governance/readiness-policy-gate.js";
import type { WorkbenchLifecycleTrace } from "../../src/governance/governance-workbench.js";

const POLICY: ExecutionReadinessPolicy = {
  policyId: "policy-default",
  allowSemanticDryRunFor: ["dry_run_capable", "reversible"],
  requireCompleteRollbackForReversible: true,
  blockExternalSideEffects: true,
  blockIrreversibleActions: true,
  requireP18Visibility: true,
};

function trace(p: GovernanceExecutionPlan, a: GovernanceExecutionApproval): WorkbenchLifecycleTrace {
  return {
    remediationId: p.remediationId,
    hops: [
      { kind: "proposal", id: p.remediationId, status: "accepted", summary: "Proposal", timestamp: NOW, gap: false },
      { kind: "plan", id: p.planId, status: "plan_created", summary: "Plan", timestamp: NOW, gap: false },
      { kind: "approval", id: a.approvalId, status: "approved", summary: "Approval", timestamp: NOW, gap: false },
    ],
  };
}

function visibility(
  p: GovernanceExecutionPlan,
  a: GovernanceExecutionApproval,
  lifecycleTrace = trace(p, a),
): WorkbenchVisibilityEvidence {
  return {
    remediationId: p.remediationId,
    planId: p.planId,
    approvalId: a.approvalId,
    lifecycleTrace,
  };
}

it("blocks missing or mismatched P18 visibility", () => {
  const p = plan([action("inspect")]);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  const broken = trace(p, a);
  broken.hops = broken.hops.filter((hop) => hop.kind !== "approval");

  const decision = evaluateReadinessGate({
    plan: p,
    approval: a,
    assessment,
    simulation,
    policy: POLICY,
    visibility: visibility(p, a, broken),
    options: { now: NOW },
  });
  assert.equal(decision.disposition, "blocked");
  assert.ok(decision.reasonCodes.includes("p18_visibility_missing"));
});

for (const expected of ["external_side_effecting", "irreversible"] as const) {
  it(`blocks ${expected}`, () => {
    const p = plan([action("a", {
      externalSideEffect: expected === "external_side_effecting",
      reversible: expected !== "irreversible",
    })]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "blocked");
    assert.equal(decision.controlledExecutionAuthorization, "not_available_in_p19");
  });
}
```

- [ ] **Step 2: Build to verify RED**

Run `pnpm build`.

Expected: missing `readiness-policy-gate.js` module error.

- [ ] **Step 3: Implement policy, visibility validation, decision rules, and hash**

```typescript
import { createHash } from "node:crypto";
import type { GovernanceExecutionPlan } from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import type { WorkbenchLifecycleTrace } from "./governance-workbench.js";
import type { ExecutionReadinessAssessment } from "./execution-readiness.js";
import type { DryRunSimulation } from "./dry-run-simulator.js";

export interface ExecutionReadinessPolicy {
  policyId: string;
  allowSemanticDryRunFor: Array<"dry_run_capable" | "reversible">;
  requireCompleteRollbackForReversible: boolean;
  blockExternalSideEffects: true;
  blockIrreversibleActions: true;
  requireP18Visibility: true;
}

export interface WorkbenchVisibilityEvidence {
  remediationId: string;
  planId: string;
  approvalId: string;
  lifecycleTrace: WorkbenchLifecycleTrace;
}

export type ReadinessDisposition =
  | "blocked"
  | "manual_only"
  | "dry_run_allowed";

export interface ReadinessGateInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
  assessment: ExecutionReadinessAssessment;
  simulation: DryRunSimulation | null;
  policy: ExecutionReadinessPolicy;
  visibility: WorkbenchVisibilityEvidence;
  options?: { now?: string };
}

export interface ReadinessGateDecision {
  decisionId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string | null;
  policyId: string;
  disposition: ReadinessDisposition;
  reasonCodes: string[];
  futureControlledExecutionCandidate: boolean;
  controlledExecutionAuthorization: "not_available_in_p19";
  evaluatedAt: string;
}

export class ReadinessGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessGateError";
  }
}

function visibilityValid(
  evidence: WorkbenchVisibilityEvidence,
): boolean {
  const required = [
    ["proposal", evidence.remediationId],
    ["plan", evidence.planId],
    ["approval", evidence.approvalId],
  ] as const;
  return (
    evidence.lifecycleTrace.remediationId === evidence.remediationId &&
    required.every(([kind, id]) =>
      evidence.lifecycleTrace.hops.some(
        (hop) => hop.kind === kind && hop.id === id && !hop.gap,
      ),
    )
  );
}

export function evaluateReadinessGate(
  input: ReadinessGateInput,
): ReadinessGateDecision {
  const { plan, approval, assessment, simulation, policy, visibility } = input;
  if (
    approval.decision !== "approved" ||
    approval.planId !== plan.planId ||
    approval.remediationId !== plan.remediationId ||
    assessment.planId !== plan.planId ||
    assessment.remediationId !== plan.remediationId ||
    assessment.approvalId !== approval.approvalId
  ) {
    throw new ReadinessGateError("plan, approval, and assessment correlation mismatch");
  }
  if (
    simulation !== null &&
    (
      simulation.planId !== plan.planId ||
      simulation.approvalId !== approval.approvalId ||
      simulation.assessmentId !== assessment.assessmentId
    )
  ) {
    throw new ReadinessGateError("simulation correlation mismatch");
  }

  const reasons: string[] = [];
  let disposition: ReadinessDisposition;
  const visible = visibilityValid(visibility);
  if (!visible) {
    reasons.push("p18_visibility_missing");
    disposition = "blocked";
  } else if (assessment.readinessLevel === "external_side_effecting") {
    reasons.push("external_side_effect_blocked");
    disposition = "blocked";
  } else if (assessment.readinessLevel === "irreversible") {
    reasons.push("irreversible_action_blocked");
    disposition = "blocked";
  } else if (
    assessment.readinessLevel === "reversible" &&
    policy.requireCompleteRollbackForReversible &&
    !assessment.facts.rollbackCoverageComplete
  ) {
    reasons.push("rollback_coverage_incomplete");
    disposition = "blocked";
  } else if (
    policy.allowSemanticDryRunFor.includes(
      assessment.readinessLevel as "dry_run_capable" | "reversible",
    ) &&
    simulation?.status === "complete"
  ) {
    reasons.push("semantic_dry_run_allowed");
    disposition = "dry_run_allowed";
  } else {
    reasons.push("manual_handling_required");
    disposition = "manual_only";
  }

  const futureControlledExecutionCandidate =
    visible &&
    assessment.readinessLevel === "reversible" &&
    assessment.facts.rollbackCoverageComplete &&
    simulation?.status === "complete" &&
    policy.allowSemanticDryRunFor.includes("reversible");
  const evaluatedAt = input.options?.now ?? new Date().toISOString();
  const simulationId = simulation?.simulationId ?? null;
  reasons.sort();
  const decisionId = createHash("sha256")
    .update(
      [
        "p19.3",
        plan.planId,
        approval.approvalId,
        assessment.assessmentId,
        simulationId ?? "",
        policy.policyId,
        disposition,
        evaluatedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    decisionId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    assessmentId: assessment.assessmentId,
    simulationId,
    policyId: policy.policyId,
    disposition,
    reasonCodes: reasons,
    futureControlledExecutionCandidate,
    controlledExecutionAuthorization: "not_available_in_p19",
    evaluatedAt,
  };
}
```

- [ ] **Step 4: Add rollback, dry-run, manual-only, future-candidate, and immutability tests**

```typescript
it("allows dry run for complete supported simulation", () => {
  const p = plan([action("inspect")]);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  const decision = evaluateReadinessGate({
    plan: p,
    approval: a,
    assessment,
    simulation,
    policy: POLICY,
    visibility: visibility(p, a),
    options: { now: NOW },
  });
  assert.equal(decision.disposition, "dry_run_allowed");
  assert.equal(decision.futureControlledExecutionCandidate, false);
});

it("blocks reversible mutation with incomplete rollback", () => {
  const p = plan([action("config", {
    kind: "update_config",
    mutationRequired: true,
  })], { requiresRollbackPlan: true, rollbackPlan: null });
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  const decision = evaluateReadinessGate({
    plan: p,
    approval: a,
    assessment,
    simulation,
    policy: POLICY,
    visibility: visibility(p, a),
    options: { now: NOW },
  });
  assert.equal(decision.disposition, "blocked");
  assert.ok(decision.reasonCodes.includes("rollback_coverage_incomplete"));
});

it("returns manual only when simulation is partial", () => {
  const p = plan([action("manual", { kind: "manual_action" })]);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  const decision = evaluateReadinessGate({
    plan: p,
    approval: a,
    assessment,
    simulation,
    policy: POLICY,
    visibility: visibility(p, a),
    options: { now: NOW },
  });
  assert.equal(decision.disposition, "manual_only");
});

it("marks only fully qualified reversible plan as future candidate", () => {
  const p = plan(
    [action("config", { kind: "update_config", mutationRequired: true })],
    {
      requiresRollbackPlan: true,
      rollbackPlan: {
        rollbackId: "rb-1",
        summary: "Rollback",
        reversibleActions: ["config"],
        nonReversibleActions: [],
        operatorInstructions: ["Restore"],
        riskNotes: [],
      },
    },
  );
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  const before = JSON.stringify({ p, a, assessment, simulation, policy: POLICY });
  const decision = evaluateReadinessGate({
    plan: p,
    approval: a,
    assessment,
    simulation,
    policy: POLICY,
    visibility: visibility(p, a),
    options: { now: NOW },
  });
  assert.equal(decision.futureControlledExecutionCandidate, true);
  assert.equal(decision.controlledExecutionAuthorization, "not_available_in_p19");
  assert.equal(JSON.stringify({ p, a, assessment, simulation, policy: POLICY }), before);
});
```

- [ ] **Step 5: Build and run P19.1–P19.3 tests**

```bash
pnpm build
node --test \
  dist/tests/governance/execution-readiness.test.js \
  dist/tests/governance/dry-run-simulator.test.js \
  dist/tests/governance/readiness-policy-gate.test.js
```

Expected: all suites pass.

- [ ] **Step 6: Commit P19.3**

Stage, run GitNexus change detection, then:

```bash
git add src/governance/readiness-policy-gate.ts tests/governance/readiness-policy-gate.test.ts
git commit -m "feat(governance): evaluate readiness policy"
```

## Task 4: P19.4 Readiness Report

**Files:**

- Create: `src/governance/execution-readiness-report.ts`
- Create: `tests/governance/execution-readiness-report.test.ts`

- [ ] **Step 1: Write failing report tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExecutionReadinessReport } from "../../src/governance/execution-readiness-report.js";

const WINDOW_START = "2026-07-01T12:00:00.000Z";

it("empty input produces zero totals", () => {
  const report = buildExecutionReadinessReport({
    assessments: [],
    simulations: [],
    decisions: [],
    lifecycleTraces: [],
    options: { now: NOW, since: WINDOW_START, until: NOW },
  });
  assert.equal(report.items.length, 0);
  assert.deepEqual(report.totals, {
    blocked: 0,
    manualOnly: 0,
    dryRunAllowed: 0,
    notEvaluated: 0,
    externalSideEffecting: 0,
    irreversible: 0,
    reversible: 0,
    dryRunCapable: 0,
    missingP18Visibility: 0,
    futureCandidates: 0,
  });
});

it("joins correlated artifacts and counts disposition", () => {
  const { assessment, simulation, decision, lifecycleTrace } = makePipeline();
  const report = buildExecutionReadinessReport({
    assessments: [assessment],
    simulations: [simulation],
    decisions: [decision],
    lifecycleTraces: [lifecycleTrace],
    options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
  });
  assert.equal(report.items[0]!.assessmentId, assessment.assessmentId);
  assert.equal(report.items[0]!.simulationId, simulation.simulationId);
  assert.equal(report.items[0]!.decisionId, decision.decisionId);
  assert.equal(report.items[0]!.p18TracePresent, true);
  assert.equal(report.totals.dryRunAllowed, 1);
});

it("marks missing P18 trace as attention and never dry-run allowed", () => {
  const { assessment, simulation, decision } = makePipeline();
  const report = buildExecutionReadinessReport({
    assessments: [assessment],
    simulations: [simulation],
    decisions: [decision],
    lifecycleTraces: [],
    options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
  });
  assert.equal(report.items[0]!.p18TracePresent, false);
  assert.equal(report.items[0]!.requiresAttention, true);
  assert.equal(report.items[0]!.disposition, "blocked");
});
```

Define the pipeline helper above the report tests:

```typescript
import { classifyExecutionReadiness } from "../../src/governance/execution-readiness.js";
import { simulateExecutionPlan } from "../../src/governance/dry-run-simulator.js";
import {
  evaluateReadinessGate,
  type ExecutionReadinessPolicy,
} from "../../src/governance/readiness-policy-gate.js";
import type { WorkbenchLifecycleTrace } from "../../src/governance/governance-workbench.js";

const POLICY: ExecutionReadinessPolicy = {
  policyId: "policy-default",
  allowSemanticDryRunFor: ["dry_run_capable", "reversible"],
  requireCompleteRollbackForReversible: true,
  blockExternalSideEffects: true,
  blockIrreversibleActions: true,
  requireP18Visibility: true,
};

function makePipeline(
  options: { now?: string; suffix?: string } = {},
) {
  const now = options.now ?? NOW;
  const suffix = options.suffix ?? "1";
  const p = plan(
    [action(`action-${suffix}`)],
    {
      planId: `plan-${suffix}`,
      remediationId: `rem-${suffix}`,
      sourceProposalId: `rem-${suffix}`,
      createdAt: now,
    },
  );
  const a = approval(
    p,
    [`action-${suffix}`],
    {
      approvalId: `approval-${suffix}`,
      createdAt: now,
    },
  );
  const assessment = classifyExecutionReadiness(p, a, { now });
  const simulation = simulateExecutionPlan(p, a, assessment, { now });
  const lifecycleTrace: WorkbenchLifecycleTrace = {
    remediationId: p.remediationId,
    hops: [
      {
        kind: "proposal",
        id: p.remediationId,
        status: "accepted",
        summary: "Proposal",
        timestamp: now,
        gap: false,
      },
      {
        kind: "plan",
        id: p.planId,
        status: "plan_created",
        summary: "Plan",
        timestamp: now,
        gap: false,
      },
      {
        kind: "approval",
        id: a.approvalId,
        status: "approved",
        summary: "Approval",
        timestamp: now,
        gap: false,
      },
    ],
  };
  const decision = evaluateReadinessGate({
    plan: p,
    approval: a,
    assessment,
    simulation,
    policy: POLICY,
    visibility: {
      remediationId: p.remediationId,
      planId: p.planId,
      approvalId: a.approvalId,
      lifecycleTrace,
    },
    options: { now },
  });
  return { assessment, simulation, decision, lifecycleTrace };
}
```

- [ ] **Step 2: Build to verify RED**

Run `pnpm build`.

Expected: missing `execution-readiness-report.js` module error.

- [ ] **Step 3: Implement report types, joins, filtering, sorting, and totals**

```typescript
import type { WorkbenchLifecycleTrace } from "./governance-workbench.js";
import type {
  ExecutionReadinessAssessment,
  ExecutionReadinessLevel,
} from "./execution-readiness.js";
import type { DryRunSimulation } from "./dry-run-simulator.js";
import type {
  ReadinessDisposition,
  ReadinessGateDecision,
} from "./readiness-policy-gate.js";

export interface ExecutionReadinessReportInput {
  assessments: ExecutionReadinessAssessment[];
  simulations: DryRunSimulation[];
  decisions: ReadinessGateDecision[];
  lifecycleTraces: WorkbenchLifecycleTrace[];
  options?: { since?: string; until?: string; now?: string };
}

export interface ExecutionReadinessReportItem {
  remediationId: string;
  planId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string | null;
  decisionId: string | null;
  readinessLevel: ExecutionReadinessLevel;
  disposition: ReadinessDisposition | "not_evaluated";
  simulationStatus: DryRunSimulation["status"] | "not_simulated";
  p18TracePresent: boolean;
  futureControlledExecutionCandidate: boolean;
  controlledExecutionAuthorization: "not_available_in_p19";
  requiresAttention: boolean;
  reasonCodes: string[];
  updatedAt: string;
}

export interface ExecutionReadinessReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totals: {
    blocked: number;
    manualOnly: number;
    dryRunAllowed: number;
    notEvaluated: number;
    externalSideEffecting: number;
    irreversible: number;
    reversible: number;
    dryRunCapable: number;
    missingP18Visibility: number;
    futureCandidates: number;
  };
  items: ExecutionReadinessReportItem[];
}

export class ReadinessReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessReportError";
  }
}

function parseIso(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ReadinessReportError(`invalid ISO timestamp "${value}"`);
  }
  return parsed;
}

function traceMatches(
  trace: WorkbenchLifecycleTrace | undefined,
  item: ExecutionReadinessAssessment,
): boolean {
  if (!trace || trace.remediationId !== item.remediationId) return false;
  return trace.hops.some(
    (hop) => hop.kind === "plan" && hop.id === item.planId && !hop.gap,
  ) && trace.hops.some(
    (hop) => hop.kind === "approval" && hop.id === item.approvalId && !hop.gap,
  );
}

const DISPOSITION_ORDER: Record<
  ExecutionReadinessReportItem["disposition"],
  number
> = {
  blocked: 0,
  manual_only: 1,
  dry_run_allowed: 2,
  not_evaluated: 3,
};

export function buildExecutionReadinessReport(
  input: ExecutionReadinessReportInput,
): ExecutionReadinessReport {
  const generatedAt = input.options?.now ?? new Date().toISOString();
  const windowEnd = input.options?.until ?? generatedAt;
  const windowStart = input.options?.since ??
    new Date(parseIso(windowEnd) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const start = parseIso(windowStart);
  const end = parseIso(windowEnd);
  if (start >= end) throw new ReadinessReportError("since must be before until");

  const simulations = new Map(
    input.simulations.map((item) => [item.assessmentId, item]),
  );
  const decisions = new Map(
    input.decisions.map((item) => [item.assessmentId, item]),
  );
  const traces = new Map(
    input.lifecycleTraces.map((item) => [item.remediationId, item]),
  );

  const items = input.assessments
    .filter((item) => {
      const timestamp = parseIso(item.assessedAt);
      return timestamp >= start && timestamp < end;
    })
    .map((assessment): ExecutionReadinessReportItem => {
      const simulation = simulations.get(assessment.assessmentId) ?? null;
      const decision = decisions.get(assessment.assessmentId) ?? null;
      const p18TracePresent = traceMatches(
        traces.get(assessment.remediationId),
        assessment,
      );
      const disposition = !p18TracePresent
        ? "blocked"
        : decision?.disposition ?? "not_evaluated";
      const reasonCodes = [
        ...(decision?.reasonCodes ?? []),
        ...(!p18TracePresent ? ["p18_visibility_missing"] : []),
      ].filter((value, index, all) => all.indexOf(value) === index).sort();
      const updatedAt =
        decision?.evaluatedAt ?? simulation?.simulatedAt ?? assessment.assessedAt;
      return {
        remediationId: assessment.remediationId,
        planId: assessment.planId,
        approvalId: assessment.approvalId,
        assessmentId: assessment.assessmentId,
        simulationId: simulation?.simulationId ?? null,
        decisionId: decision?.decisionId ?? null,
        readinessLevel: assessment.readinessLevel,
        disposition,
        simulationStatus: simulation?.status ?? "not_simulated",
        p18TracePresent,
        futureControlledExecutionCandidate:
          p18TracePresent && (decision?.futureControlledExecutionCandidate ?? false),
        controlledExecutionAuthorization: "not_available_in_p19",
        requiresAttention:
          !p18TracePresent ||
          disposition === "blocked" ||
          disposition === "not_evaluated",
        reasonCodes,
        updatedAt,
      };
    })
    .sort((left, right) =>
      Number(right.requiresAttention) - Number(left.requiresAttention) ||
      DISPOSITION_ORDER[left.disposition] - DISPOSITION_ORDER[right.disposition] ||
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.remediationId.localeCompare(right.remediationId) ||
      left.planId.localeCompare(right.planId),
    );

  const countDisposition = (value: ExecutionReadinessReportItem["disposition"]) =>
    items.filter((item) => item.disposition === value).length;
  const countLevel = (value: ExecutionReadinessLevel) =>
    items.filter((item) => item.readinessLevel === value).length;

  return {
    generatedAt,
    windowStart,
    windowEnd,
    totals: {
      blocked: countDisposition("blocked"),
      manualOnly: countDisposition("manual_only"),
      dryRunAllowed: countDisposition("dry_run_allowed"),
      notEvaluated: countDisposition("not_evaluated"),
      externalSideEffecting: countLevel("external_side_effecting"),
      irreversible: countLevel("irreversible"),
      reversible: countLevel("reversible"),
      dryRunCapable: countLevel("dry_run_capable"),
      missingP18Visibility: items.filter((item) => !item.p18TracePresent).length,
      futureCandidates: items.filter(
        (item) => item.futureControlledExecutionCandidate,
      ).length,
    },
    items,
  };
}
```

- [ ] **Step 4: Add time-window, sorting, missing-artifact, and operator-neutral tests**

```typescript
it("uses half-open [since, until) filtering", () => {
  const first = makePipeline({ now: WINDOW_START });
  const end = makePipeline({ now: NOW, suffix: "end" });
  const report = buildExecutionReadinessReport({
    assessments: [first.assessment, end.assessment],
    simulations: [first.simulation, end.simulation],
    decisions: [first.decision, end.decision],
    lifecycleTraces: [first.lifecycleTrace, end.lifecycleTrace],
    options: { now: NOW, since: WINDOW_START, until: NOW },
  });
  assert.deepEqual(
    report.items.map((item) => item.assessmentId),
    [first.assessment.assessmentId],
  );
});

it("marks absent simulation and decision explicitly", () => {
  const { assessment, lifecycleTrace } = makePipeline();
  const report = buildExecutionReadinessReport({
    assessments: [assessment],
    simulations: [],
    decisions: [],
    lifecycleTraces: [lifecycleTrace],
    options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
  });
  assert.equal(report.items[0]!.simulationStatus, "not_simulated");
  assert.equal(report.items[0]!.disposition, "not_evaluated");
});

it("contains no operator identity or ranking fields", () => {
  const pipeline = makePipeline();
  const report = buildExecutionReadinessReport({
    assessments: [pipeline.assessment],
    simulations: [pipeline.simulation],
    decisions: [pipeline.decision],
    lifecycleTraces: [pipeline.lifecycleTrace],
    options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
  });
  const json = JSON.stringify(report);
  assert.equal(json.includes("operatorId"), false);
  assert.equal(json.includes("ranking"), false);
  assert.equal(json.includes("leaderboard"), false);
});
```

- [ ] **Step 5: Build and run P19.1–P19.4 domain tests**

```bash
pnpm build
node --test \
  dist/tests/governance/execution-readiness.test.js \
  dist/tests/governance/dry-run-simulator.test.js \
  dist/tests/governance/readiness-policy-gate.test.js \
  dist/tests/governance/execution-readiness-report.test.js
```

Expected: all suites pass.

- [ ] **Step 6: Commit report**

Stage, run GitNexus change detection, then:

```bash
git add \
  src/governance/execution-readiness-report.ts \
  tests/governance/execution-readiness-report.test.ts
git commit -m "feat(governance): report execution readiness"
```

## Task 5: P19.4 Read-Only CLI

**Files:**

- Modify: `src/cli/commands/governance.ts`
- Create: `tests/cli/governance-readiness-cli.test.ts`
- Verify: `tests/cli/commands/governance-integration.vitest.ts`
- Verify: `tests/cli/commands/governance-cli.vitest.ts`
- Verify: `tests/cli/commands/governance-cli-smoke.vitest.ts`

- [ ] **Step 1: Run required GitNexus impact analysis before editing CLI symbols**

Run:

```text
gitnexus_impact({
  target: "handleGovernanceCommand",
  file_path: "src/cli/commands/governance.ts",
  direction: "upstream",
  includeTests: true
})
```

Known planning result: LOW risk; 3 direct test callers; 0 affected execution flows. If implementation-time result is HIGH or CRITICAL, stop and warn before editing.

- [ ] **Step 2: Write failing CLI dispatch and input-validation tests**

Test `handleGovernanceCommand` through the existing Vitest CLI harness or a child process using built `dist/src/cli.js`. The fixture file must contain `P19ReadinessInputBundle` with one accepted remediation, plan, approval, signal/investigation arrays as needed by `buildLifecycleTrace`, empty attempts, and immutable policy.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(args: string[]) {
  return spawnSync(
    process.execPath,
    ["dist/src/cli.js", "governance", "readiness", ...args],
    { encoding: "utf8" },
  );
}

it("requires --input", () => {
  const result = run(["classify", "plan-1", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--input is required/);
});

it("classify emits JSON assessment", () => {
  const dir = mkdtempSync(join(tmpdir(), "alix-p19-"));
  const input = join(dir, "bundle.json");
  writeFileSync(input, JSON.stringify(makeBundle()), "utf8");
  const result = run(["classify", "plan-1", "--input", input, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.planId, "plan-1");
  assert.equal(parsed.readinessLevel, "dry_run_capable");
});

for (const subcommand of ["simulate", "evaluate", "report"]) {
  it(`${subcommand} emits JSON without execution authorization`, () => {
    const dir = mkdtempSync(join(tmpdir(), "alix-p19-"));
    const input = join(dir, "bundle.json");
    writeFileSync(input, JSON.stringify(makeBundle()), "utf8");
    const args = subcommand === "report"
      ? [subcommand, "--input", input, "--json"]
      : [subcommand, "plan-1", "--input", input, "--json"];
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("authorized_for_execution"), false);
  });
}
```

Define the exact bundle fixture above the CLI tests:

```typescript
function makeBundle() {
  const proposedAction = {
    actionId: "action-1",
    kind: "investigate_anomaly" as const,
    description: "Investigate anomaly",
    target: { type: "anomaly", id: "signal-1" },
    expectedEffect: "Evidence documented",
    mutationRequired: false,
    externalSideEffect: false,
    approvalRequired: true as const,
    reversible: true,
    rollbackHint: null,
  };
  return {
    workbench: {
      signals: [{
        signalId: "signal-1",
        sourcePhase: "p15",
        signalType: "trend_alert",
        severity: "high",
        confidence: 0.9,
        title: "Governance anomaly",
        description: "Unexpected governance trend",
        evidenceRefs: [],
        recommendation: "Investigate",
        metadata: {},
        status: "new",
        requestedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
      investigations: [{
        id: "investigation-1",
        kind: "chain_restoration",
        status: "open",
        severity: "high",
        source: "drift",
        sourceArtifactId: "signal-1",
        evidenceRefs: [],
        title: "Investigate governance anomaly",
        description: "Trace anomaly source",
        operatorGuidance: "Review evidence",
        createdAt: NOW,
      }],
      remediations: [{
        proposalId: "rem-1",
        sourceRecommendationIds: ["investigation-1"],
        title: "Investigate anomaly",
        severity: "warning",
        windowStart: "2026-07-01T00:00:00.000Z",
        windowEnd: NOW,
        evidenceRefs: [],
        status: "accepted",
        createdAt: NOW,
        responseKind: "investigate_anomaly",
        proposedAction: "Review evidence",
        reversible: true,
      }],
      executionPlans: [{
        planId: "plan-1",
        remediationId: "rem-1",
        sourceProposalId: "rem-1",
        status: "draft",
        title: "Plan",
        summary: "Investigate",
        proposedActions: [proposedAction],
        riskLevel: "low",
        requiresRollbackPlan: false,
        rollbackPlan: null,
        createdAt: NOW,
        createdBy: "system",
        approvedAt: null,
        approvedBy: null,
        executionAttemptIds: [],
        auditRefs: [],
      }],
      approvals: [{
        approvalId: "approval-1",
        planId: "plan-1",
        remediationId: "rem-1",
        decision: "approved",
        rationale: "Reviewed",
        operatorId: "operator-1",
        createdAt: NOW,
        approvedActionIds: ["action-1"],
        auditRefs: [],
      }],
      attempts: [],
      options: { now: NOW },
    },
    policy: {
      policyId: "policy-default",
      allowSemanticDryRunFor: ["dry_run_capable", "reversible"],
      requireCompleteRollbackForReversible: true,
      blockExternalSideEffects: true,
      blockIrreversibleActions: true,
      requireP18Visibility: true,
    },
  };
}
```

- [ ] **Step 3: Build to verify RED**

```bash
pnpm build
node --test dist/tests/cli/governance-readiness-cli.test.js
```

Expected: commands fail because `readiness` is not dispatched.

- [ ] **Step 4: Add delimited P19 CLI section and dispatcher**

Add to `handleGovernanceCommand`:

```typescript
    case "readiness":
      return runReadiness(rest);
```

Add a visibly delimited section near P17/P18 handlers:

```typescript
// P19-READINESS-START
// P19 readiness source sentinels scan only this delimited section.

interface P19ReadinessInputBundle {
  workbench: import("../../governance/governance-workbench.js").GovernanceWorkbenchInput;
  policy: import("../../governance/readiness-policy-gate.js").ExecutionReadinessPolicy;
}

function requiredFlag(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function readReadinessBundle(path: string): Promise<P19ReadinessInputBundle> {
  const { readFile } = await import("node:fs/promises");
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("readiness input must be a JSON object");
  }
  const candidate = parsed as Partial<P19ReadinessInputBundle>;
  if (!candidate.workbench || !candidate.policy) {
    throw new Error("readiness input requires workbench and policy");
  }
  return candidate as P19ReadinessInputBundle;
}

function readinessPlan(
  bundle: P19ReadinessInputBundle,
  planId: string,
) {
  const plan = bundle.workbench.executionPlans.find((item) => item.planId === planId);
  if (!plan) throw new Error(`execution plan "${planId}" not found`);
  const approvals = bundle.workbench.approvals
    .filter((item) => item.planId === planId && item.decision === "approved")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const approval = approvals[0];
  if (!approval) throw new Error(`approved P17 approval for plan "${planId}" not found`);
  return { plan, approval };
}

async function readinessTrace(
  bundle: P19ReadinessInputBundle,
  planId: string,
) {
  const { buildLifecycleTrace } = await import(
    "../../governance/governance-workbench.js"
  );
  const { plan } = readinessPlan(bundle, planId);
  const plans = new Map(bundle.workbench.executionPlans.map(
    (item) => [item.remediationId, item],
  ));
  const approvals = new Map(bundle.workbench.approvals.map(
    (item) => [item.planId, item],
  ));
  const attempts = new Map(bundle.workbench.attempts.map(
    (item) => [item.planId, item],
  ));
  const signals = new Map((bundle.workbench.signals ?? []).map(
    (item) => [item.signalId, item],
  ));
  const investigations = new Map((bundle.workbench.investigations ?? []).map(
    (item) => [item.id, item],
  ));
  return buildLifecycleTrace(
    plan.remediationId,
    bundle.workbench.remediations,
    plans,
    approvals,
    attempts,
    signals,
    investigations,
    new Map(),
  );
}

async function computeReadiness(bundle: P19ReadinessInputBundle, planId: string) {
  const { classifyExecutionReadiness } = await import(
    "../../governance/execution-readiness.js"
  );
  const { simulateExecutionPlan } = await import(
    "../../governance/dry-run-simulator.js"
  );
  const { evaluateReadinessGate } = await import(
    "../../governance/readiness-policy-gate.js"
  );
  const { plan, approval } = readinessPlan(bundle, planId);
  const now = new Date().toISOString();
  const assessment = classifyExecutionReadiness(plan, approval, { now });
  const simulation = simulateExecutionPlan(plan, approval, assessment, { now });
  const lifecycleTrace = await readinessTrace(bundle, planId);
  const decision = evaluateReadinessGate({
    plan,
    approval,
    assessment,
    simulation,
    policy: bundle.policy,
    visibility: {
      remediationId: plan.remediationId,
      planId: plan.planId,
      approvalId: approval.approvalId,
      lifecycleTrace,
    },
    options: { now },
  });
  return { assessment, simulation, decision, lifecycleTrace };
}

async function runReadiness(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");
  try {
    const inputPath = requiredFlag(args, "--input");
    const bundle = await readReadinessBundle(inputPath);
    if (subcommand === "report") {
      const { buildExecutionReadinessReport } = await import(
        "../../governance/execution-readiness-report.js"
      );
      const results = [];
      for (const plan of bundle.workbench.executionPlans) {
        if (bundle.workbench.approvals.some(
          (item) => item.planId === plan.planId && item.decision === "approved",
        )) {
          results.push(await computeReadiness(bundle, plan.planId));
        }
      }
      const report = buildExecutionReadinessReport({
        assessments: results.map((item) => item.assessment),
        simulations: results.map((item) => item.simulation),
        decisions: results.map((item) => item.decision),
        lifecycleTraces: results.map((item) => item.lifecycleTrace),
        options: {
          since: parseInlineFlag(args, "--since") ?? undefined,
          until: parseInlineFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      });
      console.log(jsonMode ? JSON.stringify(report, null, 2) : renderReadinessReport(report));
      return;
    }
    if (!["classify", "simulate", "evaluate"].includes(subcommand)) {
      throw new Error("usage: readiness {classify|simulate|evaluate|report}");
    }
    const planId = args[1];
    if (!planId || planId.startsWith("--")) throw new Error("plan ID is required");
    const result = await computeReadiness(bundle, planId);
    const value = subcommand === "classify"
      ? result.assessment
      : subcommand === "simulate"
        ? result.simulation
        : result.decision;
    console.log(jsonMode ? JSON.stringify(value, null, 2) : renderReadinessValue(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonMode) console.error(JSON.stringify({ code: "P19_READINESS_ERROR", message }));
    else console.error(`Readiness error: ${message}`);
    process.exitCode = 1;
  }
}

function renderReadinessValue(value: object): string {
  return JSON.stringify(value, null, 2);
}

function renderReadinessReport(
  report: import("../../governance/execution-readiness-report.js").ExecutionReadinessReport,
): string {
  return [
    "Governance Execution Readiness",
    `Blocked: ${report.totals.blocked}`,
    `Manual only: ${report.totals.manualOnly}`,
    `Dry-run allowed: ${report.totals.dryRunAllowed}`,
    `Missing P18 visibility: ${report.totals.missingP18Visibility}`,
  ].join("\n");
}

// P19-READINESS-END
```

- [ ] **Step 5: Add scoped sentinel tests**

Read only four P19 source files and the delimited CLI section:

```typescript
it("P19 source has no execution, mutation, write, audit, or policy-write imports", () => {
  const files = [
    "src/governance/execution-readiness.ts",
    "src/governance/dry-run-simulator.ts",
    "src/governance/readiness-policy-gate.ts",
    "src/governance/execution-readiness-report.ts",
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const forbidden = [
    /from ["'][^"']*(tool-executor|shell-pool|runtime-executor|execution-adapter)[^"']*["']/,
    /from ["'][^"']*(audit-emitter)[^"']*["']/,
    /\b(executeAction|applyPolicy|transitionRemediation)\s*\(/,
    /\.(append|write|save|delete)\s*\(/,
    /\b(fetch|spawn|execFile|exec)\s*\(/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern);
  }
});

it("scans only delimited P19 CLI section", () => {
  const source = readFileSync("src/cli/commands/governance.ts", "utf8");
  const start = source.indexOf("// P19-READINESS-START");
  const end = source.indexOf("// P19-READINESS-END");
  assert.ok(start >= 0 && end > start);
  const p19 = source.slice(start, end);
  assert.doesNotMatch(p19, /\.(append|write|save|delete)\s*\(/);
  assert.doesNotMatch(p19, /\b(executeAction|applyPolicy|transitionRemediation)\s*\(/);
  assert.doesNotMatch(p19, /(audit-emitter|tool-executor|shell-pool|runtime-executor)/);
  assert.doesNotMatch(p19, /\b(operatorRank|leaderboard|performanceScore)\b/);
});
```

Do not forbid generic `.apply(`. Do not scan unrelated CLI code.

- [ ] **Step 6: Build and run CLI plus direct callers**

```bash
pnpm build
node --test dist/tests/cli/governance-readiness-cli.test.js
pnpm vitest run \
  tests/cli/commands/governance-integration.vitest.ts \
  tests/cli/commands/governance-cli.vitest.ts \
  tests/cli/commands/governance-cli-smoke.vitest.ts
```

Expected: P19 CLI suite and all 3 existing direct-caller suites pass.

- [ ] **Step 7: Commit CLI**

Stage both files, run GitNexus change detection, verify only governance CLI dispatch and new tests are affected, then:

```bash
git add src/cli/commands/governance.ts tests/cli/governance-readiness-cli.test.ts
git commit -m "feat(cli): expose governance readiness views"
```

## Task 6: DOX Contract and Full Verification

**Files:**

- Create: `src/governance/AGENTS.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Create governance child DOX**

```markdown
# Governance Subsystem

## Purpose

Build deterministic governance analysis, remediation, approval, execution-recording, workbench, and readiness projections.

## Ownership

- `execution-plans.ts`, `execution-approval.ts`, `execution-recorder.ts`, `execution-report.ts` own P17 lifecycle contracts.
- `governance-workbench.ts` owns P18 read-only operator visibility.
- `execution-readiness.ts`, `dry-run-simulator.ts`, `readiness-policy-gate.ts`, `execution-readiness-report.ts` own P19 derived readiness analysis.

## Local Contracts

- P17 approval is required before P19 analysis.
- P18 lifecycle correlation is required before P19 gate eligibility.
- Readiness is a projection, never persisted lifecycle state.
- Dry run is semantic description, never execution.
- No direct audit emitter imports; audited stores own audit emission.
- No operator ranking or punitive inference.

## Work Guidance

- Run GitNexus impact analysis before editing existing symbols.
- Keep pure domain functions separate from CLI loading and rendering.
- Fail closed on unknown action kinds or correlation gaps.
- Scope P19 sentinels to P19 files and delimited CLI section.

## Verification

- `pnpm build`
- `node --test dist/tests/governance/*.test.js`
- `node --test dist/tests/cli/governance-readiness-cli.test.js`

## Child DOX Index

No child contracts.
```

- [ ] **Step 2: Add governance child entry to root index**

Add:

```markdown
| `src/governance/AGENTS.md` | Governance analysis, remediation, lifecycle, workbench, readiness |
```

- [ ] **Step 3: Run full verification**

```bash
pnpm build
node --test dist/tests/governance/*.test.js
node --test dist/tests/cli/governance-readiness-cli.test.js
pnpm vitest run \
  tests/cli/commands/governance-integration.vitest.ts \
  tests/cli/commands/governance-cli.vitest.ts \
  tests/cli/commands/governance-cli-smoke.vitest.ts
pnpm typecheck
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Re-run P19 sentinels explicitly**

```bash
node --test \
  --test-name-pattern="P19 source|delimited P19 CLI" \
  dist/tests/cli/governance-readiness-cli.test.js
```

Expected: scoped sentinel tests pass. Confirm no `src/governance/*readiness*store.ts` or equivalent file exists:

```bash
find src/governance -maxdepth 1 -type f -iname '*readiness*store*'
```

Expected: no output.

- [ ] **Step 5: Commit DOX**

Stage `AGENTS.md` files, run GitNexus change detection, then:

```bash
git add AGENTS.md src/governance/AGENTS.md
git commit -m "docs: define governance subsystem contract"
```

## Task 7: P19.5 Report, Checkpoint, and Seal

**Files:**

- Create: `docs/architecture/reports/p19-governance-automation-readiness-report.md`
- Create: `docs/architecture/checkpoints/2026-07-08-p19-governance-automation-readiness-complete.md`

- [ ] **Step 1: Capture final evidence**

Run:

```bash
pnpm build
node --test dist/tests/governance/*.test.js
node --test dist/tests/cli/governance-readiness-cli.test.js
pnpm typecheck
git status --short
```

Record exact pass counts and commit hashes. Do not copy projected counts from this plan.

- [ ] **Step 2: Write phase report**

Report sections:

```markdown
# P19 — Governance Automation Readiness & Policy-Controlled Execution

## Phase Summary
## Delivered Slices
## Derived Readiness Pipeline
## Readiness Level Precedence
## Semantic Dry-Run Boundary
## Policy Gate and P18 Visibility
## Readiness Report and CLI
## No-Persistence and No-Execution Evidence
## Sentinel Coverage
## Test Evidence
## Deferred Capabilities
## Final Seal
```

State explicitly:

- no execution capability shipped;
- no readiness store exists;
- no policy mutation exists;
- P17 approval and P18 visibility remain mandatory;
- future candidacy is informational;
- controlled execution authorization remains unavailable.

- [ ] **Step 3: Write checkpoint**

Checkpoint must include:

```markdown
# P19 Governance Automation Readiness Complete

**Status:** Sealed
**Tag:** `alix-p19-governance-automation-readiness-complete`

## Proof

- P19.1 classifier complete
- P19.2 semantic simulator complete
- P19.3 policy gate complete
- P19.4 report and CLI complete
- P19.5 verification complete
- TypeScript clean
- Governance tests green
- CLI readiness tests green
- Scoped sentinels green
- No readiness store
- No execution imports
- No policy writes
- No P17 approval bypass
- No P18 visibility bypass
- No operator ranking
```

Replace “green” with exact counts after verification.

- [ ] **Step 4: Check documentation**

```bash
rg -n 'TBD|TODO|PLACEHOLDER|green$' \
  docs/architecture/reports/p19-governance-automation-readiness-report.md \
  docs/architecture/checkpoints/2026-07-08-p19-governance-automation-readiness-complete.md
git diff --check
```

Expected: no placeholder output; diff check passes.

- [ ] **Step 5: Commit checkpoint docs**

Stage docs, run GitNexus change detection, then:

```bash
git add \
  docs/architecture/reports/p19-governance-automation-readiness-report.md \
  docs/architecture/checkpoints/2026-07-08-p19-governance-automation-readiness-complete.md
git commit -m "docs: seal P19 automation readiness"
```

- [ ] **Step 6: Final feature-branch change detection and PR handoff**

Run:

```text
gitnexus_detect_changes(scope="compare", base_ref="alix-p18-governance-workbench-complete")
```

Review all affected symbols and flows. If scope matches P19, push the feature branch and open the PR through the normal repository workflow. Do not create or push the P19 tag from the feature branch.

- [ ] **Step 7: Tag verified main after PR merge**

After the PR is merged, switch to `main`, update it to the merged commit, confirm the worktree is clean, and rerun final verification:

```bash
git switch main
git pull --ff-only origin main
pnpm build
node --test dist/tests/governance/*.test.js
node --test dist/tests/cli/governance-readiness-cli.test.js
pnpm typecheck
git status --short
git tag -a alix-p19-governance-automation-readiness-complete \
  -m "P19 governance automation readiness complete"
git push origin alix-p19-governance-automation-readiness-complete
```

Expected before tagging: all verification commands pass, `git status --short` has no output, and `HEAD` is the merged `origin/main`.

## Final Acceptance Checklist

- [ ] P19.1 applies approved-action-only readiness precedence.
- [ ] All IDs use `array.join("|")` before SHA-256.
- [ ] P19.2 performs semantic projection only.
- [ ] P19.3 fails closed without P17 approval and P18 visibility.
- [ ] P19.3 never returns machine execution authorization.
- [ ] P19.4 reports all required totals and correlations.
- [ ] CLI requires explicit `--input` and explicit `simulate` command.
- [ ] No P19 persistence or readiness store exists.
- [ ] Sentinels scan only P19 source and delimited CLI section.
- [ ] Generic JavaScript `.apply(` is not forbidden.
- [ ] No operator ranking fields or terms exist in P19 output.
- [ ] Governance DOX chain documents P19 boundaries.
- [ ] GitNexus change detection confirms expected scope.
- [ ] Build, typecheck, governance tests, CLI tests, and direct CLI callers pass.
- [ ] Phase report, checkpoint, commit, and tag exist.
