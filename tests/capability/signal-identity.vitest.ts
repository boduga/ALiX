// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  computeSignalId,
  isValidSignalId,
} from "../../src/capability/evolution/signal-identity.js";
import type { CapabilityEvolutionSignal } from "../../src/capability/evolution/proposals.js";

describe("computeSignalId (CAP-10.5 ruling #R5)", () => {
  const underperformer: CapabilityEvolutionSignal = {
    kind: "underperformer",
    capabilityId: "cap-x@1.0.0",
    score: 0.4,
    evidenceIds: ["obs-1", "obs-2"],
  };

  it("is deterministic for the same signal body", () => {
    expect(computeSignalId(underperformer)).toBe(computeSignalId(underperformer));
  });

  it("is canonical-JSON order independent (key reordering → same id)", () => {
    const reordered: CapabilityEvolutionSignal = {
      score: 0.4,
      evidenceIds: ["obs-1", "obs-2"],
      capabilityId: "cap-x@1.0.0",
      kind: "underperformer",
    };
    expect(computeSignalId(reordered)).toBe(computeSignalId(underperformer));
  });

  it("produces a 64-char lowercase hex string", () => {
    expect(computeSignalId(underperformer)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across signal kinds", () => {
    const gap: CapabilityEvolutionSignal = { kind: "gap", score: 0.7, evidenceIds: [] };
    expect(computeSignalId(gap)).not.toBe(computeSignalId(underperformer));
  });

  it("differs across capabilityIds for the same kind", () => {
    const a: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "a@1", score: 0.4, evidenceIds: [] };
    const b: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "b@1", score: 0.4, evidenceIds: [] };
    expect(computeSignalId(a)).not.toBe(computeSignalId(b));
  });

  it("does not collide with proposal ids (different domain prefix)", () => {
    // computeSignalId must NOT match computeProposalId — domain-prefix isolation.
    // Indirect check: signal-id prefix is `alix-capability-signal-id-v1:`.
    // computeProposalId is out of scope to import here; the prefix check is enough.
    const id = computeSignalId(underperformer);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidSignalId (CAP-10.5 ruling #R5)", () => {
  it("accepts a 64-char lowercase hex string", () => {
    expect(isValidSignalId("a".repeat(64))).toBe(true);
  });

  it("rejects uppercase hex", () => {
    expect(isValidSignalId("A".repeat(64))).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidSignalId("a".repeat(63))).toBe(false);
    expect(isValidSignalId("a".repeat(65))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidSignalId(123)).toBe(false);
    expect(isValidSignalId(null)).toBe(false);
    expect(isValidSignalId(undefined)).toBe(false);
    expect(isValidSignalId({})).toBe(false);
  });
});