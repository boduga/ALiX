/**
 * P8.5 — ProposalFactory: converts a LearningProposal into an AdaptationProposal.
 *
 * Lives in the CLI layer (NOT src/learning/). This is the ONLY bridge from
 * learning data to the proposal lifecycle. Per the P8 governance boundary:
 *   - Instantiated only in the CLI `propose` command
 *   - Never imported by any src/learning/ module (sentinel-enforced)
 *   - The resulting proposal is always "pending", always requires approval
 *   - There is NO applier for learning_adjustment in P8 — calibration
 *     application is deferred to P8.9/P9
 *
 * @module
 */

import type { AdaptationProposal, LearningArea } from "../adaptation/adaptation-types.js";
import type {
  CalibrationProfile,
  LearningProposal,
  LearningProposalType,
} from "../learning/learning-types.js";

// ---------------------------------------------------------------------------
// ProposalFactory
// ---------------------------------------------------------------------------

export class ProposalFactory {
  /**
   * Convert a LearningProposal into a pending AdaptationProposal.
   *
   * The result always has:
   *   - action: "learning_adjustment"
   *   - target: { kind: "learning", area }
   *   - status: "pending" (never auto-approved)
   *   - requiresApproval: true (always — the type enforces this via LearningProposal)
   *   - payload: the calibration profiles + source signal IDs
   */
  toAdaptationProposal(learning: LearningProposal): AdaptationProposal {
    const area = areaFromProposalType(learning.proposalType);

    return {
      id: learning.id,
      createdAt: learning.generatedAt,
      status: "pending",
      action: "learning_adjustment",
      target: { kind: "learning", area },
      payload: {
        profiles: learning.profiles,
        sourceSignalIds: learning.sourceSignalIds,
        expectedBenefit: learning.expectedBenefit,
        riskEstimate: learning.riskEstimate,
      },
      sourceRecommendationType: "learning_calibration",
      sourceConfidence: learning.confidence,
      evidenceFingerprints: learning.evidenceRefs ?? [],
      reason: learning.subject,
      provenance: "manual",
      // ponytail: no approved/applied/error fields — they're optional and only
      // set by the approval gate / applier. No snapshot data — there is no
      // applier in P8, so nothing is snapshotted.
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function areaFromProposalType(
  proposalType: LearningProposalType,
): LearningArea {
  switch (proposalType) {
    case "recommendation_calibration":
      return "recommendation";
    case "risk_calibration":
      return "risk";
    case "governance_calibration":
      return "governance";
    case "routing_calibration":
      return "routing";
  }
}

/**
 * Build a LearningProposal from calibration profiles, ready for the factory.
 * Convenience helper used by the CLI propose command.
 */
export function buildLearningProposal(
  proposalType: LearningProposalType,
  profiles: CalibrationProfile[],
  generatedAt: string,
): LearningProposal {
  const sourceSignalIds = [
    ...new Set(profiles.flatMap((p) => p.sourceSignalIds)),
  ];

  return {
    id: `prop-learning-${Date.now()}`,
    subject: `Learning calibration: ${proposalType}`,
    outcome: "pending_learning",
    confidence:
      profiles.length > 0
        ? profiles.reduce((s, p) => s + p.confidence, 0) / profiles.length
        : 0,
    reasons: profiles.map((p) => p.reason),
    generatedAt,
    proposalType,
    profiles,
    expectedBenefit: `${profiles.length} calibration adjustment(s) suggested`,
    riskEstimate: "Low — all changes require human approval before application",
    sourceSignalIds,
    requiresApproval: true,
  };
}
