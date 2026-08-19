// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 7 — Platform composition root wires `capabilityMeasurement`.
 *
 * Verifies the locked ruling #18 surface on `CapabilityPlatform`:
 *   - Optional ctor dep `capabilityMeasurement?: CapabilityMeasurement`.
 *   - When supplied, the platform constructs a `CapabilityMeasurementEngine`
 *     and forwards it to `CapabilityService` (ruling #22 — engine optional
 *     on the service; absent → stable not-implemented error).
 *   - When NOT supplied, the platform remains backward-compatible with the
 *     CAP-8 contract; `service.measure()` throws the stable error.
 *   - `platform.measurementEngine` is exposed (read-only) when constructed
 *     with `capabilityMeasurement`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityMeasurement } from "../../src/evolution/observation/capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";
import { CapabilityMeasureInvalidTargetError } from "../../src/capability/errors/measure-invalid-target.js";
import type { ProposalSignalSink, ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/proposals.js";

/** CAP-10.5 — sink+source fake for tests; implements both contracts so a
 *  single instance can stand in for either side of the channel. Used
 *  here for the A5 sink side; A7 side is wired via the composition-root
 *  channel (`src/capability/platform.ts`). */
class FakeSignalChannel implements ProposalSignalSink, ProposalSignalSource {
  public readonly published: CapabilityEvolutionSignal[] = [];
  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    this.published.push(signal);
  }
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [...this.published];
  }
}

describe("CapabilityPlatform — CAP-10 wiring (ruling #18, #22)", () => {
  let dir: string;
  let eventLog: EventLog;
  let platform: CapabilityPlatform;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-plat-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("auto-constructs A5 with the channel when capabilityMeasurement not provided (CAP-10.5 ruling #R4)", () => {
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
    // CAP-10.5 — composition root owns ProposalSignalChannel and auto-constructs
    // a real A5 bound to it; the platform's measurementEngine is now always present.
    expect(platform.measurementEngine).toBeDefined();
  });

  it("constructs with capabilityMeasurement and wires measurementEngine", () => {
    const a5 = new CapabilityMeasurement({
      observationEngine: new ObservationEngine(),
      signalSink: new FakeSignalChannel(),
      catalog: { get: () => undefined } as never,
      eventLog,
    });
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog, capabilityMeasurement: a5 });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
    expect(platform.measurementEngine).toBeDefined();
  });

  it("service.measure() reaches the engine (which throws CapabilityMeasureInvalidTargetError for unknown ids)", async () => {
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    // CAP-10.5 — A5 is auto-constructed, so the engine is wired. Measure
    // reaches the engine and surfaces the catalog's invalid-target error
    // (not the CAP-8 not-implemented stub).
    await expect(
      platform.service.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityMeasureInvalidTargetError);
  });
});
