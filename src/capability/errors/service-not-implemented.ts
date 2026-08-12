// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — Stable error for forward-wired `propose()` and `measure()` methods.
 *
 * Locked ruling #4 (verbatim): "propose() and measure() are forward-wired stubs
 * that throw a stable error class (CapabilityServiceNotImplementedError with
 * code: 'not_implemented_yet'). They do NOT return empty/envelope results,
 * do NOT encode 'awaiting_cap_9' / 'awaiting_cap_10' in the error message —
 * the service contract does not encode the development roadmap. CAP-9/CAP-10
 * replace the body, keeping the same contract."
 *
 * @module capability/errors/service-not-implemented
 */

export class CapabilityServiceNotImplementedError extends Error {
  readonly code: "not_implemented_yet";

  constructor(message: string) {
    super(message);
    this.name = "CapabilityServiceNotImplementedError";
    this.code = "not_implemented_yet";
    Object.freeze(this);
  }
}