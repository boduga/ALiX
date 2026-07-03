# P10.9.2c — Lifecycle Automation / Executive Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a remediated child proposal reaches terminal status (applied/failed) and resume/advance the originating executive plan.

**Architecture:** Two-layer hybrid: event hook fires after `alix adaptation apply` succeeds (fast path), and `alix executive orchestrate` scans for missed proposals (recovery path). Pure preview (`planChildReconciliation`) for dry-run, effectful `reconcileChildProposal` for writes. No daemon.

**Tech Stack:** TypeScript, Node.js, vitest

## Global Constraints

- Hook fires AFTER `gate.apply()` completes — never blocks the apply
- Only proposals with `payload.source === "executive_remediate"` AND non-empty `planId`, `stepId`, `parentProposalId` trigger orchestration
- Applied child → step becomes `completed`. Failed child → step becomes `blocked`. `rejected` and non-terminal statuses are no-ops
- `completedAt` only set on `completed` transitions — never on `blocked`
- Evidence writer failure logs a warning (no silent `.catch(() => {})`)
- No ADR-0004 protected type files modified
- No daemon, no background watcher, no long-running process
- All new executive files added to EXECUTIVE_FILES allowlist in purity sentinel

---
### Task 0: Evidence type + writer method

**Files:**
- Modify: `src/security/evidence/evidence-types.ts`
- Modify: `src/workflow/evidence-writer.ts`
- Test: (verify type exists + writer returns correct shape)

**Interfaces:**
- Produces: `EvidenceType` union gets `"executive_step_orchestrated"` member
- Produces: `EvidenceEventWriter` gets `recordExecutiveStepOrchestrated(payload)` method

- [ ] **Step 1: Add evidence type to `evidence-types.ts`**

Add `"executive_step_orchestrated"` to the `EvidenceType` union and to the `EVIDENCE_TYPES` set:

```typescript
// In EvidenceType union (around line 92, after executive_step_applied_remediation)
  | "executive_step_orchestrated"

// In EVIDENCE_TYPES set (around line 153, after "executive_step_applied_remediation")
  "executive_step_orchestrated",
```

- [ ] **Step 2: Add writer method to `evidence-writer.ts`**

Add the method near the existing executive bridge/reconciliation methods (around line 698):

```typescript
async recordExecutiveStepOrchestrated(payload: {
  planId: string;
  stepId: string;
  parentProposalId: string;
  childProposalId: string;
  childStatus: string;
  newStepStatus: string;
}): Promise<EvidenceRecord | null> {
  return this.appendEvent("executive_step_orchestrated", { ...payload });
}
```

- [ ] **Step 3: Verify type is recognized**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only errors unrelated to evidence types).

- [ ] **Step 4: Commit**

```bash
git add src/security/evidence/evidence-types.ts src/workflow/evidence-writer.ts
git commit -m "P10.9.2c-T0: Add executive_step_orchestrated evidence type + writer method"
```

---

### Task 1: ExecutiveOrchestrator module — types, pure functions, class, and unit tests

**Files:**
- Create: `src/executive/executive-orchestrator.ts`
- Create: `tests/executive/executive-orchestrator.vitest.ts`

**Interfaces:**
- Consumes: `AdaptationProposal`, `ProposalStatus` from `adaptation-types.js`
- Consumes: `PlanExecutionState`, `StepRuntimeStatus`, `StepRuntimeState` from `executive-plan-types.js`
- Consumes: `ExecutionStateStore` from `execution-state-store.js`
- Consumes: `ExecutionEngine` from `execution-engine.js`
- Consumes: `EvidenceEventWriter` from `evidence-writer.js`
- Consumes: `ReconcileResult`, `ChildLineageInfo`, `OrchestrateResult` from same file (produced in this task)
- Produces: `extractChildLineage`, `computeStepTransition`, `orchestrationSequence`, `planChildReconciliation`, `reconcileChildProposal`, `OrchestrationHook`, `ExecutiveOrchestrator`

- [ ] **Step 1: Write the failing unit test file**

Create `tests/executive/executive-orchestrator.vitest.ts` with these test groups:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  extractChildLineage,
  computeStepTransition,
  planChildReconciliation,
  orchestrationSequence,
} from "../../src/executive/executive-orchestrator.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { PlanExecutionState } from "../../src/executive/executive-plan-types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function childProposal(overrides: Partial<AdaptationProposal> & { id: string }): AdaptationProposal {
  const base: AdaptationProposal = {
    id: "",
    createdAt: "2026-06-30T00:00:00.000Z",
    status: "applied",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "card-1" },
    payload: {
      source: "executive_remediate",
      planId: "plan-1",
      stepId: "step-1",
      parentProposalId: "prop-007",
    },
    reason: "test child proposal",
  } as AdaptationProposal;
  return { ...base, ...overrides };
}

function makeState(overrides: Partial<PlanExecutionState> & { planId: string }): PlanExecutionState {
  const base: PlanExecutionState = {
    planId: "",
    status: "running",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: "2026-06-30T00:00:00.000Z" },
    lastExecutionId: undefined,
  } as PlanExecutionState;
  return { ...base, ...overrides };
}
```

**Test group 1: extractChildLineage**

```typescript
describe("extractChildLineage", () => {
  it("returns lineage for valid executive_remediate proposal", () => {
    const proposal = childProposal({ id: "prop-008" });
    const result = extractChildLineage(proposal);
    expect(result).toEqual({
      planId: "plan-1",
      stepId: "step-1",
      parentProposalId: "prop-007",
    });
  });

  it("returns null when source is not executive_remediate", () => {
    const proposal = childProposal({ id: "prop-008" });
    (proposal.payload as any).source = "executive_bridge";
    expect(extractChildLineage(proposal)).toBeNull();
  });

  it("returns null when planId is missing", () => {
    const proposal = childProposal({ id: "prop-008" });
    delete (proposal.payload as any).planId;
    expect(extractChildLineage(proposal)).toBeNull();
  });

  it("returns null when stepId is missing", () => {
    const proposal = childProposal({ id: "prop-008" });
    delete (proposal.payload as any).stepId;
    expect(extractChildLineage(proposal)).toBeNull();
  });

  it("returns null when parentProposalId is missing", () => {
    const proposal = childProposal({ id: "prop-008" });
    delete (proposal.payload as any).parentProposalId;
    expect(extractChildLineage(proposal)).toBeNull();
  });

  it("returns null for undefined payload", () => {
    const proposal = childProposal({ id: "prop-008" });
    (proposal as any).payload = undefined;
    expect(extractChildLineage(proposal)).toBeNull();
  });
});
```

**Test group 2: computeStepTransition**

```typescript
describe("computeStepTransition", () => {
  it("returns completed when child applied and step is waiting_for_bridge", () => {
    const state = makeState({
      planId: "plan-1",
      stepStates: {
        "step-1": { status: "waiting_for_bridge" } as any,
      },
    });
    expect(computeStepTransition(state, "step-1", "applied")).toBe("completed");
  });

  it("returns blocked when child failed and step is waiting_for_bridge", () => {
    const state = makeState({
      planId: "plan-1",
      stepStates: {
        "step-1": { status: "waiting_for_bridge" } as any,
      },
    });
    expect(computeStepTransition(state, "step-1", "failed")).toBe("blocked");
  });

  it("returns null when step does not exist", () => {
    const state = makeState({ planId: "plan-1", stepStates: {} });
    expect(computeStepTransition(state, "step-404", "applied")).toBeNull();
  });

  it("returns null when step is already completed (idempotent)", () => {
    const state = makeState({
      planId: "plan-1",
      stepStates: {
        "step-1": { status: "completed" } as any,
      },
    });
    expect(computeStepTransition(state, "step-1", "applied")).toBeNull();
  });

  it("returns null when child is rejected (operator declined)", () => {
    const state = makeState({
      planId: "plan-1",
      stepStates: {
        "step-1": { status: "waiting_for_bridge" } as any,
      },
    });
    expect(computeStepTransition(state, "step-1", "rejected")).toBeNull();
  });

  it("returns null when child is pending (not terminal)", () => {
    const state = makeState({
      planId: "plan-1",
      stepStates: {
        "step-1": { status: "waiting_for_bridge" } as any,
      },
    });
    expect(computeStepTransition(state, "step-1", "pending")).toBeNull();
  });

  it("returns null when child is approved (not yet applied)", () => {
    const state = makeState({
      planId: "plan-1",
      stepStates: {
        "step-1": { status: "waiting_for_bridge" } as any,
      },
    });
    expect(computeStepTransition(state, "step-1", "approved")).toBeNull();
  });
});
```

**Test group 3: planChildReconciliation (pure preview)**

```typescript
describe("planChildReconciliation", () => {
  it("returns newStatus=completed for applied child on waiting_for_bridge step", () => {
    const proposal = childProposal({ id: "prop-008" });
    const state = makeState({
      planId: "plan-1",
      stepStates: { "step-1": { status: "waiting_for_bridge" } as any },
    });
    const result = planChildReconciliation(proposal, state);
    expect(result.newStatus).toBe("completed");
  });

  it("returns no lineage summary when source is not executive_remediate", () => {
    const proposal = childProposal({ id: "prop-008" });
    (proposal.payload as any).source = "executive_bridge";
    const state = makeState({ planId: "plan-1", stepStates: {} });
    const result = planChildReconciliation(proposal, state);
    expect(result.newStatus).toBeNull();
    expect(result.summary).toContain("no executive_remediate lineage");
  });
});
```

**Test group 4: orchestrationSequence**

```typescript
describe("orchestrationSequence", () => {
  it("produces a string starting with a timestamp", () => {
    const seq = orchestrationSequence();
    expect(seq).toMatch(/^\d+-[a-f0-9]+$/);
  });

  it("produces different values on successive calls", () => {
    const a = orchestrationSequence();
    const b = orchestrationSequence();
    expect(a).not.toBe(b);
  });
});
```

**Test group 5: ExecutiveOrchestrator class**

```typescript
describe("ExecutiveOrchestrator", () => {
  it("onProposalTerminal no-ops for non-remediated proposal", async () => {
    const proposal = childProposal({ id: "prop-008" });
    (proposal.payload as any).source = "executive_bridge";
    const stateStore = { load: vi.fn() } as any;
    const engine = { runReadySteps: vi.fn() } as any;
    const writer = { recordExecutiveStepOrchestrated: vi.fn() } as any;

    const { ExecutiveOrchestrator } = await import(
      "../../src/executive/executive-orchestrator.js"
    );
    const orchestrator = new ExecutiveOrchestrator(stateStore, engine, writer);
    await expect(orchestrator.onProposalTerminal(proposal)).resolves.toBeUndefined();
    expect(stateStore.load).not.toHaveBeenCalled();
  });
});
```

Total: **15+ tests**.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/executive/executive-orchestrator.vitest.ts --config vitest.config.mts 2>&1 | head -10
```
Expected: FAIL — `executive-orchestrator.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/executive/executive-orchestrator.ts`**

Create the module with these exports in order:

```typescript
import { randomUUID } from "node:crypto";
import type { AdaptationProposal, ProposalStatus } from "../adaptation/adaptation-types.js";
import type { PlanExecutionState, StepRuntimeStatus } from "./executive-plan-types.js";
import type { ExecutionStateStore } from "./execution-state-store.js";
import type { ExecutionEngine } from "./execution-engine.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChildLineageInfo {
  planId: string;
  stepId: string;
  parentProposalId: string;
}

export interface ReconcileResult {
  childProposalId: string;
  planId: string;
  stepId: string;
  transitioned: boolean;
  newStepStatus?: StepRuntimeStatus;
  summary: string;
}

export interface OrchestrateResult {
  scanned: number;
  matched: number;
  reconciled: number;
  plansResumed: string[];
  results: ReconcileResult[];
}

// ── OrchestrationSequence ────────────────────────────────────────────────────

export function orchestrationSequence(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

// ── Pure functions ───────────────────────────────────────────────────────────

export function extractChildLineage(proposal: AdaptationProposal): ChildLineageInfo | null {
  const payload = proposal.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  if (payload.source !== "executive_remediate") return null;
  if (!payload.planId || !payload.stepId || !payload.parentProposalId) return null;
  return {
    planId: String(payload.planId),
    stepId: String(payload.stepId),
    parentProposalId: String(payload.parentProposalId),
  };
}

export function computeStepTransition(
  state: PlanExecutionState,
  stepId: string,
  childStatus: ProposalStatus,
): StepRuntimeStatus | null {
  const stepState = state.stepStates[stepId];
  if (!stepState) return null;
  if (stepState.status !== "waiting_for_bridge") return null;
  if (childStatus === "applied") return "completed";
  if (childStatus === "failed") return "blocked";
  return null;
}

export function planChildReconciliation(
  proposal: AdaptationProposal,
  state: PlanExecutionState,
): { newStatus: StepRuntimeStatus | null; summary: string } {
  const lineage = extractChildLineage(proposal);
  if (!lineage) {
    return { newStatus: null, summary: "Proposal has no executive_remediate lineage — skipped" };
  }
  if (!state.stepStates[lineage.stepId]) {
    return { newStatus: null, summary: `Step ${lineage.stepId} not found in plan ${lineage.planId}` };
  }
  return {
    newStatus: computeStepTransition(state, lineage.stepId, proposal.status),
    summary: `Step ${lineage.stepId} → compute transition for child ${proposal.id} (${proposal.status})`,
  };
}

// ── Effectful reconciliation ─────────────────────────────────────────────────

export async function reconcileChildProposal(
  proposal: AdaptationProposal,
  stateStore: ExecutionStateStore,
  engine: ExecutionEngine,
  writer: EvidenceEventWriter,
): Promise<ReconcileResult> {
  const lineage = extractChildLineage(proposal);
  if (!lineage) {
    return {
      childProposalId: proposal.id,
      planId: "",
      stepId: "",
      transitioned: false,
      summary: "Proposal has no executive_remediate lineage — skipped",
    };
  }

  let state: PlanExecutionState;
  try {
    state = stateStore.load(lineage.planId);
  } catch {
    return {
      childProposalId: proposal.id,
      planId: lineage.planId,
      stepId: lineage.stepId,
      transitioned: false,
      summary: `Parent plan ${lineage.planId} not found — skipped`,
    };
  }

  const { newStatus } = planChildReconciliation(proposal, state);
  if (!newStatus) {
    const stepStatus = state.stepStates[lineage.stepId]?.status ?? "unknown";
    return {
      childProposalId: proposal.id,
      planId: lineage.planId,
      stepId: lineage.stepId,
      transitioned: false,
      summary: `Step ${lineage.stepId} status is "${stepStatus}" — no transition needed`,
    };
  }

  const executionId = `orchestration-${orchestrationSequence()}`;
  stateStore.update(lineage.planId, {
    from: state.status,
    to: state.status,
    executionId,
    reason: `Child proposal ${proposal.id} (${proposal.status}) → step ${lineage.stepId} → ${newStatus}`,
  }, (s: PlanExecutionState) => {
    s.stepStates[lineage.stepId].status = newStatus;
    if (newStatus === "completed") {
      s.stepStates[lineage.stepId].completedAt = new Date().toISOString();
    }
    s.stepStates[lineage.stepId].summary =
      `Orchestrated from child proposal ${proposal.id} (${proposal.status})`;
    return s;
  });

  const evidenceResult = await writer.recordExecutiveStepOrchestrated({
    planId: lineage.planId,
    stepId: lineage.stepId,
    parentProposalId: lineage.parentProposalId,
    childProposalId: proposal.id,
    childStatus: proposal.status,
    newStepStatus: newStatus,
  });
  if (!evidenceResult) {
    console.warn(
      `[executive-orchestrator] Failed to record executive_step_orchestrated evidence for plan ${lineage.planId} step ${lineage.stepId} — non-blocking, audit trail may be incomplete`,
    );
  }

  if (newStatus === "completed") {
    await engine.runReadySteps(lineage.planId);
  }

  return {
    childProposalId: proposal.id,
    planId: lineage.planId,
    stepId: lineage.stepId,
    transitioned: true,
    newStepStatus: newStatus,
    summary: `Child proposal ${proposal.id} (${proposal.status}) → step ${lineage.stepId} → ${newStatus}`,
  };
}

// ── Event hook ───────────────────────────────────────────────────────────────

export interface OrchestrationHook {
  onProposalTerminal(proposal: AdaptationProposal): Promise<void>;
}

export class ExecutiveOrchestrator implements OrchestrationHook {
  constructor(
    private readonly stateStore: ExecutionStateStore,
    private readonly engine: ExecutionEngine,
    private readonly writer: EvidenceEventWriter,
  ) {}

  async onProposalTerminal(proposal: AdaptationProposal): Promise<void> {
    try {
      const lineage = extractChildLineage(proposal);
      if (!lineage) return;

      await reconcileChildProposal(proposal, this.stateStore, this.engine, this.writer);
    } catch (e) {
      console.warn(
        `[executive-orchestrator] Failed to orchestrate proposal ${proposal.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/executive/executive-orchestrator.vitest.ts --config vitest.config.mts
```
Expected: All 15+ tests pass.

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: Clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/executive/executive-orchestrator.ts tests/executive/executive-orchestrator.vitest.ts
git commit -m "P10.9.2c-T1: ExecutiveOrchestrator module — types, pure functions, class, unit tests

- Types: ChildLineageInfo, ReconcileResult, OrchestrateResult
- Pure: extractChildLineage, computeStepTransition, planChildReconciliation
- Effectful: reconcileChildProposal (shared with event hook + recovery CLI)
- Event hook: ExecutiveOrchestrator implementing OrchestrationHook
- 15+ unit tests covering all pure functions and hook behavior
- completedAt only for 'completed' transitions (never for 'blocked')
- Evidence failure logs warning (not silent catch)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Wire orchestration hook into adaptation.ts

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Modify: `tests/cli/commands/adaptation.vitest.ts` (or relevant existing test file)

**Interfaces:**
- Consumes: `OrchestrationHook`, `ExecutiveOrchestrator` from `executive-orchestrator.js`
- Consumes: `ExecutionStateStore` from `execution-state-store.js`
- Consumes: `ExecutionEngine` from `execution-engine.js`

- [ ] **Step 1: Update `runApply` signature**

Add optional `orchestrator` parameter:

```typescript
async function runApply(
  cwd: string,
  store: ProposalStore,
  gate: ApprovalGate,
  writer: EvidenceEventWriter,
  args: string[],
  orchestrator?: OrchestrationHook,          // ★ NEW
): Promise<void> {
```

- [ ] **Step 2: Fire hook after gate.apply()**

Find the line after `const updated = await gate.apply(id, applier);` and add:

```typescript
  // ★ NEW: fire orchestration hook (best-effort, never blocks apply)
  if (orchestrator) {
    orchestrator.onProposalTerminal(updated).catch(() => {});
  }
```

- [ ] **Step 3: Construct orchestrator in `handleAdaptationCommand`**

In the `handleAdaptationCommand` function (where the dispatcher creates `gate`, `store`, etc.), add construction logic. The function already receives `cwd` and creates `writer`. Add:

```typescript
  // ★ NEW: Construct ExecutiveOrchestrator if executive data exists
  import { ExecutiveOrchestrator } from "../executive/executive-orchestrator.js";
  import { ExecutionStateStore } from "../executive/execution-state-store.js";
  import { ExecutionEngine } from "../executive/execution-engine.js";
  import { PlanStore } from "../executive/plan-store.js";

  // ...

  let orchestrator: ExecutiveOrchestrator | undefined;
  const execDir = join(cwd, ".alix", "executive");
  if (existsSync(join(execDir, "states"))) {
    try {
      const planStore = new PlanStore(join(execDir, "plans"));
      const stateStore = new ExecutionStateStore(join(execDir, "states"));
      const engine = new ExecutionEngine(
        planStore,
        stateStore,
        new StepRunner(writer),
        writer,
        // proposalStore, outcomeHook, snapshotStore, snapshotProvider
        // are optional; pass undefined for each if not wired
      );
      orchestrator = new ExecutiveOrchestrator(stateStore, engine, writer);
    } catch {
      // Non-blocking: if executive layer isn't available, skip orchestration
    }
  }
```

Thread `orchestrator` into the `runApply` call:

```typescript
    case "apply":
      await runApply(cwd, store, gate, writer, rest, orchestrator);
      return;
```

- [ ] **Step 4: Run tests to verify nothing breaks**

```bash
npx vitest run --config vitest.config.mts 2>&1 | tail -10
```
Expected: All existing tests pass (the hook is optional, so existing tests without orchestrator still work).

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/adaptation.ts
git commit -m "P10.9.2c-T2: Wire orchestration hook into adaptation.ts apply path

- Optional OrchestrationHook parameter in runApply
- Hook fires after gate.apply() succeeds (best-effort, never blocks)
- ExecutiveOrchestrator constructed from executive data dir when available
- Backward compatible — existing call sites pass undefined

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Recovery CLI — `alix executive orchestrate`

**Files:**
- Create: `src/cli/commands/executive-orchestrate-handler.ts`
- Create: `tests/cli/commands/executive-orchestrate-cli.vitest.ts`
- Modify: `src/cli/commands/executive.ts`

**Interfaces:**
- Consumes: `ExecutiveOrchestrator`, `planChildReconciliation`, `reconcileChildProposal`, `ChildLineageInfo`, `ReconcileResult`, `OrchestrateResult` from Task 1
- Consumes: `ProposalStore` from `adaptation/proposal-store.js`
- Consumes: `ExecutionStateStore` from `executive/execution-state-store.js`
- Consumes: `ExecutionEngine`, `StepRunner` from `executive/`

- [ ] **Step 1: Write the failing CLI integration test file**

Create `tests/cli/commands/executive-orchestrate-cli.vitest.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { handleOrchestrateCommand } from "../../../src/cli/commands/executive-orchestrate-handler.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

function makeChildProposal(overrides: Partial<AdaptationProposal> & { id: string }): AdaptationProposal {
  const base: AdaptationProposal = {
    id: "",
    createdAt: "2026-06-30T00:00:00.000Z",
    status: "applied",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "card-1" },
    payload: {
      source: "executive_remediate",
      planId: "plan-1",
      stepId: "step-1",
      parentProposalId: "prop-007",
    },
    sourceRecommendationType: "executive_remediation",
    sourceConfidence: 0.8,
    evidenceFingerprints: ["fp-1"],
    reason: "test child proposal",
  } as AdaptationProposal;
  return { ...base, ...overrides };
}
```

**Test groups (8+ tests):**

1. **No remediated proposals** — no proposals with lineage → `"No remediated child proposals found."`
2. **Reconciles applied child** — creates proposal with `source === "executive_remediate"`, `status === "applied"`, verifies it gets reconciled
3. **Reconciles failed child** — `status === "failed"` → step becomes blocked
4. **--dry-run** — no mutations, prints preview
5. **--json** — valid JSON output
6. **--plan filter** — only reconciles proposals linked to that plan
7. **Already reconciled** — step already completed → idempotent no-op
8. **Non-remediated proposal ignored** — source !== "executive_remediate" → no match

Because the handler loads real stores, tests should set up temporary directories with mock/fake state store data, or use vi.mock to mock `ExecutionStateStore` and `ProposalStore`:

```typescript
// Use vi.mock for the stores and engine
vi.mock("../../../src/executive/execution-state-store.js");
vi.mock("../../../src/executive/execution-engine.js");
vi.mock("../../../src/executive/step-runner.js");
vi.mock("../../../src/adaptation/proposal-store.js");

// Tests use mock implementations
const mockStateStore = {
  load: vi.fn(),
};

const mockEngine = {
  runReadySteps: vi.fn(),
};
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands/executive-orchestrate-cli.vitest.ts --config vitest.config.mts 2>&1 | head -10
```
Expected: FAIL — `executive-orchestrate-handler.ts` doesn't exist.

- [ ] **Step 3: Implement `src/cli/commands/executive-orchestrate-handler.ts`**

```typescript
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { ExecutionStateStore } from "../../executive/execution-state-store.js";
import { ExecutionEngine } from "../../executive/execution-engine.js";
import { StepRunner } from "../../executive/step-runner.js";
import { EvidenceEventWriter } from "../../workflow/evidence-writer.js";
import {
  reconcileChildProposal,
  planChildReconciliation,
} from "../../executive/executive-orchestrator.js";
import type { ReconcileResult, OrchestrateResult } from "../../executive/executive-orchestrator.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

export async function handleOrchestrateCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const useJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  const planFilterIdx = args.indexOf("--plan");
  const planFilter = planFilterIdx >= 0 ? args[planFilterIdx + 1] : undefined;

  // 1. Load all proposals
  const store = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const all = await store.list();
  const proposals = planFilter
    ? all.filter(p => {
        const payload = p.payload as Record<string, unknown>;
        return payload?.planId === planFilter;
      })
    : all;

  // 2. Filter: terminal status + executive_remediate lineage
  const matched = proposals.filter(p => {
    const payload = p.payload as Record<string, unknown> | undefined;
    if (!payload || payload.source !== "executive_remediate") return false;
    if (p.status !== "applied" && p.status !== "failed") return false;
    if (!payload.planId || !payload.stepId) return false;
    return true;
  });

  if (matched.length === 0) {
    if (useJson) {
      console.log(JSON.stringify({ scanned: proposals.length, matched: 0, reconciled: 0, plansResumed: [], results: [] }));
    } else {
      console.log(`Scanned ${proposals.length} proposals.\nNo remediated child proposals found.`);
    }
    return;
  }

  // 3. Set up executive stores (read-only state store needed for dry-run too)
  //    Effectful stores (planStore, writer, engine) only for non-dry-run.
  let stateStoreForLoop: ExecutionStateStore | undefined;
  let engine: ExecutionEngine | undefined;
  let writer: EvidenceEventWriter | undefined;

  // 4. Reconcile each matched proposal
  const results: ReconcileResult[] = [];
  const resumedPlans = new Set<string>();

  // Load state store for pure preview (dry-run) or effectful writes
  const execDir = join(cwd, ".alix", "executive");
  let stateStoreForLoop: ExecutionStateStore | undefined;
  if (existsSync(join(execDir, "states"))) {
    stateStoreForLoop = new (await import("../../executive/execution-state-store.js")).ExecutionStateStore(join(execDir, "states"));
  }

  for (const p of matched) {
    if (dryRun) {
      // Pure preview via planChildReconciliation — never mutates
      const planId = String((p.payload as any).planId);
      const stepId = String((p.payload as any).stepId);
      let state;
      try {
        state = stateStoreForLoop?.load(planId);
      } catch { /* plan not found */ }

      if (state) {
        const preview = planChildReconciliation(p, state);
        results.push({
          childProposalId: p.id,
          planId,
          stepId,
          transitioned: preview.newStatus !== null,
          newStepStatus: preview.newStatus ?? undefined,
          summary: `[dry-run] ${preview.summary}`,
        });
      } else {
        results.push({
          childProposalId: p.id,
          planId,
          stepId,
          transitioned: false,
          summary: `[dry-run] Parent plan ${planId} not found — skipped`,
        });
      }
    } else {
      const result = await reconcileChildProposal(p, stateStore!, engine!, writer!);
      results.push(result);
      if (result.transitioned && result.newStepStatus === "completed") {
        resumedPlans.add(result.planId);
      }
    }
  }

  // 5. Output
  const scanned = proposals.length;
  const matchedCount = matched.length;
  const reconciled = results.filter(r => r.transitioned).length;
  const plansResumed = Array.from(resumedPlans).sort();

  if (useJson) {
    console.log(JSON.stringify({ scanned, matched: matchedCount, reconciled, plansResumed, results }));
  } else {
    console.log(`Scanned ${scanned} proposals.`);
    console.log(`Found ${matchedCount} matched child proposals (${matched.filter(p => p.status === "applied").length} applied, ${matched.filter(p => p.status === "failed").length} failed).`);
    console.log(`Reconciled ${reconciled} steps across ${new Set(results.filter(r => r.transitioned).map(r => r.planId)).size} plans.`);
    if (plansResumed.length) {
      console.log(`Resumed ${plansResumed.length} plan(s) (${plansResumed.join(", ")}).`);
    }
    console.log("");
    for (const r of results) {
      const icon = r.transitioned ? (r.newStepStatus === "completed" ? "✓" : "⚠") : "·";
      console.log(`  ${r.childProposalId.padEnd(10)} ${icon} ${r.summary}`);
    }
  }
}
```

- [ ] **Step 4: Wire into `executive.ts`**

Add dynamic import to `src/cli/commands/executive.ts`:

```typescript
case "orchestrate": {
  const { handleOrchestrateCommand } = await import(
    "./executive-orchestrate-handler.js"
  );
  return handleOrchestrateCommand(rest);
}
```

Update the `default` error message to include `"orchestrate"`:

```typescript
console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend, bridge, recommendation-effectiveness, subsystem-correlation, remediate, orchestrate");
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-orchestrate-cli.vitest.ts --config vitest.config.mts
```
Expected: All 8+ tests pass.

```bash
npx vitest run --config vitest.config.mts 2>&1 | tail -5
```
Expected: Full suite green.

```bash
npx tsc --noEmit 2>&1
```
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-orchestrate-handler.ts tests/cli/commands/executive-orchestrate-cli.vitest.ts src/cli/commands/executive.ts
git commit -m "P10.9.2c-T3: Recovery CLI — alix executive orchestrate

- handleOrchestrateCommand with --plan, --dry-run, --json flags
- Dry-run uses pure preview (no mutations)
- Effectful path uses reconcileChildProposal
- Deduplicates plansResumed (only plans with completed transitions)
- 8+ CLI integration tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Sentinel allowlist + full suite verification

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts`

- [ ] **Step 1: Add new files to EXECUTIVE_FILES**

In `tests/executive/executive-sentinels.vitest.ts`, add after the existing P10.9.2b entries:

```typescript
  // P10.9.2c files
  "src/executive/executive-orchestrator.ts",
  "src/cli/commands/executive-orchestrate-handler.ts",
```

- [ ] **Step 2: Run full suite**

```bash
npx vitest run --config vitest.config.mts 2>&1 | tail -15
```
Expected: Full suite green.

```bash
npx tsc --noEmit 2>&1
```
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "P10.9.2c-T4: Sentinel allowlist update + full suite verification

- Added executive-orchestrator.ts and CLI handler to EXECUTIVE_FILES
- Full test suite green, tsc clean

Co-Authored-By: Claude <noreply@anthropic.com>"
```
