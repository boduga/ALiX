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
 * The ledger enumerates proposals via `listProposals()`; the adapter
 * projects every proposal's evidence when no explicit proposal list is
 * supplied, and only those proposals when one is. Expired evidence is
 * included via `listByProposal(proposalId, { includeExpired: true })`.
 *
 * Artifact mapping (design spec §3 "A5 evidence input"):
 * - VerificationEvidence → store: "evidence", artifactKind:
 *   "VerificationEvidence", content: JSON of metrics/deltas,
 *   evidenceRefs: [evidenceId], and a structured `claim` projected from
 *   the observed metric deltas ({ subject: metric, predicate: "delta",
 *   value: delta }) so the staleness/contradiction detectors'
 *   outcome_contradiction branch has a claim to compare (spec §5).
 *
 * @module evidence-adapter
 */

import type { VerificationEvidenceLedger } from "../../verification/evidence/evidence-ledger.js";
import type { VerificationEvidence } from "../../verification/contracts/verification-contract.js";
import type { KnowledgeArtifact } from "../contracts/curation-contract.js";
import { runAdapter, type AdapterResult } from "./shared.js";

function evidenceToArtifact(ev: VerificationEvidence): KnowledgeArtifact {
  // Structured claim from the observed metric deltas: lexicographically-first
  // metric (sorted for determinism), subject = metric name so it can match
  // artifact claims keyed on the same metric. Only where deltas exist.
  const deltas = Object.entries(ev.metricDeltas).sort(([a], [b]) => a.localeCompare(b));
  const claim =
    deltas.length > 0
      ? { subject: deltas[0][0], predicate: "delta", value: String(deltas[0][1]) }
      : undefined;

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
    ...(claim ? { claim } : {}),
  };
}

export class EvidenceAdapter {
  /**
   * @param ledger - The A5 verification evidence ledger to project.
   * @param proposalIds - Proposals whose evidence to project. Empty (the
   *   default) enumerates every proposal the ledger holds evidence for.
   */
  constructor(
    private readonly ledger: VerificationEvidenceLedger,
    private readonly proposalIds: readonly string[] = [],
  ) {}

  async read(): Promise<AdapterResult> {
    return runAdapter("evidence", async () => {
      const proposalIds =
        this.proposalIds.length > 0 ? this.proposalIds : await this.ledger.listProposals();
      const artifacts: KnowledgeArtifact[] = [];
      for (const proposalId of proposalIds) {
        const all = await this.ledger.listByProposal(proposalId, { includeExpired: true });
        for (const ev of all) {
          artifacts.push(evidenceToArtifact(ev));
        }
      }
      return artifacts;
    });
  }
}
