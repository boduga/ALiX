// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Contract Types.
 *
 * Core artifact types for the A5 Observation Engine. Defines the
 * observation definition (what to measure), the observation result
 * (what was measured), and the provider contract (how to measure).
 *
 * @module observation-contract
 */

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// ObservationStatus
// ---------------------------------------------------------------------------

export type ObservationStatus = "pass" | "fail" | "error" | "inconclusive";

export const VALID_OBSERVATION_STATUSES: readonly ObservationStatus[] = [
  "pass",
  "fail",
  "error",
  "inconclusive",
];

// ---------------------------------------------------------------------------
// Observation (definition)
// ---------------------------------------------------------------------------

export interface Observation {
  /** Unique identifier for this observation. */
  readonly observationId: string;
  /** Provider routing key — must match a registered ObservationProvider.name. */
  readonly provider: string;
  /** Human-readable description of what is being measured. */
  readonly description: string;
  /** Optional expected value for verification-style observations. */
  readonly expected?: unknown;
  /** Provider-specific configuration parameters. */
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ObservationResult
// ---------------------------------------------------------------------------

export interface ObservationResult {
  /** Matches the originating Observation.observationId. */
  readonly observationId: string;
  /** Outcome of this observation measurement. */
  readonly status: ObservationStatus;
  /** Confidence in THIS measurement (0-1), not a provider-level reliability score. */
  readonly confidence: number;
  /** When the measurement was taken (ISO 8601). */
  readonly observedAt: string;
  /** The expected value (copied from Observation if provided). */
  readonly expected?: unknown;
  /** The observed value (may be absent on error/inconclusive). */
  readonly observed?: unknown;
  /** Provider-specific raw evidence artifacts. */
  readonly evidence: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ObservationProvider
// ---------------------------------------------------------------------------

export interface ObservationProvider {
  /** Unique provider name (used as the Observation.provider routing key). */
  readonly name: string;
  /** Descriptive capability tags for discovery/diagnostics. */
  readonly capabilities: readonly string[];
  /** Optional validation guard — not for runtime dispatch. */
  canObserve?(observation: Observation): boolean;
  /**
   * Execute the observation.
   *
   * @invariant MUST return ObservationResult, never throw.
   * @invariant MUST NOT mutate system.
   */
  observe(observation: Observation): Promise<ObservationResult>;
}

// ---------------------------------------------------------------------------
// Validator helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateObservation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Observation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.observationId)) errors.push("observationId required and must be non-empty");
  if (!isNonEmptyString(v.provider)) errors.push("provider required and must be non-empty");
  if (!isNonEmptyString(v.description)) errors.push("description required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

export function validateObservationResult(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ObservationResult must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.observationId)) errors.push("observationId required and must be non-empty");

  if (typeof v.status !== "string" || !(VALID_OBSERVATION_STATUSES as readonly string[]).includes(v.status as string)) {
    errors.push(`status must be one of: ${VALID_OBSERVATION_STATUSES.join(", ")}`);
  }

  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1");
  }

  if (!isNonEmptyString(v.observedAt)) errors.push("observedAt required and must be non-empty");

  if (typeof v.evidence !== "object" || v.evidence === null || Array.isArray(v.evidence)) {
    errors.push("evidence required and must be a non-null object");
  }

  return { valid: errors.length === 0, errors };
}
