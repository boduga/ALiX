/**
 * P10.9.2a — Proposal State Machine & Readiness: unit tests.
 *
 * Tests the pure derivation layer (computeProposalReadiness + getApplySupport)
 * against the decision table in the SDS.
 */
import { describe, it, expect } from "vitest";
import {
  computeProposalReadiness,
  getApplySupport,
  type ProposalReadinessInfo,
} from "../../src/adaptation/proposal-readiness.js";
import type {
  AdaptationProposal,
  ProposalTarget,
} from "../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Minimal inline factory — avoids importing the full type
// ---------------------------------------------------------------------------

function makeProposal(
  overrides: Partial<AdaptationProposal> = {},
): AdaptationProposal {
  return {
    id: "test-prop",
    createdAt: "2026-06-29T12:00:00.000Z",
    status: "pending",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "agent-x" },
    payload: {},
    sourceRecommendationType: "test",
    sourceConfidence: 0.8,
    evidenceFingerprints: [],
    reason: "test",
    ...overrides,
  } as AdaptationProposal;
}

// ---------------------------------------------------------------------------
// Decision table tests
// ---------------------------------------------------------------------------

describe("computeProposalReadiness — decision table", () => {
  it("pending + agent_card → readiness: needs_approval, applyable: false", () => {
    const p = makeProposal({ status: "pending" });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("pending");
    expect(r.readiness).toBe("needs_approval");
    expect(r.applyable).toBe(false);
    expect(r.nextAction).toContain("approve");
  });

  it("approved + agent_card → readiness: ready_to_apply, applyable: true", () => {
    const p = makeProposal({ status: "approved" });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("approved");
    expect(r.readiness).toBe("ready_to_apply");
    expect(r.applyable).toBe(true);
    expect(r.nextAction).toContain("apply");
  });

  it("approved + executive_remediation + requiresHumanSpecification → needs_specification, applyable: false", () => {
    const p = makeProposal({
      status: "approved",
      target: {
        kind: "executive_remediation",
        planId: "plan-1",
        stepId: "step-1",
        objectiveId: "obj-1",
        subsystem: "adaptation",
      },
      payload: { requiresHumanSpecification: true },
    });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("approved");
    expect(r.readiness).toBe("needs_specification");
    expect(r.applyable).toBe(false);
    expect(r.nextAction).toContain("remediate");
    expect(r.blocker).toBeTruthy();
  });

  it("approved + capability → readiness: manual_action, applyable: false", () => {
    const p = makeProposal({
      status: "approved",
      target: { kind: "capability", capability: "test-cap" },
    });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("approved");
    expect(r.readiness).toBe("manual_action");
    expect(r.applyable).toBe(false);
    expect(r.blocker).toContain("manual action");
  });

  it("approved + learning → readiness: blocked, applyable: false", () => {
    const p = makeProposal({
      status: "approved",
      target: { kind: "learning", area: "recommendation" },
    });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("approved");
    expect(r.readiness).toBe("blocked");
    expect(r.applyable).toBe(false);
    expect(r.blocker).toBeTruthy();
  });

  it("applied → readiness: completed, applyable: false, nextAction includes 'effectiveness'", () => {
    const p = makeProposal({ status: "applied" });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("applied");
    expect(r.readiness).toBe("completed");
    expect(r.applyable).toBe(false);
    expect(r.nextAction).toContain("effectiveness");
  });

  it("rejected → readiness: completed, applyable: false, nextAction includes 'No further action'", () => {
    const p = makeProposal({ status: "rejected" });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("rejected");
    expect(r.readiness).toBe("completed");
    expect(r.applyable).toBe(false);
    expect(r.nextAction).toContain("No further action");
  });

  it("failed → readiness: completed, applyable: false, nextAction includes 'Inspect failure'", () => {
    const p = makeProposal({ status: "failed" });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("failed");
    expect(r.readiness).toBe("completed");
    expect(r.applyable).toBe(false);
    expect(r.nextAction).toContain("Inspect failure");
  });
});

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

describe("computeProposalReadiness — edge cases", () => {
  it("pending + executive_remediation + requiresHumanSpecification → needs_approval (approval gate first)", () => {
    const p = makeProposal({
      status: "pending",
      target: {
        kind: "executive_remediation",
        planId: "plan-1",
        stepId: "step-1",
        objectiveId: "obj-1",
        subsystem: "adaptation",
      },
      payload: { requiresHumanSpecification: true },
    });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("pending");
    expect(r.readiness).toBe("needs_approval");
    expect(r.applyable).toBe(false);
    // Approval gate comes first, not needs_specification
    expect(r.nextAction).toContain("approve");
  });

  it("approved + executive_remediation + no requiresHumanSpecification → blocked (safe default)", () => {
    const p = makeProposal({
      status: "approved",
      target: {
        kind: "executive_remediation",
        planId: "plan-1",
        stepId: "step-1",
        objectiveId: "obj-1",
        subsystem: "adaptation",
      },
      payload: {},
    });
    const r = computeProposalReadiness(p);
    expect(r.status).toBe("approved");
    expect(r.readiness).toBe("blocked");
    expect(r.applyable).toBe(false);
    expect(r.blocker).toBeTruthy();
  });

  it("approved + issue → readiness: manual_action (manual kind even though no applier)", () => {
    const p = makeProposal({
      status: "approved",
      target: { kind: "issue", title: "test-issue" },
    });
    const r = computeProposalReadiness(p);
    expect(r.readiness).toBe("manual_action");
    expect(r.applyable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getApplySupport tests
// ---------------------------------------------------------------------------

describe("getApplySupport", () => {
  it("returns registered_applier for agent_card targets", () => {
    const p = makeProposal({ target: { kind: "agent_card", id: "x" } });
    expect(getApplySupport(p)).toEqual({
      supported: true,
      kind: "registered_applier",
    });
  });

  it("returns registered_applier for skill targets", () => {
    const p = makeProposal({ target: { kind: "skill", id: "x" } });
    expect(getApplySupport(p)).toEqual({
      supported: true,
      kind: "registered_applier",
    });
  });

  it("returns registered_applier for revert targets", () => {
    const p = makeProposal({
      target: { kind: "revert", sourceProposalId: "x" },
    });
    expect(getApplySupport(p)).toEqual({
      supported: true,
      kind: "registered_applier",
    });
  });

  it("returns registered_applier for governance targets", () => {
    const p = makeProposal({
      target: { kind: "governance", recommendationId: "x" },
    });
    expect(getApplySupport(p)).toEqual({
      supported: true,
      kind: "registered_applier",
    });
  });

  it("returns unsupported for executive_remediation with nextCommand", () => {
    const p = makeProposal({
      target: {
        kind: "executive_remediation",
        planId: "plan-1",
        stepId: "step-1",
        objectiveId: "obj-1",
        subsystem: "adaptation",
      },
    });
    const s = getApplySupport(p);
    expect(s.supported).toBe(false);
    expect(s.kind).toBe("unsupported");
    expect(s.nextCommand).toContain("remediate");
  });

  it("returns unsupported for learning with deferred reason", () => {
    const p = makeProposal({
      target: { kind: "learning", area: "recommendation" },
    });
    const s = getApplySupport(p);
    expect(s.supported).toBe(false);
    expect(s.kind).toBe("unsupported");
    expect(s.reason).toContain("deferred");
  });
});
