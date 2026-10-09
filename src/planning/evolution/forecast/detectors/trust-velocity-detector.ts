/**
 * A9 — trust velocity detector (Slice 1, Phase 6).
 *
 * Pure function over `proposal.submitted` evidence. Evaluates the locked
 * predicate structure of the submitted candidate:
 *
 *   - blast radius          → absorbedCapabilityIds (consolidation touches N capabilities)
 *   - replacement targets   → absorbedCapabilityIds (consolidation replaces the survivor)
 *   - capability surface    → proposedPatch (widens the change surface)
 *   - multi-tenancy impact  → consolidateDefinition (redefines a shared capability)
 *
 * Scoring is a deterministic weighted sum over a base derived from the
 * candidate's locked A7 `riskClass` (low/medium/high) plus documented bonuses.
 * The concrete weights below are authorized defaults from the implementation
 * plan — NO adaptive tuning. A finding is emitted only when the internalScore
 * meets the exported trigger.
 *
 * No I/O. No clock access. No hidden configuration mutation. Deterministic
 * given the same input.
 *
 * @module evolution/forecast/detectors/trust-velocity-detector
 */

import type { ForecastKind, DetectorFinding, ProposalEventRecord } from "../contracts/contract.js";
import { clamp01 } from "../scale.js";

export const TRUST_VELOCITY_KIND: ForecastKind = "trust-velocity";

/** Deterministic scoring weights (authorized implementation-plan defaults). */
export const TRUST_VELOCITY_WEIGHTS = {
  /** Base score from the candidate's locked A7 risk class. */
  riskClassBase: { low: 0.1, medium: 0.4, high: 0.7 },
  /** Absorbed capability ids → widened blast radius + replacement targets. */
  consolidationBonus: 0.15,
  /** A carried patch → widened capability surface area. */
  patchBonus: 0.1,
  /** A carried consolidation definition → multi-tenancy impact. */
  redefinitionBonus: 0.1,
  maxScore: 1.0,
} as const;

/** Below this internalScore a submitted proposal is not detection-worthy. */
export const TRUST_VELOCITY_TRIGGER_SCORE = 0.3;

/** Confidence used when the candidate carries no finite `confidence`. */
export const TRUST_VELOCITY_DEFAULT_CONFIDENCE = 0.5;

/**
 * Detect trust-velocity risk from proposal.submitted evidence.
 *
 * @param records raw proposal event records (RAW payload preserved by the adapter)
 * @returns deterministic findings, sorted by subject
 */
export function detectTrustVelocity(
  records: ReadonlyArray<ProposalEventRecord>,
): ReadonlyArray<DetectorFinding> {
  const findings: DetectorFinding[] = [];
  for (const rec of records) {
    if (rec.kind !== "proposal.submitted") continue;

    const candidate = (rec.payload["candidate"] ?? {}) as Record<string, unknown>;
    const riskClass = candidate["riskClass"];
    const base =
      riskClass === "high"
        ? TRUST_VELOCITY_WEIGHTS.riskClassBase.high
        : riskClass === "medium"
          ? TRUST_VELOCITY_WEIGHTS.riskClassBase.medium
          : TRUST_VELOCITY_WEIGHTS.riskClassBase.low;

    const absorbed = Array.isArray(candidate["absorbedCapabilityIds"])
      ? candidate["absorbedCapabilityIds"].length
      : 0;
    const consolidation = absorbed > 0 ? TRUST_VELOCITY_WEIGHTS.consolidationBonus : 0;
    const patch = candidate["proposedPatch"] !== undefined ? TRUST_VELOCITY_WEIGHTS.patchBonus : 0;
    const redefinition =
      candidate["consolidateDefinition"] !== undefined ? TRUST_VELOCITY_WEIGHTS.redefinitionBonus : 0;

    const internalScore = clamp01(base + consolidation + patch + redefinition);
    if (internalScore < TRUST_VELOCITY_TRIGGER_SCORE) continue;

    const rawConfidence = candidate["confidence"];
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
        ? clamp01(rawConfidence)
        : TRUST_VELOCITY_DEFAULT_CONFIDENCE;

    const evidenceIds = Array.isArray(candidate["evidenceIds"])
      ? candidate["evidenceIds"].filter((x): x is string => typeof x === "string")
      : [];
    // Evidence refs preserved from the candidate's evidenceIds; fall back to
    // the eventId for traceability when the candidate carries none.
    const evidenceRefs = evidenceIds.length > 0 ? evidenceIds : [rec.eventId];

    findings.push({
      subject: rec.proposalId,
      subjectCapability: rec.capabilityId,
      kind: TRUST_VELOCITY_KIND,
      internalScore,
      confidence,
      evidenceRefs,
    });
  }
  return findings.sort((a, b) => a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind));
}
