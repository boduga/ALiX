/**
 * P28.2 — Governance explainability builder.
 *
 * Pure explanation section generators that transform DriftOutcomeTrace[]
 * into section-based GovernanceExplanation artifacts. All functions are
 * deterministic (no I/O, no side effects).
 *
 * Core invariant: sections never contain ranking or prescriptive language.
 * Descriptions only — no "perform better", "should prioritize", etc.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { DriftOutcomeTrace, DriftCorrelationAnalytics } from "./learning-synthesis-types.js";
import type { GovernanceExplanation, ExplanationSection } from "./governance-explainability-types.js";

// ---------------------------------------------------------------------------
// createExplanationId
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 hex identifier over a set of trace IDs.
 * Sorts the input so the result is order-independent.
 */
export function createExplanationId(traceIds: string[]): string {
  const sorted = [...traceIds].sort();
  const joined = sorted.join("|");
  return createHash("sha256").update(joined).digest("hex");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Describes the P24 signal that triggered the candidate.
 * Always present in a trace-level explanation.
 */
export function buildSignalOriginSection(trace: DriftOutcomeTrace): ExplanationSection {
  const parts: string[] = [];

  if (trace.signalKind) {
    parts.push(`Signal kind: ${trace.signalKind}`);
  }
  if (trace.signalSeverity) {
    parts.push(`severity: ${trace.signalSeverity}`);
  }
  if (trace.signalDirection) {
    parts.push(`direction: ${trace.signalDirection}`);
  }
  if (trace.windowStart && trace.windowEnd) {
    parts.push(`observation window: ${trace.windowStart} to ${trace.windowEnd}`);
  }

  const body =
    parts.length > 0
      ? capitalize(parts.join(", ")) + "."
      : "No signal metadata available.";

  return {
    kind: "signal_origin",
    heading: "Signal Origin",
    body,
    evidenceRefs: [trace.signalId],
    dataPoints: {
      signalKind: trace.signalKind,
      signalSeverity: trace.signalSeverity,
      signalDirection: trace.signalDirection,
    },
  };
}

/**
 * Describes the candidate lifecycle: status, timestamps, duration.
 */
export function buildLifecycleSection(trace: DriftOutcomeTrace): ExplanationSection {
  const parts: string[] = [];

  if (trace.candidateStatus) {
    parts.push(`Candidate status: ${trace.candidateStatus}`);
  }
  if (trace.candidateCreatedAt) {
    parts.push(`created at: ${trace.candidateCreatedAt}`);
  }
  if (trace.candidateClosedAt) {
    parts.push(`closed at: ${trace.candidateClosedAt}`);
  }
  parts.push(
    `time to review: ${trace.timeToReviewDays} days, time to outcome: ${trace.timeToOutcomeDays} days`,
  );

  const body = capitalize(parts.join(", ")) + ".";

  return {
    kind: "candidate_lifecycle",
    heading: "Candidate Lifecycle",
    body,
    evidenceRefs: [trace.candidateId],
    dataPoints: {
      timeToReviewDays: trace.timeToReviewDays,
      timeToOutcomeDays: trace.timeToOutcomeDays,
    },
  };
}

/**
 * Describes the human outcome decision and its rationale.
 */
export function buildOutcomeSection(trace: DriftOutcomeTrace): ExplanationSection {
  const parts: string[] = [];

  parts.push(`Outcome type: ${trace.outcomeType}`);
  if (trace.outcomeRationale) {
    parts.push(`rationale: ${trace.outcomeRationale}`);
  }
  parts.push(`recorded at: ${trace.outcomeRecordedAt}`);

  const body = capitalize(parts.join(", ")) + ".";

  return {
    kind: "outcome_summary",
    heading: "Outcome Summary",
    body,
    evidenceRefs: [trace.outcomeId],
    dataPoints: {
      outcomeType: trace.outcomeType,
      timeToOutcomeDays: trace.timeToOutcomeDays,
    },
  };
}

/**
 * Descriptive comparison against peer candidates.
 *
 * INVARIANT: Never uses ranking language ("performed better", "worst case",
 * "should prioritize", "more successful"). Reports counts only.
 */
export function buildPeerComparisonSection(
  trace: DriftOutcomeTrace,
  peers: DriftOutcomeTrace[],
): ExplanationSection {
  // Count outcomes by type among peers
  const outcomeCounts: Record<string, number> = {};
  for (const peer of peers) {
    outcomeCounts[peer.outcomeType] = (outcomeCounts[peer.outcomeType] || 0) + 1;
  }

  const pairs = Object.entries(outcomeCounts).sort(([a], [b]) => a.localeCompare(b));
  const countsText = pairs.map(([type, count]) => `${count} ${type}`).join(", ");

  const body = `Among ${peers.length} peer candidates: ${countsText}. This candidate's outcome was ${trace.outcomeType}.`;

  return {
    kind: "peer_comparison",
    heading: "Peer Comparison",
    body,
    evidenceRefs: [trace.outcomeId, ...peers.map((p) => p.outcomeId)],
    dataPoints: {
      peerCount: peers.length,
      ...Object.fromEntries(pairs),
    },
  };
}

/**
 * Broader pattern context — either from window analytics or from a single
 * trace's signal pattern and review-cycle data.
 */
export function buildLearningSection(
  traces: DriftOutcomeTrace[],
  analytics?: DriftCorrelationAnalytics,
): ExplanationSection {
  const evidenceRefs = traces.map((t) => t.outcomeId);

  if (analytics) {
    const segments: string[] = [
      `Across ${analytics.totalOutcomes} outcomes in this window, ${analytics.traceCompleteness}% had complete trace data.`,
      `${analytics.missingOutcomes} outcomes were missing trace data.`,
      `Average time to review: ${analytics.timeStats.avgTimeToReviewDays.toFixed(1)} days.`,
      `Average time to outcome: ${analytics.timeStats.avgTimeToOutcomeDays.toFixed(1)} days.`,
    ];

    if (analytics.repeatedPatterns.length > 0) {
      segments.push(`Repeated patterns: ${analytics.repeatedPatterns.join(", ")}.`);
    }

    return {
      kind: "learning_synthesis",
      heading: "Learning Synthesis",
      body: segments.join(" "),
      evidenceRefs,
      dataPoints: {
        totalOutcomes: analytics.totalOutcomes,
        traceCompleteness: analytics.traceCompleteness,
        missingOutcomes: analytics.missingOutcomes,
        avgTimeToReviewDays: analytics.timeStats.avgTimeToReviewDays,
        avgTimeToOutcomeDays: analytics.timeStats.avgTimeToOutcomeDays,
      },
    };
  }

  // Single-trace or bare-trace synthesis
  const trace = traces[0];
  const parts: string[] = [];
  if (trace.signalKind) {
    parts.push(`Signal pattern: ${trace.signalKind} (severity: ${trace.signalSeverity})`);
  }
  parts.push(
    `Review cycle: ${trace.timeToReviewDays} days to review, ${trace.timeToOutcomeDays} days to outcome`,
  );

  return {
    kind: "learning_synthesis",
    heading: "Learning Synthesis",
    body: parts.join(". ") + ".",
    evidenceRefs,
    dataPoints: {
      timeToReviewDays: trace.timeToReviewDays,
      timeToOutcomeDays: trace.timeToOutcomeDays,
      signalKind: trace.signalKind,
      signalSeverity: trace.signalSeverity,
    },
  };
}

// ---------------------------------------------------------------------------
// Main builders
// ---------------------------------------------------------------------------

/**
 * Build a full GovernanceExplanation for a single trace.
 *
 * Produces sections: signal_origin, candidate_lifecycle, outcome_summary,
 * plus peer_comparison if peerGroup is provided, plus learning_synthesis.
 */
export function buildTraceExplanation(
  trace: DriftOutcomeTrace,
  peerGroup?: DriftOutcomeTrace[],
): GovernanceExplanation {
  const traceIds = [trace.outcomeId];
  const sections: ExplanationSection[] = [
    buildSignalOriginSection(trace),
    buildLifecycleSection(trace),
    buildOutcomeSection(trace),
  ];

  if (peerGroup && peerGroup.length > 0) {
    sections.push(buildPeerComparisonSection(trace, peerGroup));
  }

  sections.push(buildLearningSection([trace]));

  return explanationEnvelope(traceIds, trace.candidateTitle || trace.candidateId, sections);
}

/**
 * Build a GovernanceExplanation for a time window of traces.
 *
 * Produces a single learning_synthesis section using aggregated analytics.
 */
export function buildWindowExplanation(
  traces: DriftOutcomeTrace[],
  analytics: DriftCorrelationAnalytics,
): GovernanceExplanation {
  const traceIds = traces.map((t) => t.outcomeId);

  return explanationEnvelope(traceIds, "Governance Window Analysis", [
    buildLearningSection(traces, analytics),
  ]);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Assemble a GovernanceExplanation envelope with immutable boundary flags.
 */
function explanationEnvelope(
  traceIds: string[],
  subject: string,
  sections: ExplanationSection[],
): GovernanceExplanation {
  return {
    explanationId: createExplanationId(traceIds),
    generatedAt: new Date().toISOString(),
    subject,
    sections,
    traceIds,
    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,
  };
}

/** Capitalize the first character of a string. */
function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text[0].toUpperCase() + text.slice(1);
}
