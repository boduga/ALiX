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
    sourceRecommendationType: "orchestrator_test",
    sourceConfidence: 0,
    evidenceFingerprints: [],
    reason: "test child proposal",
  } as unknown as AdaptationProposal;
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

// ── Test group 1: extractChildLineage ────────────────────────────────────────

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

// ── Test group 2: computeStepTransition ──────────────────────────────────────

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

// ── Test group 3: planChildReconciliation (pure preview) ─────────────────────

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

// ── Test group 4: orchestrationSequence ──────────────────────────────────────

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

// ── Test group 5: ExecutiveOrchestrator class ────────────────────────────────

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
