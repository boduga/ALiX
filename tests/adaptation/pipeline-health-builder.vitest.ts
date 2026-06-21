import { describe, it, expect } from "vitest";
import { PipelineHealthBuilder } from "../../src/adaptation/pipeline-health-builder.js";
import type { PipelineHealthInput } from "../../src/adaptation/pipeline-health-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHealthyInput(
  overrides: Partial<PipelineHealthInput> = {},
): PipelineHealthInput {
  return {
    proposalCounts: {
      total: 5,
      pending: 2,
      approved: 1,
      applied: 2,
      rejected: 0,
      failed: 0,
    },
    scopedProposalInputs: [
      {
        contextConfidence: 0.8,
        ageDays: 5,
        lineageCompleteness: "complete",
        dataFreshness: { newestDays: 2, oldestDays: 10 },
      },
      {
        contextConfidence: 0.9,
        ageDays: 3,
        lineageCompleteness: "complete",
        dataFreshness: { newestDays: 1, oldestDays: 5 },
      },
    ],
    effectivenessReports: 14,
    intelligenceReports: 3,
    lifecycleEvents: { total: 89, inWindow: 42 },
    strategicBrief: { available: true, confidence: 0.85, findings: 3 },
    storeAvailability: {
      proposalStore: true,
      evidenceStore: true,
      effectivenessStore: true,
      intelligenceStore: true,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PipelineHealthBuilder", () => {
  // ---- Healthy ----

  it("returns healthy for a well-functioning pipeline", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const report = builder.build(input);
    expect(report.health).toBe("healthy");
    expect(report.scopedProposals.total).toBe(2);
    expect(report.scopedProposals.staleProposals).toBe(0);
    expect(report.scopedProposals.brokenLineage).toBe(0);
    expect(report.scopedProposals.confidence.contextAvg).toBeCloseTo(0.85, 2);
    expect(report.scopedProposals.confidence.sampleSize).toBe(2);
  });

  it("returns healthy for an empty system", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      proposalCounts: {
        total: 0,
        pending: 0,
        approved: 0,
        applied: 0,
        rejected: 0,
        failed: 0,
      },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      strategicBrief: { available: true, confidence: 0, findings: 0 },
    });
    const report = builder.build(input);
    expect(report.health).toBe("healthy");
    expect(report.scopedProposals.total).toBe(0);
    expect(report.scopedProposals.confidence.contextAvg).toBe(0);
  });

  // ---- attention_needed ----

  it("returns attention_needed when proposalStore is unavailable", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      storeAvailability: {
        proposalStore: false,
        evidenceStore: true,
        effectivenessStore: true,
        intelligenceStore: true,
      },
    });
    const report = builder.build(input);
    expect(report.health).toBe("attention_needed");
    expect(
      report.healthSignals.some(
        (s) => s.severity === "critical" && s.message.includes("ProposalStore"),
      ),
    ).toBe(true);
  });

  it("returns attention_needed when broken lineage exists", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 5,
          lineageCompleteness: "broken",
          dataFreshness: { newestDays: 1, oldestDays: 3 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("attention_needed");
    expect(report.scopedProposals.brokenLineage).toBe(1);
    expect(
      report.healthSignals.some(
        (s) => s.severity === "critical" && s.message.includes("broken lineage"),
      ),
    ).toBe(true);
  });

  // attention_needed wins over degraded
  it("attention_needed wins over degraded when both conditions exist", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 35, // stale
          lineageCompleteness: "broken", // broken
          dataFreshness: { newestDays: 1, oldestDays: 40 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("attention_needed");
    expect(report.scopedProposals.staleProposals).toBe(1);
    expect(report.scopedProposals.brokenLineage).toBe(1);
  });

  // ---- degraded — non-foundational store ----

  it("returns degraded when evidenceStore is unavailable", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      storeAvailability: {
        proposalStore: true,
        evidenceStore: false,
        effectivenessStore: true,
        intelligenceStore: true,
      },
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
  });

  it("returns degraded when effectivenessStore is unavailable", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      storeAvailability: {
        proposalStore: true,
        evidenceStore: true,
        effectivenessStore: false,
        intelligenceStore: true,
      },
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
  });

  it("returns degraded when intelligenceStore is unavailable", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      storeAvailability: {
        proposalStore: true,
        evidenceStore: true,
        effectivenessStore: true,
        intelligenceStore: false,
      },
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
  });

  // ---- degraded — stale proposals ----

  it("returns degraded when stale proposals exist", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 35,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 30, oldestDays: 40 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
    expect(report.scopedProposals.staleProposals).toBe(1);
    expect(
      report.healthSignals.some(
        (s) => s.severity === "warning" && s.message.includes("stale proposal"),
      ),
    ).toBe(true);
  });

  it("returns healthy when proposals are exactly at threshold (not stale)", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 30,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 30 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("healthy");
    expect(report.scopedProposals.staleProposals).toBe(0);
  });

  // ---- degraded — strategic brief ----

  it("returns degraded when strategic brief is unavailable with data", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      strategicBrief: { available: false, confidence: null, findings: 0 },
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
    expect(
      report.healthSignals.some(
        (s) =>
          s.severity === "warning" &&
          s.message.includes("Strategic brief unavailable"),
      ),
    ).toBe(true);
  });

  it("returns healthy when strategic brief is unavailable but no data", () => {
    const builder = new PipelineHealthBuilder();
    const empty = makeHealthyInput({
      proposalCounts: {
        total: 0,
        pending: 0,
        approved: 0,
        applied: 0,
        rejected: 0,
        failed: 0,
      },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      strategicBrief: { available: false, confidence: null, findings: 0 },
    });
    const report = builder.build(empty);
    // No data at all — strategic brief unavailability isn't meaningful
    expect(report.health).toBe("healthy");
  });

  // ---- degraded — low confidence ----

  it("returns degraded when context confidence is below threshold", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.2,
          ageDays: 5,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 3 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
    expect(report.scopedProposals.confidence.contextAvg).toBe(0.2);
    expect(
      report.healthSignals.some(
        (s) =>
          s.severity === "warning" && s.message.includes("context confidence"),
      ),
    ).toBe(true);
  });

  it("returns degraded when recommendation confidence is below threshold", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.5,
          recommendationConfidence: 0.2,
          ageDays: 5,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 3 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded");
    expect(report.scopedProposals.confidence.recommendationAvg).toBe(0.2);
  });

  // ---- Determinism ----

  it("is deterministic — same input produces same output", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const r1 = builder.build(input);
    const r2 = builder.build(input);
    expect(r1.health).toBe(r2.health);
    expect(r1.healthSignals.length).toBe(r2.healthSignals.length);
    expect(r1.scopedProposals.total).toBe(r2.scopedProposals.total);
    expect(r1.scopedProposals.staleProposals).toBe(r2.scopedProposals.staleProposals);
    expect(r1.scopedProposals.brokenLineage).toBe(r2.scopedProposals.brokenLineage);
    expect(r1.scopedProposals.confidence.contextAvg).toBe(
      r2.scopedProposals.confidence.contextAvg,
    );
    // id will differ because generatedAt differs, so exclude from comparison
  });

  it("is deterministic with explicit generatedAt", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const fixedTime = "2026-06-21T00:00:00.000Z";
    const r1 = builder.build(input, { generatedAt: fixedTime });
    const r2 = builder.build(input, { generatedAt: fixedTime });
    expect(r1).toEqual(r2);
  });

  // ---- Signals ----

  it("produces warning for stale and critical for broken lineage in combined scenario", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 40,
          lineageCompleteness: "broken",
          dataFreshness: { newestDays: 30, oldestDays: 50 },
        },
        {
          contextConfidence: 0.9,
          ageDays: 35,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 20, oldestDays: 40 },
        },
      ],
    });
    const report = builder.build(input);
    const severities = report.healthSignals.map((s) => s.severity);
    expect(severities).toContain("warning"); // stale
    expect(severities).toContain("critical"); // broken lineage
    expect(
      report.healthSignals.every(
        (s) => typeof s.message === "string" && s.message.length > 0,
      ),
    ).toBe(true);
  });

  it("produces info signal for no proposals in window", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      proposalCounts: {
        total: 0,
        pending: 0,
        approved: 0,
        applied: 0,
        rejected: 0,
        failed: 0,
      },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
    });
    const report = builder.build(input);
    expect(
      report.healthSignals.some(
        (s) =>
          s.severity === "info" && s.message.includes("No proposals"),
      ),
    ).toBe(true);
  });

  // ---- Store pass-through ----

  it("passes through storeAvailability and storeErrors", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      storeErrors: { evidenceStore: "Connection refused" },
    });
    const report = builder.build(input);
    expect(report.storeAvailability.proposalStore).toBe(true);
    expect(report.storeAvailability.evidenceStore).toBe(true);
    expect(report.storeErrors?.evidenceStore).toBe("Connection refused");
  });

  // ---- Window clamping ----

  it("clamps windowDays to 30 for invalid values", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const report = builder.build(input, { windowDays: 45 as any });
    expect(report.windowDays).toBe(30);
  });

  it("accepts valid window sizes 30, 90, 180", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    expect(builder.build(input, { windowDays: 30 }).windowDays).toBe(30);
    expect(builder.build(input, { windowDays: 90 }).windowDays).toBe(90);
    expect(builder.build(input, { windowDays: 180 }).windowDays).toBe(180);
  });

  it("defaults windowDays to 30 when not specified", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const report = builder.build(input);
    expect(report.windowDays).toBe(30);
  });

  // ---- Confidence calculation ----

  it("computes confidence as min(1, total/10) when proposals exist", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: Array.from({ length: 5 }, (_, i) => ({
        contextConfidence: 0.8,
        ageDays: i,
        lineageCompleteness: "complete" as const,
        dataFreshness: { newestDays: 1, oldestDays: i + 1 },
      })),
    });
    const report = builder.build(input);
    expect(report.confidence).toBe(0.5); // 5/10
  });

  it("computes confidence as 1 when no proposals", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      proposalCounts: {
        total: 0,
        pending: 0,
        approved: 0,
        applied: 0,
        rejected: 0,
        failed: 0,
      },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
    });
    const report = builder.build(input);
    expect(report.confidence).toBe(1);
  });

  it("caps confidence at 1 for many proposals", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: Array.from({ length: 20 }, (_, i) => ({
        contextConfidence: 0.8,
        ageDays: i,
        lineageCompleteness: "complete" as const,
        dataFreshness: { newestDays: 1, oldestDays: i + 1 },
      })),
    });
    const report = builder.build(input);
    expect(report.confidence).toBe(1);
  });

  // ---- Edge cases ----

  it("handles missing optional confidence fields", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.6,
          // no riskConfidence or recommendationConfidence
          ageDays: 5,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 3 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.scopedProposals.confidence.contextAvg).toBe(0.6);
    expect(report.scopedProposals.confidence.riskAvg).toBeUndefined();
    expect(report.scopedProposals.confidence.recommendationAvg).toBeUndefined();
    expect(report.health).toBe("healthy");
  });

  it("handles partial lineage without triggering broken", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.7,
          ageDays: 10,
          lineageCompleteness: "partial",
          dataFreshness: { newestDays: 2, oldestDays: 12 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.scopedProposals.brokenLineage).toBe(0);
    expect(report.health).toBe("healthy");
  });

  it("produces complete id format", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const report = builder.build(input);
    expect(report.id).toMatch(/^status:.*:30d$/);
  });

  it("includes reasons summarizing the pipeline state", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const report = builder.build(input);
    expect(report.reasons.length).toBeGreaterThan(0);
    expect(report.reasons.some((r) => r.includes("Status:"))).toBe(true);
    expect(report.reasons.some((r) => r.includes("Proposals:"))).toBe(true);
    expect(
      report.reasons.some((r) => r.includes("Strategic brief:")),
    ).toBe(true);
  });

  it("sets governanceReview to the expected defaults", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput();
    const report = builder.build(input);
    expect(report.governanceReview).toEqual({
      frameworkAvailable: true,
      liveLensExecutionAvailable: false,
      persistedReviews: false,
    });
  });

  it("computes dataFreshness correctly across multiple proposals", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 5,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 3, oldestDays: 15 },
        },
        {
          contextConfidence: 0.9,
          ageDays: 3,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 20 },
        },
        {
          contextConfidence: 0.7,
          ageDays: 10,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 5, oldestDays: 10 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.scopedProposals.dataFreshness.newestDays).toBe(1);
    expect(report.scopedProposals.dataFreshness.oldestDays).toBe(20);
  });

  // ---- Pluralization in signals ----

  it("uses singular for single stale proposal", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 35,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 36 },
        },
      ],
    });
    const report = builder.build(input);
    const staleSignal = report.healthSignals.find(
      (s) => s.message.includes("stale proposal"),
    );
    expect(staleSignal).toBeDefined();
    expect(staleSignal!.message).toMatch(/1 stale proposal/);
    expect(staleSignal!.message).not.toMatch(/proposals/);
  });

  it("uses plural for multiple stale proposals", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 35,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 36 },
        },
        {
          contextConfidence: 0.7,
          ageDays: 40,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 5, oldestDays: 45 },
        },
      ],
    });
    const report = builder.build(input);
    const staleSignal = report.healthSignals.find(
      (s) => s.message.includes("stale proposal"),
    );
    expect(staleSignal).toBeDefined();
    expect(staleSignal!.message).toMatch(/2 stale proposals/);
  });

  // ---- warnings field ----

  it("populates warnings when health signals exist", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          ageDays: 35,
          lineageCompleteness: "broken",
          dataFreshness: { newestDays: 1, oldestDays: 36 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.warnings).toBeDefined();
    expect(report.warnings!.length).toBeGreaterThan(0);
    expect(report.warnings![0].severity).toBeDefined();
    expect(report.warnings![0].message).toBeDefined();
  });

  it("populates warnings with info-level health signals", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      proposalCounts: {
        total: 0,
        pending: 0,
        approved: 0,
        applied: 0,
        rejected: 0,
        failed: 0,
      },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      storeAvailability: {
        proposalStore: true,
        evidenceStore: true,
        effectivenessStore: true,
        intelligenceStore: true,
      },
    });
    const report = builder.build(input);
    // "No proposals" info signal is still a health signal — warnings reflects it
    expect(report.warnings).toBeDefined();
    expect(report.warnings!.length).toBe(1);
    expect(report.warnings![0].severity).toBe("info");
  });

  // ---- Risk confidence average ----

  it("computes riskAvg when riskConfidence is provided", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.8,
          riskConfidence: 0.9,
          ageDays: 5,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 6 },
        },
        {
          contextConfidence: 0.9,
          riskConfidence: 0.7,
          ageDays: 3,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 4 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.scopedProposals.confidence.riskAvg).toBeCloseTo(0.8, 2);
  });

  // ---- Multiple conditions: stale + low confidence ----

  it("signals both stale and low confidence when both are present", () => {
    const builder = new PipelineHealthBuilder();
    const input = makeHealthyInput({
      scopedProposalInputs: [
        {
          contextConfidence: 0.2,
          ageDays: 35,
          lineageCompleteness: "complete",
          dataFreshness: { newestDays: 1, oldestDays: 40 },
        },
      ],
    });
    const report = builder.build(input);
    expect(report.health).toBe("degraded"); // first degraded condition
    expect(
      report.healthSignals.some((s) => s.message.includes("stale")),
    ).toBe(true);
    expect(
      report.healthSignals.some((s) => s.message.includes("context confidence")),
    ).toBe(true);
  });
});
