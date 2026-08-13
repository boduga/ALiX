// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 7 — Platform composition root wires `a5CapabilityMeasurement`.
 *
 * Verifies the locked ruling #18 surface on `CapabilityPlatform`:
 *   - Optional ctor dep `a5CapabilityMeasurement?: A5CapabilityMeasurement`.
 *   - When supplied, the platform constructs a `CapabilityMeasurementEngine`
 *     and forwards it to `CapabilityService` (ruling #22 — engine optional
 *     on the service; absent → stable not-implemented error).
 *   - When NOT supplied, the platform remains backward-compatible with the
 *     CAP-8 contract; `service.measure()` throws the stable error.
 *   - `platform.measurementEngine` is exposed (read-only) when constructed
 *     with `a5CapabilityMeasurement`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { EventLog } from "../../src/events/event-log.js";
import { A5CapabilityMeasurement } from "../../src/evolution/observation/a5-capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";
import type { ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

class NoopSignalSource implements ProposalSignalSource {
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [];
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

  it("constructs without a5CapabilityMeasurement (CAP-8 backward compat)", () => {
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
    expect(platform.measurementEngine).toBeUndefined();
  });

  it("constructs with a5CapabilityMeasurement and wires measurementEngine", () => {
    const a5 = new A5CapabilityMeasurement({
      observationEngine: new ObservationEngine(),
      signalSource: new NoopSignalSource(),
      catalog: { get: () => undefined } as never,
    });
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog, a5CapabilityMeasurement: a5 });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
    expect(platform.measurementEngine).toBeDefined();
  });

  it("service.measure() throws when platform wired without A5", async () => {
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    await expect(
      platform.service.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityServiceNotImplementedError);
  });
});
