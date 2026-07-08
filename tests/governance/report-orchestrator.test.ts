import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../../src/governance/report-orchestrator.js";
import type { GovernanceAuditEvent } from "../../src/governance/audit-types.js";
import type { OperatorDecision } from "../../src/governance/decision-capture.js";
import type { OperatorReview } from "../../src/governance/operator-review.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition } from "../../src/governance/action-queue.js";

const S = "2026-07-01T00:00:00.000Z";
const U = "2026-07-08T00:00:00.000Z";
const NOW = "2026-07-08T12:00:00.000Z";

function empty() {
  return {
    auditEvents: [] as GovernanceAuditEvent[],
    decisions: [] as OperatorDecision[],
    reviews: [] as OperatorReview[],
    proposals: [] as GovernanceActionProposal[],
    transitions: [] as ActionProposalStatusTransition[],
  };
}

describe("buildReport", () => {
  it("all sections present in full report", () => {
    const r = buildReport(
      empty().auditEvents, empty().decisions, empty().reviews,
      empty().proposals, empty().transitions,
      { since: S, until: U, now: NOW, staleThresholdDays: 7, sections: ["trends", "anomalies", "effectiveness"] },
    );
    assert.equal(r.sections.length, 3);
    assert.ok(r.trends !== undefined);
    assert.ok(r.anomalies !== undefined);
    assert.ok(r.effectiveness !== undefined);
  });

  it("single section omits others", () => {
    const r = buildReport(
      empty().auditEvents, empty().decisions, empty().reviews,
      empty().proposals, empty().transitions,
      { since: S, until: U, now: NOW, staleThresholdDays: 7, sections: ["trends"] },
    );
    assert.ok(r.trends !== undefined);
    assert.equal(r.anomalies, undefined);
    assert.equal(r.effectiveness, undefined);
  });

  it("empty fixtures produce zero-valued report, no crash", () => {
    const r = buildReport(
      empty().auditEvents, empty().decisions, empty().reviews,
      empty().proposals, empty().transitions,
      { since: S, until: U, now: NOW, staleThresholdDays: 7, sections: ["trends", "anomalies", "effectiveness"] },
    );
    assert.equal((r.trends as any).totalEvents, 0);
    assert.equal((r.anomalies as any[]).length, 0);
    assert.equal((r.effectiveness as any).decisionStability?.totalDecisions, 0);
  });

  it("JSON shape matches contract", () => {
    const r = buildReport(
      empty().auditEvents, empty().decisions, empty().reviews,
      empty().proposals, empty().transitions,
      { since: S, until: U, now: NOW, staleThresholdDays: 7, sections: ["trends", "anomalies", "effectiveness"] },
    );
    const j = JSON.parse(JSON.stringify(r));
    assert.ok(Array.isArray(j.sections));
    assert.ok(j.trends !== undefined);
    assert.ok(Array.isArray(j.anomalies));
    assert.ok(j.effectiveness !== undefined);
    assert.equal(j.windowStart, S);
  });
});
