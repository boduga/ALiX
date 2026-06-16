/**
 * collaboration-evidence-quality.ts — Evidence source quality assessment.
 *
 * Scores evidence references based on source reliability.
 * Confidence (self-declared) and evidence quality (independently derived)
 * remain separate. Broken references incur a penalty.
 */

import type { EvidenceRef } from "./collaboration-types.js";
import type { SharedArtifact } from "./collaboration-types.js";

export type EvidenceQualityReport = {
  score: number;
  reasons: string[];
  verifiedCount: number;
  unresolvedCount: number;
};

/**
 * Assess the quality of evidence references for a finding.
 * Score is clamped 0–15. Broken references reduce the score.
 */
export function assessEvidenceQuality(
  evidenceRefs: EvidenceRef[],
  artifacts: SharedArtifact[],
): EvidenceQualityReport {
  let score = 0;
  const reasons: string[] = [];
  let verified = 0;
  let broken = 0;

  for (const ref of evidenceRefs) {
    if (ref.kind === "artifact" && artifacts.some(a => a.id === ref.artifactId && a.digest)) {
      score += 6; verified++; reasons.push("artifact with digest");
    } else if (ref.kind === "file" && ref.digest) {
      score += 7; verified++; reasons.push("file with digest");
    } else if (ref.kind === "worker_result") {
      score += 8; verified++; reasons.push("durable worker result");
    } else if (ref.kind === "event") {
      score += 3; verified++; reasons.push("event reference");
    } else if (ref.kind === "finding") {
      score += 2; verified++; reasons.push("finding reference");
    } else {
      score -= 3; broken++; reasons.push("broken evidence reference");
    }
  }

  return {
    score: Math.max(0, Math.min(15, score)),
    reasons,
    verifiedCount: verified,
    unresolvedCount: broken,
  };
}
