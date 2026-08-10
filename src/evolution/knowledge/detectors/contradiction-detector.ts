// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Contradiction detector.
 *
 * Pure function over `KnowledgeArtifact[]`. Operates ONLY on
 * `KnowledgeArtifact.claim` — never free text, never semantic inference.
 * Artifacts without a `claim` produce no contradiction finding. Emits
 * "contradiction" findings:
 * - "value_clash": two non-evidence claims assert incompatible values for the
 *   same (subject, predicate).
 * - "outcome_contradiction": a claim's value disagrees with an evidence
 *   artifact's claim for the same (subject, predicate).
 *
 * Pairwise findings are canonicalized like dedup (artifactId = larger id,
 * targetId = smaller id), so the finding is identical regardless of input
 * order.
 *
 * Pure: no I/O, no store access, no mutation of its input.
 *
 * @module contradiction-detector
 */

import type {
  CurationFinding,
  KnowledgeArtifact,
} from "../contracts/curation-contract.js";
import { computeFindingId } from "./finding-id.js";

function canonicalPair(
  a: KnowledgeArtifact,
  b: KnowledgeArtifact,
): { artifactId: string; targetId: string; primary: KnowledgeArtifact; related: KnowledgeArtifact } {
  if (a.artifactId < b.artifactId) {
    return { artifactId: b.artifactId, targetId: a.artifactId, primary: b, related: a };
  }
  return { artifactId: a.artifactId, targetId: b.artifactId, primary: a, related: b };
}

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
      if (!a.claim || !b.claim) continue;
      if (a.claim.subject !== b.claim.subject) continue;
      if (a.claim.predicate !== b.claim.predicate) continue;
      if (a.claim.value === b.claim.value) continue;

      const involvesEvidence = a.store === "evidence" || b.store === "evidence";
      const { artifactId, targetId, primary, related } = canonicalPair(a, b);
      const evidenceRefs = involvesEvidence
        ? [...(a.store === "evidence" ? a : b).evidenceRefs]
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
          ? `Artifact ${artifactId}'s claim (${a.claim.subject}/${a.claim.predicate}=${a.claim.value}) conflicts with observed evidence artifact ${targetId} (${related.claim?.value}).`
          : `Artifacts ${artifactId} and ${targetId} assert conflicting values for ${a.claim.subject}/${a.claim.predicate} (${a.claim.value} vs ${b.claim.value}).`,
        evidenceRefs,
        confidence: 0.9,
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  return findings.sort((x, y) => x.findingId.localeCompare(y.findingId));
}
