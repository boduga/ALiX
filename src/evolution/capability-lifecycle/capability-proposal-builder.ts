// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { CapabilityLifecycleCandidate } from "./contracts/lifecycle-contract.js";
import type {
  EvidenceReference,
  EvolutionIntent,
  EvolutionProposal,
} from "../contracts/evolution-contract.js";

export interface CapabilityProposalArtifacts {
  candidate: CapabilityLifecycleCandidate;
  intent: EvolutionIntent;
  proposal: EvolutionProposal;
}

/**
 * Build A0 EvolutionIntent + EvolutionProposal artifacts from lifecycle
 * candidates. Deterministic: identical candidates → identical ids. Empty
 * candidates → empty array (zero-candidate invariant, spec §4.7 analog).
 *
 * A7.0 proposals target `{ kind: "capability", id }`, carry `riskClass: "low"`
 * (A7.0 mutates nothing), and reference P5.5 + A5/A6 evidence by id.
 */
export function buildCapabilityProposals(
  candidates: CapabilityLifecycleCandidate[],
  signalEvidenceRefs: EvidenceReference[] = [],
): CapabilityProposalArtifacts[] {
  return candidates.map((candidate) => {
    const seed = `${candidate.target.capabilityId}|${candidate.intent}`;
    const evolutionId = `evol-a7-${hash16(`evol|${seed}`)}`;
    const proposalId = `prop-a7-${hash16(`prop|${seed}`)}`;

    const rationale: EvidenceReference[] = [
      ...signalEvidenceRefs,
      ...candidate.evidenceRefs.map((id) => ({ evidenceId: id, source: "a7" })),
    ];

    const intent: EvolutionIntent = {
      evolutionId,
      origin: "governance_signal",
      target: { kind: "capability", id: candidate.target.capabilityId },
      rationale,
      expectedEffect: `Capability lifecycle: ${candidate.intent} ${candidate.target.capabilityId}`,
      riskClass: "low",
      constraints: [],
      createdAt: new Date().toISOString(),
    };

    const proposal: EvolutionProposal = {
      proposalId,
      evolutionId,
      title: `${candidate.intent} capability ${candidate.target.capabilityId}`,
      description: candidate.rationale.join("; "),
      change: `${candidate.intent}: ${candidate.target.capabilityId} → ${candidate.proposedLifecycleState}`,
      beforeHash: null,
      afterHash: null,
      createdAt: new Date().toISOString(),
    };

    return { candidate, intent, proposal };
  });
}

function hash16(input: string): string {
  const hash = createHash("sha256");
  hash.update(input, "utf-8");
  return hash.digest("hex").slice(0, 16);
}
