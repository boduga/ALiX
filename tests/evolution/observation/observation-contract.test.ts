// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateObservation,
  validateObservationResult,
  type Observation,
  type ObservationResult,
} from "../../../src/evolution/observation/contracts/observation-contract.js";

describe("validateObservation", () => {
  it("accepts a valid observation", () => {
    const obs: Observation = {
      observationId: "obs-1",
      provider: "cli",
      description: "Check system status",
    };
    assert.ok(validateObservation(obs).valid);
  });

  it("accepts observation with optional expected and params", () => {
    const obs: Observation = {
      observationId: "obs-2",
      provider: "filesystem",
      description: "File exists",
      expected: "exists",
      params: { path: "/tmp/test.txt" },
    };
    assert.ok(validateObservation(obs).valid);
  });

  it("rejects when observationId is empty", () => {
    const result = validateObservation({ observationId: "", provider: "cli", description: "test" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("observationId")));
  });

  it("rejects when provider is missing", () => {
    const result = validateObservation({ observationId: "obs-1", description: "test" } as Observation);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("provider")));
  });

  it("rejects when description is missing", () => {
    const result = validateObservation({ observationId: "obs-1", provider: "cli" } as Observation);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("description")));
  });
});

describe("validateObservationResult", () => {
  const validResult: ObservationResult = {
    observationId: "obs-1",
    status: "pass",
    confidence: 1.0,
    observedAt: "2026-07-12T00:00:00Z",
    evidence: { key: "value" },
  };

  it("accepts a valid result", () => {
    assert.ok(validateObservationResult(validResult).valid);
  });

  it("accepts result with optional expected and observed", () => {
    const result: ObservationResult = {
      ...validResult,
      expected: "pass",
      observed: "pass",
    };
    assert.ok(validateObservationResult(result).valid);
  });

  it("rejects when status is invalid", () => {
    const result = validateObservationResult({ ...validResult, status: "invalid" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("status")));
  });

  it("rejects when confidence is out of range", () => {
    const tooLow = validateObservationResult({ ...validResult, confidence: -0.1 });
    assert.ok(!tooLow.valid);
    const tooHigh = validateObservationResult({ ...validResult, confidence: 1.1 });
    assert.ok(!tooHigh.valid);
  });

  it("rejects when observedAt is empty", () => {
    const result = validateObservationResult({ ...validResult, observedAt: "" });
    assert.ok(!result.valid);
  });

  it("rejects when evidence is not an object", () => {
    const result = validateObservationResult({ ...validResult, evidence: "string" });
    assert.ok(!result.valid);
  });
});
