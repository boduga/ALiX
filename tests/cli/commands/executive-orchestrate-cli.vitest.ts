/**
 * P10.9.2c-T3 — Executive Orchestrate CLI integration tests.
 *
 * 8+ tests covering:
 *   1. No remediated proposals → "No remediated child proposals found."
 *   2. Reconciles applied child → step transitions to completed
 *   3. Reconciles failed child → step becomes blocked
 *   4. --dry-run → no mutations, prints preview
 *   5. --json → valid JSON output
 *   6. --plan filter → only proposals linked to that plan
 *   7. Already reconciled → step already completed, idempotent no-op
 *   8. Non-remediated proposal ignored → source !== "executive_remediate"
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import type { ReconcileResult } from "../../../src/executive/executive-orchestrator.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";
import type { PlanExecutionState } from "../../../src/executive/executive-plan-types.js";

// ---------------------------------------------------------------------------
// Module-level mock control variables
//
// These MUST be declared with `let` (not `const`) because vi.mock factory
// closures are hoisted above the module body — `let` hoists to undefined
// (no TDZ in this context), while `const` stays in the temporal dead zone.
// ---------------------------------------------------------------------------

let mockList: any;
let mockStateLoad: any;
let mockReconcileChildProposal: any;

// PlanStore/ExecutionEngine/StepRunner/EvidenceEventWriter need only exist
// for the non-dry-run construction path; they are passed to the mocked
// reconcileChildProposal and never invoked directly by the test handler.
vi.mock("../../../src/executive/plan-store.js", () => ({
  PlanStore: class {
    constructor() { /* noop for mock */ }
  },
}));
vi.mock("../../../src/executive/step-runner.js", () => ({
  StepRunner: class {
    constructor() { /* noop for mock */ }
  },
}));
vi.mock("../../../src/executive/execution-engine.js", () => ({
  ExecutionEngine: class {
    constructor() { /* noop for mock */ }
    runReadySteps = vi.fn();
  },
}));
vi.mock("../../../src/workflow/evidence-writer.js", () => ({
  EvidenceEventWriter: class {
    constructor() { /* noop for mock */ }
  },
}));

vi.mock("../../../src/adaptation/proposal-store.js", () => ({
  ProposalStore: class {
    list = mockList;
  },
}));

vi.mock("../../../src/executive/execution-state-store.js", () => ({
  ExecutionStateStore: class {
    load = mockStateLoad;
  },
}));

vi.mock("../../../src/executive/executive-orchestrator.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/executive/executive-orchestrator.js")
  >("../../../src/executive/executive-orchestrator.js");
  return {
    ...actual,
    // Deferred wrapper: mockReconcileChildProposal is assigned in beforeEach,
    // but vi.mock factories run before let-initializers.  The closure over
    // the variable via a call-time function body avoids the TDZ issue.
    reconcileChildProposal: (...args: any[]) => mockReconcileChildProposal(...args),
  };
});

import { handleOrchestrateCommand } from "../../../src/cli/commands/executive-orchestrate-handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChildProposal(
  overrides: Partial<AdaptationProposal> & { id: string },
): AdaptationProposal {
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

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  return {
    out: () => out,
    err: () => err,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

function makeRunningState(): PlanExecutionState {
  return {
    planId: "plan-1",
    status: "running",
    approval: { status: "approved" },
    stepStates: {
      "step-1": {
        status: "waiting_for_bridge",
        evidenceIds: [],
        generatedArtifacts: [],
        warnings: [],
      },
    },
    planTransitions: [],
    timestamps: { createdAt: "2026-06-30T00:00:00.000Z" },
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const completedResult: ReconcileResult = {
  childProposalId: "prop-orchestrate-001",
  planId: "plan-1",
  stepId: "step-1",
  transitioned: true,
  newStepStatus: "completed",
  summary: "Step step-1 → completed for child prop-orchestrate-001 (applied)",
};

const blockedResult: ReconcileResult = {
  childProposalId: "prop-orchestrate-002",
  planId: "plan-1",
  stepId: "step-1",
  transitioned: true,
  newStepStatus: "blocked",
  summary: "Step step-1 → blocked for child prop-orchestrate-002 (failed)",
};

const noopResult: ReconcileResult = {
  childProposalId: "prop-already-done",
  planId: "plan-1",
  stepId: "step-1",
  transitioned: false,
  newStepStatus: undefined,
  summary: "Step step-1 status is \"completed\" — no transition needed",
};

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-9-2c-t3-"));
  // Create the .alix/executive/plans dir so the handler constructs stateStore
  // (ExecutionStateStore uses the plans directory — state files are stored
  // as <planId>-state.json alongside plan files)
  mkdirSync(join(tempRoot, ".alix", "executive", "plans"), { recursive: true });

  // Re-initialize mocks per test
  mockList = vi.fn();
  mockStateLoad = vi.fn();
  mockReconcileChildProposal = vi.fn();
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive orchestrate CLI", () => {
  // -----------------------------------------------------------------------
  // 1. No remediated proposals
  // -----------------------------------------------------------------------
  it("no remediated proposals: prints empty message", async () => {
    // Return proposals that have no executive_remediate lineage
    const irrelevant: AdaptationProposal = makeChildProposal({
      id: "prop-other",
      payload: { source: "reflection", planId: "plan-1", stepId: "step-1" },
    });
    mockList.mockResolvedValue([irrelevant]);

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand([]);
    expect(c.out().join("\n")).toMatch(/No remediated child proposals found\./i);
    expect(mockReconcileChildProposal).not.toHaveBeenCalled();
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 2. Reconciles applied child
  // -----------------------------------------------------------------------
  it("reconciles an applied child proposal", async () => {
    const child = makeChildProposal({
      id: "prop-orchestrate-001",
      status: "applied",
    });
    mockList.mockResolvedValue([child]);
    mockReconcileChildProposal.mockResolvedValue(completedResult);
    mockStateLoad.mockReturnValue(makeRunningState());

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand([]);
    const output = c.out().join("\n");
    expect(output).toMatch(/Scanned 1 proposals/);
    expect(output).toMatch(/prop-orchestrate-001/);
    expect(output).toMatch(/completed/);
    expect(mockReconcileChildProposal).toHaveBeenCalledTimes(1);
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 3. Reconciles failed child
  // -----------------------------------------------------------------------
  it("reconciles a failed child proposal", async () => {
    const child = makeChildProposal({
      id: "prop-orchestrate-002",
      status: "failed",
    });
    mockList.mockResolvedValue([child]);
    mockReconcileChildProposal.mockResolvedValue(blockedResult);
    mockStateLoad.mockReturnValue(makeRunningState());

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand([]);
    const output = c.out().join("\n");
    expect(output).toMatch(/blocked/);
    expect(mockReconcileChildProposal).toHaveBeenCalledTimes(1);
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 4. --dry-run: no mutations, prints preview
  // -----------------------------------------------------------------------
  it("--dry-run: no mutations, prints preview", async () => {
    const child = makeChildProposal({
      id: "prop-dry-run",
      status: "applied",
    });
    mockList.mockResolvedValue([child]);
    // planChildReconciliation is NOT mocked — it runs pure logic.
    // Provide a real state so reconciliation produces a preview.
    mockStateLoad.mockReturnValue(makeRunningState());

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand(["--dry-run"]);

    const output = c.out().join("\n");
    expect(output).toMatch(/dry-run/i);
    // reconcileChildProposal must NOT be called in dry-run mode
    expect(mockReconcileChildProposal).not.toHaveBeenCalled();
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 5. --json: valid JSON output
  // -----------------------------------------------------------------------
  it("--json: produces valid JSON output", async () => {
    const child = makeChildProposal({
      id: "prop-json-001",
      status: "applied",
    });
    mockList.mockResolvedValue([child]);
    mockReconcileChildProposal.mockResolvedValue(completedResult);
    mockStateLoad.mockReturnValue(makeRunningState());

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed).toHaveProperty("scanned", 1);
    expect(parsed).toHaveProperty("matched", 1);
    expect(parsed).toHaveProperty("reconciled", 1);
    expect(parsed).toHaveProperty("plansResumed");
    expect(parsed).toHaveProperty("results");
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].transitioned).toBe(true);
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 6. --plan filter
  // -----------------------------------------------------------------------
  it("--plan filter: only reconciles proposals linked to that plan", async () => {
    const plan1Child = makeChildProposal({
      id: "prop-plan1",
      payload: {
        source: "executive_remediate",
        planId: "plan-1",
        stepId: "step-1",
        parentProposalId: "prop-007",
      },
    });
    const plan2Child = makeChildProposal({
      id: "prop-plan2",
      payload: {
        source: "executive_remediate",
        planId: "plan-2",
        stepId: "step-1",
        parentProposalId: "prop-008",
      },
    });
    mockList.mockResolvedValue([plan1Child, plan2Child]);
    mockReconcileChildProposal.mockResolvedValue(completedResult);
    mockStateLoad.mockReturnValue(makeRunningState());

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand(["--plan", "plan-1", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.scanned).toBe(1); // only plan-1's proposal after filter
    expect(parsed.matched).toBe(1);
    expect(mockReconcileChildProposal).toHaveBeenCalledTimes(1);
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 7. Already reconciled (idempotent no-op)
  // -----------------------------------------------------------------------
  it("already reconciled step: idempotent no-op", async () => {
    const child = makeChildProposal({
      id: "prop-already-done",
      status: "applied",
    });
    mockList.mockResolvedValue([child]);
    mockReconcileChildProposal.mockResolvedValue(noopResult);
    mockStateLoad.mockReturnValue({
      planId: "plan-1",
      status: "running",
      approval: { status: "approved" },
      stepStates: {
        "step-1": {
          status: "completed",
          completedAt: "2026-06-30T01:00:00.000Z",
          evidenceIds: [],
          generatedArtifacts: [],
          warnings: [],
        },
      },
      planTransitions: [],
      timestamps: { createdAt: "2026-06-30T00:00:00.000Z" },
    });

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.reconciled).toBe(0); // no new transitions
    expect(parsed.results[0].transitioned).toBe(false);
    cwdSpy.mockRestore();
    c.restore();
  });

  // -----------------------------------------------------------------------
  // 8. Non-remediated proposal ignored
  // -----------------------------------------------------------------------
  it("non-remediated proposal: ignored", async () => {
    const nonRemediated = makeChildProposal({
      id: "prop-reflection",
      payload: { source: "reflection" },
    });
    mockList.mockResolvedValue([nonRemediated]);

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleOrchestrateCommand([]);
    expect(c.out().join("\n")).toMatch(/No remediated child proposals found\./i);
    expect(mockReconcileChildProposal).not.toHaveBeenCalled();
    cwdSpy.mockRestore();
    c.restore();
  });
});
