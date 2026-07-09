import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateClosureOutcomes, OutcomeAggregateError } from "../../src/governance/handoff-outcome-aggregate.js";
import type { HandoffIntelligenceRef } from "../../src/governance/handoff-intelligence-types.js";
import type { HumanExecutionEvidenceRef } from "../../src/governance/human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";
const PERIOD_START = "2026-07-01T00:00:00.000Z";
const PERIOD_END = "2026-07-09T00:00:00.000Z";

function handoff(overrides: Partial<HandoffIntelligenceRef> = {}): HandoffIntelligenceRef {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    handoffType: "config_update",
    createdAt: VALID_ISO,
    readinessLevel: "dry_run_capable",
    requiredEvidenceKinds: ["log_ref", "manual_verification_note"],
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

describe("aggregateClosureOutcomes", () => {
  it("empty inputs produce zero aggregates", () => {
    const result = aggregateClosureOutcomes([], [], [], PERIOD_START, PERIOD_END);
    assert.equal(result.totalHandoffs, 0);
    assert.equal(result.byStatus.accepted, 0);
    assert.equal(result.byReadinessLevel.dry_run_capable, 0);
    assert.equal(result.byEvidenceCompleteness.none, 0);
  });

  it("accept/reject/incomplete/follow-up counts correct", () => {
    const ho1 = handoff({ handoffId: "ho-accepted", readinessLevel: "reversible" });
    const ho2 = handoff({ handoffId: "ho-rejected", readinessLevel: "dry_run_capable" });
    const ho3 = handoff({ handoffId: "ho-incomplete", readinessLevel: "reversible" });
    const ho4 = handoff({ handoffId: "ho-followup", readinessLevel: "manual_only" });
    const evAll = (id: string, eid: string) => evidence({ handoffId: id, evidenceId: eid, kind: "log_ref" });
    const result = aggregateClosureOutcomes(
      [ho1, ho2, ho3, ho4],
      [evAll("ho-accepted", "ev-a"), evAll("ho-rejected", "ev-r"), evAll("ho-incomplete", "ev-i"), evAll("ho-followup", "ev-f")],
      [
        review({ handoffId: "ho-accepted", decision: "accepted" }),
        review({ handoffId: "ho-rejected", decision: "rejected" }),
        review({ handoffId: "ho-incomplete", decision: "incomplete", followUpSummary: "More" }),
        review({ handoffId: "ho-followup", decision: "needs_follow_up", followUpSummary: "Follow" }),
      ],
      PERIOD_START, PERIOD_END,
    );
    assert.equal(result.totalHandoffs, 4);
    assert.equal(result.byStatus.accepted, 1);
    assert.equal(result.byStatus.rejected, 1);
    assert.equal(result.byStatus.incomplete, 1);
    assert.equal(result.byStatus.needsFollowUp, 1);
  });

  it("awaitingEvidence counted when no review or evidence", () => {
    const result = aggregateClosureOutcomes([handoff({ handoffId: "ho-new" })], [], [], PERIOD_START, PERIOD_END);
    assert.equal(result.byStatus.awaitingEvidence, 1);
  });

  it("readiness level grouping works", () => {
    const h1 = handoff({ handoffId: "h1", readinessLevel: "reversible" });
    const h2 = handoff({ handoffId: "h2", readinessLevel: "dry_run_capable" });
    const h3 = handoff({ handoffId: "h3", readinessLevel: "reversible" });
    const result = aggregateClosureOutcomes([h1, h2, h3], [], [], PERIOD_START, PERIOD_END);
    assert.equal(result.byReadinessLevel.reversible, 2);
    assert.equal(result.byReadinessLevel.dry_run_capable, 1);
    assert.equal(result.byReadinessLevel.manual_only, 0);
  });

  it("evidence completeness grouping works", () => {
    const hoNoEv = handoff({ handoffId: "ho-none", requiredEvidenceKinds: ["log_ref"] });
    const hoPartial = handoff({ handoffId: "ho-partial", requiredEvidenceKinds: ["log_ref", "screenshot_ref"] });
    const hoFull = handoff({ handoffId: "ho-full", requiredEvidenceKinds: ["log_ref"] });

    const result = aggregateClosureOutcomes(
      [hoNoEv, hoPartial, hoFull],
      [
        evidence({ handoffId: "ho-partial", evidenceId: "ev-p1", kind: "log_ref" }),
        evidence({ handoffId: "ho-full", evidenceId: "ev-f1", kind: "log_ref" }),
      ],
      [],
      PERIOD_START, PERIOD_END,
    );
    assert.equal(result.byEvidenceCompleteness.none, 1);
    assert.equal(result.byEvidenceCompleteness.partial, 1);
    assert.equal(result.byEvidenceCompleteness.full, 1);
  });

  it("respects [periodStart, periodEnd) window", () => {
    const old = handoff({ handoffId: "ho-old", createdAt: "2026-06-01T00:00:00.000Z" });
    const result = aggregateClosureOutcomes([old], [], [], PERIOD_START, PERIOD_END);
    assert.equal(result.totalHandoffs, 0);
  });

  it("rejects invalid period", () => {
    assert.throws(
      () => aggregateClosureOutcomes([], [], [], "invalid", PERIOD_END),
      OutcomeAggregateError,
    );
    assert.throws(
      () => aggregateClosureOutcomes([], [], [], PERIOD_END, PERIOD_START),
      OutcomeAggregateError,
    );
  });

  it("no operator identity in output", () => {
    const result = aggregateClosureOutcomes([handoff()], [], [], PERIOD_START, PERIOD_END);
    const json = JSON.stringify(result);
    assert.equal(json.includes("operatorId"), false);
    assert.equal(json.includes("ranking"), false);
    assert.equal(json.includes("leaderboard"), false);
  });
});
