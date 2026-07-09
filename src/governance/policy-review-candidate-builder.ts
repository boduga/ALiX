/**
 * P25.2 — Policy Review Candidate Builder.
 *
 * Pure function: converts P24 PolicyDriftSignal[] into PolicyReviewCandidate[]
 * previews. Only medium/high severity signals that pass the kind/direction
 * filter produce candidates.
 *
 * Pure module — no stores, no fs, no event writing, no persistence.
 * MUST NOT import the store module.
 */

import { createHash } from "node:crypto";
import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Filter: candidate-worthy signals
// ---------------------------------------------------------------------------

const CANDIDATE_SEVERITIES = new Set(["medium", "high"]);

const EXCLUDED_KINDS = new Set(["evidence_coverage"]);

const EXCLUDED_DIRECTIONS = new Set(["neutral", "insufficient_evidence"]);

function isCandidateWorthy(signal: PolicyDriftSignal): boolean {
  if (!CANDIDATE_SEVERITIES.has(signal.severity)) return false;
  if (EXCLUDED_KINDS.has(signal.kind)) return false;
  if (EXCLUDED_DIRECTIONS.has(signal.direction)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic ID
// ---------------------------------------------------------------------------

function deterministicId(signal: PolicyDriftSignal): string {
  const raw = [
    "p25",
    signal.signalId,
    signal.kind,
    signal.windowStart,
    signal.windowEnd,
  ].join("|");
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Title helpers
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  calibration_skew: "Calibration Skew",
  replay_divergence: "Replay Divergence",
  convergent_gap: "Convergent Gap",
  trend_direction: "Trend Direction",
  evidence_coverage: "Evidence Coverage",
  volatility: "Volatility",
};

function titleFor(signal: PolicyDriftSignal): string {
  const kindLabel = KIND_LABELS[signal.kind] ?? signal.kind;
  return `Policy Review: ${kindLabel} (${signal.direction}, ${signal.severity})`;
}

function summaryFor(signal: PolicyDriftSignal): string {
  if (signal.rationale.length > 0) {
    return signal.rationale.join(" ");
  }
  return `${signal.kind} signal detected with ${signal.direction} direction at ${signal.severity} severity.`;
}

// ---------------------------------------------------------------------------
// buildCandidates
// ---------------------------------------------------------------------------

export function buildCandidates(signals: PolicyDriftSignal[]): PolicyReviewCandidate[] {
  const candidates: PolicyReviewCandidate[] = [];

  for (const signal of signals) {
    if (!isCandidateWorthy(signal)) continue;

    const id = deterministicId(signal);
    const nowStr = new Date().toISOString();

    candidates.push({
      candidateId: id,
      source: {
        phase: "P24",
        signalId: signal.signalId,
        signalKind: signal.kind,
        signalSeverity: signal.severity,
        signalDirection: signal.direction,
        windowStart: signal.windowStart,
        windowEnd: signal.windowEnd,
      },
      title: titleFor(signal),
      summary: summaryFor(signal),
      status: "proposed",
      createdAt: nowStr,
      updatedAt: nowStr,
      evidenceRefs: signal.evidenceRefs.map(r => ({
        source: r.source,
        lifecycleId: r.lifecycleId,
        handoffId: r.handoffId,
        replayId: r.replayId,
        basis: r.basis,
      })),
      review: {
        notes: [],
        decisionBasis: [],
      },
      boundaries: {
        readOnlyEvidence: true,
        noPolicyMutation: true,
        noThresholdChange: true,
        noAutoAdoption: true,
        noRanking: true,
        requiresHumanReview: true,
      },
    });
  }

  // Deterministic sort: severity (high first), then kind, then candidateId
  const severityOrder: Record<string, number> = { high: 0, medium: 1 };
  candidates.sort((a, b) => {
    const sa = severityOrder[a.source.signalSeverity] ?? 2;
    const sb = severityOrder[b.source.signalSeverity] ?? 2;
    if (sa !== sb) return sa - sb;
    const ka = a.source.signalKind;
    const kb = b.source.signalKind;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.candidateId.localeCompare(b.candidateId);
  });

  return candidates;
}
