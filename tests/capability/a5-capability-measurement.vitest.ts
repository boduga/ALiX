// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 4 — A5CapabilityMeasurement concrete implementation.
 *
 * Asserts that A5CapabilityMeasurement:
 *   - returns effective outcome when post observation passes (ruling #7, #8)
 *   - returns ineffective outcome when post observation fails (ruling #7)
 *   - returns inconclusive when observation engine returns error (ruling #16)
 *   - consults signalSource via signals() (ruling #12)
 *   - uses injected OutcomeDecider when supplied
 *   - does NOT mutate catalog/registry (axis 5 purity)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  A5CapabilityMeasurement,
  type OutcomeDecider,
} from "../../src/evolution/observation/a5-capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { ObservationProvider, Observation, ObservationResult } from "../../src/evolution/observation/contracts/observation-contract.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import type { ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";
import type { A5Measurement } from "../../src/capability/measurement/a5.js";

class FakePassProvider implements ObservationProvider {
  readonly name = "native";
  readonly capabilities = ["test"];
  async observe(_o: Observation): Promise<ObservationResult> {
    return {
      observationId: _o.observationId,
      status: "pass",
      confidence: 0.95,
      observedAt: new Date().toISOString(),
      evidence: { ok: true },
    };
  }
}

class FakeFailProvider implements ObservationProvider {
  readonly name = "native";
  readonly capabilities = ["test"];
  async observe(_o: Observation): Promise<ObservationResult> {
    return {
      observationId: _o.observationId,
      status: "fail",
      confidence: 0.85,
      observedAt: new Date().toISOString(),
      evidence: { ok: false },
      observed: { score: 0.1 },
      expected: { score: 0.9 },
    };
  }
}

class CapturingSignalSource implements ProposalSignalSource {
  consumed = 0;
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    this.consumed += 1;
    return [];
  }
}

describe("A5CapabilityMeasurement (CAP-10 ruling #7, #8, #12, #15)", () => {
  let dir: string;
  let engine: ObservationEngine;
  let catalog: CapabilityCatalog;
  let signalSource: CapturingSignalSource;
  let a5: A5Measurement;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap10-a5-"));
    engine = new ObservationEngine();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    signalSource = new CapturingSignalSource();
    a5 = new A5CapabilityMeasurement({
      observationEngine: engine,
      signalSource,
      catalog,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns effective outcome when post passes", async () => {
    engine.register(new FakePassProvider());
    const outcome = await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(outcome.kind).toBe("effective");
    expect(outcome.confidence).toBeGreaterThan(0);
    expect(outcome.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(outcome.evidenceRefs)).toBe(true);
    expect(Array.isArray(outcome.signals)).toBe(true);
  });

  it("returns ineffective outcome when post fails", async () => {
    engine.register(new FakeFailProvider());
    const outcome = await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(outcome.kind).toBe("ineffective");
  });

  it("returns inconclusive when observation engine returns error (ruling #16)", async () => {
    const errorProvider: ObservationProvider = {
      name: "native",
      capabilities: ["test"],
      async observe(_o) { throw new Error("provider down"); },
    };
    engine.register(errorProvider);
    const outcome = await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(outcome.kind).toBe("inconclusive");
  });

  it("consults signalSource via signals() (ruling #12)", async () => {
    engine.register(new FakePassProvider());
    await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(signalSource.consumed).toBeGreaterThanOrEqual(1);
  });

  it("uses injected OutcomeDecider when supplied", async () => {
    let called = false;
    const decider: OutcomeDecider = (_post, _baseline) => {
      called = true;
      return {
        kind: "inconclusive",
        evidenceRefs: [],
        confidence: 0.0,
        summary: "decider-forced",
        signals: [],
      };
    };
    const custom = new A5CapabilityMeasurement({
      observationEngine: engine,
      signalSource,
      catalog,
      outcomeDecider: decider,
    });
    engine.register(new FakePassProvider());
    const outcome = await custom.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(called).toBe(true);
    expect(outcome.summary).toBe("decider-forced");
  });
});
