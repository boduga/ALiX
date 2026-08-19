// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 1 — Measurement event types: literal, constants, runtime guard,
 * discriminated union shape.
 * CAP-10.5 Task 4 — Adds the `signals_unpublished` event for sink-publish failures
 * (ruling #R5).
 */

import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MEASUREMENT_EVENT_TYPES,
  MEASUREMENT_EVENT_PREFIX,
  MEASUREMENT_GOVERNANCE_PREFIX,
  isMeasurementEventType,
} from "../../src/capability/measurement/measurement-event-types.js";
import type {
  CapabilityMeasurementEvent,
  CapabilityMeasurementEventType,
  MeasurementSignalsUnpublishedEvent,
  MeasurementSignalsUnpublishedFailure,
} from "../../src/capability/measurement/measurement-event-types.js";

const baseFailure: MeasurementSignalsUnpublishedFailure = {
  classification: "sink_threw",
  cause: "boom",
};

const unpublished: MeasurementSignalsUnpublishedEvent = {
  seq: 42,
  timestamp: "2026-08-14T00:00:00.000Z",
  type: "capability.governance.measurement.signals_unpublished",
  payload: {
    measurementEventId: "evt-1",
    signalCount: 2,
    signalIds: ["a".repeat(64), "b".repeat(64)],
    failure: baseFailure,
    occurredAt: "2026-08-14T00:00:00.000Z",
    actor: { kind: "system", component: "CapabilityMeasurement" },
  },
};

describe("MeasurementSignalsUnpublishedEvent (CAP-10.5 ruling #R5)", () => {
  it("has the locked event-type discriminator", () => {
    expect(CAPABILITY_MEASUREMENT_EVENT_TYPES).toContain(
      "capability.governance.measurement.signals_unpublished",
    );
  });

  it("isMeasurementEventType accepts both measured and signals_unpublished", () => {
    expect(isMeasurementEventType("capability.governance.measurement.measured")).toBe(true);
    expect(isMeasurementEventType("capability.governance.measurement.signals_unpublished")).toBe(true);
    expect(isMeasurementEventType("something.else")).toBe(false);
  });

  it("signalCount invariant equals signalIds.length", () => {
    expect(unpublished.payload.signalCount).toBe(unpublished.payload.signalIds.length);
  });

  it("failure classification is one of the locked values", () => {
    const c1: MeasurementSignalsUnpublishedFailure = { classification: "sink_threw", cause: "x" };
    const c2: MeasurementSignalsUnpublishedFailure = { classification: "sink_timeout", cause: "x" };
    expect([c1.classification, c2.classification].sort()).toEqual(["sink_threw", "sink_timeout"]);
  });

  it("actor shape is locked to system + CapabilityMeasurement", () => {
    expect(unpublished.payload.actor).toEqual({
      kind: "system",
      component: "CapabilityMeasurement",
    });
  });
});

describe("CapabilityMeasurementEventType (CAP-10 ruling #1, #5)", () => {
  it("exposes both measured and signals_unpublished (CAP-10.5 ruling #R5)", () => {
    expect(CAPABILITY_MEASUREMENT_EVENT_TYPES).toEqual([
      "capability.governance.measurement.measured",
      "capability.governance.measurement.signals_unpublished",
    ]);
  });

  it("MEASUREMENT_EVENT_PREFIX matches ruling #1", () => {
    expect(MEASUREMENT_EVENT_PREFIX).toBe("capability.governance.measurement.");
  });

  it("MEASUREMENT_GOVERNANCE_PREFIX matches parent prefix (ruling #6, #20)", () => {
    expect(MEASUREMENT_GOVERNANCE_PREFIX).toBe("capability.governance.");
  });

  it("isMeasurementEventType accepts measured literal", () => {
    expect(isMeasurementEventType("capability.governance.measurement.measured")).toBe(true);
  });

  it("isMeasurementEventType rejects non-measurement types short-form", () => {
    expect(isMeasurementEventType("capability.governance.proposal.submitted")).toBe(false);
    expect(isMeasurementEventType("capability.created")).toBe(false);
    expect(isMeasurementEventType("measurement.measured")).toBe(false);
    expect(isMeasurementEventType(null)).toBe(false);
    expect(isMeasurementEventType(undefined)).toBe(false);
  });
});

describe("CapabilityMeasurementEvent (CAP-10 ruling #5, #14)", () => {
  it("union value carries full payload mirroring CapabilityMeasureResult", () => {
    const evt: CapabilityMeasurementEvent = {
      seq: 1,
      timestamp: "2026-08-13T00:00:00.000Z",
      type: "capability.governance.measurement.measured",
      payload: {
        measurement: {
          capabilityId: "tool.file.read",
          version: "1.0.0",
        },
        baseline: {
          observationId: "obs-0",
          takenAt: "2026-08-12T00:00:00.000Z",
        },
        post: {
          observationId: "obs-1",
          takenAt: "2026-08-13T00:00:00.000Z",
          status: "pass",
          confidence: 0.92,
        },
        outcome: {
          kind: "effective",
          evidenceRefs: ["ref-1"],
          confidence: 0.92,
          summary: "Capability performed as designed",
          signals: [],
        },
      },
    };

    expect(evt.type).toBe("capability.governance.measurement.measured");
    expect(evt.payload.measurement.capabilityId).toBe("tool.file.read");
  });
});

describe("CapabilityMeasurementEventType literal (compile-time)", () => {
  it("single literal long form (ruling #1)", () => {
    const t: CapabilityMeasurementEventType = "capability.governance.measurement.measured";
    expect(t).toBe("capability.governance.measurement.measured");
  });
});
