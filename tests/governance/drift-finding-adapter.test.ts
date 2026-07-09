import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDriftFindings } from "../../src/governance/drift-finding-adapter.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "p24-cs:abc123",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

describe("toDriftFindings", () => {

  it("empty signals produce empty findings", () => {
    const findings = toDriftFindings([]);
    assert.equal(findings.length, 0);
  });

  it("maps PolicyDriftSignal to DriftFinding with policy_drift category", () => {
    const findings = toDriftFindings([signal()]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.driftType, "policy_drift");
  });

  it("preserves severity from signal to finding", () => {
    const findings = toDriftFindings([signal({ severity: "high" })]);
    assert.equal(findings[0]!.severity, "high");
  });

  it("maps rationale as finding description", () => {
    const s = signal({ rationale: ["Overconfidence rate 0.65."] });
    const findings = toDriftFindings([s]);
    assert.ok(findings[0]!.description.includes("Overconfidence rate 0.65"));
  });

  it("maps evidenceRefs into finding evidenceRefs", () => {
    const s = signal({
      evidenceRefs: [{
        source: "p22_calibration",
        handoffId: "ho-1",
        lifecycleId: "lc-1",
        basis: "Test basis",
      }],
    });
    const findings = toDriftFindings([s]);
    assert.equal(findings[0]!.evidenceRefs.length, 1);
  });

  it("skips signals with severity 'none'", () => {
    const findings = toDriftFindings([
      signal({ signalId: "s-1", severity: "none" }),
      signal({ signalId: "s-2", severity: "medium" }),
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, "medium");
    assert.ok(findings[0]!.description.includes("calibration_skew"));
  });

  it("includes boundary-safe recommendation string", () => {
    const findings = toDriftFindings([signal()]);
    assert.ok(findings[0]!.recommendation.includes("No policy change is proposed"));
    assert.ok(findings[0]!.recommendation.includes("read-only"));
  });

  it("sorts findings by severity then detection time", () => {
    const findings = toDriftFindings([
      signal({ signalId: "s-1", severity: "low", windowEnd: "2026-07-01T00:00:00.000Z" }),
      signal({ signalId: "s-2", severity: "high", windowEnd: "2026-06-01T00:00:00.000Z" }),
      signal({ signalId: "s-3", severity: "medium", windowEnd: "2026-06-15T00:00:00.000Z" }),
    ]);
    assert.equal(findings.length, 3);
    assert.equal(findings[0]!.severity, "high");
    assert.equal(findings[1]!.severity, "medium");
    assert.equal(findings[2]!.severity, "low");
  });
});
