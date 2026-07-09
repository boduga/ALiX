import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHumanExecutionClosureReport,
  type HandoffRef,
} from "../../src/governance/human-execution-closure-report.js";
import type { HumanExecutionEvidenceRef } from "../../src/governance/human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";

const NOW = "2026-07-09T12:00:00.000Z";
const WINDOW_START = "2026-07-01T00:00:00.000Z";
const VALID_ISO = "2026-07-08T18:00:00.000Z";

function handoff(overrides: Partial<HandoffRef> = {}): HandoffRef {
  return {
    handoffId: "ho-1",
    preparedRecordId: null,
    title: "Test handoff",
    createdAt: VALID_ISO,
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
    auditRefs: ["ar-1"],
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
    auditRefs: ["ar-2"],
    ...overrides,
  };
}

describe("buildHumanExecutionClosureReport", () => {
  it("empty inputs produce zero totals", () => {
    const report = buildHumanExecutionClosureReport([], [], [], { now: NOW, since: WINDOW_START, until: NOW });
    assert.equal(report.items.length, 0);
    assert.deepEqual(report.totals, {
      handoffs: 0, withEvidence: 0,
      accepted: 0, rejected: 0, incomplete: 0, needsFollowUp: 0, awaitingEvidence: 0,
    });
  });

  it("handoff without evidence shows awaiting_evidence", () => {
    const report = buildHumanExecutionClosureReport([handoff()], [], [], { now: NOW, since: WINDOW_START, until: NOW });
    assert.equal(report.items[0]!.status, "awaiting_evidence");
    assert.equal(report.totals.awaitingEvidence, 1);
  });

  it("handoff with evidence shows evidence_submitted", () => {
    const report = buildHumanExecutionClosureReport(
      [handoff()], [evidence()], [], { now: NOW, since: WINDOW_START, until: NOW },
    );
    assert.equal(report.items[0]!.status, "evidence_submitted");
    assert.equal(report.totals.withEvidence, 1);
  });

  it("handoff with accepted review shows accepted", () => {
    const report = buildHumanExecutionClosureReport(
      [handoff()], [evidence()], [review()], { now: NOW, since: WINDOW_START, until: NOW },
    );
    assert.equal(report.items[0]!.status, "accepted");
    assert.equal(report.totals.accepted, 1);
  });

  it("handoff with rejected review shows rejected", () => {
    const report = buildHumanExecutionClosureReport(
      [handoff()], [evidence()], [review({ decision: "rejected" })],
      { now: NOW, since: WINDOW_START, until: NOW },
    );
    assert.equal(report.items[0]!.status, "rejected");
    assert.equal(report.totals.rejected, 1);
  });

  it("handoff with incomplete review shows incomplete", () => {
    const report = buildHumanExecutionClosureReport(
      [handoff()], [evidence()],
      [review({ decision: "incomplete", followUpSummary: "Need more" })],
      { now: NOW, since: WINDOW_START, until: NOW },
    );
    assert.equal(report.items[0]!.status, "incomplete");
    assert.equal(report.totals.incomplete, 1);
  });

  it("needs-follow-up review shows correct status", () => {
    const report = buildHumanExecutionClosureReport(
      [handoff()], [evidence()],
      [review({ decision: "needs_follow_up", followUpSummary: "Follow up needed" })],
      { now: NOW, since: WINDOW_START, until: NOW },
    );
    assert.equal(report.items[0]!.status, "needs_follow_up");
    assert.equal(report.totals.needsFollowUp, 1);
  });

  it("follow-up items sort first", () => {
    const ho1 = handoff({ handoffId: "ho-needs" });
    const ho2 = handoff({ handoffId: "ho-accepted", createdAt: "2026-07-08T19:00:00.000Z" });
    const report = buildHumanExecutionClosureReport(
      [ho2, ho1],
      [evidence({ handoffId: "ho-needs" }), evidence({ handoffId: "ho-accepted", evidenceId: "ev-2" })],
      [
        review({ handoffId: "ho-needs", decision: "needs_follow_up", followUpSummary: "More needed" }),
        review({ handoffId: "ho-accepted", closureReviewId: "cr-2", decision: "accepted" }),
      ],
      { now: NOW, since: WINDOW_START, until: NOW },
    );
    assert.equal(report.items[0]!.handoffId, "ho-needs");
    assert.equal(report.items[1]!.handoffId, "ho-accepted");
  });

  it("respects [since, until) window", () => {
    const old = handoff({ handoffId: "ho-old", createdAt: "2026-06-01T00:00:00.000Z" });
    const report = buildHumanExecutionClosureReport([old], [], [], { now: NOW, since: WINDOW_START, until: NOW });
    assert.equal(report.items.length, 0);
  });

  it("no operator ranking language in output", () => {
    const report = buildHumanExecutionClosureReport([handoff()], [], [], { now: NOW, since: WINDOW_START, until: NOW });
    const json = JSON.stringify(report);
    assert.equal(json.includes("ranking"), false);
    assert.equal(json.includes("leaderboard"), false);
    assert.equal(json.includes("score"), false);
    assert.equal(json.includes("productivity"), false);
  });

  it("JSON output shape is stable", () => {
    const report = buildHumanExecutionClosureReport([handoff()], [], [], { now: NOW, since: WINDOW_START, until: NOW });
    const parsed = JSON.parse(JSON.stringify(report));
    assert.ok(parsed.windowStart);
    assert.ok(parsed.windowEnd);
    assert.ok(parsed.totals);
    assert.ok(Array.isArray(parsed.items));
  });
});
