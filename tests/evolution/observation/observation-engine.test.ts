// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ObservationEngine } from "../../../src/evolution/observation/observation-engine.js";
import type { Observation, ObservationResult, ObservationProvider } from "../../../src/evolution/observation/contracts/observation-contract.js";

function makeMockProvider(name: string): ObservationProvider {
  return {
    name,
    capabilities: ["test"],
    observe: mock.fn(async (obs: Observation): Promise<ObservationResult> => ({
      observationId: obs.observationId,
      status: "pass",
      confidence: 1.0,
      observedAt: "2026-07-12T00:00:00Z",
      evidence: {},
    })),
  };
}

describe("ObservationEngine", () => {
  it("registers provider", () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("test"));
    assert.ok(engine.getProvider("test"));
  });

  it("throws on duplicate provider registration", () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("test"));
    assert.throws(() => engine.register(makeMockProvider("test")), /already registered/);
  });

  it("returns error result for unknown provider", async () => {
    const engine = new ObservationEngine();
    const result = await engine.observe({
      observationId: "obs-1",
      provider: "unknown",
      description: "test",
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
    assert.ok(result.evidence.errorType === "unknown_provider");
  });

  it("returns error result when provider throws", async () => {
    const engine = new ObservationEngine();
    const throwingProvider: ObservationProvider = {
      name: "thrower",
      capabilities: ["test"],
      observe: mock.fn(async () => { throw new Error("boom"); }),
    };
    engine.register(throwingProvider);
    const result = await engine.observe({
      observationId: "obs-1",
      provider: "thrower",
      description: "test",
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
    assert.ok(result.evidence.errorType === "provider_exception");
  });

  it("observeAll preserves input ordering", async () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("a"));
    engine.register(makeMockProvider("b"));

    const results = await engine.observeAll([
      { observationId: "obs-a", provider: "a", description: "A" },
      { observationId: "obs-b", provider: "b", description: "B" },
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].observationId, "obs-a");
    assert.equal(results[1].observationId, "obs-b");
  });

  it("observeAll returns error for unknown providers without crashing", async () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("a"));

    const results = await engine.observeAll([
      { observationId: "obs-1", provider: "a", description: "A" },
      { observationId: "obs-2", provider: "unknown", description: "B" },
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].status, "pass");
    assert.equal(results[1].status, "error");
  });

  it("getProvider returns undefined for unregistered name", () => {
    const engine = new ObservationEngine();
    assert.equal(engine.getProvider("nonexistent"), undefined);
  });
});
