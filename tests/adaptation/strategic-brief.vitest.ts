/**
 * P6.3 — StrategicBrief comprehensive unit tests.
 *
 * Covers: type shape, builder behavior, window filtering, determinism,
 * runtime no-proposal-ID enforcement.
 */
import { describe, it, expect } from "vitest";
import { StrategicBriefBuilder } from "../../src/adaptation/strategic-brief.js";
import type { StrategicBrief, StrategicFinding, Trend, Hotspot, StrategicBriefInput } from "../../src/adaptation/strategic-brief-types.js";
import type { IntelligenceReport } from "../../src/adaptation/intelligence-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";
import type { EvidenceRecord } from "../../src/security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntelligenceReport(overrides: Partial<IntelligenceReport> = {}): IntelligenceReport {
  return {
    generatedAt: new Date().toISOString(),
    totalProposalsAnalyzed: 10,
    dataWindow: {
      oldestProposalCreatedAt: "2026-05-01T00:00:00.000Z",
      newestProposalCreatedAt: "2026-06-01T00:00:00.000Z",
      oldestEffectivenessAssessedAt: null,
    },
    executiveSummary: "All metrics stable within expected ranges.",
    buckets: {
      byAction: { dimension: "byAction", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byTargetKind: { dimension: "byTargetKind", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      bySourceRecommendationType: { dimension: "bySourceRecommendationType", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byProvenance: { dimension: "byProvenance", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byCapability: { dimension: "byCapability", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byOutcome: { dimension: "byOutcome", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
    },
    confidenceCalibration: {
      buckets: [],
      totalAssessed: 0,
      confidenceOutcomeCorrelation: null,
    },
    revertSignalAnalysis: {
      totalAdvisoryReverts: 0,
      totalActualReverts: 0,
      totalUnactedReverts: 0,
      revertPrecision: null,
      topUnactedRevertBuckets: [],
      humansOverruledCount: 0,
    },
    topPerforming: [],
    lowestPerforming: [],
    ...overrides,
  } as IntelligenceReport;
}

function makeEffectivenessReport(overrides: Partial<ProposalEffectivenessReport> = {}): ProposalEffectivenessReport {
  return {
    proposalId: `prop-test-${Date.now()}`,
    assessedAt: new Date().toISOString(),
    appliedAt: new Date().toISOString(),
    windowDays: 7,
    metricsBefore: {
      workflowsAborted: 0,
      workflowsBlocked: 0,
      unresolvedCapabilities: 0,
      capabilitiesRequested: 0,
      reviewApprovalRate: 1,
    },
    metricsAfter: {
      workflowsAborted: 0,
      workflowsBlocked: 0,
      unresolvedCapabilities: 0,
      capabilitiesRequested: 0,
      reviewApprovalRate: 1,
    },
    primary: null,
    dataSufficient: true,
    recommendation: "keep",
    reason: "Test assessment",
    ...overrides,
  } as ProposalEffectivenessReport;
}

function makeEvidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    version: 1 as const,
    id: `evt-${Date.now()}`,
    type: "adaptation_applied",
    timestamp: new Date().toISOString(),
    fingerprint: "test-fingerprint",
    payload: {},
    ...overrides,
  } as EvidenceRecord;
}

function makeInput(overrides: Partial<StrategicBriefInput> = {}): StrategicBriefInput {
  return {
    intelligenceReports: overrides.intelligenceReports ?? [makeIntelligenceReport()],
    effectivenessReports: overrides.effectivenessReports ?? [makeEffectivenessReport()],
    evidenceRecords: overrides.evidenceRecords ?? [makeEvidenceRecord()],
  };
}

// ---------------------------------------------------------------------------
// Type shape
// ---------------------------------------------------------------------------

describe("StrategicBrief type shape", () => {
  it("extends DecisionArtifact — has id, subject, outcome, confidence, reasons, generatedAt", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    expect(brief.id).toBeDefined();
    expect(brief.subject).toBeDefined();
    expect(brief.outcome).toBe("brief");
    expect(typeof brief.confidence).toBe("number");
    expect(Array.isArray(brief.reasons)).toBe(true);
    expect(brief.generatedAt).toBeDefined();
  });

  it("has period, findings, trends, hotspots, strategicActions", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    expect(brief.period).toBeDefined();
    expect(brief.period.start).toBeDefined();
    expect(brief.period.end).toBeDefined();
    expect(Array.isArray(brief.findings)).toBe(true);
    expect(Array.isArray(brief.trends)).toBe(true);
    expect(Array.isArray(brief.hotspots)).toBe(true);
    expect(Array.isArray(brief.strategicActions)).toBe(true);
  });

  it("StrategicFinding has category, summary, detail, confidence, evidenceRefs", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    if (brief.findings.length > 0) {
      const f = brief.findings[0];
      expect(["trend", "hotspot", "system_warning", "strategic_observation"]).toContain(f.category);
      expect(typeof f.summary).toBe("string");
      expect(typeof f.detail).toBe("string");
      expect(typeof f.confidence).toBe("number");
      expect(Array.isArray(f.evidenceRefs)).toBe(true);
    }
  });

  it("Trend has metric, direction, magnitude, sampleSize", () => {
    const builder = new StrategicBriefBuilder();
    // Need at least 2 intelligence reports to trigger trend detection
    const reports = [
      makeIntelligenceReport({ generatedAt: "2026-04-01T00:00:00.000Z" }),
      makeIntelligenceReport({ generatedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const brief = builder.build(makeInput({ intelligenceReports: reports }));
    // May or may not have trends depending on data, but structure must be valid
    for (const t of brief.trends) {
      expect(typeof t.metric).toBe("string");
      expect(["increasing", "decreasing", "stable"]).toContain(t.direction);
      expect(typeof t.magnitude).toBe("number");
      expect(typeof t.sampleSize).toBe("number");
    }
  });

  it("Hotspot has area, severity, relatedActionTypes, evidence", () => {
    // Provide effectiveness reports with high revert rate to trigger hotspot detection
    const reports = [
      makeEffectivenessReport({ recommendation: "revert" }),
      makeEffectivenessReport({ recommendation: "revert" }),
      makeEffectivenessReport({ recommendation: "keep" }),
    ];
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput({ effectivenessReports: reports }));
    for (const h of brief.hotspots) {
      expect(typeof h.area).toBe("string");
      expect(["low", "medium", "high"]).toContain(h.severity);
      expect(Array.isArray(h.relatedActionTypes)).toBe(true);
      expect(typeof h.evidence).toBe("string");
    }
  });

  it("has sourceArtifacts array", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    expect(Array.isArray(brief.sourceArtifacts)).toBe(true);
    // Should have at least one artifact from each input source
    expect(brief.sourceArtifacts.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Builder behavior
// ---------------------------------------------------------------------------

describe("StrategicBriefBuilder — empty inputs", () => {
  it("produces system_warning findings, empty trends, empty hotspots", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build({
      intelligenceReports: [],
      effectivenessReports: [],
      evidenceRecords: [],
    });
    expect(brief.findings.length).toBeGreaterThanOrEqual(2); // system warnings
    expect(brief.trends).toEqual([]);
    expect(brief.hotspots).toEqual([]);
    // All findings should be system_warnings when no data available
    for (const f of brief.findings) {
      expect(f.category).toBe("system_warning");
    }
  });
});

describe("StrategicBriefBuilder — window filtering", () => {
  it("only includes records within the window", () => {
    const fixedNow = "2026-06-21T12:00:00.000Z";
    const withinWindow = makeIntelligenceReport({ generatedAt: "2026-06-15T00:00:00.000Z" });
    const outsideWindow = makeIntelligenceReport({ generatedAt: "2026-04-01T00:00:00.000Z" });
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(
      { intelligenceReports: [withinWindow, outsideWindow], effectivenessReports: [], evidenceRecords: [] },
      { generatedAt: fixedNow, window: 30 },
    );
    // Only 1 report in window → < 2 reports so trends = []
    // System warning for missing effectiveness/evidence
    expect(brief.trends).toEqual([]);
  });
});

describe("StrategicBriefBuilder — determinism", () => {
  it("same inputs + same generatedAt → same output", () => {
    const frozenTime = "2026-06-21T12:00:00.000Z";
    const input = makeInput();
    const builder = new StrategicBriefBuilder();
    const run1 = builder.build(input, { generatedAt: frozenTime });
    const run2 = builder.build(input, { generatedAt: frozenTime });
    expect(run1.id).toBe(run2.id);
    expect(run1.subject).toBe(run2.subject);
    expect(run1.period.start).toBe(run2.period.start);
    expect(run1.period.end).toBe(run2.period.end);
    expect(run1.confidence).toBe(run2.confidence);
    expect(run1.findings.length).toBe(run2.findings.length);
    expect(run1.trends.length).toBe(run2.trends.length);
    expect(run1.hotspots.length).toBe(run2.hotspots.length);
    expect(run1.strategicActions.length).toBe(run2.strategicActions.length);
  });

  it("different generatedAt produces different id and period", () => {
    const input = makeInput();
    const builder = new StrategicBriefBuilder();
    const run1 = builder.build(input, { generatedAt: "2026-06-01T00:00:00.000Z" });
    const run2 = builder.build(input, { generatedAt: "2026-06-21T00:00:00.000Z" });
    expect(run1.id).not.toBe(run2.id);
    expect(run1.period.start).not.toBe(run2.period.start);
  });
});

describe("StrategicBriefBuilder — confidence", () => {
  it("confidence reflects data sufficiency", () => {
    // 0 records out of 30 target → ~0
    const builder = new StrategicBriefBuilder();
    const empty = builder.build({ intelligenceReports: [], effectivenessReports: [], evidenceRecords: [] });
    expect(empty.confidence).toBe(0);

    // Exactly 30 records → confidence 1
    const reports30 = Array.from({ length: 30 }, (_, i) =>
      makeEffectivenessReport({ proposalId: `prop-${i}`, assessedAt: "2026-06-15T00:00:00.000Z" })
    );
    const full = builder.build(
      { intelligenceReports: [], effectivenessReports: reports30, evidenceRecords: [] },
      { generatedAt: "2026-06-21T12:00:00.000Z", window: 30 },
    );
    expect(full.confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No proposal IDs in output (runtime)
// ---------------------------------------------------------------------------

describe("StrategicBrief — no proposal IDs in output", () => {
  it("output JSON must not contain prop- when input contains real proposal IDs", () => {
    const inputWithRealIds: StrategicBriefInput = {
      intelligenceReports: [makeIntelligenceReport()],
      effectivenessReports: [
        makeEffectivenessReport({ proposalId: "prop-2026-06-21-005" }),
        makeEffectivenessReport({ proposalId: "prop-2026-06-21-006" }),
      ],
      evidenceRecords: [makeEvidenceRecord()],
    };
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(inputWithRealIds);
    const json = JSON.stringify(brief);

    // Check output fields that must NOT contain proposal IDs
    for (const finding of brief.findings) {
      expect(finding.summary).not.toContain("prop-");
      expect(finding.detail).not.toContain("prop-");
    }
    for (const trend of brief.trends) {
      expect(trend.metric).not.toContain("prop-");
    }
    for (const hotspot of brief.hotspots) {
      expect(hotspot.area).not.toContain("prop-");
      expect(hotspot.evidence).not.toContain("prop-");
    }
    for (const action of brief.strategicActions) {
      expect(action).not.toContain("prop-");
    }
    // Also verify the full JSON blobs don't have prop- in output content
    // (findings, trends, hotspots, strategicActions)
    const outputOnly = JSON.stringify({
      findings: brief.findings,
      trends: brief.trends,
      hotspots: brief.hotspots,
      strategicActions: brief.strategicActions,
    });
    expect(outputOnly).not.toContain("prop-");
  });
});

// ---------------------------------------------------------------------------
// No per-proposal directive language
// ---------------------------------------------------------------------------

describe("StrategicBrief — no per-proposal recommendations", () => {
  it("output must not contain approve/reject proposal directives", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    const json = JSON.stringify(brief);

    // Forbidden patterns
    expect(json).not.toContain('"approve proposal');
    expect(json).not.toContain('"reject proposal');
    expect(json).not.toContain('"approve prop-');
    expect(json).not.toContain('"reject prop-');

    // But historical metrics like "approval rate" ARE allowed
    // (no test needed — this checks we don't ban those)
  });
});
