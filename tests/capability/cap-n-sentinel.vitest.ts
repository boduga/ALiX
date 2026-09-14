// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-N Task 4 — Structural sentinel for carve-out site, behavioral
 * edition (#697).
 *
 * Pins the carve-out discriminator `candidateToExecutionStep` through its
 * real interface: gap → create, deprecation_signal → remove,
 * underperformer → update, consolidation_opportunity → consolidate, and
 * anything else → CapabilityValidationError (fail-closed default; the
 * CAP-P fix for the silent-transition fall-through).
 *
 * @module tests/capability/cap-n-sentinel
 */

import { describe, expect, it } from "vitest";
import { candidateToExecutionStep } from "../../src/capability/capability-service.js";
import { CapabilityValidationError } from "../../src/capability/errors.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";

function candidate(overrides: Partial<CapabilityEvolutionCandidate> = {}): CapabilityEvolutionCandidate {
  return {
    candidateId: "cand-1",
    sourcePatternId: "gap",
    confidence: 0.9,
    target: { id: "cap-a", kind: "operation" },
    description: "test candidate",
    expectedEffect: "none",
    riskClass: "low",
    evidenceIds: [],
    ...overrides,
  } as CapabilityEvolutionCandidate;
}

describe("CAP-N carve-out discriminator", () => {
  it("axis 1: maps gap → create, deprecation_signal → remove, update, consolidate", () => {
    expect(
      candidateToExecutionStep(candidate({ sourcePatternId: "gap" }), "src-1", "1.0.0").operation,
    ).toBe("capability.create");
    expect(
      candidateToExecutionStep(candidate({ sourcePatternId: "deprecation_signal" }), "src-1", "1.0.0").operation,
    ).toBe("capability.remove");
    expect(
      candidateToExecutionStep(
        candidate({ sourcePatternId: "underperformer", proposedPatch: { op: "set", path: "/x", value: 1 } as never }),
        "src-1",
        "1.0.0",
      ).operation,
    ).toBe("capability.update");
  });

  it("axis 2: unrecognized sourcePatternId throws fail-closed (no silent transition)", () => {
    expect(() =>
      candidateToExecutionStep(candidate({ sourcePatternId: "mystery" }), "src-1", "1.0.0"),
    ).toThrow(CapabilityValidationError);
    // Underperformer without a patch is equally rejected, never emitted.
    expect(() => candidateToExecutionStep(candidate({ sourcePatternId: "underperformer" }), "src-1", "1.0.0")).toThrow(
      CapabilityValidationError,
    );
  });
});
