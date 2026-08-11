// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A7.1 — a lifecycle intent that the governed application boundary deliberately
 * does not execute (spec §4: register/modify deferred). Message format per spec:
 * `capability:<intent> is not executable in A7.1 (<reason>)`. Used both as a
 * thrown error (rehydration projection) and as the blocked-reason source (applier).
 */
const DEFERRED_INTENT_REASONS: Record<string, string> = {
  register: "registration deferred to a future increment",
  modify: "modification deferred to a future increment",
};

export class CapabilityNotExecutableError extends Error {
  constructor(intent: string) {
    super(`capability:${intent} is not executable in A7.1 (${DEFERRED_INTENT_REASONS[intent] ?? "deferred"})`);
  }
}
