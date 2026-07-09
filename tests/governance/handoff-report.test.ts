import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHandoffReport } from "../../src/governance/handoff-report.js";
import type { HandoffPackage } from "../../src/governance/handoff-builder.js";
import type { GovernanceExecutionAttempt } from "../../src/governance/execution-recorder.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";
const WINDOW_END = "2026-07-09T00:00:00.000Z";
const WINDOW_START = "2026-07-01T00:00:00.000Z";

function makeHandoff(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    remediationId: "rem-1",
    approvalId: "approval-1",
    assessmentId: "assessment-1",
    simulationId: "sim-1",
    decisionId: "dec-1",
    disposition: "dry_run_allowed",
    title: "Plan",
    summary: "Summary",
    actions: [{ actionId: "a", kind: "investigate_anomaly", description: "Do", target: { type: "anomaly", id: null }, expectedEffect: "Done", operatorInstructions: [], rollbackProcedure: null, evidenceRequired: true }],
    evidence: [{ ref: "handoff/a/evidence", label: "Evidence", required: true }],
    operatorInstructions: [],
    riskNotes: [],
    rollbackSummary: [],
    status: "pending",
    generatedAt: VALID_ISO,
    evidenceCaptured: false,
    explicitlyManualOnly: true,
    ...overrides,
  };
}

describe("buildHandoffReport", () => {
  it("empty input produces zero totals", () => {
    const report = buildHandoffReport([], [], [], { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.items.length, 0);
    assert.deepEqual(report.totals, { pending: 0, completed: 0, failed: 0, evidenceMissing: 0, total: 0 });
  });

  it("handoff without validation or attempt shows pending", () => {
    const report = buildHandoffReport([makeHandoff()], [], [], { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.items[0]!.status, "pending");
  });

  it("handoff with invalid validation shows evidence_missing", () => {
    const report = buildHandoffReport(
      [makeHandoff()],
      [{ handoffId: "ho-1", totalRequired: 1, totalCaptured: 0, missingRefs: ["handoff/a/evidence"], valid: false }],
      [],
      { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END },
    );
    assert.equal(report.items[0]!.status, "evidence_missing");
  });

  it("handoff with succeeded attempt shows completed", () => {
    const attempt: GovernanceExecutionAttempt = {
      attemptId: "attempt-1", planId: "plan-1", remediationId: "rem-1",
      approvalId: "approval-1", status: "succeeded", startedAt: VALID_ISO,
      completedAt: VALID_ISO, executedBy: "op", actionResults: [],
      failureReason: null, revertAttemptId: null, auditRefs: [],
    };
    const report = buildHandoffReport([makeHandoff()], [], [attempt], { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.items[0]!.status, "completed");
    assert.equal(report.totals.completed, 1);
  });

  it("handoff with failed attempt shows failed", () => {
    const attempt: GovernanceExecutionAttempt = {
      attemptId: "attempt-1", planId: "plan-1", remediationId: "rem-1",
      approvalId: "approval-1", status: "failed", startedAt: VALID_ISO,
      completedAt: VALID_ISO, executedBy: "op", actionResults: [],
      failureReason: "Error", revertAttemptId: null, auditRefs: [],
    };
    const report = buildHandoffReport([makeHandoff()], [], [attempt], { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.items[0]!.status, "failed");
  });

  it("respects [since, until) time window", () => {
    const old = makeHandoff({ handoffId: "ho-old", generatedAt: "2026-06-01T00:00:00.000Z" });
    const report = buildHandoffReport([old], [], [], { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.items.length, 0);
  });

  it("explicitlyManualOnly is true on all items", () => {
    const report = buildHandoffReport([makeHandoff()], [], [], { now: VALID_ISO, since: WINDOW_START, until: WINDOW_END });
    assert.equal(report.items[0]!.explicitlyManualOnly, true);
  });
});
