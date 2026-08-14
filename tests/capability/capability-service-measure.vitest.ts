// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 6 — `service.measure()` delegation.
 *
 * Locked ruling #4, #18, #22:
 *   - `measure(input)` body delegates to injected `CapabilityMeasurementEngine.measure(input)`.
 *   - `measurementEngine` is an OPTIONAL ctor dep. Absent →
 *     `CapabilityServiceNotImplementedError` (CAP-8 ruling #4 preserved).
 *   - Engine error propagates verbatim (service is a thin seam, not a wrapper).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { CapabilityMeasurementEngine } from "../../src/capability/measurement/capability-measurement-engine.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { A5Measurement } from "../../src/capability/measurement/a5.js";
import type { CapabilityMeasurementOutcome } from "../../src/capability/measurement/outcome-discriminated-union.js";

function mkA5(): A5Measurement {
  return {
    async measureCapability(_target, _baseline) {
      const outcome: CapabilityMeasurementOutcome = {
        kind: "effective",
        evidenceRefs: ["obs-1"],
        confidence: 0.9,
        summary: "ok",
        signals: [],
      };
      return outcome;
    },
  };
}

describe("CapabilityService.measure() (CAP-10 ruling #2, #22)", () => {
  let dir: string;
  let eventLog: EventLog;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-svc-measure-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    resolver = new CapabilityResolver(registry, new ProviderExecutorRegistry());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws CapabilityServiceNotImplementedError when measurementEngine absent (ruling #22)", async () => {
    const mutationExecutor = {
      async executeStep() {
        return { success: true, output: {} };
      },
    } as never;
    const noEngineService = new CapabilityService({
      catalog,
      resolver,
      mutationExecutor,
      eventLog,
    });
    await expect(
      noEngineService.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityServiceNotImplementedError);
  });

  it("delegates to the engine when measurementEngine is present", async () => {
    const mutationExecutor = {
      async executeStep() {
        return { success: true, output: {} };
      },
    } as never;
    const engine = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5(),
      observationEngine: new ObservationEngine(),
    });
    const service = new CapabilityService({
      catalog,
      resolver,
      mutationExecutor,
      eventLog,
      measurementEngine: engine,
    });
    // Catalog empty → engine throws CapabilityMeasureInvalidTargetError;
    // service propagates the engine's error verbatim.
    await expect(
      service.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toThrow(/not found/);
  });
});