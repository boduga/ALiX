// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCapabilityLifecycleRecord,
  deriveCapabilityProjectionState,
  CAPABILITY_LIFECYCLE_EVENT_TYPES,
} from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityLifecycleRecord } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function baseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: "clr-a71-1",
    target: { capabilityId: "core.session.list" },
    intent: "promote",
    timestamp: "2026-08-10T00:00:00.000Z",
    evidenceRefs: ["a7-p55-report"],
    observedLifecycleState: "active",
    proposedLifecycleState: "active",
    ...overrides,
  };
}

describe("A7.1 capability lifecycle contract extension", () => {
  it("accepts a valid applied record with executionId + decisionId", () => {
    const record = baseRecord({
      eventType: "applied",
      executionId: "exec-a7-1",
      decisionId: "govd-a7-1",
    });
    assert.deepEqual(validateCapabilityLifecycleRecord(record), { valid: true, errors: [] });
  });

  it("rejects an applied record missing executionId", () => {
    const record = baseRecord({ eventType: "applied", decisionId: "govd-a7-1" });
    const result = validateCapabilityLifecycleRecord(record);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("executionId")));
  });

  it("rejects an applied record carrying measurementId", () => {
    const record = baseRecord({
      eventType: "applied",
      executionId: "exec-a7-1",
      decisionId: "govd-a7-1",
      measurementId: "meas-a7-1",
    });
    const result = validateCapabilityLifecycleRecord(record);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("measurementId")));
  });

  it("accepts a valid measured record with measurementId + evidence arrays", () => {
    const record = baseRecord({
      eventType: "measured",
      measurementId: "meas-a7-1",
      baselineEvidenceRefs: ["a7-baseline-1"],
      postObservationRefs: ["a7-post-1"],
    });
    assert.deepEqual(validateCapabilityLifecycleRecord(record), { valid: true, errors: [] });
  });

  it("rejects a measured record missing measurementId", () => {
    const record = baseRecord({
      eventType: "measured",
      baselineEvidenceRefs: ["a7-baseline-1"],
      postObservationRefs: ["a7-post-1"],
    });
    const result = validateCapabilityLifecycleRecord(record);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("measurementId")));
  });

  it("accepts a decided record carrying the full decision artifact", () => {
    const record = baseRecord({
      eventType: "decided",
      proposalId: "prop-a7-1",
      decisionId: "govd-a7-1",
      decisionKind: "APPROVE",
      decision: { decisionId: "govd-a7-1", kind: "APPROVE" },
    });
    assert.deepEqual(validateCapabilityLifecycleRecord(record), { valid: true, errors: [] });
  });

  it("rejects a decided record carrying executionId (a decision is not an application)", () => {
    const record = baseRecord({
      eventType: "decided",
      proposalId: "prop-a7-1",
      decisionId: "govd-a7-1",
      decisionKind: "APPROVE",
      executionId: "exec-a7-1",
    });
    const result = validateCapabilityLifecycleRecord(record);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("executionId")));
  });

  it("rejects a decided record carrying measurementId", () => {
    const record = baseRecord({
      eventType: "decided",
      proposalId: "prop-a7-1",
      decisionId: "govd-a7-1",
      decisionKind: "APPROVE",
      measurementId: "meas-a7-1",
    });
    const result = validateCapabilityLifecycleRecord(record);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("measurementId")));
  });

  it("includes applied/measured in the canonical event type list", () => {
    assert.deepEqual(CAPABILITY_LIFECYCLE_EVENT_TYPES, [
      "intent", "proposed", "decided", "applied", "measured",
    ]);
  });

  it("projects APPLIED for a latest applied record", () => {
    const record = {
      ...baseRecord({ eventType: "applied", executionId: "exec-a7-1", decisionId: "govd-a7-1" }),
    } as unknown as CapabilityLifecycleRecord;
    assert.equal(deriveCapabilityProjectionState(record), "APPLIED");
  });

  it("projects MEASURED for a latest measured record", () => {
    const record = {
      ...baseRecord({
        eventType: "measured",
        measurementId: "meas-a7-1",
        baselineEvidenceRefs: [],
        postObservationRefs: [],
      }),
    } as unknown as CapabilityLifecycleRecord;
    assert.equal(deriveCapabilityProjectionState(record), "MEASURED");
  });

  it("projects PROPOSED for a latest intent/proposed record", () => {
    for (const eventType of ["intent", "proposed"]) {
      const record = { ...baseRecord({ eventType }) } as unknown as CapabilityLifecycleRecord;
      assert.equal(deriveCapabilityProjectionState(record), "PROPOSED");
    }
  });
});
