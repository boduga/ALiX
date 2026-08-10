// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Curation Proposal Builder (A6 → A3 mapping).
 *
 * Transforms A6 curation findings into the two inputs A3 governance consumes:
 * a `VerificationEvidence` wrapping the finding evidenceRefs + rationale, and
 * the **A2.5** `GovernanceRecommendation` shape (`recommendation-contract.ts`),
 * NOT the P9.x `governance-types.ts` DecisionArtifact shape.
 *
 * BOUNDARY: A6 is the curation PROPOSER, A3 remains the governance authority.
 *   - The recommendation is always `kind: "APPROVE"` — A6 proposes a bounded
 *     curation action; A3 decides.
 *   - Zero findings → `buildCurationProposal` returns `null` — no proposal,
 *     no evidence, no A3 call (design spec §4.7 zero-findings invariant).
 *
 * Aggregated confidence is the mean of the finding confidences (the codebase
 * convention shared by observation-evidence-bridge and
 * governance-recommendation-generator).
 *
 * Determinism: `createVerificationEvidence` mints a random evidenceId, which
 * would break the A6→A3 round-trip (the recommendation must reference the SAME
 * evidence built from the same findings). The builder overrides the evidenceId
 * with a deterministic hash of the finding set and recomputes the integrity
 * hash so evidence remains self-verifying.
 *
 * @module curation-proposal-builder
 */

import { createHash } from "node:crypto";
import type {
  CurationFinding,
  CurationFindingKind,
  CurationProposal,
} from "./contracts/curation-contract.js";
import type { GovernanceRecommendation } from "../verification/contracts/recommendation-contract.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import {
  computeEvidenceIntegrityHash,
  createVerificationEvidence,
} from "../verification/evidence/verification-evidence.js";

// ---------------------------------------------------------------------------
// buildCurationProposal
// ---------------------------------------------------------------------------

/**
 * Aggregate a non-empty finding list into a `CurationProposal`.
 *
 * @param findings Curation findings (must be non-empty).
 * @returns A `CurationProposal`, or `null` when findings is empty
 *          (zero-findings invariant — an empty proposal must never reach A3).
 */
export function buildCurationProposal(
  findings: CurationFinding[],
): CurationProposal | null {
  if (findings.length === 0) return null;

  return {
    proposalId: computeCurationProposalId(findings),
    findings: [...findings],
    summary: buildSummary(findings),
    dimension: uniqueKinds(findings),
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// buildEvidenceFromFindings
// ---------------------------------------------------------------------------

/**
 * Wrap finding evidenceRefs + rationale into a `VerificationEvidence`.
 *
 * Uses `createVerificationEvidence` with `reproducibilityLevel: 2` — the
 * lowest value passing A3's gate (`DEFAULT_GOVERNANCE_POLICY.minReproducibilityLevel`,
 * verified in the Task 1 contract-verification checkpoint). The evidence
 * `proposalId` is the first finding's artifactId per the A6 contract.
 *
 * @param findings Curation findings (must be non-empty).
 * @returns A `VerificationEvidence` with `evidenceClass: "projected"`.
 * @throws If findings is empty — evidence cannot exist without findings.
 */
export function buildEvidenceFromFindings(
  findings: CurationFinding[],
): VerificationEvidence {
  if (findings.length === 0) {
    throw new Error("buildEvidenceFromFindings requires at least one finding");
  }

  const artifactId = findings[0].artifactId;
  const aggregated = aggregateConfidence(findings);

  const evidence = createVerificationEvidence({
    verificationId: `a6-curation-${artifactId}`,
    proposalId: artifactId,
    replayDatasetId: "a6-curation",
    proposalSnapshotHash: "a6",
    environmentHash: "a6",
    baselineMetrics: {},
    candidateMetrics: {},
    metricDeltas: {},
    behavioralChanges: findings.map((f) => f.rationale),
    // ConfidenceProfile sub-fields: replay/coverage/determinism carry the
    // aggregated curation confidence; historicalSimilarity is 1 (curation
    // evidence has no historical baseline), so the confidence-formula
    // invariant holds exactly: min(a, a, a) * 1 === overallConfidence.
    confidenceProfile: {
      replayFidelity: aggregated,
      coverage: aggregated,
      determinism: aggregated,
      historicalSimilarity: 1,
      overallConfidence: aggregated,
    },
    reproducibilityLevel: 2, // lowest value passing A3's minReproducibilityLevel gate
    lineage: [],
    verifiedAt: new Date().toISOString(),
  });

  // createVerificationEvidence mints a random evidenceId. Override it with a
  // deterministic id over the finding set so buildGovernanceRecommendation and
  // buildEvidenceFromFindings agree on the same evidenceId for the same
  // findings (the A6→A3 round-trip), then recompute the integrity hash so the
  // evidence remains self-verifying.
  const evidenceId = computeCurationEvidenceId(findings);
  const stable: Omit<VerificationEvidence, "integrityHash"> = {
    ...evidence,
    evidenceId,
  };

  return {
    ...stable,
    integrityHash: computeEvidenceIntegrityHash(stable),
  };
}

// ---------------------------------------------------------------------------
// buildGovernanceRecommendation
// ---------------------------------------------------------------------------

/**
 * Build the A2.5 `GovernanceRecommendation` that A3 `generateDecision` consumes.
 *
 * A6 proposes a bounded curation action (`kind: "APPROVE"`); A3 remains
 * authoritative. The recommendation references the same evidence built by
 * `buildEvidenceFromFindings` so the evidenceId round-trips. An already-built
 * evidence may be passed in to avoid a redundant (deterministic) rebuild.
 *
 * @param proposal A non-empty `CurationProposal`.
 * @param evidence Prebuilt evidence for the same findings (optional — built
 *   here when omitted).
 * @returns The A2.5 recommendation shape.
 */
export function buildGovernanceRecommendation(
  proposal: CurationProposal,
  evidence?: VerificationEvidence,
): GovernanceRecommendation {
  const ev = evidence ?? buildEvidenceFromFindings(proposal.findings);

  return {
    recommendationId: `rec-curate-${proposal.proposalId}`,
    evidenceId: ev.evidenceId,
    proposalId: ev.proposalId,
    kind: "APPROVE", // A6 proposes; A3 decides
    confidence: ev.confidenceProfile.overallConfidence,
    reasoning: proposal.summary,
    supportingEvidence: proposal.findings.flatMap((f) => f.evidenceRefs),
    risks: proposal.findings.map((f) => f.rationale),
    createdAt: proposal.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Mean of the finding confidences — the aggregated finding confidence. */
function aggregateConfidence(findings: CurationFinding[]): number {
  if (findings.length === 0) return 0;
  return findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length;
}

/** One-line summary: "N stale, M duplicate, ..." in first-seen kind order. */
function buildSummary(findings: CurationFinding[]): string {
  const counts = new Map<CurationFindingKind, number>();
  for (const f of findings) {
    counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, n]) => `${n} ${kind}`)
    .join(", ");
}

/** Unique finding kinds in first-seen order. */
function uniqueKinds(findings: CurationFinding[]): CurationFindingKind[] {
  const seen = new Set<CurationFindingKind>();
  const out: CurationFindingKind[] = [];
  for (const f of findings) {
    if (!seen.has(f.kind)) {
      seen.add(f.kind);
      out.push(f.kind);
    }
  }
  return out;
}

/** Deterministic proposalId — content-addressed over the sorted finding set. */
function computeCurationProposalId(findings: CurationFinding[]): string {
  const hash = createHash("sha256");
  hash.update(`a6-proposal|${sortedFindingKeys(findings)}`, "utf-8");
  return `cur-${hash.digest("hex").slice(0, 16)}`;
}

/** Deterministic evidenceId — content-addressed over the sorted finding set. */
function computeCurationEvidenceId(findings: CurationFinding[]): string {
  const hash = createHash("sha256");
  hash.update(`a6-curation|${sortedFindingKeys(findings)}`, "utf-8");
  return `cur-ev-${hash.digest("hex").slice(0, 16)}`;
}

/** Canonical key over the sorted finding ids (order-independent). */
function sortedFindingKeys(findings: CurationFinding[]): string {
  return findings
    .map((f) => f.findingId)
    .sort()
    .join("|");
}
