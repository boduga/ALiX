import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHandoffIntelligenceReport } from "../../src/governance/handoff-intelligence-report.js";
import type { HandoffIntelligenceRef } from "../../src/governance/handoff-intelligence-types.js";
import type { HumanExecutionEvidenceRef } from "../../src/governance/human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";
const WINDOW_START = "2026-07-01T00:00:00.000Z";
const WINDOW_END = "2026-07-09T00:00:00.000Z";
const NOW = "2026-07-09T12:00:00.000Z";

function handoff(overrides: Partial<HandoffIntelligenceRef> = {}): HandoffIntelligenceRef {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    handoffType: "config_update",
    createdAt: VALID_ISO,
    readinessLevel: "dry_run_capable",
    requiredEvidenceKinds: ["log_ref"],
    ...overrides,
  };
}

function evidence(overrides: Partial<HumanExecutionEvidenceRef> = {}): HumanExecutionEvidenceRef {
  return {
    evidenceId: "ev-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    kind: "log_ref",
    uri: "https://example.com/log",
    label: "Log",
    summary: "Done",
    submittedBy: "op",
    submittedAt: VALID_ISO,
    contentHash: null,
    auditRefs: [],
    ...overrides,
  };
}

function review(overrides: Partial<HumanExecutionClosureReview> = {}): HumanExecutionClosureReview {
  return {
    closureReviewId: "cr-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    decision: "accepted",
    rationale: "Good",
    reviewedBy: "rev",
    reviewedAt: VALID_ISO,
    evidenceIds: ["ev-1"],
    followUpRequired: false,
    followUpSummary: null,
    auditRefs: [],
    ...overrides,
  };
}

describe("buildHandoffIntelligenceReport", () => {
  it("empty inputs produce zero aggregates and no signals", () => {
    const report = buildHandoffIntelligenceReport([], [], [], { now: NOW, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.outcomeAggregate.totalHandoffs, 0);
    assert.equal(report.qualitySignals.length, 0);
    assert.equal(report.readinessCalibration.length, 0);
    assert.equal(report.summary.totalQualitySignals, 0);
  });

  it("all three computation stages compose correctly", () => {
    const report = buildHandoffIntelligenceReport(
      [handoff({ requiredEvidenceKinds: [] })],
      [evidence()],
      [review({ decision: "accepted" })],
      { now: NOW, since: WINDOW_START, until: WINDOW_END },
    );
    assert.equal(report.outcomeAggregate.totalHandoffs, 1);
    assert.equal(report.outcomeAggregate.byStatus.accepted, 1);
    assert.equal(report.readinessCalibration.length, 1);
  });

  it("JSON output shape is stable and schema-versioned", () => {
    const report = buildHandoffIntelligenceReport([], [], [], { now: NOW, since: WINDOW_START, until: WINDOW_END });
    const json = JSON.parse(JSON.stringify(report));
    assert.equal(json.schemaVersion, "p22.4-1");
    assert.ok(json.windowStart);
    assert.ok(json.windowEnd);
    assert.ok(json.outcomeAggregate);
    assert.ok(Array.isArray(json.qualitySignals));
    assert.ok(Array.isArray(json.readinessCalibration));
    assert.ok(json.summary);
  });

  it("no operator ranking language appears in output", () => {
    const report = buildHandoffIntelligenceReport(
      [handoff()], [evidence()], [review()],
      { now: NOW, since: WINDOW_START, until: WINDOW_END },
    );
    const json = JSON.stringify(report);
    assert.equal(json.includes("operatorId"), false);
    assert.equal(json.includes("ranking"), false);
    assert.equal(json.includes("leaderboard"), false);
    assert.equal(json.includes("productivity"), false);
  });

  it("window filtering is respected", () => {
    const old = handoff({ handoffId: "ho-old", createdAt: "2026-06-01T00:00:00.000Z" });
    const report = buildHandoffIntelligenceReport([old], [], [], { now: NOW, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.outcomeAggregate.totalHandoffs, 0);
  });

  it("summary counts are correct", () => {
    const report = buildHandoffIntelligenceReport(
      [handoff({ handoffId: "ho-rej", readinessLevel: "dry_run_capable", requiredEvidenceKinds: [] })],
      [evidence({ handoffId: "ho-rej", evidenceId: "ev-r" })],
      [review({ handoffId: "ho-rej", decision: "rejected", evidenceIds: ["ev-r"] })],
      { now: NOW, since: WINDOW_START, until: WINDOW_END },
    );
    assert.equal(report.summary.totalCalibrationSignals, 1);
    assert.equal(report.summary.overconfidentCount, 1);
    assert.equal(report.summary.underconfidentCount, 0);
  });
});
