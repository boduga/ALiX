# P10.4c — Executive Apply Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a read-only reconciler that observes the proposal lifecycle and marks `apply_remediation` executive steps as `completed` when their linked `AdaptationProposal` reaches `"applied"` status.

**Architecture:** Pure `reconcileApplyStep()` function finds the sibling `create_remediation_proposal` step by `objectiveId`, then matches proposals by `target.kind === "executive_remediation"` + `planId` + `stepId`. The effectful engine dispatch fires in `ExecutionEngine.executeStepInternal()` after the P10.4b bridge block, guarded by `step.action === "apply_remediation" && this.proposalStore`. Evidence recorded via `EvidenceEventWriter.recordExecutiveStepAppliedRemediation`.

**Tech Stack:** TypeScript, Vitest, existing EvidenceEventWriter pattern, existing ProposalStore pattern.

## Global Constraints

- `reconcileApplyStep` is PURE — no side effects, no I/O, no imports from mutation modules
- Sibling matching: `plan.steps.find(s => s.action === "create_remediation_proposal" && s.objectiveId === step.objectiveId)`
- Proposal matching narrowed with `p.target?.kind !== "executive_remediation"` — no `as any`
- Step status overridden to `"completed"` only when match found AND `status === "applied"`
- Otherwise stays `"waiting_for_bridge"` (StepRunner's default, no override)
- Do NOT clear prior warnings — append reconciler note instead
- Evidence event is `"executive_step_applied_remediation"` via `recordExecutiveStepAppliedRemediation`
- `proposalStore` guard ensures no-op when store is not wired
- Engine dispatch fires after P10.4b bridge block (line ~213), before terminal state write (line ~215)
- `implement_improvements` deferred — stays `waiting_for_bridge`
- No changes to: `adaptation-types.ts`, `executive-bridge.ts`, `step-behavior.ts`, `step-runner.ts`, `cli/commands/executive.ts`

---

## Branch setup (before any task)

Create the feature branch first. All subsequent tasks commit onto this branch.

```bash
git checkout main
git pull --ff-only
git checkout -b feature/p10-4c-executive-apply-reconciler
```

**Fixture alignment note for implementers:** Before coding any test fixture, read the actual current type definitions from:
- `src/executive/executive-plan-types.ts` — `PersistedExecutionPlan`, `PlanExecutionState`, `StepRuntimeStatus`, `GeneratedArtifactRef`, `StepRuntimeState`
- `src/executive/planning-engine.ts` — `ExecutionStep`
- `src/adaptation/adaptation-types.ts` — `AdaptationProposal`, `ProposalTarget`

Align all test fixture shapes exactly to these source-of-truth types (not the guessed shapes in the plan below). The plan's fixture code is illustrative — the real types govern.

---

### Task 1: Evidence infrastructure — add evidence type + writer method

**Files:**
- Modify: `src/security/evidence/evidence-types.ts` — add `"executive_step_applied_remediation"` to `EvidenceType` union and `EVIDENCE_TYPES` set
- Modify: `src/workflow/evidence-writer.ts` — add payload type interface + `recordExecutiveStepAppliedRemediation` method

**Interfaces:**
- Consumes: existing `EvidenceType` union, existing `EvidenceEventWriter` class pattern
- Produces: `"executive_step_applied_remediation"` evidence type usable in evidence records; `EvidenceEventWriter.recordExecutiveStepAppliedRemediation(payload)` ready for engine dispatch

- [ ] **Step 1: Add evidence type to evidence-types.ts**

Add `"executive_step_applied_remediation"` to both the `EvidenceType` union type and the `EVIDENCE_TYPES` set, after the P10.4b block:

```typescript
  // P10.4b executive proposal bridge events
  | "executive_step_bridged_to_proposal"
  | "executive_step_bridge_failed"
  // P10.4c executive apply reconciler event
  | "executive_step_applied_remediation";
```

And in `EVIDENCE_TYPES`:
```typescript
  // P10.4b executive proposal bridge events
  "executive_step_bridged_to_proposal",
  "executive_step_bridge_failed",
  // P10.4c executive apply reconciler event
  "executive_step_applied_remediation",
]);
```

- [ ] **Step 2: Add payload type interface to evidence-writer.ts**

Add a payload type interface in the executive execution events section (around line ~668, after the `recordExecutiveStepBridgeFailed` method):

```typescript
export interface ExecutiveStepAppliedRemediationPayload {
  planId: string;
  stepId: string;
  proposalId: string;
}
```

- [ ] **Step 3: Add recordExecutiveStepAppliedRemediation method to EvidenceEventWriter**

Insert after the `recordExecutiveStepBridgeFailed` method (line ~684):

```typescript
  async recordExecutiveStepAppliedRemediation(payload: {
    planId: string;
    stepId: string;
    proposalId: string;
  }): Promise<EvidenceRecord | null> {
    return this.appendEvent("executive_step_applied_remediation", { ...payload });
  }
```

- [ ] **Step 4: Run focused test to verify it compiles and doesn't break existing tests**

Run: `npx vitest run src/security/evidence/ tests/workflow/evidence-writer.vitest.ts --reporter=verbose 2>&1 | head -40`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/security/evidence/evidence-types.ts src/workflow/evidence-writer.ts
git commit -m "feat(p10-4c): add executive_step_applied_remediation evidence type + writer method"
```

---

### Task 2: Pure reconciler function + 7 unit tests

**Files:**
- Create: `src/executive/executive-apply-reconciler.ts`
- Create: `tests/executive/executive-apply-reconciler.vitest.ts`

**Interfaces:**
- Consumes: `PersistedExecutionPlan` from `./executive-plan-types.js`, `ExecutionStep` from `./planning-engine.js`, `AdaptationProposal` from `../adaptation/adaptation-types.js`
- Produces: `ApplyReconciliationResult` with `stepCompleted: boolean`, `matchedProposalId?: string`, `matchedCreateStepId?: string`
- Produces: `reconcileApplyStep(plan, step, proposals) => ApplyReconciliationResult` — pure function

- [ ] **Step 1: Write the failing tests**

Create `tests/executive/executive-apply-reconciler.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { reconcileApplyStep } from "../../src/executive/executive-apply-reconciler.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-1",
    stepNumber: 1,
    title: "Test step",
    action: "create_remediation_proposal",
    objectiveId: "obj-1",
    targetSubsystem: "adaptation",
    riskLevel: "medium",
    objectiveScore: 0,
    priorityScore: 0,
    status: "pending",
    dependsOn: [],
    ...overrides,
  };
}

function makePlan(steps: ExecutionStep[]): PersistedExecutionPlan {
  return {
    id: "plan-1",
    steps,
    objectives: ["obj-1"],
    generatedAt: "2026-06-25T00:00:00.000Z",
    healthSnapshotAt: "2026-06-25T00:00:00.000Z",
    objectiveReports: [],
    windowDays: 7,
    planStatus: "ready",
    contentHash: "test-hash",
  };
}

function makeProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "proposal-1",
    status: "pending",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "create-step-1",
      objectiveId: "obj-1",
      subsystem: "adaptation",
    },
    provenance: "manual",
    reason: "test",
    createdAt: "2026-06-25T00:00:00.000Z",
    evidenceFingerprints: [],
    sourceConfidence: 0,
    payload: {},
    ...overrides,
  } as AdaptationProposal;
}

describe("reconcileApplyStep", () => {
  it("returns stepCompleted=false when no sibling create_remediation_proposal step exists", () => {
    const plan = makePlan([
      makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" }),
    ]);
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const result = reconcileApplyStep(plan, applyStep, []);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=false when sibling exists but no matching proposal in store", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const result = reconcileApplyStep(plan, applyStep, []);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=false when matching proposal status is 'pending'", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const proposal = makeProposal({
      id: "proposal-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "pending",
    });
    const result = reconcileApplyStep(plan, applyStep, [proposal]);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=false when matching proposal status is 'approved'", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const proposal = makeProposal({
      id: "proposal-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "approved",
    });
    const result = reconcileApplyStep(plan, applyStep, [proposal]);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=true with matched IDs when proposal status is 'applied'", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const proposal = makeProposal({
      id: "proposal-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "applied",
    });
    const result = reconcileApplyStep(plan, applyStep, [proposal]);
    expect(result.stepCompleted).toBe(true);
    expect(result.matchedProposalId).toBe("proposal-1");
    expect(result.matchedCreateStepId).toBe("create-1");
  });

  it("selects correct proposal when multiple proposals exist and only one matches planId + stepId", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const unrelatedProposal = makeProposal({
      id: "unrelated-1",
      target: { kind: "executive_remediation", planId: "other-plan", stepId: "other-step", objectiveId: "other-obj", subsystem: "adaptation" },
      status: "applied",
    });
    const matchingProposal = makeProposal({
      id: "match-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "applied",
    });
    const result = reconcileApplyStep(plan, applyStep, [unrelatedProposal, matchingProposal]);
    expect(result.stepCompleted).toBe(true);
    expect(result.matchedProposalId).toBe("match-1");
  });

  it("correctly filters out non-executive-remediation proposals", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const govProposal = makeProposal({
      id: "gov-1",
      action: "governance_change",
      target: { kind: "governance", recommendationId: "rec-1" } as any,
      status: "applied",
    });
    const result = reconcileApplyStep(plan, applyStep, [govProposal]);
    expect(result.stepCompleted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/executive/executive-apply-reconciler.vitest.ts --reporter=verbose 2>&1 | head -30`
Expected: FAIL with "Cannot find module" or similar — file doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/executive/executive-apply-reconciler.ts`:

```typescript
/**
 * P10.4c — Executive Apply Reconciler.
 *
 * PURE: observes the proposal lifecycle and determines whether an
 * `apply_remediation` step should be marked completed. Never mutates
 * any state — the caller (ExecutionEngine) drives the side effects.
 *
 * Matching strategy: find the sibling create_remediation_proposal step
 * on the same objective, then find a proposal targeting that create step
 * with status === "applied".
 *
 * @module
 */

import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { ExecutionStep } from "./planning-engine.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";

export interface ApplyReconciliationResult {
  /** Whether the step should be marked completed. */
  stepCompleted: boolean;
  /** The matched proposal's ID, if found and applied. */
  matchedProposalId?: string;
  /** The sibling create step's ID, if found. */
  matchedCreateStepId?: string;
}

/**
 * PURE: Determine whether an `apply_remediation` step should be marked
 * completed based on the proposal lifecycle.
 *
 * Finds the sibling create_remediation_proposal step on the same objective,
 * then checks whether its linked proposal has reached "applied" status.
 *
 * @returns stepCompleted=false when no sibling, no match, or not yet applied.
 */
export function reconcileApplyStep(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposals: AdaptationProposal[],
): ApplyReconciliationResult {
  // 1. Find sibling create_remediation_proposal step on the same objective
  const createStep = plan.steps.find(
    s =>
      s.action === "create_remediation_proposal" &&
      s.objectiveId === step.objectiveId,
  );
  if (!createStep) return { stepCompleted: false };

  // 2. Find proposal targeting that create step
  const match = proposals.find(p => {
    if (p.target?.kind !== "executive_remediation") return false;
    const t = p.target;
    return t.planId === plan.id && t.stepId === createStep.id;
  });
  if (!match) return { stepCompleted: false };

  // 3. Check if the proposal has been fully applied
  return {
    stepCompleted: match.status === "applied",
    matchedProposalId: match.id,
    matchedCreateStepId: createStep.id,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/executive/executive-apply-reconciler.vitest.ts --reporter=verbose 2>&1 | head -40`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/executive/executive-apply-reconciler.ts tests/executive/executive-apply-reconciler.vitest.ts
git commit -m "feat(p10-4c): add pure reconcileApplyStep function + 7 unit tests"
```

---

### Task 3: Engine dispatch + 3 integration tests

**Files:**
- Modify: `src/executive/execution-engine.ts` — add P10.4c dispatch block after P10.4b bridge block
- Create: `tests/executive/execution-engine-apply-dispatch.vitest.ts` — 3 integration tests

**Interfaces:**
- Consumes: `reconcileApplyStep` and `ApplyReconciliationResult` from `./executive-apply-reconciler.js`; `ProposalStore` from `../adaptation/proposal-store.js` (already imported)
- Modifies: `executeStepInternal()` — adds dispatch for `step.action === "apply_remediation"`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/executive/execution-engine-apply-dispatch.vitest.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEngine } from "../../src/executive/execution-engine.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { StepRunner } from "../../src/executive/step-runner.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";

// -----------------------------------------------------------------------
// Factory helpers
// -----------------------------------------------------------------------

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-1",
    stepNumber: 1,
    title: "Test step",
    action: "create_remediation_proposal",
    objectiveId: "obj-1",
    targetSubsystem: "adaptation",
    riskLevel: "medium",
    objectiveScore: 0,
    priorityScore: 0,
    status: "pending",
    dependsOn: [],
    ...overrides,
  };
}

const CREATE_STEP = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
const APPLY_STEP = makeStep({ id: "apply-1", stepNumber: 2, action: "apply_remediation", objectiveId: "obj-1", dependsOn: ["create-1"] });
const PLAN: PersistedExecutionPlan = {
  id: "plan-1",
  steps: [CREATE_STEP, APPLY_STEP],
  objectives: ["obj-1"],
  generatedAt: "2026-06-25T00:00:00.000Z",
  healthSnapshotAt: "2026-06-25T00:00:00.000Z",
  objectiveReports: [],
  windowDays: 7,
  planStatus: "ready",
  contentHash: "test-hash",
};

function makeState(overrides: Partial<PlanExecutionState> = {}): PlanExecutionState {
  return {
    planId: "plan-1",
    status: "running",
    approval: { status: "approved" },
    planTransitions: [],
    timestamps: { createdAt: "2026-06-25T00:00:00.000Z", runningAt: "2026-06-25T00:00:00.000Z" },
    stepStates: {
      "create-1": { status: "completed", generatedArtifacts: [{ type: "proposal", id: "proposal-1" }], durationMs: 10, warnings: [], summary: "done", evidenceIds: [], startedAt: "", completedAt: "", lastExecutionId: "test-exec-1" },
      "apply-1": { status: "pending", generatedArtifacts: [], durationMs: 0, warnings: [], summary: "", evidenceIds: [], startedAt: "", completedAt: "", lastExecutionId: "" },
    },
    ...overrides,
  };
}

function makeAppliedProposal(): AdaptationProposal {
  return {
    id: "proposal-1",
    status: "applied",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "create-1",
      objectiveId: "obj-1",
      subsystem: "adaptation",
    },
    provenance: "manual",
    reason: "test",
    createdAt: "2026-06-25T00:00:00.000Z",
    evidenceFingerprints: [],
    sourceConfidence: 0,
    payload: {},
  } as AdaptationProposal;
}

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

function createMocks() {
  const planStore = {
    load: vi.fn().mockReturnValue(PLAN),
  } as unknown as PlanStore;

  const stateStore = {
    load: vi.fn().mockReturnValue(makeState()),
    update: vi.fn().mockImplementation((_planId, _opts, fn: (s: PlanExecutionState) => PlanExecutionState) => {
      const state = makeState();
      return fn(state);
    }),
  } as unknown as ExecutionStateStore;

  const evidenceEvents: any[] = [];
  const writer = new EvidenceEventWriter(async (type, payload) => {
    evidenceEvents.push({ type, payload });
    return { id: `evt-${evidenceEvents.length}`, type, payload, version: 1, timestamp: "", fingerprint: "" } as any;
  });

  const runner = {
    execute: vi.fn().mockResolvedValue({
      newStepStatus: "waiting_for_bridge" as const,
      durationMs: 5,
      evidenceIds: [],
      summary: "",
      warnings: [],
    }),
  } as unknown as StepRunner;

  return { planStore, stateStore, writer, runner, evidenceEvents };
}

describe("P10.4c engine dispatch — apply_remediation reconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks step completed when proposal is applied and records evidence", async () => {
    const { planStore, stateStore, writer, runner, evidenceEvents } = createMocks();
    const proposalStore = {
      list: vi.fn().mockResolvedValue([makeAppliedProposal()]),
    } as unknown as ProposalStore;

    const engine = new ExecutionEngine(planStore, stateStore, runner, writer, proposalStore);
    const result = await engine.runStep("plan-1", "apply-1");

    expect(result.status).toBe("completed");
    // Should have recorded the applied remediation evidence
    const appliedEvt = evidenceEvents.find(e => e.type === "executive_step_applied_remediation");
    expect(appliedEvt).toBeDefined();
    expect(appliedEvt.payload).toMatchObject({
      planId: "plan-1",
      stepId: "apply-1",
      proposalId: "proposal-1",
    });
  });

  it("stays waiting_for_bridge when no matching proposal exists", async () => {
    const { planStore, stateStore, writer, runner, evidenceEvents } = createMocks();
    // Simulate that the create step hasn't been bridged yet — no proposals exist
    const proposalStore = {
      list: vi.fn().mockResolvedValue([] as AdaptationProposal[]),
    } as unknown as ProposalStore;

    const engine = new ExecutionEngine(planStore, stateStore, runner, writer, proposalStore);
    const result = await engine.runStep("plan-1", "apply-1");

    // Apply step has a sibling create step on obj-1, but no proposals
    // exist in the store yet (the bridge hasn't run for create-1).
    // Reconciler returns stepCompleted=false → stays waiting_for_bridge.
    expect(result.status).toBe("waiting_for_bridge");
    const appliedEvt = evidenceEvents.find(e => e.type === "executive_step_applied_remediation");
    expect(appliedEvt).toBeUndefined();
  });

  it("is no-op when proposalStore is undefined (backward compat)", async () => {
    const { planStore, stateStore, writer, runner, evidenceEvents } = createMocks();
    // No proposalStore — engine created with 4 args
    const engine = new ExecutionEngine(planStore, stateStore, runner, writer);
    const result = await engine.runStep("plan-1", "apply-1");

    expect(result.status).toBe("waiting_for_bridge");
    const appliedEvt = evidenceEvents.find(e => e.type === "executive_step_applied_remediation");
    expect(appliedEvt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/executive/execution-engine-apply-dispatch.vitest.ts --reporter=verbose 2>&1 | head -30`
Expected: Tests fail or import errors since the engine doesn't dispatch for `apply_remediation` yet.

- [ ] **Step 3: Implement engine dispatch**

In `src/executive/execution-engine.ts`, add the import at the top (after the `executive-bridge.js` import on line 17):

```typescript
import { reconcileApplyStep } from "./executive-apply-reconciler.js";
```

Then add the P10.4c dispatch block after the P10.4b bridge block (after line ~213, before the comment `// Mark terminal based on runner result`):

```typescript
    // ─── P10.4c executive apply reconciler ──────────────────────────────────
    // Reconcile `apply_remediation` steps by observing the linked proposal's
    // lifecycle status. If the proposal is "applied", mark the step completed.
    // Otherwise stay "waiting_for_bridge". Do NOT clear prior warnings.
    if (step.action === "apply_remediation" && this.proposalStore) {
      const proposals = await this.proposalStore.list();
      const reconcileResult = reconcileApplyStep(plan, step, proposals);
      if (reconcileResult.stepCompleted) {
        result.newStepStatus = "completed";
        result.summary = `Proposal ${reconcileResult.matchedProposalId} was applied`;
        // Append reconciler note; do NOT clear prior warnings (they may contain
        // useful history from previous run attempts).
        await this.writer.recordExecutiveStepAppliedRemediation({
          planId: plan.id,
          stepId: step.id,
          proposalId: reconcileResult.matchedProposalId!,
        });
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/execution-engine-apply-dispatch.vitest.ts --reporter=verbose 2>&1 | head -40`
Expected: All 3 tests pass.

- [ ] **Step 5: Run full suite to verify no regressions**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass (check count matches expected — should be ~1900+).

- [ ] **Step 6: Commit**

```bash
git add src/executive/execution-engine.ts tests/executive/execution-engine-apply-dispatch.vitest.ts
git commit -m "feat(p10-4c): wire apply_remediation reconciler into ExecutionEngine + 3 integration tests"
```

---

### Task 4: Sentinel allowlist check

**Files:**
- Verify: `tests/executive/executive-sentinels.vitest.ts`

**Interfaces:**
- Consumes: existing sentinel test file with `EXECUTIVE_FILES` array and `FORBIDDEN_IN_EXECUTIVE` list
- Produces: updated allowlist if needed; verification that reconciler passes purity checks

- [ ] **Step 1: Run existing sentinel tests to check if they pass with the new file**

Run: `npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter=verbose 2>&1 | head -50`
Expected: The sentinel iterates `EXECUTIVE_FILES` and tests each. If `executive-apply-reconciler.ts` is NOT in the list, the sentinel doesn't test it — which means no false positive, but also no coverage for the new file. The spec notes this may need update.

- [ ] **Step 2: Check if the new file needs sentinel coverage**

Read the sentinel file and check: is `"src/executive/executive-apply-reconciler.ts"` in the `EXECUTIVE_FILES` array?

If NOT present, add it after the `"src/executive/executive-bridge.ts"` entry (line 56):

```typescript
  // P10.4b files
  "src/executive/executive-bridge.ts",
  // P10.4c files
  "src/executive/executive-apply-reconciler.ts",
```

Then re-run the sentinel tests to confirm the reconciler file passes the purity check (it imports only types, no forbidden symbols).

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "test(p10-4c): add executive-apply-reconciler.ts to sentinel allowlist"
```

If the sentinel already passes without adding the file (e.g. it uses a directory scan or the test only fails on forbidden symbols, not on unlisted files), then no changes needed — just report the verification result.

---

### Task 5: Whole-branch review + PR + tag

**Files:** All files from Tasks 1–4.

- [ ] **Step 1: Run full test suite + type check**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
npx tsc --noEmit 2>&1
```

Expected: All tests pass, tsc clean.

- [ ] **Step 2: Run gitnexus detect_changes to verify scope**

```bash
npx gitnexus detect_changes
```

Expected: Only expected files (evidence-types.ts, evidence-writer.ts, executive-apply-reconciler.ts, execution-engine.ts, sentinel tests). No unexpected mutation surfaces.

- [ ] **Step 3: Push and create PR**

```bash
# Create branch off main
git checkout -b feature/p10-4c-executive-apply-reconciler
git push -u origin feature/p10-4c-executive-apply-reconciler
gh pr create --base main --title "P10.4c — Executive Apply Reconciler" --body "## P10.4c — Executive Apply Reconciler

Bridges \`apply_remediation\` steps by observing the proposal lifecycle.

### Files created
- \`src/executive/executive-apply-reconciler.ts\` — pure \`reconcileApplyStep()\` function
- \`tests/executive/executive-apply-reconciler.vitest.ts\` — 7 unit tests
- \`tests/executive/execution-engine-apply-dispatch.vitest.ts\` — 3 integration tests

### Files modified
- \`src/security/evidence/evidence-types.ts\` — +executive_step_applied_remediation
- \`src/workflow/evidence-writer.ts\` — +recordExecutiveStepAppliedRemediation
- \`src/executive/execution-engine.ts\` — +apply_remediation dispatch block
- \`tests/executive/executive-sentinels.vitest.ts\` — allowlist update

### Safety invariants
- Read-only reconciler: observes proposal status, never mutates
- No approve/apply/reject calls
- No adaptation-types.ts changes
- StepRunner unchanged
- proposalStore guard ensures no-op when not wired
- Warnings preserved (not cleared)

Closes #<issue-number>"
```

- [ ] **Step 4: (After merge)** Tag the merged commit

After the PR is merged into `main`:
```bash
git checkout main
git pull --ff-only
git tag alix-p10-4c-complete
git push origin alix-p10-4c-complete
```
