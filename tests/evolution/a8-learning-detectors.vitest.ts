import { describe, it, expect } from "vitest";
import type {
  MeasurementOutcomeRecord,
  LearningEngineOptions,
  LearningFinding,
  ProposalGovernanceRecord,
  RecommendationRecord,
} from "../../src/evolution/learning/contracts/learning-contract.js";
import { detectUnderperformer, UNDERPERFORMER_DETECTOR_KIND } from "../../src/evolution/learning/detectors/underperformer-detector.js";
import {
  detectOutcomeContradictions,
  OUTCOME_CONTRADICTION_DETECTOR_KIND,
} from "../../src/evolution/learning/detectors/outcome-contradiction-detector.js";
import {
  detectRepeatedPatternFailures,
  REPEATED_PATTERN_FAILURE_DETECTOR_KIND,
} from "../../src/evolution/learning/detectors/repeated-pattern-failure-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-08-14T00:00:00.000Z";
const OPTIONS: LearningEngineOptions = {
  minCardinality: 3,
  evidenceWindowDays: 30,
};

/** Build an outcome record with sensible defaults. */
function makeRecord(overrides: Partial<MeasurementOutcomeRecord> & { capabilityId: string }): MeasurementOutcomeRecord {
  return {
    capabilityId: overrides.capabilityId,
    outcome: overrides.outcome ?? "ineffective",
    recordedAt: overrides.recordedAt ?? "2026-08-10T00:00:00.000Z",
    eventId: overrides.eventId ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
  };
}

// ---------------------------------------------------------------------------
// Detector kind constant
// ---------------------------------------------------------------------------

describe("UNDERPERFORMER_DETECTOR_KIND", () => {
  it('is "underperformer"', () => {
    expect(UNDERPERFORMER_DETECTOR_KIND).toBe("underperformer");
  });
});

// ---------------------------------------------------------------------------
// detectUnderperformer — per-axis behavior
// ---------------------------------------------------------------------------

describe("detectUnderperformer", () => {
  it("returns 0 findings for empty input", () => {
    const result = detectUnderperformer([], OPTIONS, NOW);
    expect(result).toEqual([]);
  });

  it("returns 0 findings when every capability is below minCardinality", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      // only 2 ineffective for cap-A — below minCardinality=3
      makeRecord({ capabilityId: "cap-B", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toEqual([]);
  });

  it("emits 1 finding when one capability meets minCardinality (at threshold)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toHaveLength(1);
    const f = result[0]!;
    expect(f.findingId).toBe("underperformer:cap-A");
    expect(f.kind).toBe("underperformer");
    expect(f.identityKey).toBe("cap-A");
    expect(f.occurrences).toBe(3);
  });

  it("emits 1 finding when one capability exceeds minCardinality (above threshold)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e4" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e5" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toBe(5);
  });

  it("emits N findings when N capabilities exceed minCardinality (each above threshold)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      // cap-A: 4 ineffective
      makeRecord({ capabilityId: "cap-A", eventId: "a1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a3" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a4" }),
      // cap-B: 3 ineffective
      makeRecord({ capabilityId: "cap-B", eventId: "b1" }),
      makeRecord({ capabilityId: "cap-B", eventId: "b2" }),
      makeRecord({ capabilityId: "cap-B", eventId: "b3" }),
      // cap-C: 2 ineffective — below threshold, must be excluded
      makeRecord({ capabilityId: "cap-C", eventId: "c1" }),
      makeRecord({ capabilityId: "cap-C", eventId: "c2" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.identityKey)).toEqual(["cap-A", "cap-B"]);
    expect(result.find((f) => f.identityKey === "cap-A")!.occurrences).toBe(4);
    expect(result.find((f) => f.identityKey === "cap-B")!.occurrences).toBe(3);
  });

  it("is deterministic — same input twice produces identical findings (sorted by identityKey)", () => {
    // Intentionally scramble input order to prove sorting/determinism
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-Z", eventId: "z1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a1" }),
      makeRecord({ capabilityId: "cap-M", eventId: "m1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a2" }),
      makeRecord({ capabilityId: "cap-Z", eventId: "z2" }),
      makeRecord({ capabilityId: "cap-M", eventId: "m2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a3" }),
      makeRecord({ capabilityId: "cap-M", eventId: "m3" }),
      makeRecord({ capabilityId: "cap-Z", eventId: "z3" }),
    ];
    const first = detectUnderperformer(records, OPTIONS, NOW);
    const second = detectUnderperformer(records, OPTIONS, NOW);
    expect(first).toEqual(second);
    // And the order is sorted by identityKey (string-locale compare)
    expect(first.map((f) => f.identityKey)).toEqual(["cap-A", "cap-M", "cap-Z"]);
  });

  it("preserves evidenceRefs exactly in encounter order", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result[0]!.evidenceRefs).toEqual(["e1", "e2", "e3"]);
  });

  it("ignores effective and inconclusive outcomes (only counts ineffective)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", outcome: "effective", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "effective", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", outcome: "inconclusive", eventId: "i1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "inconclusive", eventId: "i2" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "n1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "n2" }),
      // 2 ineffective — below minCardinality=3 — must NOT emit
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toEqual([]);
  });

  it("excludes records recorded before the evidence window", () => {
    // Window for NOW=2026-08-14T00:00:00.000Z, days=30 → [2026-07-15T00:00:00.000Z, 2026-08-14T00:00:00.000Z]
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-01T00:00:00.000Z", eventId: "old1" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-10T00:00:00.000Z", eventId: "old2" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-14T23:59:59.999Z", eventId: "old3" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-15T00:00:00.000Z", eventId: "in1" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-20T00:00:00.000Z", eventId: "in2" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-08-10T00:00:00.000Z", eventId: "in3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    // 3 in window (in1, in2, in3) → exactly meets threshold → 1 finding
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toBe(3);
    expect(result[0]!.evidenceRefs).toEqual(["in1", "in2", "in3"]);
  });

  it("excludes records recorded after `now` (future-dated)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-08-13T00:00:00.000Z", eventId: "ok1" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-08-14T00:00:00.000Z", eventId: "now" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-09-01T00:00:00.000Z", eventId: "future" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    // ok1 + now = 2 within window → below threshold → 0 findings
    expect(result).toEqual([]);
  });

  it("computes evidenceWindow as [now - days, now]", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result[0]!.evidenceWindow.from).toBe("2026-07-15T00:00:00.000Z");
    expect(result[0]!.evidenceWindow.to).toBe(NOW);
  });

  it("summary string includes count and window days", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result[0]!.summary).toBe(
      "3 ineffective outcomes for capability cap-A within 30 days",
    );
  });

  it("honors minCardinality overrides (higher threshold excludes weaker evidence)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e4" }),
    ];
    const threshold4: LearningEngineOptions = { minCardinality: 5, evidenceWindowDays: 30 };
    const lowThreshold = detectUnderperformer(records, OPTIONS, NOW);
    const highThreshold = detectUnderperformer(records, threshold4, NOW);
    expect(lowThreshold).toHaveLength(1);
    expect(highThreshold).toHaveLength(0);
  });

  it("emits LearningFinding objects (read-only shape with all required fields)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    const f: LearningFinding = result[0]!;
    expect(typeof f.findingId).toBe("string");
    expect(typeof f.kind).toBe("string");
    expect(typeof f.identityKey).toBe("string");
    expect(typeof f.evidenceWindow.from).toBe("string");
    expect(typeof f.evidenceWindow.to).toBe("string");
    expect(typeof f.occurrences).toBe("number");
    expect(Array.isArray(f.evidenceRefs)).toBe(true);
    expect(typeof f.summary).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// detectOutcomeContradictions (T4, 4-adapter pattern, A8 wayfinder map #517)
// ---------------------------------------------------------------------------

const NOW2 = "2026-08-14T00:00:00.000Z";
const OPTIONS2: LearningEngineOptions = {
  evidenceWindowDays: 30,
  minCardinality: 2,
};

function makeProposal(
  overrides: Partial<{
    proposalId: string;
    capabilityId: string;
    kind: ProposalGovernanceRecord["kind"];
    recordedAt: string;
    eventId: string;
    error?: string;
  }> = {},
): ProposalGovernanceRecord {
  // T2 reconciliation: `capabilityId` is populated ONLY on `proposal.submitted`
  // events (via `payload.candidate.target.id`). For all other event kinds,
  // the adapter returns an empty string. Mirror that semantics here so the
  // detector's identity-join behavior is tested against realistic records.
  const kind = overrides.kind ?? "proposal.approved";
  const defaultCapabilityId = kind === "proposal.submitted" ? "cap-default" : "";
  return {
    proposalId: overrides.proposalId ?? "p-default",
    capabilityId: overrides.capabilityId ?? defaultCapabilityId,
    kind,
    recordedAt: overrides.recordedAt ?? "2026-08-10T00:00:00.000Z",
    eventId: overrides.eventId ?? "evt-default",
    error: overrides.error,
  };
}

function makeRecommendation(
  overrides: Partial<{
    recordId: string;
    proposalId: string;
    kind: RecommendationRecord["kind"];
    recordedAt: string;
  }> = {},
): RecommendationRecord {
  return {
    recordId: overrides.recordId ?? "rec-default",
    proposalId: overrides.proposalId ?? "p-default",
    kind: overrides.kind ?? "APPROVE",
    confidence: 0.8,
    reasoning: "default",
    evidenceRefs: [],
    recordedAt: overrides.recordedAt ?? "2026-08-10T00:00:00.000Z",
  };
}

describe("detectOutcomeContradictions", () => {
  it("exposes detector kind constant", () => {
    expect(OUTCOME_CONTRADICTION_DETECTOR_KIND).toBe("outcome-contradiction");
  });

  it("emits [] when there are no proposals", () => {
    expect(detectOutcomeContradictions([], [], OPTIONS2, NOW2)).toEqual([]);
  });

  it("emits [] when there are proposals but no recommendations (no silent default)", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.approved" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected" }),
    ];
    expect(detectOutcomeContradictions(proposals, [], OPTIONS2, NOW2)).toEqual([]);
  });

  it("detects APPROVE-recommendation + rejected-proposal = contradiction", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "APPROVE" }),
    ];
    const findings = detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("outcome-contradiction");
    expect(findings[0]!.identityKey).toBe("cap-A");
    expect(findings[0]!.occurrences).toBe(2);
    expect(findings[0]!.findingId).toBe("outcome-contradiction:cap-A");
  });

  it("detects REJECT-recommendation + approved-proposal = contradiction", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-B", kind: "proposal.approved", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-B", kind: "proposal.approved", eventId: "evt-2" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "REJECT" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "REJECT" }),
    ];
    const findings = detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.identityKey).toBe("cap-B");
    expect(findings[0]!.occurrences).toBe(2);
  });

  it("does NOT detect APPROVE-recommendation + approved-proposal (no contradiction)", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.approved", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.approved", eventId: "evt-2" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "APPROVE" }),
    ];
    expect(detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2)).toEqual([]);
  });

  it("does NOT detect MONITOR/REQUEST_ADDITIONAL_EVIDENCE/ESCALATE (non-binary kinds)", () => {
    // These kinds are intentionally non-binary — no contradiction can be
    // established against an operator's approved/rejected decision.
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.approved", eventId: "evt-3" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "MONITOR" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "REQUEST_ADDITIONAL_EVIDENCE" }),
      makeRecommendation({ recordId: "rec-3", proposalId: "p3", kind: "ESCALATE" }),
    ];
    expect(detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2)).toEqual([]);
  });

  it("ignores non-approved/rejected proposal kinds (submitted/executed/etc.)", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.executed", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.execution_failed", eventId: "evt-3" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "REJECT" }),
      makeRecommendation({ recordId: "rec-3", proposalId: "p3", kind: "APPROVE" }),
    ];
    expect(detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2)).toEqual([]);
  });

  it("ignores proposals outside evidence window", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1", recordedAt: "2026-01-01T00:00:00.000Z" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2", recordedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "APPROVE" }),
    ];
    expect(detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2)).toEqual([]);
  });

  it("respects minCardinality threshold", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
    ];
    const threshold2 = { ...OPTIONS2, minCardinality: 2 };
    const threshold1 = { ...OPTIONS2, minCardinality: 1 };
    expect(detectOutcomeContradictions(proposals, recs, threshold2, NOW2)).toEqual([]);
    expect(detectOutcomeContradictions(proposals, recs, threshold1, NOW2)).toHaveLength(1);
  });

  it("groups by capabilityId (one finding per capability)", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-B", kind: "proposal.rejected", eventId: "evt-3" }),
      makeProposal({ proposalId: "p4", capabilityId: "cap-B", kind: "proposal.rejected", eventId: "evt-4" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-3", proposalId: "p3", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-4", proposalId: "p4", kind: "APPROVE" }),
    ];
    const findings = detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.identityKey).sort()).toEqual(["cap-A", "cap-B"]);
  });

  it("skips proposals without matching recommendation (no silent default)", () => {
    // Per locked ruling: missing recommendation → cannot establish
    // contradiction; do NOT silently substitute defaults.
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2" }),
    ];
    // Only p1 has a recommendation; p2 does not.
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
    ];
    expect(detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2)).toEqual([]);
  });

  it("evidenceRefs contain 'eventId:recordId' pairs for traceability", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "APPROVE" }),
    ];
    const findings = detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2);
    expect(findings[0]!.evidenceRefs).toEqual(["evt-1:rec-1", "evt-2:rec-2"]);
  });

  it("emits findings sorted by identityKey for deterministic output", () => {
    const proposals = [
      makeProposal({ proposalId: "p-zeta", capabilityId: "cap-Z", kind: "proposal.rejected", eventId: "evt-z1" }),
      makeProposal({ proposalId: "p-zeta2", capabilityId: "cap-Z", kind: "proposal.rejected", eventId: "evt-z2" }),
      makeProposal({ proposalId: "p-alpha", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-a1" }),
      makeProposal({ proposalId: "p-alpha2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-a2" }),
    ];
    const recs = [
      makeRecommendation({ recordId: "rec-z1", proposalId: "p-zeta", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-z2", proposalId: "p-zeta2", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-a1", proposalId: "p-alpha", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-a2", proposalId: "p-alpha2", kind: "APPROVE" }),
    ];
    const findings = detectOutcomeContradictions(proposals, recs, OPTIONS2, NOW2);
    expect(findings.map((f) => f.identityKey)).toEqual(["cap-A", "cap-Z"]);
  });
});

// ============================================================================
// T5 — repeated-pattern-failure detector (A8 wayfinder map #517, ruling #2)
// ============================================================================

const NOW5 = "2026-08-14T00:00:00.000Z";
const OPTIONS5: LearningEngineOptions = { minCardinality: 3, evidenceWindowDays: 30 };

describe("detectRepeatedPatternFailures (T5)", () => {
  it("emits no findings when records are empty", () => {
    const findings = detectRepeatedPatternFailures([], OPTIONS5, NOW5);
    expect(findings).toEqual([]);
  });

  it("skips records outside the evidence window", () => {
    const proposals = [
      makeProposal({
        proposalId: "p1",
        capabilityId: "cap-A",
        kind: "proposal.execution_failed",
        error: "timeout",
        recordedAt: "2026-01-01T00:00:00.000Z",
        eventId: "evt-1",
      }),
      makeProposal({
        proposalId: "p2",
        capabilityId: "cap-A",
        kind: "proposal.execution_failed",
        error: "timeout",
        recordedAt: "2026-08-01T00:00:00.000Z",
        eventId: "evt-2",
      }),
      makeProposal({
        proposalId: "p3",
        capabilityId: "cap-A",
        kind: "proposal.execution_failed",
        error: "timeout",
        recordedAt: "2026-08-02T00:00:00.000Z",
        eventId: "evt-3",
      }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    // Only 2 are within the window (Aug 1, Aug 2); below minCardinality 3.
    expect(findings).toEqual([]);
  });

  it("groups by error:capabilityId fingerprint and emits one finding per fingerprint group", () => {
    const proposals = [
      // Submitted (for capabilityId join)
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p4", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p5", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p6", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p7", capabilityId: "cap-B", kind: "proposal.submitted" }),
      // Failures: 3x "timeout" on cap-A, 3x "timeout" on cap-B
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
      makeProposal({ proposalId: "p5", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-5" }),
      makeProposal({ proposalId: "p6", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-6" }),
      makeProposal({ proposalId: "p7", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-7" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toHaveLength(2);
    const byKey = Object.fromEntries(findings.map((f) => [f.identityKey, f]));
    expect(byKey["timeout:cap-A"]?.occurrences).toBe(3);
    expect(byKey["timeout:cap-B"]?.occurrences).toBe(3);
  });

  it("differentiates failure modes: same capability, different errors are SEPARATE findings", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p4", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p5", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p6", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
      makeProposal({ proposalId: "p4", kind: "proposal.execution_failed", error: "diverged", eventId: "evt-4" }),
      makeProposal({ proposalId: "p5", kind: "proposal.execution_failed", error: "diverged", eventId: "evt-5" }),
      makeProposal({ proposalId: "p6", kind: "proposal.execution_failed", error: "diverged", eventId: "evt-6" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toHaveLength(2);
    const keys = findings.map((f) => f.identityKey).sort();
    expect(keys).toEqual(["diverged:cap-A", "timeout:cap-A"]);
  });

  it("requires count >= minCardinality; sub-threshold groups are dropped", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p4", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
      makeProposal({ proposalId: "p4", kind: "proposal.execution_failed", error: "diverged", eventId: "evt-4" }),
    ];
    // minCardinality 3; "timeout" has 3, "diverged" has 1 -> only "timeout" emits.
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.identityKey).toBe("timeout:cap-A");
    expect(findings[0]?.occurrences).toBe(3);
  });

  it("ignores non-execution_failed events entirely", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.rejected", eventId: "evt-3" }),
      makeProposal({ proposalId: "p4", capabilityId: "cap-A", kind: "proposal.approved", eventId: "evt-4" }),
      makeProposal({ proposalId: "p5", capabilityId: "cap-A", kind: "proposal.executed", eventId: "evt-5" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toEqual([]);
  });

  it("recovers capabilityId from proposal.submitted events when the failure record has no capabilityId", () => {
    // No capabilityId on the failure record itself; the detector must
    // join proposalId -> capabilityId via the submitted-event index.
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-X", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-X", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-X", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", capabilityId: "", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", capabilityId: "", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", capabilityId: "", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.identityKey).toBe("timeout:cap-X");
    expect(findings[0]?.occurrences).toBe(3);
  });

  it("falls back to empty capabilityId when submitted event is missing for proposalId", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.identityKey).toBe("timeout:");
    expect(findings[0]?.occurrences).toBe(3);
  });

  it("emits finding with kind='repeated-pattern-failure' and deterministic shape", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.kind).toBe("repeated-pattern-failure");
    expect(f.findingId).toBe("repeated-pattern-failure:timeout:cap-A");
    expect(f.identityKey).toBe("timeout:cap-A");
    expect(f.evidenceWindow).toEqual({ from: "2026-07-15T00:00:00.000Z", to: NOW5 });
    expect(f.evidenceRefs).toEqual(["evt-1", "evt-2", "evt-3"]);
    expect(f.summary).toContain("timeout:cap-A");
  });

  it("exports REPEATED_PATTERN_FAILURE_DETECTOR_KIND constant", () => {
    expect(REPEATED_PATTERN_FAILURE_DETECTOR_KIND).toBe("repeated-pattern-failure");
  });

  it("emits findings sorted by identityKey for deterministic output", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p4", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p5", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p6", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
      makeProposal({ proposalId: "p4", kind: "proposal.execution_failed", error: "aborted", eventId: "evt-4" }),
      makeProposal({ proposalId: "p5", kind: "proposal.execution_failed", error: "aborted", eventId: "evt-5" }),
      makeProposal({ proposalId: "p6", kind: "proposal.execution_failed", error: "aborted", eventId: "evt-6" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, OPTIONS5, NOW5);
    expect(findings.map((f) => f.identityKey).sort()).toEqual(["aborted:cap-B", "timeout:cap-A"]);
  });

  it("reflects the supplied minCardinality threshold (higher threshold drops groups)", () => {
    const proposals = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-A", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-1" }),
      makeProposal({ proposalId: "p2", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-2" }),
      makeProposal({ proposalId: "p3", kind: "proposal.execution_failed", error: "timeout", eventId: "evt-3" }),
    ];
    const findings = detectRepeatedPatternFailures(proposals, { minCardinality: 4, evidenceWindowDays: 30 }, NOW5);
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LearningEngine + buildLearningProposal + buildGovernanceRecommendation (T6)
// ---------------------------------------------------------------------------

import type {
  EnrichedProposalRecord,
  LearningAdapter,
  LearningProposal,
} from "../../src/evolution/learning/contracts/learning-contract.js";
import { LearningEngine } from "../../src/evolution/learning/learning-engine.js";
import { buildLearningProposal } from "../../src/evolution/learning/learning-proposal-builder.js";
import { buildGovernanceRecommendation } from "../../src/evolution/learning/a2-bridge.js";

/** Adapter that returns a fixed record set. */
function fakeAdapter<T>(records: ReadonlyArray<T>): LearningAdapter<T> {
  return {
    name: "fake",
    list: async () => records,
  };
}

const ENGINE_NOW = "2026-08-14T00:00:00.000Z";
const ENGINE_OPTIONS: LearningEngineOptions = {
  minCardinality: 3,
  evidenceWindowDays: 30,
};

describe("LearningEngine — aggregation axes", () => {
  it("aggregates findings from 3 detectors into a single LearningProposal when all fire", async () => {
    // underperformer: 3 ineffective outcomes for cap-A (above threshold).
    const measurementRecs: MeasurementOutcomeRecord[] = [
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "m1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "m2" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "m3" }),
    ];

    // outcome-contradiction: APPROVE recommendation vs operator-rejected.
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p1", capabilityId: "cap-B", kind: "proposal.rejected" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p2", capabilityId: "cap-B", kind: "proposal.rejected" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-B", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "p3", capabilityId: "cap-B", kind: "proposal.rejected" }),
    ];
    const recommendationRecs: RecommendationRecord[] = [
      makeRecommendation({ recordId: "rec-1", proposalId: "p1", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-2", proposalId: "p2", kind: "APPROVE" }),
      makeRecommendation({ recordId: "rec-3", proposalId: "p3", kind: "APPROVE" }),
    ];

    // repeated-pattern-failure: 3 timeouts for cap-C.
    proposalRecs.push(
      makeProposal({ proposalId: "f1", capabilityId: "cap-C", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "f2", capabilityId: "cap-C", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "f3", capabilityId: "cap-C", kind: "proposal.submitted" }),
      makeProposal({ proposalId: "f1", kind: "proposal.execution_failed", error: "timeout", eventId: "fe-1" }),
      makeProposal({ proposalId: "f2", kind: "proposal.execution_failed", error: "timeout", eventId: "fe-2" }),
      makeProposal({ proposalId: "f3", kind: "proposal.execution_failed", error: "timeout", eventId: "fe-3" }),
    );

    const enrichedRecs: EnrichedProposalRecord[] = [];
    const engine = new LearningEngine(
      fakeAdapter(proposalRecs),
      fakeAdapter(measurementRecs),
      fakeAdapter(enrichedRecs),
      fakeAdapter(recommendationRecs),
      ENGINE_OPTIONS,
    );

    const proposal = await engine.learn(ENGINE_NOW);
    expect(proposal).not.toBeNull();
    expect(proposal).toMatchObject({
      generatedAt: ENGINE_NOW,
    });
    expect(proposal!.proposalId).toMatch(/^a8:2026-08-14T00:00:00\.000Z:/);
    expect(proposal!.findings).toHaveLength(3);
    const kinds = proposal!.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual([
      "outcome-contradiction",
      "repeated-pattern-failure",
      "underperformer",
    ]);
    // Findings sorted deterministically by findingId.
    const ids = proposal!.findings.map((f) => f.findingId);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("returns null when 0 findings across all detectors", async () => {
    // All records below threshold / outside window / non-triggering.
    const measurementRecs: MeasurementOutcomeRecord[] = [
      makeRecord({ capabilityId: "cap-A", outcome: "effective", eventId: "m1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "m2" }),
    ];
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({ proposalId: "p1", capabilityId: "cap-A", kind: "proposal.approved" }),
    ];
    const recommendationRecs: RecommendationRecord[] = [];
    const enrichedRecs: EnrichedProposalRecord[] = [];

    const engine = new LearningEngine(
      fakeAdapter(proposalRecs),
      fakeAdapter(measurementRecs),
      fakeAdapter(enrichedRecs),
      fakeAdapter(recommendationRecs),
      ENGINE_OPTIONS,
    );

    const proposal = await engine.learn(ENGINE_NOW);
    expect(proposal).toBeNull();
  });
});

describe("buildGovernanceRecommendation — MONITOR-only emission", () => {
  it("always returns kind: 'MONITOR'", () => {
    const proposal: LearningProposal = buildLearningProposal(
      [
        {
          findingId: "underperformer:cap-A",
          kind: "underperformer",
          identityKey: "cap-A",
          evidenceWindow: { from: "2026-07-15T00:00:00.000Z", to: ENGINE_NOW },
          occurrences: 3,
          evidenceRefs: ["e1", "e2", "e3"],
          summary: "3 ineffective outcomes",
        },
      ],
      ENGINE_NOW,
    );

    const rec = buildGovernanceRecommendation(proposal);
    expect(rec.kind).toBe("MONITOR");
  });

  it("keeps kind: 'MONITOR' even when the proposal has zero findings (defensive)", () => {
    // buildLearningProposal always returns non-null, but in principle
    // buildGovernanceRecommendation must not assume findings.length > 0.
    const proposal: LearningProposal = {
      proposalId: "a8:2026-08-14T00:00:00.000Z:",
      generatedAt: ENGINE_NOW,
      findings: [],
    };
    const rec = buildGovernanceRecommendation(proposal);
    expect(rec.kind).toBe("MONITOR");
    expect(rec.supportingEvidence).toEqual([]);
    expect(rec.risks).toEqual([]);
  });

  it("flattens evidenceRefs from all findings into supportingEvidence", () => {
    const proposal = buildLearningProposal(
      [
        {
          findingId: "underperformer:cap-A",
          kind: "underperformer",
          identityKey: "cap-A",
          evidenceWindow: { from: "2026-07-15T00:00:00.000Z", to: ENGINE_NOW },
          occurrences: 3,
          evidenceRefs: ["e1", "e2"],
          summary: "3 ineffective outcomes",
        },
        {
          findingId: "outcome-contradiction:cap-B",
          kind: "outcome-contradiction",
          identityKey: "cap-B",
          evidenceWindow: { from: "2026-07-15T00:00:00.000Z", to: ENGINE_NOW },
          occurrences: 2,
          evidenceRefs: ["r1"],
          summary: "contradiction pattern",
        },
      ],
      ENGINE_NOW,
    );
    const rec = buildGovernanceRecommendation(proposal);
    expect(rec.supportingEvidence.sort()).toEqual(["e1", "e2", "r1"]);
  });

  it("threads proposalId and generatedAt through proposalId and createdAt", () => {
    const proposal = buildLearningProposal(
      [
        {
          findingId: "underperformer:cap-A",
          kind: "underperformer",
          identityKey: "cap-A",
          evidenceWindow: { from: "2026-07-15T00:00:00.000Z", to: ENGINE_NOW },
          occurrences: 3,
          evidenceRefs: ["e1"],
          summary: "ok",
        },
      ],
      ENGINE_NOW,
    );
    const rec = buildGovernanceRecommendation(proposal);
    expect(rec.proposalId).toBe(proposal.proposalId);
    expect(rec.createdAt).toBe(proposal.generatedAt);
    expect(rec.recommendationId).toBe(`a8-rec:${proposal.proposalId}`);
    expect(rec.evidenceId).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.confidence).toBe(1.0);
  });
});

describe("LearningProposal — structural non-executability sentinel (T6)", () => {
  it("does NOT carry mutation / execution / artifact fields (architectural invariant)", () => {
    const proposal = buildLearningProposal(
      [
        {
          findingId: "underperformer:cap-A",
          kind: "underperformer",
          identityKey: "cap-A",
          evidenceWindow: { from: "2026-07-15T00:00:00.000Z", to: ENGINE_NOW },
          occurrences: 3,
          evidenceRefs: ["e1"],
          summary: "ok",
        },
      ],
      ENGINE_NOW,
    );
    // ARCHITECTURAL SENTINEL: LearningProposal MUST NOT carry any of these
    // fields. If a future change adds one, this test will fail at compile-time
    // (because TS would not allow excess property access without `as any`),
    // which is exactly the structural guard we want. We use a single
    // assertion that names every forbidden field as a key.
    const forbiddenKeys = [
      "mutation",
      "artifactId",
      "proposedDefinition",
      "patch",
      "command",
    ] as const;
    for (const key of forbiddenKeys) {
      expect((proposal as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
    // Sanity: it DOES carry the allowed fields.
    expect(typeof proposal.proposalId).toBe("string");
    expect(typeof proposal.generatedAt).toBe("string");
    expect(Array.isArray(proposal.findings)).toBe(true);
  });
});