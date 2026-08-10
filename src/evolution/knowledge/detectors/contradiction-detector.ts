// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Contradiction detector.
 *
 * Pure function over `KnowledgeArtifact[]`. Operates ONLY on
 * `KnowledgeArtifact.claim` — never free text, never semantic inference.
 * Artifacts without a `claim` produce no contradiction finding. Emits
 * "contradiction" findings:
 * - "value_clash": two non-evidence claims in the same (store, artifactKind,
 *   subject) cluster assert incompatible values for the same (subject,
 *   predicate) — the design spec §5 "same subject cluster" rule.
 * - "outcome_contradiction": a claim's value disagrees with an evidence
 *   artifact's claim for the same (subject, predicate). Evidence is a
 *   cross-store governance input, so this branch is not cluster-scoped.
 *
 * Pairwise findings are canonicalized (artifactId = larger id, targetId =
 * smaller id), so the finding is identical regardless of input order.
 *
 * Pure: no I/O, no store access, no mutation of its input.
 *
 * @module contradiction-detector
 */

import type { CurationFinding, KnowledgeArtifact } from "../contracts/curation-contract.js";
import { computeFindingId } from "./finding-id.js";
import {
  canonicalPair,
  claimsConflict,
  isEvidenceArtifact,
  sameCluster,
} from "./shared.js";

/**
 * Detect contradictory claims.
 *
 * @param artifacts Normalized read-model artifacts (adapters' output).
 * @returns Contradiction curation findings, deterministically ordered by findingId.
 */
export function detectContradictions(artifacts: KnowledgeArtifact[]): CurationFinding[] {
  const findings: CurationFinding[] = [];
  const now = Date.now();

  for (let i = 0; i < artifacts.length; i += 1) {
    for (let j = i + 1; j < artifacts.length; j += 1) {
      const a = artifacts[i];
      const b = artifacts[j];
      if (a.artifactId === b.artifactId) continue;
      if (!claimsConflict(a, b)) continue;

      const involvesEvidence = isEvidenceArtifact(a) || isEvidenceArtifact(b);
      // value_clash applies only within the same subject cluster (spec §5);
      // evidence-vs-evidence pairs are inherently cross-store and are only
      // meaningful as outcome contradictions.
      if (!involvesEvidence && !sameCluster(a, b)) continue;

      const { artifactId, targetId, primary, related } = canonicalPair(a, b);
      const evidenceRefs = involvesEvidence
        ? [...(isEvidenceArtifact(a) ? a : b).evidenceRefs]
        : [];

      findings.push({
        findingId: computeFindingId(primary.store, "contradiction", artifactId, targetId),
        kind: "contradiction",
        reasonCode: involvesEvidence ? "outcome_contradiction" : "value_clash",
        store: primary.store,
        artifactId,
        artifactKind: primary.artifactKind,
        targetId,
        severity: "high",
        rationale: involvesEvidence
          ? `Artifact ${artifactId}'s claim (${a.claim?.subject}/${a.claim?.predicate}=${a.claim?.value}) conflicts with observed evidence artifact ${targetId} (${related.claim?.value}).`
          : `Artifacts ${artifactId} and ${targetId} assert conflicting values for ${a.claim?.subject}/${a.claim?.predicate} (${a.claim?.value} vs ${b.claim?.value}).`,
        evidenceRefs,
        confidence: 0.9,
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  return findings.sort((x, y) => x.findingId.localeCompare(y.findingId));
}
