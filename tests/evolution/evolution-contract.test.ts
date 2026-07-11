/**
 * Tests for A0.1 — Evolution Contract Types.
 *
 * Covers type validation, lineage validation, terminal state invariants,
 * deterministic ordering, and edge cases.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EvolutionState,
  EVOLUTION_TERMINAL_STATES,
  VALID_EVOLUTION_ORIGINS,
  VALID_EVOLUTION_TARGET_KINDS,
  VALID_EVOLUTION_RISK_CLASSES,
  VALID_EVOLUTION_REVIEW_DECISIONS,
  VALID_EVOLUTION_VALIDATION_RESULTS,
  validateEvolutionIntent,
  validateEvolutionProposal,
  validateEvolutionReview,
  validateEvolutionApproval,
  validateEvolutionImplementation,
  validateEvolutionValidation,
  validateEvolutionActivation,
  validateEvolutionLineage,
  sortReviews,
  sortProposals,
  type EvolutionIntent,
  type EvolutionProposal,
  type EvolutionReview,
  type EvolutionApproval,
  type EvolutionImplementation,
  type EvolutionValidation,
  type EvolutionActivation,
} from "../../src/evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T = "2026-07-11T10:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<EvolutionIntent> = {}): EvolutionIntent {
  return {
    evolutionId: "evol-test-001",
    origin: "operator",
    target: { kind: "policy", id: "policy-approval-threshold" },
    rationale: [{ evidenceId: "ev-001", source: "p15" }],
    expectedEffect: "Improve approval threshold accuracy",
    riskClass: "medium",
    constraints: [],
    createdAt: T,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    proposalId: "prop-test-001",
    evolutionId: "evol-test-001",
    title: "Adjust approval threshold",
    description: "Change the approval threshold from 3 to 5",
    change: "Update policy-approval-threshold value from 3 to 5",
    beforeHash: "abc123",
    afterHash: "def456",
    createdAt: T,
    ...overrides,
  };
}

function makeReview(overrides: Partial<EvolutionReview> = {}): EvolutionReview {
  return {
    reviewId: "rev-test-001",
    evolutionId: "evol-test-001",
    reviewer: "alice",
    decision: "approve",
    rationale: "Threshold adjustment is appropriate",
    createdAt: T,
    ...overrides,
  };
}

function makeApproval(overrides: Partial<EvolutionApproval> = {}): EvolutionApproval {
  return {
    approvalId: "app-test-001",
    evolutionId: "evol-test-001",
    approvedBy: "governance-reviewer",
    approvedAt: T,
    authority: "governance_board",
    ...overrides,
  };
}

function makeImplementation(overrides: Partial<EvolutionImplementation> = {}): EvolutionImplementation {
  return {
    implementationId: "impl-test-001",
    evolutionId: "evol-test-001",
    changeEvidence: "Updated policy file",
    diff: "@@ -1,3 +1,5 @@",
    beforeHash: "abc123",
    afterHash: "def456",
    executedAt: T,
    ...overrides,
  };
}

function makeValidation(overrides: Partial<EvolutionValidation> = {}): EvolutionValidation {
  return {
    validationId: "val-test-001",
    evolutionId: "evol-test-001",
    result: "passed",
    metrics: { successRate: 1.0, latencyMs: 42 },
    evidenceIds: ["ev-val-001", "ev-val-002"],
    completedAt: T,
    ...overrides,
  };
}

function makeActivation(overrides: Partial<EvolutionActivation> = {}): EvolutionActivation {
  return {
    activationId: "act-test-001",
    evolutionId: "evol-test-001",
    activatedAt: T,
    scope: "production",
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EvolutionState
// ---------------------------------------------------------------------------

describe("EvolutionState", () => {
  it("has 11 defined states", () => {
    const states = Object.values(EvolutionState);
    assert.equal(states.length, 11);
  });

  it("defines 4 terminal states", () => {
    assert.equal(EVOLUTION_TERMINAL_STATES.length, 4);
    assert.ok(EVOLUTION_TERMINAL_STATES.includes(EvolutionState.ACTIVE));
    assert.ok(EVOLUTION_TERMINAL_STATES.includes(EvolutionState.REJECTED));
    assert.ok(EVOLUTION_TERMINAL_STATES.includes(EvolutionState.WITHDRAWN));
    assert.ok(EVOLUTION_TERMINAL_STATES.includes(EvolutionState.ROLLED_BACK));
  });
});

// ---------------------------------------------------------------------------
// EvolutionOrigin
// ---------------------------------------------------------------------------

describe("EvolutionOrigin", () => {
  it("has 4 valid origins", () => {
    assert.equal(VALID_EVOLUTION_ORIGINS.length, 4);
    assert.ok(VALID_EVOLUTION_ORIGINS.includes("operator"));
    assert.ok(VALID_EVOLUTION_ORIGINS.includes("governance_signal"));
    assert.ok(VALID_EVOLUTION_ORIGINS.includes("learning_outcome"));
    assert.ok(VALID_EVOLUTION_ORIGINS.includes("system_observation"));
  });
});

// ---------------------------------------------------------------------------
// EvolutionTargetKind
// ---------------------------------------------------------------------------

describe("EvolutionTargetKind", () => {
  it("has 7 valid target kinds", () => {
    assert.equal(VALID_EVOLUTION_TARGET_KINDS.length, 7);
    assert.ok(VALID_EVOLUTION_TARGET_KINDS.includes("policy"));
    assert.ok(VALID_EVOLUTION_TARGET_KINDS.includes("execution_intent"));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionIntent
// ---------------------------------------------------------------------------

describe("validateEvolutionIntent", () => {
  it("accepts a valid intent", () => {
    const result = validateEvolutionIntent(makeIntent());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects null input", () => {
    const result = validateEvolutionIntent(null);
    assert.equal(result.valid, false);
  });

  it("rejects missing evolutionId", () => {
    const result = validateEvolutionIntent(makeIntent({ evolutionId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evolutionId")));
  });

  it("rejects invalid origin", () => {
    const result = validateEvolutionIntent(makeIntent({ origin: "unknown_origin" as never }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("origin")));
  });

  it("rejects missing rationale", () => {
    const result = validateEvolutionIntent(makeIntent({ rationale: [] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("rationale")));
  });

  it("rejects invalid riskClass", () => {
    const result = validateEvolutionIntent(makeIntent({ riskClass: "critical" as never }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("riskClass")));
  });

  it("rejects missing constraints", () => {
    const result = validateEvolutionIntent(makeIntent({ constraints: undefined as never }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("constraints")));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionProposal
// ---------------------------------------------------------------------------

describe("validateEvolutionProposal", () => {
  it("accepts a valid proposal", () => {
    assert.equal(validateEvolutionProposal(makeProposal()).valid, true);
  });

  it("rejects null", () => {
    assert.equal(validateEvolutionProposal(null).valid, false);
  });

  it("rejects missing title", () => {
    const result = validateEvolutionProposal(makeProposal({ title: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("title")));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionReview
// ---------------------------------------------------------------------------

describe("validateEvolutionReview", () => {
  it("accepts a valid review", () => {
    assert.equal(validateEvolutionReview(makeReview()).valid, true);
  });

  it("rejects invalid decision", () => {
    const result = validateEvolutionReview(makeReview({ decision: "skip" as never }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decision")));
  });

  it("accepts reject decision", () => {
    assert.equal(validateEvolutionReview(makeReview({ decision: "reject" })).valid, true);
  });

  it("accepts amend decision", () => {
    assert.equal(validateEvolutionReview(makeReview({ decision: "amend" })).valid, true);
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionApproval
// ---------------------------------------------------------------------------

describe("validateEvolutionApproval", () => {
  it("accepts a valid approval", () => {
    assert.equal(validateEvolutionApproval(makeApproval()).valid, true);
  });

  it("rejects missing authority", () => {
    const result = validateEvolutionApproval(makeApproval({ authority: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("authority")));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionImplementation
// ---------------------------------------------------------------------------

describe("validateEvolutionImplementation", () => {
  it("accepts a valid implementation", () => {
    assert.equal(validateEvolutionImplementation(makeImplementation()).valid, true);
  });

  it("rejects missing beforeHash", () => {
    const result = validateEvolutionImplementation(makeImplementation({ beforeHash: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("beforeHash")));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionValidation
// ---------------------------------------------------------------------------

describe("validateEvolutionValidation", () => {
  it("accepts a valid validation", () => {
    assert.equal(validateEvolutionValidation(makeValidation()).valid, true);
  });

  it("rejects invalid result", () => {
    const result = validateEvolutionValidation(makeValidation({ result: "unknown" as never }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("result")));
  });

  it("accepts all valid results", () => {
    for (const r of VALID_EVOLUTION_VALIDATION_RESULTS) {
      assert.equal(validateEvolutionValidation(makeValidation({ result: r })).valid, true);
    }
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionActivation
// ---------------------------------------------------------------------------

describe("validateEvolutionActivation", () => {
  it("accepts a valid activation", () => {
    assert.equal(validateEvolutionActivation(makeActivation()).valid, true);
  });

  it("rejects missing scope", () => {
    const result = validateEvolutionActivation(makeActivation({ scope: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("scope")));
  });

  it("rejects non-boolean isActive", () => {
    const result = validateEvolutionActivation(makeActivation({ isActive: "yes" as never }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("isActive")));
  });
});

// ---------------------------------------------------------------------------
// Non-object input
// ---------------------------------------------------------------------------

describe("validation rejects non-object input", () => {
  const validators = [
    ["validateEvolutionIntent", validateEvolutionIntent],
    ["validateEvolutionProposal", validateEvolutionProposal],
    ["validateEvolutionReview", validateEvolutionReview],
    ["validateEvolutionApproval", validateEvolutionApproval],
    ["validateEvolutionImplementation", validateEvolutionImplementation],
    ["validateEvolutionValidation", validateEvolutionValidation],
    ["validateEvolutionActivation", validateEvolutionActivation],
  ] as const;

  for (const [name, fn] of validators) {
    it(`${name} rejects non-object`, () => {
      assert.equal(fn("not-an-object").valid, false);
    });
    it(`${name} rejects array`, () => {
      assert.equal(fn([]).valid, false);
    });
  }
});

// ---------------------------------------------------------------------------
// Lineage validation
// ---------------------------------------------------------------------------

describe("validateEvolutionLineage", () => {
  it("accepts intent-only (no other artifacts)", () => {
    const result = validateEvolutionLineage({ intent: makeIntent() });
    assert.equal(result.valid, true);
  });

  it("accepts all artifacts with matching evolutionId", () => {
    const result = validateEvolutionLineage({
      intent: makeIntent(),
      proposal: makeProposal(),
      review: makeReview(),
      approval: makeApproval(),
      implementation: makeImplementation(),
      validation: makeValidation(),
      activation: makeActivation(),
    });
    assert.equal(result.valid, true);
  });

  it("rejects when other artifacts exist without an intent", () => {
    const result = validateEvolutionLineage({
      proposal: makeProposal(),
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("EvolutionIntent is required")));
  });

  it("rejects proposal with mismatched evolutionId", () => {
    const result = validateEvolutionLineage({
      intent: makeIntent({ evolutionId: "evol-abc" }),
      proposal: makeProposal({ evolutionId: "evol-xyz" }),
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evol-xyz")));
  });

  it("rejects review with mismatched evolutionId", () => {
    const result = validateEvolutionLineage({
      intent: makeIntent({ evolutionId: "evol-abc" }),
      review: makeReview({ evolutionId: "evol-xyz" }),
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evol-xyz")));
  });

  it("rejects multiple mismatched artifacts with all errors", () => {
    const result = validateEvolutionLineage({
      intent: makeIntent({ evolutionId: "evol-abc" }),
      proposal: makeProposal({ evolutionId: "evol-wrong" }),
      review: makeReview({ evolutionId: "evol-wrong" }),
      approval: makeApproval({ evolutionId: "evol-abc" }), // correct
      implementation: makeImplementation({ evolutionId: "evol-wrong" }),
    });
    assert.equal(result.valid, false);
    // Should have 3 error messages
    assert.ok(result.errors.length >= 3);
  });
});

// ---------------------------------------------------------------------------
// Deterministic sort
// ---------------------------------------------------------------------------

describe("sortReviews", () => {
  const base = makeReview();

  it("sorts by createdAt ascending", () => {
    const early = { ...base, reviewId: "rev-b", createdAt: "2026-07-10T10:00:00.000Z" };
    const late = { ...base, reviewId: "rev-a", createdAt: "2026-07-12T10:00:00.000Z" };

    const sorted = sortReviews([late, early]);
    assert.equal(sorted[0].reviewId, "rev-b");
    assert.equal(sorted[1].reviewId, "rev-a");
  });

  it("ties broken by reviewId ascending", () => {
    const a = { ...base, reviewId: "rev-a", createdAt: T };
    const b = { ...base, reviewId: "rev-b", createdAt: T };

    const sorted = sortReviews([b, a]);
    assert.equal(sorted[0].reviewId, "rev-a");
    assert.equal(sorted[1].reviewId, "rev-b");
  });

  it("does not mutate the input array", () => {
    const input = [
      { ...base, reviewId: "rev-b", createdAt: "2026-07-12T10:00:00.000Z" },
      { ...base, reviewId: "rev-a", createdAt: "2026-07-10T10:00:00.000Z" },
    ];
    const copy = [...input];
    sortReviews(input);
    assert.deepEqual(input, copy);
  });
});

describe("sortProposals", () => {
  const base = makeProposal();

  it("sorts by createdAt ascending", () => {
    const early = { ...base, proposalId: "prop-b", createdAt: "2026-07-10T10:00:00.000Z" };
    const late = { ...base, proposalId: "prop-a", createdAt: "2026-07-12T10:00:00.000Z" };

    const sorted = sortProposals([late, early]);
    assert.equal(sorted[0].proposalId, "prop-b");
  });

  it("ties broken by proposalId ascending", () => {
    const a = { ...base, proposalId: "prop-a", createdAt: T };
    const b = { ...base, proposalId: "prop-b", createdAt: T };

    const sorted = sortProposals([b, a]);
    assert.equal(sorted[0].proposalId, "prop-a");
  });
});

// ---------------------------------------------------------------------------
// Empty input edge case
// ---------------------------------------------------------------------------

describe("empty input edge cases", () => {
  it("empty intent list lineage validates fine", () => {
    const result = validateEvolutionLineage({});
    assert.equal(result.valid, true);
  });

  it("sortReviews with empty list returns empty", () => {
    assert.deepEqual(sortReviews([]), []);
  });

  it("sortProposals with empty list returns empty", () => {
    assert.deepEqual(sortProposals([]), []);
  });
});
