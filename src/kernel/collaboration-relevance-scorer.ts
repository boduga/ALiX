/**
 * collaboration-relevance-scorer.ts — Deterministic relevance scoring for findings.
 *
 * Scores are computed from dependency relationship, tag overlap, confidence,
 * recency, and evidence quality. Clamped to 0-100. Tie-breaks are stable.
 * Subscription scoring is reserved (zero until implemented).
 */

import type { RelevanceScore } from "./collaboration-relevance-types.js";
import type { SharedFinding } from "./collaboration-types.js";
import type { WorkerAssignment } from "./coordination-types.js";
import { computeRecencyScore, type Clock } from "./collaboration-freshness.js";
import { assessEvidenceQuality } from "./collaboration-evidence-quality.js";

export class RelevanceScorer {
  constructor(private clock: Clock) {}

  scoreFinding(
    finding: SharedFinding,
    worker: WorkerAssignment,
    depWorkerIds: string[],
  ): RelevanceScore {
    const dependency = depWorkerIds.includes(finding.workerId) ? 35 : 0;

    const tagOverlap = worker.ownershipClaims?.some(c => finding.tags.includes(c.path))
      ? 15
      : worker.requiredCapabilities?.some(c => finding.tags.includes(c))
        ? 10
        : 0;

    const confidence = finding.confidence ? Math.round(finding.confidence * 10) : 0;
    const recency = computeRecencyScore(finding.createdAt, this.clock);
    const eq = assessEvidenceQuality(finding.evidenceRefs ?? [], []);

    const total = Math.max(0, Math.min(100, dependency + tagOverlap + confidence + recency + eq.score));

    const reasons: string[] = [];
    if (dependency) reasons.push("direct dependency finding");
    if (tagOverlap > 0) reasons.push("tag overlap");
    if (confidence > 5) reasons.push("high confidence");
    if (recency > 4) reasons.push("recent");
    if (eq.verifiedCount > 0) reasons.push("verified evidence");

    return {
      total,
      components: {
        dependency,
        tagOverlap,
        capabilityMatch: 0,
        confidence,
        recency,
        evidenceQuality: eq.score,
        explicitSubscription: 0,
      },
      reasons,
    };
  }

  /**
   * Sort findings deterministically: score desc -> direct dep first -> evidence desc -> createdAt desc -> id asc.
   */
  sortFindings(
    findings: Array<{ finding: SharedFinding; score: RelevanceScore }>,
    depWorkerIds: string[],
  ): Array<{ finding: SharedFinding; score: RelevanceScore }> {
    return [...findings].sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      const aDep = depWorkerIds.includes(a.finding.workerId) ? 1 : 0;
      const bDep = depWorkerIds.includes(b.finding.workerId) ? 1 : 0;
      if (bDep !== aDep) return bDep - aDep;
      if (b.score.components.evidenceQuality !== a.score.components.evidenceQuality) return b.score.components.evidenceQuality - a.score.components.evidenceQuality;
      if (b.finding.createdAt !== a.finding.createdAt) return b.finding.createdAt.localeCompare(a.finding.createdAt);
      return a.finding.id.localeCompare(b.finding.id);
    });
  }
}
