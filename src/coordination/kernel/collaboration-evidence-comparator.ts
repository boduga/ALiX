/**
 * collaboration-evidence-comparator.ts — Conflict-specific evidence comparison.
 *
 * Reuses M0.78e freshness/evidence helpers without calling RelevanceScorer.
 * Scores findings on freshness, evidence quality, confidence, source attempt,
 * result provenance, and artifact integrity.
 */

import type { SharedFinding } from "./collaboration-types.js";
import type { EvidenceComparison, EvidenceComparisonRanking } from "./collaboration-conflict-types.js";
import { computeRecencyScore, type Clock } from "./collaboration-freshness.js";
import { assessEvidenceQuality } from "./collaboration-evidence-quality.js";

export class ConflictEvidenceComparator {
  constructor(private clock: Clock) {}

  compare(findings: SharedFinding[]): EvidenceComparison {
    const ranking: EvidenceComparisonRanking[] = findings.map(f => {
      const freshness = computeRecencyScore(f.createdAt, this.clock);
      const eq = assessEvidenceQuality(f.evidenceRefs ?? [], []);
      const confidence = f.confidence ? Math.round(f.confidence * 10) : 0;
      const sourceAttempt = f.workerAttempt !== undefined ? Math.min(f.workerAttempt, 10) : 0;
      const resultProvenance = f.evidenceRefs?.some(r => r.kind === "worker_result") ? 15 : 0;
      const artifactIntegrity = f.evidenceRefs?.some(r => r.kind === "file" && r.digest) ? 15 : f.evidenceRefs?.some(r => r.kind === "artifact") ? 8 : 0;

      const score = Math.min(100, freshness + eq.score + confidence + sourceAttempt + resultProvenance + artifactIntegrity);

      const reasons: string[] = [...eq.reasons];
      if (freshness > 5) reasons.push("recent");
      if (resultProvenance > 0) reasons.push("durable result");
      if (artifactIntegrity > 10) reasons.push("verified artifact");

      return { findingId: f.id, score, components: { freshness, evidenceQuality: eq.score, confidence, sourceAttempt, resultProvenance, artifactIntegrity }, reasons };
    });

    ranking.sort((a, b) => b.score - a.score);

    const topScore = ranking[0]?.score ?? 0;
    const scoreMargin = ranking.length > 1 ? ranking[0].score - ranking[1].score : 0;
    const hasStrong = ranking.filter(r => r.score >= topScore * 0.8);
    const confidence = hasStrong.length === 1 ? "high" : hasStrong.length > 1 ? "low" : "medium";
    const recommendation = confidence === "high" ? "prefer_stronger_evidence" : "human_review";

    return { ranking, confidence, scoreMargin, recommendation, unresolvedReasons: [] };
  }
}
