/**
 * A9 — evidence completeness detector (Slice 1, Phase 6).
 *
 * Pure function over enriched proposal evidence. Evaluates:
 *
 *   - populated enriched fields  → `assessment` flags (effectiveness report,
 *     revert decision, time-to-approval, time-to-apply)
 *   - recency                    → recordedAt relative to `now`
 *   - source diversity           → distinct evidence fingerprints
 *
 * INCOMPLETENESS is the risk signal: a proposal with sparse, stale,
 * single-source evidence scores HIGHER (riskier). The score is a deterministic
 * weighted sum of the three incompleteness components; concrete weights are
 * authorized implementation-plan defaults — NO adaptive tuning. A finding is
 * emitted only when the score meets the exported trigger.
 *
 * No I/O. No implicit clock (the `now` timestamp is an explicit parameter).
 * No hidden configuration mutation. Deterministic given the same input +
 * timestamp.
 *
 * @module evolution/forecast/detectors/evidence-completeness-detector
 */

import type {
  ForecastKind,
  DetectorFinding,
  EnrichedProposalRecord,
} from "../contracts/contract.js";
import { clamp01 } from "../scale.js";

export const EVIDENCE_COMPLETENESS_KIND: ForecastKind = "evidence-completeness";

/** Deterministic scoring weights (authorized implementation-plan defaults). */
export const EVIDENCE_COMPLETENESS_WEIGHTS = {
  /** Weight of unpopulated enriched fields on the incompleteness score. */
  population: 0.5,
  /** Weight of staleness on the incompleteness score. */
  recency: 0.25,
  /** Weight of low source diversity on the incompleteness score. */
  diversity: 0.25,
  /** A proposal at-or-older than this many days contributes full staleness. */
  recencyWindowDays: 30,
  /** Fingerprint count at/above this saturates the diversity component. */
  diversitySaturation: 3,
} as const;

/** Below this incompleteness score a proposal is not detection-worthy. */
export const EVIDENCE_COMPLETENESS_TRIGGER_SCORE = 0.4;

/** Confidence base for a completeness assessment (rises with source diversity). */
export const EVIDENCE_COMPLETENESS_CONFIDENCE_BASE = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Detect evidence-completeness risk from enriched proposal evidence.
 *
 * @param records enriched proposal records (adapter output)
 * @param now the evaluation timestamp (explicit — no implicit clock)
 * @returns deterministic findings, sorted by subject
 */
export function detectEvidenceCompleteness(
  records: ReadonlyArray<EnrichedProposalRecord>,
  now: string,
): ReadonlyArray<DetectorFinding> {
  const nowMs = Date.parse(now);
  const findings: DetectorFinding[] = [];

  for (const rec of records) {
    const flags = [
      rec.assessment.hasEffectivenessReport,
      rec.assessment.hasRevertDecision,
      rec.assessment.hasTimeToApproval,
      rec.assessment.hasTimeToApply,
    ];
    const populated = flags.filter(Boolean).length;
    const populatedRatio = flags.length > 0 ? populated / flags.length : 0;

    const recordedMs = Date.parse(rec.recordedAt);
    const ageDays =
      Number.isFinite(recordedMs) && Number.isFinite(nowMs)
        ? (nowMs - recordedMs) / DAY_MS
        : Number.POSITIVE_INFINITY;
    const recencyScore = clamp01(1 - ageDays / EVIDENCE_COMPLETENESS_WEIGHTS.recencyWindowDays);

    const diversityRatio = clamp01(
      rec.evidenceFingerprints.length / EVIDENCE_COMPLETENESS_WEIGHTS.diversitySaturation,
    );

    const incompleteness = clamp01(
      EVIDENCE_COMPLETENESS_WEIGHTS.population * (1 - populatedRatio)
        + EVIDENCE_COMPLETENESS_WEIGHTS.recency * (1 - recencyScore)
        + EVIDENCE_COMPLETENESS_WEIGHTS.diversity * (1 - diversityRatio),
    );
    if (incompleteness < EVIDENCE_COMPLETENESS_TRIGGER_SCORE) continue;

    const confidence = clamp01(EVIDENCE_COMPLETENESS_CONFIDENCE_BASE + 0.5 * diversityRatio);

    findings.push({
      subject: rec.proposalId,
      subjectCapability: rec.capabilityId,
      kind: EVIDENCE_COMPLETENESS_KIND,
      internalScore: incompleteness,
      confidence,
      evidenceRefs: [...rec.evidenceFingerprints],
    });
  }
  return findings.sort((a, b) => a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind));
}
