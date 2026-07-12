/**
 * Tests A2.0 — Verification Environment Contract.
 *
 * Covers VerificationEnvironment validation.
 *
 * @module environment-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateVerificationEnvironment,
} from "../../../src/evolution/verification/index.js";
import type {
  VerificationEnvironment,
} from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Validate — VerificationEnvironment
// ---------------------------------------------------------------------------

describe("validateVerificationEnvironment", () => {
  it("accepts a valid environment", () => {
    const env: VerificationEnvironment = {
      environmentId: "env-001",
      environmentHash: "hash-001",
      runtimeVersion: "alix-runtime-v2.1.0",
      activePolicies: [{ policyId: "policy-retry", version: "v3" }],
      resourceLimits: { maxMemoryMb: 512, maxCpuMs: 60000, maxWallClockMs: 120000 },
      configuration: { replay_seed: 42 },
      capturedAt: "2026-07-12T10:00:00.000Z",
    };
    const result = validateVerificationEnvironment(env);
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects null input", () => {
    assert.equal(validateVerificationEnvironment(null).valid, false);
  });

  it("rejects missing environmentId", () => {
    const env = {
      environmentHash: "hash-001",
      runtimeVersion: "v2.1.0",
      activePolicies: [],
      resourceLimits: { maxMemoryMb: 512, maxCpuMs: 60000, maxWallClockMs: 120000 },
      capturedAt: "2026-07-12T10:00:00.000Z",
    };
    const result = validateVerificationEnvironment(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("environmentId")));
  });

  it("rejects missing resourceLimits", () => {
    const env = {
      environmentId: "env-001",
      environmentHash: "hash-001",
      runtimeVersion: "v2.1.0",
      activePolicies: [],
      capturedAt: "2026-07-12T10:00:00.000Z",
    };
    const result = validateVerificationEnvironment(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("resourceLimits")));
  });
});
