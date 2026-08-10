// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type {
  CapabilityLifecycleCandidate,
  CapabilityLifecycleEventType,
  CapabilityLifecycleRecord,
} from "./contracts/lifecycle-contract.js";
import type { GovernanceRecommendation } from "../verification/contracts/recommendation-contract.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import {
  computeEvidenceIntegrityHash,
  createVerificationEvidence,
} from "../verification/evidence/verification-evidence.js";
import {
  generateDecision,
} from "../governance/decision-engine.js";
import type {
  GovernanceDecision,
  GovernanceDecisionKind,
  GovernancePolicyConfig,
} from "../governance/contracts/decision-contract.js";

/**
 * A7 — Capability Governance Bridge (A7 → A3).
 *
 * Mirrors the A6 curation bridge: builds a `VerificationEvidence`
 * (reproducibilityLevel 2, deterministic evidenceId over the candidate,
 * recomputed integrity hash) and an A2.5 `GovernanceRecommendation` referencing
 * the SAME evidence, then calls A3 `generateDecision`. A7 proposes; A3 decides.
 * No A7-specific recommendation shape (spec §7).
 */

export interface CapabilityGovernanceOutcome {
  evidence: VerificationEvidence;
  recommendation: GovernanceRecommendation;
  decision: GovernanceDecision;
}

export function buildCapabilityEvidence(
  candidate: CapabilityLifecycleCandidate,
  proposalId: string,
): VerificationEvidence {
  const evidence = createVerificationEvidence({
    verificationId: `a7-capability-${candidate.target.capabilityId}`,
    proposalId,
    replayDatasetId: "a7-capability",
    proposalSnapshotHash: "a7",
    environmentHash: "a7",
    baselineMetrics: {},
    candidateMetrics: {},
    metricDeltas: {},
    behavioralChanges: candidate.rationale,
    confidenceProfile: {
      replayFidelity: candidate.confidence,
      coverage: candidate.confidence,
      determinism: candidate.confidence,
      historicalSimilarity: 1,
      overallConfidence: candidate.confidence,
    },
    reproducibilityLevel: 2, // lowest value passing A3's minReproducibilityLevel gate
    lineage: [],
    verifiedAt: new Date().toISOString(),
  });

  const evidenceId = `a7-ev-${hash16(`a7-ev|${candidate.target.capabilityId}|${candidate.intent}`)}`;
  const stable: Omit<VerificationEvidence, "integrityHash"> = { ...evidence, evidenceId };
  return { ...stable, integrityHash: computeEvidenceIntegrityHash(stable) };
}

export function buildCapabilityRecommendation(
  candidate: CapabilityLifecycleCandidate,
  proposalId: string,
  evidence: VerificationEvidence,
): GovernanceRecommendation {
  return {
    recommendationId: `rec-a7-${proposalId}`,
    evidenceId: evidence.evidenceId,
    proposalId,
    kind: "APPROVE", // A7 proposes; A3 decides
    confidence: evidence.confidenceProfile.overallConfidence,
    reasoning: candidate.rationale.join("; "),
    supportingEvidence: candidate.evidenceRefs,
    risks: candidate.rationale,
    createdAt: new Date().toISOString(),
  };
}

export function runCapabilityGovernance(
  candidate: CapabilityLifecycleCandidate,
  proposalId: string,
  options?: {
    policyConfig?: GovernancePolicyConfig;
    generateDecision?: typeof generateDecision;
  },
): CapabilityGovernanceOutcome {
  const evidence = buildCapabilityEvidence(candidate, proposalId);
  const recommendation = buildCapabilityRecommendation(candidate, proposalId, evidence);
  const decide = options?.generateDecision ?? generateDecision;
  const decision = decide(evidence, recommendation, { policyConfig: options?.policyConfig });
  return { evidence, recommendation, decision };
}

/**
 * Map a bridge phase + outcome into a ledger record (spec §5.2 semantics).
 * `decided` records carry decisionId + decisionKind; `proposed` carry
 * proposalId; `intent` carry neither. Never sets executionId/measurementId.
 */
export function toLedgerRecord(
  phase: CapabilityLifecycleEventType,
  candidate: CapabilityLifecycleCandidate,
  options: { proposalId?: string; outcome?: CapabilityGovernanceOutcome } = {},
): Omit<CapabilityLifecycleRecord, "recordId"> {
  const record: Omit<CapabilityLifecycleRecord, "recordId"> = {
    target: { ...candidate.target },
    intent: candidate.intent,
    eventType: phase,
    timestamp: new Date().toISOString(),
    evidenceRefs: [...candidate.evidenceRefs],
    observedLifecycleState: candidate.observedLifecycleState,
    proposedLifecycleState: candidate.proposedLifecycleState,
  };
  if (phase === "proposed" || phase === "decided") {
    record.proposalId = options.proposalId;
  }
  if (phase === "decided" && options.outcome) {
    record.decisionId = options.outcome.decision.decisionId;
    record.decisionKind = options.outcome.decision.kind as GovernanceDecisionKind;
  }
  return record;
}

function hash16(input: string): string {
  const hash = createHash("sha256");
  hash.update(input, "utf-8");
  return hash.digest("hex").slice(0, 16);
}
