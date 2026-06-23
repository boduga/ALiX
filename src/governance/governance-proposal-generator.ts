/**
 * P9.2 — Advisory-to-proposal bridge.
 *
 * This is the SINGLE P9 file permitted to import ProposalStore. The
 * sentinel allowlist (ALLOWED_IN_FILE) enforces this. Even this file
 * is forbidden from importing ApprovalGate, any applier, or calling
 * approve/apply. The bridge creates pending proposals only; approval
 * and apply are P5-owned.
 *
 * Hard boundary:
 *   1. Explicit operator command (CLI only, not auto/scheduler)
 *   2. Eligibility gate (confidence + priority + status)
 *   3. Idempotency (one recommendation -> at most one proposal)
 *   4. Atomicity (case A or B: both succeed, or proposal is orphaned)
 */

import { join } from "node:path";
import type { GovernanceRecommendation, Recommendation } from "./governance-types.js";
import type { GovernanceChangePayload } from "./governance-types.js";
import { GovernanceStore } from "./governance-store.js";
import { ProposalStore } from "../adaptation/proposal-store.js";
import { EvidenceChainStore } from "../learning/evidence-chain-store.js";
import type { ProvenanceLink } from "../learning/evidence-chain-types.js";

const MIN_PROPOSAL_CONFIDENCE = 0.6;

export type CreateProposalResult =
  | { ok: true; proposalId: string }
  | { ok: false; reason: string };

function isEligible(rec: Recommendation): { eligible: true } | { eligible: false; reason: string } {
  if (rec.confidence < MIN_PROPOSAL_CONFIDENCE) {
    return { eligible: false, reason: `confidence ${rec.confidence.toFixed(2)} is below threshold ${MIN_PROPOSAL_CONFIDENCE.toFixed(2)}` };
  }
  if (rec.priority === "low") {
    return { eligible: false, reason: `priority "${rec.priority}" is not eligible for proposal` };
  }
  // Status gate is fail-closed: ONLY "open" is eligible.
  if (rec.status !== "open") {
    return { eligible: false, reason: `status "${rec.status}" is not eligible for proposal (only "open" recommendations may become proposals)` };
  }
  return { eligible: true };
}

function recommendationToPayload(rec: Recommendation): GovernanceChangePayload {
  // 1:1 projection: { kind: category, ...rest }
  const { category, ...rest } = rec.metadata;
  return { kind: category, ...rest } as GovernanceChangePayload;
}

export async function createGovernanceProposal(opts: {
  recommendationId: string;
  cwd?: string;
  generatedAt?: string;
  proposalStore?: ProposalStore;
  chainStore?: EvidenceChainStore;
  govStore?: GovernanceStore;
}): Promise<CreateProposalResult> {
  const effectiveGovStore = opts.govStore ?? new GovernanceStore();
  const effectivePropStore = opts.proposalStore ?? new ProposalStore(join(opts.cwd ?? process.cwd(), ".alix", "adaptation", "proposals"));
  const effectiveChainStore = opts.chainStore ?? new EvidenceChainStore();
  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  // 1. Load inner recommendation + containing report
  const found = await effectiveGovStore.findRecommendationById(opts.recommendationId);
  if (!found) {
    return { ok: false, reason: `Recommendation not found: ${opts.recommendationId}` };
  }
  const { rec, parent } = found;

  // 2. Eligibility gate
  const gate = isEligible(rec);
  if (!gate.eligible) {
    return { ok: false, reason: gate.reason };
  }

  // 3. Idempotency check — has this recommendation already been proposed?
  const existingChains = await effectiveChainStore.getChainForRoot(opts.recommendationId);
  for (const chain of existingChains) {
    for (const link of chain.links) {
      if (link.relationship === "proposal_from_recommendation") {
        return {
          ok: false,
          reason: `Recommendation ${opts.recommendationId} has already been proposed as ${link.sourceArtifactId}.`
        };
      }
    }
  }

  // 4. Build the proposal
  const proposalId = `prop-${generatedAt.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const proposal = {
    id: proposalId,
    createdAt: generatedAt,
    status: "pending" as const,
    action: "governance_change" as const,
    target: { kind: "governance" as const, recommendationId: opts.recommendationId },
    payload: {
      ...recommendationToPayload(rec),
      _provenance: {
        parentRecommendationId: opts.recommendationId,
        parentRecommendationReportId: parent.id,
        sourceArtifactIds: rec.evidenceRefs ?? [],
        recommendationCategory: rec.category
      }
    },
    sourceRecommendationType: "governance_recommendation",
    sourceConfidence: rec.confidence,
    evidenceFingerprints: [opts.recommendationId, ...(rec.evidenceRefs ?? [])],
    reason: rec.description,
    provenance: "manual" as const
  };

  // 5. Persist proposal + EvidenceChain link with atomicity recovery
  try {
    await effectivePropStore.save(proposal as any);

    const link: ProvenanceLink = {
      sourceArtifactId: proposalId,
      sourceArtifactType: "adaptation_proposal",
      targetArtifactId: opts.recommendationId,
      targetArtifactType: "recommendation",
      relationship: "proposal_from_recommendation",
      recordedAt: generatedAt
    };

    const chain = {
      id: `chain-${proposalId}`,
      subject: "GovernanceProposal provenance",
      outcome: "linked" as const,
      confidence: rec.confidence,
      reasons: ["P9.2 bridge: recommendation -> proposal"],
      generatedAt,
      evidenceRefs: [proposalId, opts.recommendationId, parent.id],
      rootArtifactId: opts.recommendationId,
      rootArtifactType: "recommendation" as const,
      links: [link],
      depth: 1
    };

    try {
      await effectiveChainStore.appendChain(chain);
    } catch (edgeError) {
      // Compensating tombstone: case (B)
      await effectivePropStore.markOrphaned(proposalId, `EvidenceChain write failed: ${(edgeError as Error).message}`);
      return { ok: false, reason: `Proposal ${proposalId} created but provenance chain failed: ${(edgeError as Error).message}. Proposal marked orphaned.` };
    }
  } catch (createError) {
    return { ok: false, reason: `Failed to create proposal: ${(createError as Error).message}` };
  }

  return { ok: true, proposalId };
}
