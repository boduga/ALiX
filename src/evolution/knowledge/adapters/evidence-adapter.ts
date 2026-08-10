// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — A5 evidence adapter.
 *
 * Read-only projection of A5 VerificationEvidence (from the
 * VerificationEvidenceLedger) into the normalized KnowledgeArtifact
 * read model so the staleness and contradiction detectors receive it as
 * pure input. Never writes; on a ledger read throw it returns an
 * "unavailable" status with no artifacts.
 *
 * The ledger exposes no "list all" API (only listByProposal /
 * listExpired, and listExpired returns IDs that get() rejects), so the
 * adapter enumerates evidence by the proposal IDs passed to the
 * constructor. Expired evidence is included via
 * `listByProposal(proposalId, { includeExpired: true })`.
 *
 * Artifact mapping (design spec §3 "A5 evidence input"):
 * - VerificationEvidence → store: "evidence", artifactKind:
 *   "VerificationEvidence", content: JSON of metrics/deltas,
 *   evidenceRefs: [evidenceId]
 *
 * @module evidence-adapter
 */

import type { VerificationEvidenceLedger } from "../../verification/evidence/evidence-ledger.js";
import type { VerificationEvidence } from "../../verification/contracts/verification-contract.js";
import type { KnowledgeArtifact } from "../contracts/curation-contract.js";
import type { AdapterResult } from "./shared.js";

function evidenceToArtifact(ev: VerificationEvidence): KnowledgeArtifact {
  return {
    store: "evidence",
    artifactId: ev.evidenceId,
    artifactKind: "VerificationEvidence",
    subject: ev.proposalId,
    content: JSON.stringify({
      baselineMetrics: ev.baselineMetrics,
      candidateMetrics: ev.candidateMetrics,
      metricDeltas: ev.metricDeltas,
      behavioralChanges: ev.behavioralChanges,
    }),
    createdAt: ev.verifiedAt,
    evidenceRefs: [ev.evidenceId],
    downstreamRefs: [],
  };
}

export class EvidenceAdapter {
  /**
   * @param ledger - The A5 verification evidence ledger to project.
   * @param proposalIds - Proposals whose evidence to project. Empty by
   *   default because the ledger cannot enumerate proposals itself.
   */
  constructor(
    private readonly ledger: VerificationEvidenceLedger,
    private readonly proposalIds: readonly string[] = [],
  ) {}

  async read(): Promise<AdapterResult> {
    try {
      const artifacts: KnowledgeArtifact[] = [];
      for (const proposalId of this.proposalIds) {
        const all = await this.ledger.listByProposal(proposalId, { includeExpired: true });
        for (const ev of all) {
          artifacts.push(evidenceToArtifact(ev));
        }
      }
      return { artifacts, status: { status: "available", store: "evidence" } };
    } catch (err) {
      return {
        artifacts: [],
        status: { status: "unavailable", store: "evidence", reason: (err as Error).message ?? String(err) },
      };
    }
  }
}
