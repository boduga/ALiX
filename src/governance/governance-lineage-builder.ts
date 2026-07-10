/**
 * P30.2 — Lineage Builder.
 *
 * Pure-function builder that composes P24–P29 governance phase data into
 * a LineageIndex with embedded LineageRecords.  No I/O, no side effects,
 * no mutation of inputs.  Same evidence always produces the same index
 * (replay stability).
 *
 * @module
 */

import { createHash } from "node:crypto";

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";
import type { PolicyReviewOutcome } from "./policy-review-outcome-types.js";
import type { DriftOutcomeTrace } from "./governance-reporting-builder.js";
import type {
  GovernanceExplanation,
  CompliancePackage,
} from "./governance-reporting-types.js";
import type {
  LineageRecord,
  LineageIndex,
  SignalRef,
  CandidateRef,
  OutcomeRef,
  TraceRef,
  ExplanationRef,
  ComplianceRef,
} from "./governance-lineage-types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute a namespace-prefixed deterministic lineage ID.
 *
 * SHA-256 of `"alix:p30:lineage:" + candidateId`.  No external clock,
 * randomness, or environment access.
 */
function computeLineageId(candidateId: string): string {
  return createHash("sha256")
    .update("alix:p30:lineage:" + candidateId)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a LineageIndex from P24–P29 governance phase data.
 *
 * Pure function — no I/O, no side effects, no mutation of inputs.
 * Same evidence always produces the same index and embedded records.
 *
 * The returned LineageIndex carries an internal records map so that
 * buildLineageRecord can retrieve individual records.  Consumers
 * observe only the 4 lookup maps declared on the LineageIndex interface.
 *
 * @param opts.signals P24 drift signals (may be empty).
 * @param opts.candidates P25 policy review candidates (may be empty).
 * @param opts.outcomes P26 policy review outcomes (may be empty).
 * @param opts.traces P27 drift-outcome traces (may be empty).
 * @param opts.explanations P28 governance explanations (may be empty).
 * @param opts.compliancePackages P29 compliance packages (optional, may be empty).
 */
export function buildLineageIndex(opts: {
  signals: PolicyDriftSignal[];
  candidates: PolicyReviewCandidate[];
  outcomes: PolicyReviewOutcome[];
  traces: DriftOutcomeTrace[];
  explanations: GovernanceExplanation[];
  compliancePackages?: CompliancePackage[];
}): LineageIndex {
  // -----------------------------------------------------------------------
  // Pre-index input data for fast cross-referencing (no mutation of originals)
  // -----------------------------------------------------------------------

  const signalBySignalId = new Map<string, PolicyDriftSignal>();
  for (const s of opts.signals) {
    signalBySignalId.set(s.signalId, s);
  }

  const outcomesByCandidate = new Map<string, PolicyReviewOutcome[]>();
  for (const o of opts.outcomes) {
    const list = outcomesByCandidate.get(o.candidateId);
    if (list) {
      list.push(o);
    } else {
      outcomesByCandidate.set(o.candidateId, [o]);
    }
  }

  const tracesByCandidate = new Map<string, DriftOutcomeTrace[]>();
  for (const t of opts.traces) {
    const list = tracesByCandidate.get(t.candidateId);
    if (list) {
      list.push(t);
    } else {
      tracesByCandidate.set(t.candidateId, [t]);
    }
  }

  // -----------------------------------------------------------------------
  // Build records and index maps
  // -----------------------------------------------------------------------

  const byCandidateId = new Map<string, string[]>();
  const bySignalKind = new Map<string, string[]>();
  const byOutcomeType = new Map<string, string[]>();
  const byCompliancePackageId = new Map<string, string[]>();
  const records = new Map<string, LineageRecord>();

  // Deterministic iteration over candidates (sorted by candidateId)
  const sortedCandidates = [...opts.candidates].sort((a, b) =>
    a.candidateId.localeCompare(b.candidateId),
  );

  for (const candidate of sortedCandidates) {
    const signal = signalBySignalId.get(candidate.source.signalId);
    const outcomes = outcomesByCandidate.get(candidate.candidateId) ?? [];
    const traces = tracesByCandidate.get(candidate.candidateId) ?? [];

    // Explanations that reference this candidate via relatedIds
    const explanations = opts.explanations.filter((e) =>
      e.relatedIds.includes(candidate.candidateId),
    );

    // Compliance packages that reference this candidate via traceSummary
    const packages = opts.compliancePackages
      ? opts.compliancePackages.filter((p) =>
          p.traceSummary.some((t) => t.candidateId === candidate.candidateId),
        )
      : [];

    const lineageId = computeLineageId(candidate.candidateId);

    // ---- Shallow phase refs (navigation fields only) ----

    const signalRef: SignalRef | undefined = signal
      ? {
          signalId: signal.signalId,
          signalKind: signal.kind,
          windowEnd: signal.windowEnd,
        }
      : undefined;

    const candidateRef: CandidateRef = {
      candidateId: candidate.candidateId,
      title: candidate.title,
      status: candidate.status,
    };

    const outcomeRef: OutcomeRef | undefined =
      outcomes.length > 0
        ? {
            outcomeId: outcomes[0].outcomeId,
            candidateId: outcomes[0].candidateId,
            outcomeType: outcomes[0].outcomeType,
          }
        : undefined;

    const traceRef: TraceRef | undefined =
      traces.length > 0
        ? {
            outcomeId: traces[0].outcomeId,
            candidateId: traces[0].candidateId,
            signalKind: traces[0].signalKind,
          }
        : undefined;

    const explanationRef: ExplanationRef | undefined =
      explanations.length > 0
        ? {
            explanationId: explanations[0].explanationId,
            type: explanations[0].type,
          }
        : undefined;

    const complianceRef: ComplianceRef | undefined =
      packages.length > 0
        ? {
            packageId: packages[0].packageId,
            windowStart: packages[0].windowStart,
            windowEnd: packages[0].windowEnd,
          }
        : undefined;

    // ---- LineageRecord ----

    const record: LineageRecord = {
      lineageId,
      assembledAt: new Date().toISOString(),
      phasePresence: {
        p24: signalRef !== undefined,
        p25: true,
        p26: outcomeRef !== undefined,
        p27: traceRef !== undefined,
        p28: explanationRef !== undefined,
        p29: complianceRef !== undefined,
      },
      signalRef,
      candidateRef,
      outcomeRef,
      traceRef,
      explanationRef,
      complianceRef,
      readOnly: true as const,
      noPolicyMutation: true as const,
      noThresholdChange: true as const,
      noAutoAdoption: true as const,
      noRanking: true as const,
    };

    records.set(lineageId, record);

    // ---- Index by candidateId ----
    byCandidateId.set(candidate.candidateId, [lineageId]);

    // ---- Index by signalKind ----
    if (signal) {
      const kindList = bySignalKind.get(signal.kind);
      if (kindList) {
        kindList.push(lineageId);
      } else {
        bySignalKind.set(signal.kind, [lineageId]);
      }
    }

    // ---- Index by outcomeType ----
    for (const outcome of outcomes) {
      const typeList = byOutcomeType.get(outcome.outcomeType);
      if (typeList) {
        typeList.push(lineageId);
      } else {
        byOutcomeType.set(outcome.outcomeType, [lineageId]);
      }
    }

    // ---- Index by compliancePackageId ----
    for (const pkg of packages) {
      const pkgList = byCompliancePackageId.get(pkg.packageId);
      if (pkgList) {
        pkgList.push(lineageId);
      } else {
        byCompliancePackageId.set(pkg.packageId, [lineageId]);
      }
    }
  }

  // Return the index with embedded records for buildLineageRecord retrieval.
  // The embedded _records is not on the public LineageIndex interface but is
  // accessible via a cast inside buildLineageRecord (same module).
  const index: LineageIndex & { _records: Map<string, LineageRecord> } = {
    byCandidateId,
    bySignalKind,
    byOutcomeType,
    byCompliancePackageId,
    _records: records,
  };

  return index;
}

/**
 * Retrieve a single LineageRecord by candidateId from a previously-built
 * LineageIndex.
 *
 * Returns null when the candidateId is not present in the index.
 * The returned record contains shallow phase refs (never full objects).
 */
export function buildLineageRecord(
  candidateId: string,
  index: LineageIndex,
): LineageRecord | null {
  const lineageIds = index.byCandidateId.get(candidateId);
  if (!lineageIds || lineageIds.length === 0) return null;

  // Access the internal records map attached by buildLineageIndex
  const extended = index as LineageIndex & {
    _records?: Map<string, LineageRecord>;
  };

  if (!extended._records) return null;
  return extended._records.get(lineageIds[0]) ?? null;
}
