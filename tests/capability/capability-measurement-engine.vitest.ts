// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 5 — Measurement engine + error classes.
 *
 * Verifies:
 *   - CapabilityMeasurementEngine orchestrator behaviour (ruling #5, #8, #13, #14, #16).
 *   - CapabilityMeasureFailedError surface (ruling #16).
 *   - CapabilityMeasureInvalidTargetError surface (spec §8.2).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityMeasurementEngine } from "../../src/capability/measurement/capability-measurement-engine.js";
import { CapabilityMeasureFailedError } from "../../src/capability/errors/measure-failed.js";
import { CapabilityMeasureInvalidTargetError } from "../../src/capability/errors/measure-invalid-target.js";
import { MEASUREMENT_EVENT_PREFIX } from "../../src/capability/measurement/measurement-event-types.js";
import type { A5Measurement } from "../../src/capability/measurement/a5.js";
import type { CapabilityMeasurementOutcome } from "../../src/capability/measurement/outcome-discriminated-union.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { ObservationProvider, Observation, ObservationResult } from "../../src/evolution/observation/contracts/observation-contract.js";

class FakePassProvider implements ObservationProvider {
  readonly name = "native";
  readonly capabilities = ["test"];
  async observe(o: Observation): Promise<ObservationResult> {
    return {
      observationId: o.observationId,
      status: "pass",
      confidence: 0.95,
      observedAt: new Date().toISOString(),
      evidence: { ok: true },
    };
  }
}

function mkA5(outcome: CapabilityMeasurementOutcome): A5Measurement {
  return {
    async measureCapability(_target, _baseline) {
      return outcome;
    },
  };
}

describe("CapabilityMeasurementEngine (CAP-10 ruling #5, #13, #14, #16)", () => {
  let dir: string;
  let eventLog: EventLog;
  let catalog: CapabilityCatalog;
  let engine: ObservationEngine;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-engine-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    engine = new ObservationEngine();
    engine.register(new FakePassProvider());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws CapabilityMeasureInvalidTargetError when target absent in catalog (ruling #8)", async () => {
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5({ kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] }),
      observationEngine: engine,
    });
    await expect(
      m.measure({ capabilityId: "absent", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityMeasureInvalidTargetError);
  });

  it("happy path: records exactly one measured event and returns frozen result", async () => {
    catalog.register({
      id: "tool.file.read",
      version: "1.0.0",
      kind: "operation",
      title: "Read files",
      description: "Read files",
      tags: [],
      category: "fs",
      risk: "low",
      requiredPermissions: ["operator"],
      dependencies: [],
      bindings: [{ id: "fs.native", type: "native" }],
    });
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5({ kind: "effective", evidenceRefs: ["obs-1"], confidence: 0.9, summary: "ok", signals: [] }),
      observationEngine: engine,
    });
    const result = await m.measure({ capabilityId: "tool.file.read", version: "1.0.0" });
    expect(result.status).toBe("measured");
    expect(result.measurement).toEqual({ capabilityId: "tool.file.read", version: "1.0.0" });
    expect(result.outcome.kind).toBe("effective");
    expect(result.eventIds).toHaveLength(1);
    expect(result.eventIds[0]!.type).toBe(`${MEASUREMENT_EVENT_PREFIX}measured`);

    const all = await eventLog.readAll();
    const measured = all.filter((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`);
    expect(measured).toHaveLength(1);
  });

  it("throws CapabilityMeasureFailedError when A5 throws (ruling #16)", async () => {
    catalog.register({
      id: "tool.x",
      version: "1.0.0",
      kind: "operation",
      title: "X",
      description: "X",
      tags: [],
      category: "test",
      risk: "low",
      requiredPermissions: ["operator"],
      dependencies: [],
      bindings: [{ id: "x.native", type: "native" }],
    });
    const a5: A5Measurement = {
      async measureCapability() {
        throw new Error("a5 down");
      },
    };
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5,
      observationEngine: engine,
    });
    await expect(
      m.measure({ capabilityId: "tool.x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityMeasureFailedError);
    const all = await eventLog.readAll();
    const measured = all.filter((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`);
    expect(measured).toHaveLength(0);
  });

  it("re-measure creates a new event (append-only, ruling #13)", async () => {
    catalog.register({
      id: "tool.y",
      version: "1.0.0",
      kind: "operation",
      title: "Y",
      description: "Y",
      tags: [],
      category: "test",
      risk: "low",
      requiredPermissions: ["operator"],
      dependencies: [],
      bindings: [{ id: "y.native", type: "native" }],
    });
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5({ kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] }),
      observationEngine: engine,
    });
    await m.measure({ capabilityId: "tool.y", version: "1.0.0" });
    await m.measure({ capabilityId: "tool.y", version: "1.0.0" });
    const all = await eventLog.readAll();
    const measured = all.filter((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`);
    expect(measured).toHaveLength(2);
  });
});

describe("CapabilityMeasureFailedError (CAP-10 ruling #16)", () => {
  it("carries code, message, cause, and frozen instance", () => {
    const cause = new Error("a5 down");
    const err = new CapabilityMeasureFailedError("x", "1.0.0", "obs-base", cause);
    expect(err.code).toBe("measure_failed");
    expect(err.message).toContain("x");
    expect(err.message).toContain("1.0.0");
    expect(err.cause).toBe(cause);
    expect(Object.isFrozen(err)).toBe(true);
  });

  it("baselineObservationId is optional (absent → 'absent' in message)", () => {
    const cause = new Error("a5 down");
    const err = new CapabilityMeasureFailedError("x", "1.0.0", undefined, cause);
    expect(err.message).toContain("absent");
  });
});

describe("CapabilityMeasureInvalidTargetError (CAP-10 spec §8.2)", () => {
  it("carries code and frozen instance", () => {
    const err = new CapabilityMeasureInvalidTargetError("nonexistent", "1.0.0");
    expect(err.code).toBe("measure_invalid_target");
    expect(err.message).toContain("nonexistent");
    expect(err.message).toContain("1.0.0");
    expect(Object.isFrozen(err)).toBe(true);
  });
});
