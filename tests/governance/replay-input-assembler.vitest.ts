/**
 * P23.1 — Replay Input Assembler tests.
 *
 * Tests that the assembler:
 * - normalizes records from allowed P17–P22 sources
 * - handles missing optional records gracefully
 * - preserves source ids
 * - never mutates input objects
 * - sorts deterministically
 * - produces deterministic output for same inputs
 */

import { describe, it, expect } from "vitest";

import { assembleReplayDataset } from "../../src/governance/replay/replay-input-assembler.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { WorkbenchLifecycleTrace } from "../../src/governance/governance-workbench.js";
import type { ExecutionReadinessAssessment } from "../../src/governance/execution-readiness.js";
import type { HandoffPackage } from "../../src/governance/handoff-builder.js";
import type { HumanExecutionEvidenceRef, HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";
import type { HandoffIntelligenceRef } from "../../src/governance/handoff-intelligence-types.js";
import type { HandoffQualitySignal } from "../../src/governance/handoff-quality-signals.js";
import type { ReadinessCalibrationSignal } from "../../src/governance/handoff-readiness-calibration.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function approval(overrides: Partial<GovernanceExecutionApproval> = {}): GovernanceExecutionApproval {
  return {
    approvalId: "appr-1",
    planId: "plan-1",
    remediationId: "rem-1",
    decision: "approved",
    rationale: "Approved after review",
    operatorId: "op-1",
    createdAt: VALID_ISO,
    approvedActionIds: ["act-1", "act-2"],
    auditRefs: [],
    ...overrides,
  };
}

function lifecycleTrace(overrides: Partial<WorkbenchLifecycleTrace> = {}): WorkbenchLifecycleTrace {
  return {
    remediationId: "rem-1",
    hops: [
      { kind: "signal", id: "sig-1", status: "completed", summary: "Signal received", timestamp: VALID_ISO, gap: false },
      { kind: "approval", id: "appr-1", status: "approved", summary: "Approved", timestamp: VALID_ISO, gap: false },
    ],
    ...overrides,
  };
}

function readinessAssessment(overrides: Partial<ExecutionReadinessAssessment> = {}): ExecutionReadinessAssessment {
  return {
    assessmentId: "ra-1",
    planId: "plan-1",
    remediationId: "rem-1",
    approvalId: "appr-1",
    readinessLevel: "dry_run_capable",
    facts: {
      approvedActionCount: 2,
      mutationRequired: true,
      reversible: true,
      externalSideEffect: false,
      rollbackPlanPresent: true,
      rollbackCoverageComplete: true,
      simulatorCoverageComplete: true,
    },
    reasons: [
      { code: "reversible_mutation", actionIds: ["act-1"], summary: "Changes are reversible" },
    ],
    assessedAt: VALID_ISO,
    ...overrides,
  };
}

function handoffPackage(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    remediationId: "rem-1",
    approvalId: "appr-1",
    assessmentId: "ra-1",
    simulationId: "sim-1",
    decisionId: "dec-1",
    disposition: "manual_only",
    title: "Update config",
    summary: "Manual config update",
    actions: [
      {
        actionId: "act-1",
        kind: "update_config",
        description: "Update",
        target: { type: "config", id: "cfg-1" },
        expectedEffect: "Updated",
        operatorInstructions: ["Run command"],
        rollbackProcedure: "Revert",
        evidenceRequired: true,
      },
    ],
    evidence: [{ ref: "log_ref", label: "Log output", required: true }],
    operatorInstructions: ["Step 1", "Step 2"],
    riskNotes: ["Low risk"],
    rollbackSummary: ["Revert if needed"],
    status: "pending",
    generatedAt: VALID_ISO,
    evidenceCaptured: false,
    explicitlyManualOnly: true,
    ...overrides,
  };
}

function closureReview(overrides: Partial<HumanExecutionClosureReview> = {}): HumanExecutionClosureReview {
  return {
    closureReviewId: "cr-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    decision: "accepted",
    rationale: "All evidence submitted",
    reviewedBy: "rev-1",
    reviewedAt: VALID_ISO,
    evidenceIds: ["ev-1"],
    followUpRequired: false,
    followUpSummary: null,
    auditRefs: [],
    ...overrides,
  };
}

function intelligenceRef(overrides: Partial<HandoffIntelligenceRef> = {}): HandoffIntelligenceRef {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    handoffType: "config_update",
    createdAt: VALID_ISO,
    readinessLevel: "dry_run_capable",
    requiredEvidenceKinds: ["log_ref"],
    ...overrides,
  };
}

function qualitySignal(overrides: Partial<HandoffQualitySignal> = {}): HandoffQualitySignal {
  return {
    signalCode: "evidence_gap",
    handoffId: "ho-1",
    severity: "warning",
    summary: "Missing required evidence",
    details: { missingRefs: ["manual_verification_note"] },
    detectedAt: VALID_ISO,
    ...overrides,
  };
}

function calibrationSignal(overrides: Partial<ReadinessCalibrationSignal> = {}): ReadinessCalibrationSignal {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    readinessLevel: "dry_run_capable",
    closureDecision: "accepted",
    calibration: "accurate",
    evidenceComplete: true,
    evidenceCount: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replay-input-assembler", () => {
  it("assembles records from all allowed sources", () => {
    const dataset = assembleReplayDataset("lifecycle-1", {
      approvals: [approval()],
      lifecycleTraces: [lifecycleTrace()],
      readinessAssessments: [readinessAssessment()],
      handoffs: [handoffPackage()],
      closureReviews: [closureReview()],
      closureIntelligenceRefs: [intelligenceRef()],
      qualitySignals: [qualitySignal()],
      calibrationSignals: [calibrationSignal()],
    });

    expect(dataset.sourceLifecycleId).toBe("lifecycle-1");
    expect(dataset.approvals).toHaveLength(1);
    expect(dataset.lifecycleTraces).toHaveLength(1);
    expect(dataset.readinessProjections).toHaveLength(1);
    expect(dataset.handoffs).toHaveLength(1);
    expect(dataset.closureReviews).toHaveLength(1);
    expect(dataset.closureIntelligence).toHaveLength(1);
    expect(dataset.sourceSummary.approvalCount).toBe(1);
    expect(dataset.sourceSummary.lifecycleTraceCount).toBe(1);
    expect(dataset.sourceSummary.readinessProjectionCount).toBe(1);
    expect(dataset.sourceSummary.handoffCount).toBe(1);
    expect(dataset.sourceSummary.closureReviewCount).toBe(1);
    expect(dataset.sourceSummary.closureIntelligenceCount).toBe(1);
  });

  it("handles missing optional records gracefully", () => {
    const dataset = assembleReplayDataset("lifecycle-2", {});

    expect(dataset.sourceLifecycleId).toBe("lifecycle-2");
    expect(dataset.approvals).toHaveLength(0);
    expect(dataset.lifecycleTraces).toHaveLength(0);
    expect(dataset.readinessProjections).toHaveLength(0);
    expect(dataset.handoffs).toHaveLength(0);
    expect(dataset.closureReviews).toHaveLength(0);
    expect(dataset.closureIntelligence).toHaveLength(0);
    expect(dataset.sourceSummary.approvalCount).toBe(0);
    expect(dataset.sourceSummary.handoffCount).toBe(0);
  });

  it("preserves source ids in normalized records", () => {
    const dataset = assembleReplayDataset("lifecycle-3", {
      approvals: [approval({ approvalId: "appr-x" })],
      readinessAssessments: [readinessAssessment({ assessmentId: "ra-x" })],
      handoffs: [handoffPackage({ handoffId: "ho-x" })],
      closureReviews: [closureReview({ closureReviewId: "cr-x" })],
      closureIntelligenceRefs: [intelligenceRef({ handoffId: "ho-x" })],
    });

    expect(dataset.approvals[0].approvalId).toBe("appr-x");
    expect(dataset.readinessProjections[0].assessmentId).toBe("ra-x");
    expect(dataset.handoffs[0].handoffId).toBe("ho-x");
    expect(dataset.closureReviews[0].closureReviewId).toBe("cr-x");
    expect(dataset.closureIntelligence[0].handoffId).toBe("ho-x");
  });

  it("does not mutate input objects", () => {
    const appr: GovernanceExecutionApproval = approval({ createdAt: VALID_ISO });
    const originalCreatedAt = appr.createdAt;
    const originalActionIds = [...appr.approvedActionIds];

    assembleReplayDataset("lifecycle-4", { approvals: [appr] });

    expect(appr.createdAt).toBe(originalCreatedAt);
    expect([...appr.approvedActionIds]).toEqual(originalActionIds);
  });

  it("sorts records deterministically by timestamp then id", () => {
    const a1 = approval({ approvalId: "a1", createdAt: "2026-07-01T00:00:00.000Z" });
    const a2 = approval({ approvalId: "a2", createdAt: "2026-07-02T00:00:00.000Z" });
    const a3 = approval({ approvalId: "a3", createdAt: "2026-07-01T00:00:00.000Z" }); // same ts as a1

    const dataset = assembleReplayDataset("lifecycle-5", {
      approvals: [a2, a1, a3],
    });

    expect(dataset.approvals[0].approvalId).toBe("a1");
    expect(dataset.approvals[1].approvalId).toBe("a3");
    expect(dataset.approvals[2].approvalId).toBe("a2");
  });

  it("produces deterministic output for same inputs (idempotent)", () => {
    const inputs = {
      approvals: [
        approval({ approvalId: "a1" }),
        approval({ approvalId: "a2", createdAt: "2026-07-02T00:00:00.000Z" }),
      ],
      handoffs: [handoffPackage({ handoffId: "h1" })],
      closureReviews: [closureReview({ closureReviewId: "c1" })],
    };

    const a = assembleReplayDataset("lifecycle-6", inputs, { now: VALID_ISO });
    const b = assembleReplayDataset("lifecycle-6", inputs, { now: VALID_ISO });

    expect(a.replayId).toBe(b.replayId);
    expect(a.approvals).toHaveLength(b.approvals.length);
    expect(a.approvals[0].approvalId).toBe(b.approvals[0].approvalId);
    expect(a.approvals[1].approvalId).toBe(b.approvals[1].approvalId);
    expect(a.handoffs[0].handoffId).toBe(b.handoffs[0].handoffId);
    expect(a.closureReviews[0].closureReviewId).toBe(b.closureReviews[0].closureReviewId);
  });

  it("assembles closure intelligence with matching quality signals", () => {
    const dataset = assembleReplayDataset("lifecycle-7", {
      closureIntelligenceRefs: [intelligenceRef({ handoffId: "ho-1" })],
      qualitySignals: [
        qualitySignal({ handoffId: "ho-1", signalCode: "evidence_gap" }),
        qualitySignal({ handoffId: "ho-1", signalCode: "slow_closure" }),
        qualitySignal({ handoffId: "ho-other", signalCode: "follow_up_needed" }),
      ],
      calibrationSignals: [calibrationSignal({ handoffId: "ho-1" })],
    });

    expect(dataset.closureIntelligence).toHaveLength(1);
    expect(dataset.closureIntelligence[0].qualitySignals).toHaveLength(2);
    expect(dataset.closureIntelligence[0].qualitySignals[0].code).toBe("evidence_gap");
    expect(dataset.closureIntelligence[0].qualitySignals[1].code).toBe("slow_closure");
    expect(dataset.closureIntelligence[0].calibrationSignal).not.toBeNull();
    expect(dataset.closureIntelligence[0].calibrationSignal!.calibration).toBe("accurate");
  });

  it("handles empty dataset gracefully", () => {
    const dataset = assembleReplayDataset("lifecycle-empty", {});

    expect(dataset.replayId).toHaveLength(16);
    expect(dataset.sourceLifecycleId).toBe("lifecycle-empty");
    expect(dataset.assembledAt.length).toBeGreaterThan(0);
    expect(dataset.sourceSummary.approvalCount).toBe(0);
    expect(dataset.sourceSummary.lifecycleTraceCount).toBe(0);
    expect(dataset.sourceSummary.readinessProjectionCount).toBe(0);
    expect(dataset.sourceSummary.handoffCount).toBe(0);
    expect(dataset.sourceSummary.closureReviewCount).toBe(0);
    expect(dataset.sourceSummary.closureIntelligenceCount).toBe(0);
    expect(dataset.sourceSummary.sourceLifecycleIds).toEqual([]);
  });

  it("generates deterministic replay id from lifecycle id and timestamp", () => {
    const a = assembleReplayDataset("lc-1", {}, { now: VALID_ISO });
    const b = assembleReplayDataset("lc-1", {}, { now: VALID_ISO });
    const c = assembleReplayDataset("lc-2", {}, { now: VALID_ISO });

    expect(a.replayId).toBe(b.replayId);
    expect(a.replayId).not.toBe(c.replayId);
  });

  it("returns frozen (readonly) datasets and sub-objects", () => {
    const dataset = assembleReplayDataset("lifecycle-ro", {
      approvals: [approval()],
      handoffs: [handoffPackage()],
    });

    expect(Object.isFrozen(dataset.approvals)).toBe(true);
    expect(Object.isFrozen(dataset.handoffs)).toBe(true);
    expect(Object.isFrozen(dataset.approvals[0].approvedActionIds)).toBe(true);
  });

  it("normalizes readiness assessment facts into simplified form", () => {
    const dataset = assembleReplayDataset("lifecycle-facts", {
      readinessAssessments: [readinessAssessment()],
    });

    const record = dataset.readinessProjections[0];
    expect(record.readinessLevel).toBe("dry_run_capable");
    expect(record.facts.mutationRequired).toBe(true);
    expect(record.facts.reversible).toBe(true);
    expect(record.facts.rollbackPlanPresent).toBe(true);
    expect(record.reasonCodes).toHaveLength(1);
    expect(record.reasonCodes[0]).toBe("reversible_mutation");
  });
});
