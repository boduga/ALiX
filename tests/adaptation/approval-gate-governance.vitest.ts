/**
 * P9.3 — ApprovalGate governance criteria tests.
 *
 * Tests the governance gating logic added to ApprovalGate.approve().
 * Verifies: non-governance proposals are unaffected, governance_change
 * proposals go through criteria check, denial is recorded without state
 * change, decision is recorded BEFORE status transition (fail-closed),
 * and descriptive errors are thrown on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { ApprovalGate } from "../../src/adaptation/approval-gate.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGovernanceProposal(
  overrides: Partial<AdaptationProposal> = {},
): AdaptationProposal {
  return {
    id: "prop-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "pending",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-001" },
    payload: {},
    sourceRecommendationType: "governance",
    sourceConfidence: 0.9,
    evidenceFingerprints: [],
    reason: "governance improvement",
    ...overrides,
  };
}

function makeNonGovernanceProposal(
  overrides: Partial<AdaptationProposal> = {},
): AdaptationProposal {
  return {
    id: "prop-non-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "pending",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "test.agent" },
    payload: {},
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.9,
    evidenceFingerprints: [],
    reason: "capability gap",
    ...overrides,
  };
}

function makeApprovedProposal(proposal: AdaptationProposal): AdaptationProposal {
  return {
    ...proposal,
    status: "approved",
    approvedBy: "alice",
    approvedAt: new Date().toISOString(),
  };
}

/** Create a mock EvidenceEventWriter with the methods ApprovalGate calls. */
function makeMockWriter(overrides: {
  recordGovernanceApprovalDenied?: ReturnType<typeof vi.fn>;
  recordGovernanceApprovalDecision?: ReturnType<typeof vi.fn>;
  recordAdaptationApproved?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    recordGovernanceApprovalDenied:
      overrides.recordGovernanceApprovalDenied ??
      vi.fn().mockResolvedValue({ id: "evt-denied", type: "governance_approval_denied" }),
    recordGovernanceApprovalDecision:
      overrides.recordGovernanceApprovalDecision ??
      vi.fn().mockResolvedValue({ id: "evt-decision", type: "governance_approval_decision" }),
    recordAdaptationApproved:
      overrides.recordAdaptationApproved ??
      vi.fn().mockResolvedValue({ id: "evt-approved", type: "adaptation_approved" }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalGate governance criteria", () => {
  // -------------------------------------------------------------------------
  // Test 1: Non-governance proposals skip criteria
  // -------------------------------------------------------------------------

  it("approves non-governance proposal without calling governance criteria", async () => {
    const proposal = makeNonGovernanceProposal();
    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue(makeApprovedProposal(proposal)),
    };
    const mockWriter = makeMockWriter();
    const mockCriteria = vi.fn();

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria as any,
    );

    const updated = await gate.approve(proposal.id, "alice");

    // Criteria must NOT be called for non-governance proposals
    expect(mockCriteria).not.toHaveBeenCalled();

    // Normal approval flow still works
    expect(updated.status).toBe("approved");
    expect(mockStore.update).toHaveBeenCalledWith(proposal.id, {
      status: "approved",
      approvedBy: "alice",
      approvedAt: expect.any(String),
    });
    expect(mockWriter.recordAdaptationApproved).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: Governance proposal that fails criteria throws
  // -------------------------------------------------------------------------

  it("rejects governance proposal that fails criteria", async () => {
    const proposal = makeGovernanceProposal();
    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue(makeApprovedProposal(proposal)),
    };
    const mockWriter = makeMockWriter();
    const mockCriteria = vi.fn().mockResolvedValue({
      passed: false,
      failedCriterion: "source recommendation confidence is below threshold",
      integrityScore: 42,
    });

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria,
    );

    await expect(gate.approve(proposal.id, "alice")).rejects.toThrow(
      /Governance approval denied/,
    );

    // Criteria was called with the proposal
    expect(mockCriteria).toHaveBeenCalledWith(proposal);

    // Proposal status must NOT change
    expect(mockStore.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: Denial evidence recorded on criteria failure
  // -------------------------------------------------------------------------

  it("records governance_approval_denied on criteria failure", async () => {
    const proposal = makeGovernanceProposal();
    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue(makeApprovedProposal(proposal)),
    };
    const mockWriter = makeMockWriter();
    const mockCriteria = vi.fn().mockResolvedValue({
      passed: false,
      failedCriterion: "explanation integrity score is below threshold",
      integrityScore: 30,
    });

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria,
    );

    await expect(gate.approve(proposal.id, "alice")).rejects.toThrow();

    // Denial evidence must be recorded
    expect(mockWriter.recordGovernanceApprovalDenied).toHaveBeenCalledWith(
      proposal.id,
      {
        criterion: "explanation integrity score is below threshold",
        integrityScore: 30,
        threshold: 60,
      },
    );

    // Decision must NOT be recorded (only denial)
    expect(mockWriter.recordGovernanceApprovalDecision).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: Governance proposal that passes criteria is approved
  // -------------------------------------------------------------------------

  it("approves governance proposal that passes criteria", async () => {
    const proposal = makeGovernanceProposal();
    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue(makeApprovedProposal(proposal)),
    };
    const mockWriter = makeMockWriter();
    const mockCriteria = vi.fn().mockResolvedValue({
      passed: true,
      integrityScore: 85,
    });

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria,
    );

    const updated = await gate.approve(proposal.id, "alice");

    expect(updated.status).toBe("approved");
    expect(updated.approvedBy).toBe("alice");

    // Criteria was called
    expect(mockCriteria).toHaveBeenCalledWith(proposal);

    // Decision evidence recorded
    expect(mockWriter.recordGovernanceApprovalDecision).toHaveBeenCalledWith(
      proposal.id,
      { integrityScore: 85, threshold: 60, passed: true },
    );

    // Normal approval evidence still recorded
    expect(mockWriter.recordAdaptationApproved).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: Decision recorded BEFORE status transition
  // -------------------------------------------------------------------------

  it("records governance_approval_decision before status transition", async () => {
    const proposal = makeGovernanceProposal();
    const callOrder: string[] = [];

    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockImplementation(async () => {
        callOrder.push("store.update");
        return makeApprovedProposal(proposal);
      }),
    };
    const mockWriter = {
      recordGovernanceApprovalDenied: vi.fn().mockResolvedValue({}),
      recordGovernanceApprovalDecision: vi.fn().mockImplementation(async () => {
        callOrder.push("recordGovernanceApprovalDecision");
        return { id: "evt-decision" };
      }),
      recordAdaptationApproved: vi.fn().mockImplementation(async () => {
        callOrder.push("recordAdaptationApproved");
        return { id: "evt-approved" };
      }),
    };
    const mockCriteria = vi.fn().mockResolvedValue({
      passed: true,
      integrityScore: 90,
    });

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria,
    );

    await gate.approve(proposal.id, "alice");

    // Decision recording must come before store update
    const decisionIdx = callOrder.indexOf("recordGovernanceApprovalDecision");
    const updateIdx = callOrder.indexOf("store.update");
    expect(decisionIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(decisionIdx).toBeLessThan(updateIdx);
  });

  // -------------------------------------------------------------------------
  // Test 6: Fail-closed when decision recording fails
  // -------------------------------------------------------------------------

  it("proposal stays pending when governance_approval_decision recording fails", async () => {
    const proposal = makeGovernanceProposal();
    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue(makeApprovedProposal(proposal)),
    };
    const mockWriter = makeMockWriter({
      recordGovernanceApprovalDecision: vi.fn().mockResolvedValue(null), // recording fails
    });
    const mockCriteria = vi.fn().mockResolvedValue({
      passed: true,
      integrityScore: 75,
    });

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria,
    );

    await expect(gate.approve(proposal.id, "alice")).rejects.toThrow(
      /unable to record governance_approval_decision/,
    );

    // Criteria was called
    expect(mockCriteria).toHaveBeenCalled();

    // Decision recording was attempted
    expect(mockWriter.recordGovernanceApprovalDecision).toHaveBeenCalled();

    // Store update must NOT have been called — fail-closed
    expect(mockStore.update).not.toHaveBeenCalled();

    // Approval evidence must NOT be recorded
    expect(mockWriter.recordAdaptationApproved).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: Descriptive error on governance criteria failure with integrity score
  // -------------------------------------------------------------------------

  it("throws descriptive error on governance criteria failure with integrity score", async () => {
    const proposal = makeGovernanceProposal();
    const mockStore = {
      load: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue(makeApprovedProposal(proposal)),
    };
    const mockWriter = makeMockWriter();
    const mockCriteria = vi.fn().mockResolvedValue({
      passed: false,
      failedCriterion: "proposal is orphaned",
      integrityScore: 0,
    });

    const gate = new ApprovalGate(
      mockStore as any,
      mockWriter as any,
      mockCriteria,
    );

    await expect(gate.approve(proposal.id, "alice")).rejects.toThrow(
      /Governance approval denied: proposal is orphaned \(integrityScore: 0\)/,
    );
  });
});
