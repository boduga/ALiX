import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recommendGovernanceResponsesFromAnomalies } from "../../src/governance/response-recommendations.js";
import type { GovernanceAuditAnomaly } from "../../src/governance/audit-anomalies.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeAnomaly(overrides: Partial<GovernanceAuditAnomaly> = {}): GovernanceAuditAnomaly {
  return {
    anomalyId: `anom-test-${Math.random().toString(36).slice(2, 6)}`,
    type: "volume_spike",
    severity: "warning",
    windowStart: "2026-07-07T13:00:00.000Z",
    windowEnd: "2026-07-07T14:00:00.000Z",
    evidenceEventIds: ["evt-1", "evt-2"],
    reason: "Spike in action_denied: 10 events (baseline 2, ×5.0)",
    metadata: {},
    ...overrides,
  };
}

describe("recommendGovernanceResponsesFromAnomalies", () => {
  it("empty anomalies → empty recommendations", () => {
    const r = recommendGovernanceResponsesFromAnomalies([], { now: NOW });
    assert.deepEqual(r, []);
  });

  it("critical anomaly → critical investigate_anomaly", () => {
    const a = makeAnomaly({ anomalyId: "a1", severity: "critical", type: "timestamp_regression" });
    const r = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.severity, "critical");
    assert.equal(r[0]!.responseKind, "investigate_anomaly");
  });

  it("warning anomaly → warning investigate_anomaly", () => {
    const a = makeAnomaly({ anomalyId: "a2", severity: "warning", type: "volume_spike" });
    const r = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.equal(r[0]!.severity, "warning");
    assert.equal(r[0]!.responseKind, "investigate_anomaly");
  });

  it("info anomaly → inspect_policy_gap for policy-related types", () => {
    const a = makeAnomaly({ anomalyId: "a3", severity: "info", type: "risk_shift" });
    const r = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.equal(r[0]!.severity, "info");
    assert.equal(r[0]!.responseKind, "inspect_policy_gap");
  });

  it("info non-policy anomaly → investigate_anomaly", () => {
    const a = makeAnomaly({ anomalyId: "a4", severity: "info", type: "approval_without_request" });
    const r = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.equal(r[0]!.responseKind, "investigate_anomaly");
  });

  it("recommendation IDs deterministic (same input → same id)", () => {
    const a = makeAnomaly({ anomalyId: "fixed-id", severity: "warning", type: "volume_spike" });
    const r1 = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    const r2 = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.equal(r1[0]!.recommendationId, r2[0]!.recommendationId);
  });

  it("source anomaly ID preserved in sourceIds", () => {
    const a = makeAnomaly({ anomalyId: "src-001", severity: "warning" });
    const r = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.deepEqual(r[0]!.sourceIds, ["src-001"]);
    assert.equal(r[0]!.source, "anomaly");
  });

  it("evidenceRefs preserved from anomaly", () => {
    const a = makeAnomaly({ evidenceEventIds: ["evt-x", "evt-y"] });
    const r = recommendGovernanceResponsesFromAnomalies([a], { now: NOW });
    assert.deepEqual(r[0]!.evidenceRefs, ["evt-x", "evt-y"]);
  });

  it("sort order: severity desc → responseKind asc → sourceId asc", () => {
    const anomalies = [
      makeAnomaly({ anomalyId: "c1", severity: "critical", type: "timestamp_regression" }),
      makeAnomaly({ anomalyId: "w1", severity: "warning", type: "volume_spike" }),
      makeAnomaly({ anomalyId: "i1", severity: "info", type: "risk_shift" }),
      makeAnomaly({ anomalyId: "i2", severity: "info", type: "approval_without_request" }),
    ];
    const r = recommendGovernanceResponsesFromAnomalies(anomalies, { now: NOW });
    assert.equal(r[0]!.severity, "critical");
    assert.equal(r[1]!.severity, "warning");
    // info items: inspect_policy_gap sorts before investigate_anomaly
    assert.equal(r[2]!.severity, "info");
    assert.equal(r[3]!.severity, "info");
  });

  it("minSeverity filters lower-severity items", () => {
    const anomalies = [
      makeAnomaly({ anomalyId: "c1", severity: "critical" }),
      makeAnomaly({ anomalyId: "w1", severity: "warning" }),
      makeAnomaly({ anomalyId: "i1", severity: "info" }),
    ];
    const r = recommendGovernanceResponsesFromAnomalies(anomalies, { minSeverity: "warning", now: NOW });
    assert.equal(r.length, 2);
    assert.ok(r.every((x) => x.severity !== "info"));
  });
});
