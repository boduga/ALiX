import { describe, it, expect } from "vitest";
import type {
  DetectorFinding,
  EnrichedProposalRecord,
  ProposalEventRecord,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  detectTrustVelocity,
  TRUST_VELOCITY_KIND,
  TRUST_VELOCITY_TRIGGER_SCORE,
  TRUST_VELOCITY_WEIGHTS,
} from "../../src/evolution/a9/detectors/trust-velocity-detector.js";
import {
  detectEvidenceCompleteness,
  EVIDENCE_COMPLETENESS_KIND,
  EVIDENCE_COMPLETENESS_TRIGGER_SCORE,
} from "../../src/evolution/a9/detectors/evidence-completeness-detector.js";
import {
  detectFingerprintCoincidence,
  FINGERPRINT_COINCIDENCE_KIND,
  FINGERPRINT_COINCIDENCE_TRIGGER_SCORE,
  FINGERPRINT_COINCIDENCE_MIN_OCCURRENCES,
  normalizeFingerprint,
} from "../../src/evolution/a9/detectors/fingerprint-coincidence-detector.js";

const NOW = "2026-08-14T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function submittedRecord(
  proposalId: string,
  capabilityId: string,
  candidateOverrides: Record<string, unknown> = {},
): ProposalEventRecord {
  return {
    proposalId,
    capabilityId,
    kind: "proposal.submitted",
    payload: {
      candidate: {
        candidateId: `c-${proposalId}`,
        sourcePatternId: "gap",
        confidence: 0.8,
        target: { kind: "capability", id: capabilityId },
        description: "d",
        expectedEffect: "e",
        riskClass: "high",
        evidenceIds: ["ev-1", "ev-2"],
        ...candidateOverrides,
      },
      signalIds: [],
      sourceVersion: null,
    },
    recordedAt: "2026-08-10T00:00:00.000Z",
    eventId: `evt-${proposalId}`,
  };
}

function failedRecord(proposalId: string, error: string, overrides: Partial<ProposalEventRecord> = {}): ProposalEventRecord {
  return {
    proposalId,
    capabilityId: "",
    kind: "proposal.execution_failed",
    payload: { error, partialState: "not_committed" },
    recordedAt: "2026-08-10T00:00:00.000Z",
    eventId: `evt-${proposalId}`,
    ...overrides,
  };
}

function enrichedRecord(overrides: Partial<EnrichedProposalRecord> = {}): EnrichedProposalRecord {
  return {
    proposalId: "ep-1",
    capabilityId: "cap-1",
    enrichedFields: ["proposal", "effectivenessReport"],
    recordedAt: NOW,
    sourceConfidence: 0.8,
    evidenceFingerprints: ["fp-1"],
    assessment: {
      hasEffectivenessReport: false,
      hasRevertDecision: false,
      hasTimeToApproval: false,
      hasTimeToApply: false,
    },
    ...overrides,
  };
}

// ===========================================================================
// Trust velocity detector
// ===========================================================================

describe("detectTrustVelocity", () => {
  it("exposes the detector kind constant", () => {
    expect(TRUST_VELOCITY_KIND).toBe("trust-velocity");
  });

  it("returns 0 findings for empty input", () => {
    expect(detectTrustVelocity([])).toEqual([]);
  });

  it("is deterministic — same input twice produces identical findings", () => {
    const records = [submittedRecord("p1", "cap-1")];
    expect(detectTrustVelocity(records)).toEqual(detectTrustVelocity(records));
  });

  it("returns 0 findings below the trigger (low-risk proposal)", () => {
    const records = [submittedRecord("p1", "cap-1", { riskClass: "low" })];
    expect(TRUST_VELOCITY_TRIGGER_SCORE).toBe(0.3);
    expect(detectTrustVelocity(records)).toEqual([]);
  });

  it("emits a finding for an above-trigger proposal with preserved evidence refs", () => {
    const records = [submittedRecord("p1", "cap-1", { riskClass: "high", confidence: 0.8, evidenceIds: ["ev-1", "ev-2"] })];
    const findings = detectTrustVelocity(records);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      subject: "p1",
      subjectCapability: "cap-1",
      kind: "trust-velocity",
      internalScore: TRUST_VELOCITY_WEIGHTS.riskClassBase.high, // 0.7
      confidence: 0.8,
      evidenceRefs: ["ev-1", "ev-2"],
    });
  });

  it("adds the consolidation bonus for absorbedCapabilityIds (blast radius / replacement targets)", () => {
    const records = [
      submittedRecord("p1", "cap-1", { riskClass: "medium", absorbedCapabilityIds: ["cap-2", "cap-3"] }),
    ];
    const [f] = detectTrustVelocity(records);
    expect(f!.internalScore).toBeCloseTo(
      TRUST_VELOCITY_WEIGHTS.riskClassBase.medium + TRUST_VELOCITY_WEIGHTS.consolidationBonus,
      10,
    );
  });

  it("ignores non-submitted events", () => {
    const records: ProposalEventRecord[] = [
      failedRecord("p1", "boom"),
      { ...submittedRecord("p2", "cap-2"), kind: "proposal.approved" },
    ];
    expect(detectTrustVelocity(records)).toEqual([]);
  });

  it("falls back to the eventId when the candidate carries no evidenceIds", () => {
    const records = [submittedRecord("p1", "cap-1", { riskClass: "high", evidenceIds: [] })];
    const [f] = detectTrustVelocity(records);
    expect(f!.evidenceRefs).toEqual(["evt-p1"]);
  });

  it("sorts findings by subject for deterministic output", () => {
    const records = [
      submittedRecord("p-zeta", "cap-Z"),
      submittedRecord("p-alpha", "cap-A"),
    ];
    const findings = detectTrustVelocity(records);
    expect(findings.map((f) => f.subject)).toEqual(["p-alpha", "p-zeta"]);
  });
});

// ===========================================================================
// Evidence completeness detector
// ===========================================================================

describe("detectEvidenceCompleteness", () => {
  it("exposes the detector kind constant", () => {
    expect(EVIDENCE_COMPLETENESS_KIND).toBe("evidence-completeness");
  });

  it("returns 0 findings for empty input", () => {
    expect(detectEvidenceCompleteness([], NOW)).toEqual([]);
  });

  it("is deterministic — same input twice produces identical findings", () => {
    const records = [enrichedRecord()];
    expect(detectEvidenceCompleteness(records, NOW)).toEqual(
      detectEvidenceCompleteness(records, NOW),
    );
  });

  it("returns 0 findings for a complete, fresh, diverse record (below trigger)", () => {
    const records = [
      enrichedRecord({
        proposalId: "ep-complete",
        recordedAt: NOW,
        evidenceFingerprints: ["fp-1", "fp-2", "fp-3"],
        assessment: {
          hasEffectivenessReport: true,
          hasRevertDecision: true,
          hasTimeToApproval: true,
          hasTimeToApply: true,
        },
      }),
    ];
    expect(EVIDENCE_COMPLETENESS_TRIGGER_SCORE).toBe(0.4);
    expect(detectEvidenceCompleteness(records, NOW)).toEqual([]);
  });

  it("emits a finding for an incomplete record, preserving evidence fingerprints", () => {
    const records = [
      enrichedRecord({
        proposalId: "ep-incomplete",
        recordedAt: NOW,
        evidenceFingerprints: ["fp-1"],
        assessment: {
          hasEffectivenessReport: false,
          hasRevertDecision: false,
          hasTimeToApproval: false,
          hasTimeToApply: false,
        },
      }),
    ];
    const findings = detectEvidenceCompleteness(records, NOW);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.subject).toBe("ep-incomplete");
    expect(f.subjectCapability).toBe("cap-1");
    expect(f.kind).toBe("evidence-completeness");
    expect(f.evidenceRefs).toEqual(["fp-1"]);
    expect(f.internalScore).toBeGreaterThanOrEqual(EVIDENCE_COMPLETENESS_TRIGGER_SCORE);
  });

  it("scores stale records as more incomplete (recency axis)", () => {
    const fresh = enrichedRecord({ recordedAt: NOW, evidenceFingerprints: [] });
    const stale = enrichedRecord({ recordedAt: "2026-01-01T00:00:00.000Z", evidenceFingerprints: [] });
    const [freshFinding] = detectEvidenceCompleteness([fresh], NOW);
    const [staleFinding] = detectEvidenceCompleteness([stale], NOW);
    // Both below-trigger on population+diversity alone? fresh: 0.5*1 + 0 + 0.25*(2/3) = 0.667 → fires.
    // stale: same population/diversity but recency 0 → strictly higher.
    expect(staleFinding!.internalScore).toBeGreaterThan(freshFinding!.internalScore);
  });

  it("sorts findings by subject for deterministic output", () => {
    const records = [
      enrichedRecord({ proposalId: "ep-z", capabilityId: "cap-Z" }),
      enrichedRecord({ proposalId: "ep-a", capabilityId: "cap-A" }),
    ];
    const findings = detectEvidenceCompleteness(records, NOW);
    expect(findings.map((f) => f.subject)).toEqual(["ep-a", "ep-z"]);
  });
});

// ===========================================================================
// Fingerprint coincidence detector
// ===========================================================================

describe("detectFingerprintCoincidence", () => {
  it("exposes the detector kind constant and normalization", () => {
    expect(FINGERPRINT_COINCIDENCE_KIND).toBe("fingerprint-coincidence");
    expect(FINGERPRINT_COINCIDENCE_MIN_OCCURRENCES).toBe(2);
    expect(normalizeFingerprint("  Timeout Waiting For Registry  ")).toBe("timeout waiting for registry");
  });

  it("returns 0 findings for empty input", () => {
    expect(detectFingerprintCoincidence([], NOW)).toEqual([]);
  });

  it("is deterministic — same input twice produces identical findings", () => {
    const records: ProposalEventRecord[] = [
      submittedRecord("f1", "cap-1"),
      submittedRecord("f2", "cap-1"),
      failedRecord("f1", "Timeout waiting for registry", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("f2", "timeout waiting for registry", { recordedAt: "2026-08-11T00:00:00.000Z" }),
    ];
    expect(detectFingerprintCoincidence(records, NOW)).toEqual(
      detectFingerprintCoincidence(records, NOW),
    );
  });

  it("returns 0 findings below the trigger (low prior failure density)", () => {
    // 10 submitted proposals for cap-1, 2 failures → density 0.2 →
    // 0.6*(2/5) + 0.4*0.2 = 0.32 < 0.5 → no finding.
    const records: ProposalEventRecord[] = [];
    for (let i = 0; i < 10; i++) records.push(submittedRecord(`f${i}`, "cap-1"));
    records.push(failedRecord("f0", "timeout", { recordedAt: "2026-08-10T00:00:00.000Z" }));
    records.push(failedRecord("f1", "timeout", { recordedAt: "2026-08-11T00:00:00.000Z" }));
    expect(FINGERPRINT_COINCIDENCE_TRIGGER_SCORE).toBe(0.5);
    expect(detectFingerprintCoincidence(records, NOW)).toEqual([]);
  });

  it("emits a finding for a recurrent failure fingerprint, joining capabilityId via submitted", () => {
    const records: ProposalEventRecord[] = [
      submittedRecord("f1", "cap-1"),
      submittedRecord("f2", "cap-1"),
      failedRecord("f1", "Timeout waiting for registry", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("f2", "timeout waiting for registry", { recordedAt: "2026-08-11T00:00:00.000Z" }),
    ];
    const findings = detectFingerprintCoincidence(records, NOW);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.kind).toBe("fingerprint-coincidence");
    expect(f.subjectCapability).toBe("cap-1");
    // Subject = the most recent failure in the group.
    expect(f.subject).toBe("f2");
    // Evidence refs = member eventIds in recordedAt order.
    expect(f.evidenceRefs).toEqual(["evt-f1", "evt-f2"]);
    expect(f.internalScore).toBeGreaterThanOrEqual(FINGERPRINT_COINCIDENCE_TRIGGER_SCORE);
  });

  it("emits one finding per distinct fingerprint group", () => {
    const records: ProposalEventRecord[] = [
      submittedRecord("f1", "cap-1"),
      submittedRecord("f2", "cap-1"),
      submittedRecord("g1", "cap-2"),
      submittedRecord("g2", "cap-2"),
      failedRecord("f1", "timeout", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("f2", "timeout", { recordedAt: "2026-08-11T00:00:00.000Z" }),
      failedRecord("g1", "diverged", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("g2", "diverged", { recordedAt: "2026-08-11T00:00:00.000Z" }),
    ];
    const findings = detectFingerprintCoincidence(records, NOW);
    expect(findings).toHaveLength(2);
    const bySubject = Object.fromEntries(findings.map((f) => [f.subject, f]));
    expect(bySubject["f2"]?.subjectCapability).toBe("cap-1");
    expect(bySubject["g2"]?.subjectCapability).toBe("cap-2");
  });

  it("ignores non-execution_failed events entirely", () => {
    const records: ProposalEventRecord[] = [
      submittedRecord("p1", "cap-1"),
      submittedRecord("p2", "cap-1"),
      { ...submittedRecord("p1", "cap-1"), kind: "proposal.approved" },
      { ...submittedRecord("p2", "cap-1"), kind: "proposal.rejected" },
    ];
    expect(detectFingerprintCoincidence(records, NOW)).toEqual([]);
  });

  it("excludes future-dated evidence (determinism against `now`)", () => {
    const records: ProposalEventRecord[] = [
      submittedRecord("f1", "cap-1"),
      submittedRecord("f2", "cap-1"),
      failedRecord("f1", "timeout", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("f2", "timeout", { recordedAt: "2026-09-01T00:00:00.000Z" }), // after now
    ];
    expect(detectFingerprintCoincidence(records, NOW)).toEqual([]);
  });

  it("detects colon-bearing error fingerprints with the exact capabilityId (no colon-slice corruption)", () => {
    // Regression: the error string itself contains a colon ("TypeError: …").
    // The capabilityId must be recovered as a first-class value, NOT by slicing
    // the fingerprint at the first colon (which would corrupt it to
    // " cannot read properties of undefined:cap-1" and zero the density).
    const records: ProposalEventRecord[] = [
      submittedRecord("f1", "cap-1"),
      submittedRecord("f2", "cap-1"),
      failedRecord("f1", "TypeError: Cannot read properties of undefined", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("f2", "TypeError: Cannot read properties of undefined", { recordedAt: "2026-08-11T00:00:00.000Z" }),
    ];
    const findings = detectFingerprintCoincidence(records, NOW);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.subjectCapability).toBe("cap-1"); // exact, not colon-truncated
    expect(f.subject).toBe("f2");
    // Density computed correctly: 2 failures / 2 submitted for cap-1 → 1.0.
    // 0.6 * (2/5) + 0.4 * 1.0 = 0.24 + 0.4 = 0.64.
    expect(f.internalScore).toBeCloseTo(0.64, 10);
    expect(f.confidence).toBeCloseTo(1.0, 10);
  });

  it("keeps colon-bearing error groups distinct per capability (no cross-capability merge)", () => {
    const records: ProposalEventRecord[] = [
      submittedRecord("f1", "cap-1"),
      submittedRecord("f2", "cap-1"),
      submittedRecord("g1", "cap-2"),
      submittedRecord("g2", "cap-2"),
      failedRecord("f1", "TypeError: x is not a function", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("f2", "TypeError: x is not a function", { recordedAt: "2026-08-11T00:00:00.000Z" }),
      failedRecord("g1", "TypeError: x is not a function", { recordedAt: "2026-08-10T00:00:00.000Z" }),
      failedRecord("g2", "TypeError: x is not a function", { recordedAt: "2026-08-11T00:00:00.000Z" }),
    ];
    const findings = detectFingerprintCoincidence(records, NOW);
    expect(findings).toHaveLength(2);
    const bySubject = Object.fromEntries(findings.map((f) => [f.subject, f]));
    expect(bySubject["f2"]?.subjectCapability).toBe("cap-1");
    expect(bySubject["g2"]?.subjectCapability).toBe("cap-2");
  });
});

// ---------------------------------------------------------------------------
// Detector output shape — shared contract
// ---------------------------------------------------------------------------

describe("DetectorFinding shape", () => {
  it("every finding is a plain, read-only-shaped DetectorFinding", () => {
    const records = [submittedRecord("p1", "cap-1")];
    const findings: ReadonlyArray<DetectorFinding> = detectTrustVelocity(records);
    const f: DetectorFinding = findings[0]!;
    expect(typeof f.subject).toBe("string");
    expect(typeof f.subjectCapability).toBe("string");
    expect(typeof f.kind).toBe("string");
    expect(typeof f.internalScore).toBe("number");
    expect(typeof f.confidence).toBe("number");
    expect(Array.isArray(f.evidenceRefs)).toBe(true);
  });
});
