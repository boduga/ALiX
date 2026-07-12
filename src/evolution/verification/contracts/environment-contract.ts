// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.0 — Verification Environment Contract.
 *
 * Defines the execution environment snapshot used to anchor verification
 * determinism. Every VerificationRun and VerificationEvidence carries an
 * environmentHash so that the execution conditions are cryptographically
 * bound to the verification output.
 *
 * @module environment-contract
 */

// ---------------------------------------------------------------------------
// VerificationEnvironment
// ---------------------------------------------------------------------------

/**
 * Snapshot of the verification execution environment.
 *
 * Captures the runtime versions, configuration, active policies, and
 * resource constraints that define the conditions under which a
 * verification run executes. The environmentHash binds all of these
 * deterministically.
 */
export interface VerificationEnvironment {
  /** Unique environment identifier. */
  environmentId: string;
  /** Deterministic hash of this environment configuration. */
  environmentHash: string;
  /** Runtime version identifier (e.g. "alix-runtime-v2.1.0"). */
  runtimeVersion: string;
  /** Active policy identifiers and their versions. */
  activePolicies: readonly { policyId: string; version: string }[];
  /** Resource limits for sandbox execution. */
  resourceLimits: {
    maxMemoryMb: number;
    maxCpuMs: number;
    maxWallClockMs: number;
  };
  /** Configuration key-value pairs affecting verification behaviour. */
  configuration: Record<string, unknown>;
  /** When this environment snapshot was captured. */
  capturedAt: string;
}

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validate a VerificationEnvironment structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateVerificationEnvironment(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["VerificationEnvironment must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.environmentId)) errors.push("environmentId required and must be non-empty");
  if (!isNonEmptyString(v.environmentHash)) errors.push("environmentHash required and must be non-empty");
  if (!isNonEmptyString(v.runtimeVersion)) errors.push("runtimeVersion required and must be non-empty");
  if (!Array.isArray(v.activePolicies)) errors.push("activePolicies required and must be an array");
  if (!v.resourceLimits || typeof v.resourceLimits !== "object") {
    errors.push("resourceLimits required and must be an object");
  }
  if (!isNonEmptyString(v.capturedAt)) errors.push("capturedAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}
