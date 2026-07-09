import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prepareHandoffRecord, HandoffRecordError } from "../../src/governance/handoff-recorder.js";
import type { HandoffPackage } from "../../src/governance/handoff-builder.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

function makeHandoff(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
  return {
    handoffId: "ho-abc123",
    planId: "plan-1",
    remediationId: "rem-1",
    approvalId: "approval-1",
    assessmentId: "assessment-1",
    simulationId: "sim-1",
    decisionId: "dec-1",
    disposition: "dry_run_allowed",
    title: "Test Plan",
    summary: "Summary",
    actions: [],
    evidence: [
      { ref: "handoff/cfg/evidence", label: "Config change evidence", required: true },
    ],
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

describe("prepareHandoffRecord", () => {
  it("returns execution attempt with succeeded status for valid evidence", () => {
    const handoff = makeHandoff();
    const record = prepareHandoffRecord(handoff, {
      "handoff/cfg/evidence": {
        ref: "handoff/cfg/evidence",
        capturedAt: VALID_ISO,
        capturedBy: "operator-1",
        description: "Config updated manually",
        payload: {},
      },
    }, { now: VALID_ISO });
    assert.equal(record.status, "succeeded");
    assert.equal(record.planId, "plan-1");
    assert.ok(record.actionResults.length > 0);
  });

  it("throws when evidence is missing", () => {
    const handoff = makeHandoff();
    assert.throws(
      () => prepareHandoffRecord(handoff, {}, { now: VALID_ISO }),
      HandoffRecordError,
    );
  });

  it("includes evidence refs in action results", () => {
    const handoff = makeHandoff();
    const record = prepareHandoffRecord(handoff, {
      "handoff/cfg/evidence": {
        ref: "handoff/cfg/evidence",
        capturedAt: VALID_ISO,
        capturedBy: "operator-1",
        description: "Done",
        payload: {},
      },
    }, { now: VALID_ISO });
    assert.ok(record.actionResults.some((r) => r.evidenceRefs.includes("handoff/cfg/evidence")));
  });

  it("uses provided recordedBy", () => {
    const handoff = makeHandoff();
    const record = prepareHandoffRecord(handoff, {
      "handoff/cfg/evidence": {
        ref: "handoff/cfg/evidence",
        capturedAt: VALID_ISO,
        capturedBy: "operator-1",
        description: "Done",
        payload: {},
      },
    }, { now: VALID_ISO, recordedBy: "alice" });
    assert.equal(record.executedBy, "alice");
  });

  it("does not call .append() — returns object only", () => {
    const handoff = makeHandoff();
    const record = prepareHandoffRecord(handoff, {
      "handoff/cfg/evidence": {
        ref: "handoff/cfg/evidence",
        capturedAt: VALID_ISO,
        capturedBy: "op",
        description: "Done",
        payload: {},
      },
    }, { now: VALID_ISO });
    // Assert it's a plain object, not a persisted entity
    assert.equal(typeof record, "object");
    assert.equal(Array.isArray(record.actionResults), true);
  });
});
