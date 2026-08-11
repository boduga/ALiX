// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCapabilityLifecycleRecord,
  computeDeterministicRecordId,
  deriveCapabilityProjectionState,
  CAPABILITY_LIFECYCLE_INTENTS,
  CAPABILITY_LIFECYCLE_EVENT_TYPES,
} from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityLifecycleRecord } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: "clr-abc123",
    target: { capabilityId: "core.session.list" },
    intent: "deprecate",
    eventType: "decided",
    timestamp: "2026-08-10T00:00:00.000Z",
    proposalId: "prop-a7-abc",
    decisionId: "govd-a7-abc",
    evidenceRefs: ["a7-p55-report"],
    observedLifecycleState: "active",
    proposedLifecycleState: "deprecated",
    decisionKind: "APPROVE",
    ...overrides,
  };
}

describe("CapabilityLifecycleRecord", () => {
  it("validates a well-formed decided record", () => {
    assert.deepEqual(validateCapabilityLifecycleRecord(makeRecord()), { valid: true, errors: [] });
  });

  it("accepts every intent in the canonical list", () => {
    assert.deepEqual(CAPABILITY_LIFECYCLE_INTENTS, [
      "register", "promote", "modify", "consolidate", "deprecate",
    ]);
  });

  it("accepts every event type in the canonical list", () => {
    assert.deepEqual(CAPABILITY_LIFECYCLE_EVENT_TYPES, [
      "intent", "proposed", "decided", "applied", "measured",
    ]);
  });

  it("rejects a decided record missing its decisionId", () => {
    const result = validateCapabilityLifecycleRecord(makeRecord({ decisionId: undefined }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decisionId")));
  });

  it("rejects a decided record carrying executionId or measurementId (A7.1 fields)", () => {
    // executionId/measurementId belong to A7.1 applied/measured phases — a
    // decided record (a decision is not an application) must not carry them.
    const withExecution = validateCapabilityLifecycleRecord(makeRecord({ executionId: "exec-x" }));
    assert.equal(withExecution.valid, false);
    const withMeasurement = validateCapabilityLifecycleRecord(makeRecord({ measurementId: "meas-x" }));
    assert.equal(withMeasurement.valid, false);
  });

  it("rejects an unknown intent or event type", () => {
    assert.equal(validateCapabilityLifecycleRecord(makeRecord({ intent: "delete" })).valid, false);
    assert.equal(validateCapabilityLifecycleRecord(makeRecord({ eventType: "applied" })).valid, false);
  });

  it("rejects a proposedLifecycleState outside the P5.5 enum", () => {
    assert.equal(
      validateCapabilityLifecycleRecord(makeRecord({ proposedLifecycleState: "APPROVED_PENDING_APPLICATION" })).valid,
      false,
    );
  });
});

describe("computeDeterministicRecordId", () => {
  it("is deterministic over (eventType, correlationId) and stable across calls", () => {
    const a = computeDeterministicRecordId("proposed", "prop-a7-abc");
    const b = computeDeterministicRecordId("proposed", "prop-a7-abc");
    assert.equal(a, b);
    assert.ok(a.startsWith("clr-"));
  });

  it("differs for different correlation ids", () => {
    assert.notEqual(
      computeDeterministicRecordId("decided", "govd-a"),
      computeDeterministicRecordId("decided", "govd-b"),
    );
  });
});

describe("deriveCapabilityProjectionState", () => {
  it("maps a latest APPROVE decision to APPROVED_PENDING_APPLICATION", () => {
    const record = { ...makeRecord(), decisionKind: "APPROVE" } as unknown as CapabilityLifecycleRecord;
    assert.equal(deriveCapabilityProjectionState(record), "APPROVED_PENDING_APPLICATION");
  });

  it("maps a latest REJECT decision to REJECTED", () => {
    const record = { ...makeRecord(), decisionKind: "REJECT" } as unknown as CapabilityLifecycleRecord;
    assert.equal(deriveCapabilityProjectionState(record), "REJECTED");
  });

  it("maps MONITOR and REQUEST_MORE_EVIDENCE to pending", () => {
    for (const kind of ["MONITOR", "REQUEST_MORE_EVIDENCE"]) {
      const record = { ...makeRecord(), decisionKind: kind } as unknown as CapabilityLifecycleRecord;
      assert.equal(deriveCapabilityProjectionState(record), "APPROVED_PENDING_APPLICATION");
    }
  });

  it("maps a capability with no decided record to PROPOSED", () => {
    assert.equal(deriveCapabilityProjectionState(null), "PROPOSED");
  });
});
