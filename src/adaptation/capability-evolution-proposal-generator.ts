/**
 * P5.6 — CapabilityEvolutionProposalGenerator.
 *
 * Converts CapabilityEvolutionReport findings into adaptation proposals.
 * All proposals carry provenance="auto" and status="pending", and use the
 * create_improvement_issue action only — no structural mutations. This
 * generator is proposal-only, mirroring the governance boundary established
 * in P5.2c's AutomaticProposalGenerator.
 *
 * @module
 */

import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type {
  CapabilityEvolutionReport,
  CapabilityHealth,
} from "./capability-evolution-types.js";
import { nextProposalId } from "./recommendation-to-proposal.js";
import type { GenerateResult } from "./auto-proposal-generator.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CapabilityEvolutionGenerateOptions {
  /** Minimum gap signal strength (default 2). */
  minGapSignalStrength?: number;
  /** Minimum drift magnitude (default 0.5). */
  minDriftMagnitude?: number;
  /** Minimum resolution count for health-based findings (default 5). */
  minCapabilityUsage?: number;
  /** Maximum proposals to generate per run (default 10). */
  maxProposalsPerRun?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MIN_GAP_SIGNAL_STRENGTH = 2;
export const DEFAULT_MIN_DRIFT_MAGNITUDE = 0.5;
export const DEFAULT_MIN_CAPABILITY_USAGE = 5;
export const DEFAULT_MAX_PROPOSALS_PER_RUN = 10;

// ---------------------------------------------------------------------------
// Finding-type → confidence mapping
// ---------------------------------------------------------------------------

/**
 * P5.6 provenance: non-user facing base confidences per finding type.
 * These are the report's confidence in the finding — not proposal approval
 * confidence. Gaps have the highest base confidence because they come from
 * explicit demand-signal evidence. Deprecated/stagnant have higher
 * confidence because lifecycle classification is deterministic from the
 * metrics thresholds. Drift/overlap use soft metrics so confidence is
 * lower.
 */
export const FINDING_CONFIDENCE: Record<string, number> = {
  gap: 0.9,
  declining: 0.8,
  drift: 0.75,
  overlap: 0.7,
  deprecated: 0.85,
  stagnant: 0.85,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CapabilityEvolutionProposalPayload {
  capabilityEvolutionGeneratedAt: string;
  findingType:
    | "gap"
    | "overlap"
    | "deprecated"
    | "stagnant"
    | "declining"
    | "drift";
  findingDetail: string;
  signalStrength?: number;
  overlapScore?: number;
  lifecycleState?: string;
  driftMagnitude?: number;
  sourceReportTimestamp: string;
  dedupeKey: string;
}

interface FindingCandidate {
  priority: number; // tier 0-5, lower = higher priority
  sortKey: number; // secondary sort (descending)
  findingType: string;
  dedupeKey: string;
  title: string;
  detail: string;
  sourceConfidence: number;
  extraPayload: Record<string, unknown>;
}

interface SkippedDetail {
  duplicate: number;
  belowThreshold: number;
  capped: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a normalized dedupe key for overlap pairs.
 * Sorts capability names lexicographically so (A, B) and (B, A) produce
 * the same key, preventing duplicate overlap proposals.
 */
export function buildOverlapKey(a: string, b: string): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `capability-overlap:${first}:${second}`;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export class CapabilityEvolutionProposalGenerator {
  constructor(
    private readonly store: ProposalStore,
    private readonly writer: EvidenceEventWriter,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async generateFromCapabilityEvolution(
    report: CapabilityEvolutionReport,
    opts: CapabilityEvolutionGenerateOptions = {},
  ): Promise<GenerateResult> {
    const minGapSignalStrength =
      opts.minGapSignalStrength ?? DEFAULT_MIN_GAP_SIGNAL_STRENGTH;
    const minDriftMagnitude =
      opts.minDriftMagnitude ?? DEFAULT_MIN_DRIFT_MAGNITUDE;
    const minCapabilityUsage =
      opts.minCapabilityUsage ?? DEFAULT_MIN_CAPABILITY_USAGE;
    const maxProposalsPerRun =
      opts.maxProposalsPerRun ?? DEFAULT_MAX_PROPOSALS_PER_RUN;

    const skipped: SkippedDetail = {
      belowThreshold: 0,
      duplicate: 0,
      capped: 0,
    };

    // Collect candidates from all finding sources
    const candidates = this.#collectCandidates(report, {
      minGapSignalStrength,
      minDriftMagnitude,
      minCapabilityUsage,
      skipped,
    });

    // Sort: priority tier first (lower = higher priority), then sortKey
    // descending within tier.
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.sortKey - a.sortKey;
    });

    // Load pending create_improvement_issue proposals once for dedup
    const pending = await this.store.list("pending");
    const dedupeKeys = new Set(
      pending
        .filter(
          (p) =>
            p.action === "create_improvement_issue" &&
            typeof p.payload?.dedupeKey === "string",
        )
        .map((p) => p.payload.dedupeKey as string),
    );

    // Deduplicate + top-N truncation
    const survivors: FindingCandidate[] = [];
    for (const c of candidates) {
      if (dedupeKeys.has(c.dedupeKey)) {
        skipped.duplicate += 1;
        continue;
      }
      if (survivors.length >= maxProposalsPerRun) {
        skipped.capped += 1;
        continue;
      }
      survivors.push(c);
    }

    // Build proposals
    let generated = 0;
    const proposals: AdaptationProposal[] = [];

    for (const candidate of survivors) {
      const proposal = this.#buildProposal(candidate, report);

      // Save to store (required)
      await this.store.save(proposal);

      // Record evidence event (best-effort — failure does not abort)
      try {
        await this.writer.recordAdaptationProposed(proposal.id, {
          createdAt: proposal.createdAt,
          action: proposal.action,
          target: proposal.target as unknown as Record<string, unknown>,
          sourceRecommendationType: proposal.sourceRecommendationType,
          sourceConfidence: proposal.sourceConfidence,
          provenance: "auto",
          payload: proposal.payload,
          reason: proposal.reason,
        });
      } catch {
        // Evidence recording is best-effort; proposal is already saved.
      }

      proposals.push(proposal);
      generated += 1;
    }

    const totalSkipped =
      skipped.belowThreshold + skipped.duplicate + skipped.capped;

    return { generated, skipped: totalSkipped, proposals };
  }

  // -----------------------------------------------------------------------
  // Candidate collection
  // -----------------------------------------------------------------------

  #collectCandidates(
    report: CapabilityEvolutionReport,
    opts: {
      minGapSignalStrength: number;
      minDriftMagnitude: number;
      minCapabilityUsage: number;
      skipped: SkippedDetail;
    },
  ): FindingCandidate[] {
    const candidates: FindingCandidate[] = [];

    // 1. gapAnalysis — priority 0 (highest)
    for (const gap of report.gapAnalysis) {
      if (gap.signalStrength < opts.minGapSignalStrength) {
        opts.skipped.belowThreshold += 1;
        continue;
      }
      candidates.push({
        priority: 0,
        sortKey: gap.signalStrength,
        findingType: "gap",
        dedupeKey: `capability-gap:${gap.suggestedCapability}`,
        title: `Investigate adding capability for "${gap.suggestedCapability}"`,
        detail: gap.evidence.join("; "),
        sourceConfidence: FINDING_CONFIDENCE["gap"],
        extraPayload: {
          signalStrength: gap.signalStrength,
          confidence: gap.confidence,
          evidence: gap.evidence,
        },
      });
    }

    // 2. healthAnalysis declining — priority 1
    for (const h of report.healthAnalysis) {
      if (h.lifecycleState !== "declining") continue;
      if (h.resolutionCount < opts.minCapabilityUsage) {
        opts.skipped.belowThreshold += 1;
        continue;
      }
      candidates.push({
        priority: 1,
        sortKey: h.revertRate ?? 0,
        findingType: "declining",
        dedupeKey: `capability-health:declining:${h.capability}`,
        title: `Investigate declining capability "${h.capability}"`,
        detail: h.rationale,
        sourceConfidence: FINDING_CONFIDENCE["declining"],
        extraPayload: {
          lifecycleState: h.lifecycleState,
          revertRate: h.revertRate,
          keepRate: h.keepRate,
          resolutionCount: h.resolutionCount,
          resolutionCountRecent: h.resolutionCountRecent,
        },
      });
    }

    // 3. driftAnalysis split candidates — priority 2
    for (const d of report.driftAnalysis) {
      if (!d.splitCandidate) continue;
      if (d.driftMagnitude < opts.minDriftMagnitude) {
        opts.skipped.belowThreshold += 1;
        continue;
      }
      candidates.push({
        priority: 2,
        sortKey: d.driftMagnitude,
        findingType: "drift",
        dedupeKey: `capability-drift:${d.capability}`,
        title: `Investigate scope drift for capability "${d.capability}"`,
        detail: `Original: ${d.originalScope}. Current: ${d.currentScope}. Drift magnitude: ${d.driftMagnitude.toFixed(2)}.`,
        sourceConfidence: FINDING_CONFIDENCE["drift"],
        extraPayload: {
          driftMagnitude: d.driftMagnitude,
          originalScope: d.originalScope,
          currentScope: d.currentScope,
        },
      });
    }

    // 4. overlapAnalysis consolidation candidates — priority 3
    for (const o of report.overlapAnalysis) {
      if (!o.consolidationCandidate) continue;
      candidates.push({
        priority: 3,
        sortKey: o.overlapScore,
        findingType: "overlap",
        dedupeKey: buildOverlapKey(o.capabilityA, o.capabilityB),
        title: `Investigate overlapping capabilities "${o.capabilityA}" and "${o.capabilityB}"`,
        detail: `Overlap score: ${o.overlapScore.toFixed(2)}. Coverage A→B: ${o.coverageAtoB.toFixed(2)}, B→A: ${o.coverageBtoA.toFixed(2)}. Shared signals: ${o.sharedSignalCount}.`,
        sourceConfidence: FINDING_CONFIDENCE["overlap"],
        extraPayload: {
          overlapScore: o.overlapScore,
          capabilityA: o.capabilityA,
          capabilityB: o.capabilityB,
          coverageAtoB: o.coverageAtoB,
          coverageBtoA: o.coverageBtoA,
        },
      });
    }

    // 5. healthAnalysis deprecated — priority 4
    for (const h of report.healthAnalysis) {
      if (h.lifecycleState !== "deprecated") continue;
      candidates.push({
        priority: 4,
        sortKey: -h.resolutionCount,
        findingType: "deprecated",
        dedupeKey: `capability-health:deprecated:${h.capability}`,
        title: `Investigate removing deprecated capability "${h.capability}"`,
        detail: h.rationale,
        sourceConfidence: FINDING_CONFIDENCE["deprecated"],
        extraPayload: {
          lifecycleState: h.lifecycleState,
          resolutionCount: h.resolutionCount,
          agentCount: h.agentCount,
          rationale: h.rationale,
        },
      });
    }

    // 6. healthAnalysis stagnant — priority 5 (lowest)
    for (const h of report.healthAnalysis) {
      if (h.lifecycleState !== "stagnant") continue;
      if (h.resolutionCount < opts.minCapabilityUsage) {
        opts.skipped.belowThreshold += 1;
        continue;
      }
      candidates.push({
        priority: 5,
        sortKey: -h.resolutionCountRecent,
        findingType: "stagnant",
        dedupeKey: `capability-health:stagnant:${h.capability}`,
        title: `Investigate stagnant capability "${h.capability}"`,
        detail: h.rationale,
        sourceConfidence: FINDING_CONFIDENCE["stagnant"],
        extraPayload: {
          lifecycleState: h.lifecycleState,
          resolutionCount: h.resolutionCount,
          resolutionCountRecent: h.resolutionCountRecent,
          agentCount: h.agentCount,
        },
      });
    }

    return candidates;
  }

  // -----------------------------------------------------------------------
  // Proposal construction
  // -----------------------------------------------------------------------

  #buildProposal(
    candidate: FindingCandidate,
    report: CapabilityEvolutionReport,
  ): AdaptationProposal {
    const payload: CapabilityEvolutionProposalPayload = {
      capabilityEvolutionGeneratedAt: report.generatedAt,
      findingType: candidate.findingType as CapabilityEvolutionProposalPayload["findingType"],
      findingDetail: candidate.detail,
      sourceReportTimestamp: report.generatedAt,
      dedupeKey: candidate.dedupeKey,
      ...candidate.extraPayload,
    };

    return {
      id: nextProposalId(),
      createdAt: new Date().toISOString(),
      status: "pending",
      action: "create_improvement_issue",
      target: {
        kind: "issue",
        title: candidate.title,
      },
      payload: payload as unknown as Record<string, unknown>,
      sourceRecommendationType: "capability_evolution_proposal",
      sourceConfidence: candidate.sourceConfidence,
      evidenceFingerprints: [
        `ce:${report.generatedAt}:${candidate.dedupeKey}`,
      ],
      reason: candidate.title,
      provenance: "auto",
    };
  }
}
