// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 — Stable opaque signal identity (ruling #R5).
 *
 * Deterministic SHA-256 hex id derived from canonical-JSON of a
 * `CapabilityEvolutionSignal`. Same signal body → same id; replay
 * and undelivered-signal references stay stable across processes.
 *
 * Domain prefix isolates signal ids from CAP-9 proposal ids
 * (`alix-capability-proposal-v1:`) and CAP-6 artifact ids
 * (`alix-capability-mutation-v1:`).
 *
 * @module capability/evolution/signal-identity
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityEvolutionSignal } from "./a7-proposals.js";

const SIGNAL_ID_DOMAIN_PREFIX = "alix-capability-signal-id-v1:";

/**
 * Compute a deterministic SHA-256 hex signal id from a signal body.
 * Pure function — no I/O, no clock. Same body → same id (idempotency).
 * Canonical-JSON normalization means different key orderings yield the same id.
 */
export function computeSignalId(signal: CapabilityEvolutionSignal): string {
  const canonical = canonicalStringify(signal);
  return createHash("sha256")
    .update(SIGNAL_ID_DOMAIN_PREFIX)
    .update(canonical)
    .digest("hex");
}

/** Runtime guard: 64 lowercase hex chars. */
export function isValidSignalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}