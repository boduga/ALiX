/**
 * P29.2 — Compliance Package Builder.
 *
 * Pure-function builder that composes P24–P28 governance data into a
 * CompliancePackage.  No I/O, no side effects, no mutation of inputs.
 * Same evidence always produces the same package (replay stability).
 *
 * @module
 */

import { createHash } from "node:crypto";

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";
import type { PolicyReviewOutcome } from "./policy-review-outcome-types.js";
import type { ExecutionEvidence } from "../runtime/contracts/execution-intent-contract.js";
import { toComplianceExecutionSummary } from "./governance-execution-adapter.js";
import type {
  CompliancePackage,
  ComplianceSignalSummary,
  ComplianceCandidateSummary,
  ComplianceOutcomeSummary,
  ComplianceTraceSummary,
  DriftCorrelationAnalytics,
  GovernanceExplanation,
} from "./governance-reporting-types.js";

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/**
 * Input contract for buildCompliancePackage.
 *
 * All arrays may be empty; missing data produces a partial package
 * with available fields populated and accurate inventory counts.
 */
export interface BuildCompliancePackageInput {
  /** ISO-8601 start of the reporting window. */
  windowStart: string;
  /** ISO-8601 end of the reporting window. */
  windowEnd: string;
  /** ISO-8601 timestamp when this package is generated (supplied by caller). */
  generatedAt: string;

  /** P24 drift signals — may be empty. */
  signals: PolicyDriftSignal[];
  /** P25 policy review candidates — may be empty. */
  candidates: PolicyReviewCandidate[];
  /** P26 policy review outcomes — may be empty. */
  outcomes: PolicyReviewOutcome[];
  /** P27 drift outcome traces — may be empty. */
  traces: DriftOutcomeTrace[];
  /** P27 correlation analytics (always required, can be skeleton). */
  correlationAnalytics: DriftCorrelationAnalytics;
  /** P28 governance explanations — may be empty. */
  keyExplanations: GovernanceExplanation[];

  /** X3a execution evidence — may be empty. */
  executionEvidence: readonly ExecutionEvidence[];
}

// ---------------------------------------------------------------------------
// P27 — DriftOutcomeTrace (input type consumed by this builder)
// ---------------------------------------------------------------------------

/**
 * P27 trace linking a governance outcome back to its originating signal.
 */
export interface DriftOutcomeTrace {
  outcomeId: string;
  candidateId: string;
  signalKind: string;
  outcomeType: string;
  timeToOutcomeDays: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map a PolicyDriftSignal into a ComplianceSignalSummary. */
function buildSignalSummary(signal: PolicyDriftSignal): ComplianceSignalSummary {
  return {
    signalId: signal.signalId,
    kind: signal.kind,
    severity: signal.severity,
    direction: signal.direction,
    windowStart: signal.windowStart,
    windowEnd: signal.windowEnd,
  };
}

/** Map a PolicyReviewCandidate into a ComplianceCandidateSummary. */
function buildCandidateSummary(candidate: PolicyReviewCandidate): ComplianceCandidateSummary {
  return {
    candidateId: candidate.candidateId,
    title: candidate.title,
    status: candidate.status,
    signalKind: candidate.source.signalKind,
    signalSeverity: candidate.source.signalSeverity,
    createdAt: candidate.createdAt,
    hasOutcome: candidate.status === "accepted_for_policy_review" || candidate.status === "closed",
  };
}

/** Map a PolicyReviewOutcome into a ComplianceOutcomeSummary. */
function buildOutcomeSummary(outcome: PolicyReviewOutcome): ComplianceOutcomeSummary {
  return {
    outcomeId: outcome.outcomeId,
    candidateId: outcome.candidateId,
    outcomeType: outcome.outcomeType,
    recordedBy: outcome.recordedBy,
    rationale: outcome.rationale,
  };
}

/** Map a DriftOutcomeTrace into a ComplianceTraceSummary. */
function buildTraceSummary(trace: DriftOutcomeTrace): ComplianceTraceSummary {
  return {
    outcomeId: trace.outcomeId,
    candidateId: trace.candidateId,
    signalKind: trace.signalKind,
    outcomeType: trace.outcomeType,
    timeToOutcomeDays: trace.timeToOutcomeDays,
  };
}

/**
 * Build sorted array of ComplianceSignalSummary from PolicyDriftSignal[].
 * Sorted deterministically by signalId.
 */
function buildSignalSummaries(signals: PolicyDriftSignal[]): ComplianceSignalSummary[] {
  return signals.map(buildSignalSummary).sort((a, b) => a.signalId.localeCompare(b.signalId));
}

/**
 * Build sorted array of ComplianceCandidateSummary from PolicyReviewCandidate[].
 * Sorted deterministically by candidateId.
 */
function buildCandidateSummaries(candidates: PolicyReviewCandidate[]): ComplianceCandidateSummary[] {
  return candidates.map(buildCandidateSummary).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

/**
 * Build sorted array of ComplianceOutcomeSummary from PolicyReviewOutcome[].
 * Sorted deterministically by outcomeId.
 */
function buildOutcomeSummaries(outcomes: PolicyReviewOutcome[]): ComplianceOutcomeSummary[] {
  return outcomes.map(buildOutcomeSummary).sort((a, b) => a.outcomeId.localeCompare(b.outcomeId));
}

/**
 * Build sorted array of ComplianceTraceSummary from DriftOutcomeTrace[].
 * Sorted deterministically by outcomeId.
 */
function buildTraceSummaries(traces: DriftOutcomeTrace[]): ComplianceTraceSummary[] {
  return traces.map(buildTraceSummary).sort((a, b) => a.outcomeId.localeCompare(b.outcomeId));
}

/**
 * Derive the list of governance phases for which evidence is present.
 *
 * Phase detection describes available evidence — it never implies validation
 * or approval.
 *
 * - signals present  → "P24"
 * - candidates present → "P25"
 * - outcomes present  → "P26"
 * - traces present    → "P27"
 * - explanations present → "P28"
 */
function deriveIncludedPhases(input: BuildCompliancePackageInput): string[] {
  const phases: string[] = [];

  if (input.signals.length > 0) phases.push("P24");
  if (input.candidates.length > 0) phases.push("P25");
  if (input.outcomes.length > 0) phases.push("P26");
  if (input.traces.length > 0) phases.push("P27");
  if (input.keyExplanations.length > 0) phases.push("P28");

  if (input.executionEvidence.length > 0) phases.push("Execution");

  return phases;
}

/**
 * Create a deterministic package ID.
 *
 * SHA-256 of `windowStart + "|" + windowEnd + "|" + String(traceCount)`.
 * No external clock, randomness, or environment access.
 */
function createPackageId(windowStart: string, windowEnd: string, traceCount: number): string {
  const payload = windowStart + "|" + windowEnd + "|" + String(traceCount);
  return createHash("sha256").update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a CompliancePackage from governance evidence.
 *
 * Pure function — no I/O, no side effects, no mutation of inputs.
 * Same evidence always produces the same package.
 */
export function buildCompliancePackage(opts: BuildCompliancePackageInput): CompliancePackage {
  const signalSummary = buildSignalSummaries(opts.signals);
  const candidateSummary = buildCandidateSummaries(opts.candidates);
  const outcomeSummary = buildOutcomeSummaries(opts.outcomes);
  const traceSummary = buildTraceSummaries(opts.traces);
  const executionSummary = opts.executionEvidence.map(toComplianceExecutionSummary);
  const executionEvidenceCount = executionSummary.length;
  const executionOutcomes = {
    success: opts.executionEvidence.filter((e) => e.outcome === "SUCCESS").length,
    failed: opts.executionEvidence.filter((e) => e.outcome === "FAILED").length,
    partial: opts.executionEvidence.filter((e) => e.outcome === "PARTIAL").length,
  };
  const phasesIncluded = deriveIncludedPhases(opts);
  const packageId = createPackageId(opts.windowStart, opts.windowEnd, opts.traces.length);

  return {
    packageId,
    generatedAt: opts.generatedAt,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,

    totalSignals: signalSummary.length,
    totalCandidates: candidateSummary.length,
    totalOutcomes: outcomeSummary.length,
    totalTraces: traceSummary.length,

    signalSummary,
    candidateSummary,
    outcomeSummary,
    traceSummary,

    executionEvidenceCount,
    executionOutcomes,
    executionSummary,

    correlationAnalytics: opts.correlationAnalytics,
    keyExplanations: opts.keyExplanations,

    phasesIncluded,

    // Boundary flags
    readOnly: true as const,
    noPolicyMutation: true as const,
    noThresholdChange: true as const,
    noAutoAdoption: true as const,
    noRanking: true as const,
  };
}
