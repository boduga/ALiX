/**
 * Tests for A1.0 — Pattern Discovery Contract Types.
 *
 * Covers PatternCategory, confidence scoring,
 * PatternObservation validation, EvolutionCandidate validation,
 * EvolutionProposalDraft validation, and DiscoveryResult construction.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_PATTERN_CATEGORIES,
  computeConfidence,
  validatePatternObservation,
  validateEvolutionCandidate,
  validateEvolutionProposalDraft,
} from "../../src/evolution/contracts/pattern-discovery-contract.js";
import type {
  PatternCategory,
  PatternObservation,
  EvolutionCandidate,
  EvolutionProposalDraft,
  DiscoveryResult,
} from "../../src/evolution/contracts/pattern-discovery-contract.js";
import type {
  EvolutionTarget,
  EvolutionRiskClass,
} from "../../src/evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T = "2026-07-11T10:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(overrides: Partial<EvolutionTarget> = {}): EvolutionTarget {
  return {
    kind: "policy",
    id: "policy-approval-threshold",
    ...overrides,
  };
}

function makePatternObservation(
  overrides: Partial<PatternObservation> = {},
): PatternObservation {
  return {
    patternId: "pat-test-001",
    category: "execution_failure" as PatternCategory,
    frequency: 12,
    confidence: 0.85,
    evidenceIds: ["ev-001", "ev-002"],
    description: "Workflow retry operation failed 12 times in 7 days",
    firstObserved: "2026-07-04T10:00:00.000Z",
    lastObserved: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

function makeEvolutionCandidate(
  overrides: Partial<EvolutionCandidate> = {},
): EvolutionCandidate {
  return {
    candidateId: "cand-test-001",
    sourcePatternId: "pat-test-001",
    confidence: 0.75,
    target: makeTarget(),
    description: "Review retry policy configuration",
    expectedEffect: "Reduce failure rate for workflow retries",
    riskClass: "medium" as EvolutionRiskClass,
    evidenceIds: ["ev-001", "ev-002"],
    ...overrides,
  };
}

function makeEvolutionProposalDraft(
  overrides: Partial<EvolutionProposalDraft> = {},
): EvolutionProposalDraft {
  return {
    draftId: "draft-test-001",
    sourcePatternId: "pat-test-001",
    title: "Review retry policy configuration",
    description: "Workflow retry operation failed 12 times in 7 days. Review retry policy configuration.",
    target: makeTarget(),
    confidence: 0.75,
    riskClass: "medium" as EvolutionRiskClass,
    evidenceIds: ["ev-001", "ev-002"],
    createdAt: T,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PatternCategory
// ---------------------------------------------------------------------------

describe("PatternCategory", () => {
  it("has 6 valid categories", () => {
    assert.equal(VALID_PATTERN_CATEGORIES.length, 6);
    assert.ok(VALID_PATTERN_CATEGORIES.includes("execution_failure"));
    assert.ok(VALID_PATTERN_CATEGORIES.includes("approval_friction"));
    assert.ok(VALID_PATTERN_CATEGORIES.includes("performance_degradation"));
    assert.ok(VALID_PATTERN_CATEGORIES.includes("policy_ineffectiveness"));
    assert.ok(VALID_PATTERN_CATEGORIES.includes("governance_gap"));
    assert.ok(VALID_PATTERN_CATEGORIES.includes("agent_misbehavior"));
  });
});

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  it("returns 1.0 when all factors are at maximum", () => {
    const result = computeConfidence({
      evidenceCount: 100,
      baselineCount: 100,
      patternStrength: 1.0,
      recencyFactor: 1.0,
    });
    assert.equal(result, 1.0);
  });

  it("clamps to 1.0 when evidence exceeds baseline", () => {
    const result = computeConfidence({
      evidenceCount: 200,
      baselineCount: 100,
      patternStrength: 1.0,
      recencyFactor: 1.0,
    });
    assert.equal(result, 1.0);
  });

  it("returns 0.5 with half-density, full strength, full recency", () => {
    const result = computeConfidence({
      evidenceCount: 50,
      baselineCount: 100,
      patternStrength: 1.0,
      recencyFactor: 1.0,
    });
    assert.equal(result, 0.5);
  });

  it("returns 0 when evidenceCount is 0", () => {
    const result = computeConfidence({
      evidenceCount: 0,
      baselineCount: 100,
      patternStrength: 1.0,
      recencyFactor: 1.0,
    });
    assert.equal(result, 0.0);
  });

  it("handles baselineCount of 0 gracefully (returns 0)", () => {
    const result = computeConfidence({
      evidenceCount: 50,
      baselineCount: 0,
      patternStrength: 1.0,
      recencyFactor: 1.0,
    });
    assert.equal(result, 0.0);
  });

  it("applies patternStrength correctly", () => {
    const full = computeConfidence({
      evidenceCount: 100,
      baselineCount: 100,
      patternStrength: 1.0,
      recencyFactor: 1.0,
    });
    const half = computeConfidence({
      evidenceCount: 100,
      baselineCount: 100,
      patternStrength: 0.5,
      recencyFactor: 1.0,
    });
    assert.equal(full, 1.0);
    assert.equal(half, 0.5);
  });

  it("applies recencyFactor correctly", () => {
    const result = computeConfidence({
      evidenceCount: 100,
      baselineCount: 100,
      patternStrength: 1.0,
      recencyFactor: 0.5,
    });
    assert.equal(result, 0.5);
  });
});

// ---------------------------------------------------------------------------
// Validate — PatternObservation
// ---------------------------------------------------------------------------

describe("validatePatternObservation", () => {
  it("accepts a valid observation", () => {
    const result = validatePatternObservation(makePatternObservation());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects null input", () => {
    const result = validatePatternObservation(null);
    assert.equal(result.valid, false);
  });

  it("rejects missing patternId", () => {
    const result = validatePatternObservation(makePatternObservation({ patternId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("patternId")));
  });

  it("rejects invalid category", () => {
    const result = validatePatternObservation(
      makePatternObservation({ category: "unknown_category" as PatternCategory }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("category")));
  });

  it("rejects negative frequency", () => {
    const result = validatePatternObservation(makePatternObservation({ frequency: -1 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("frequency")));
  });

  it("rejects confidence outside [0, 1]", () => {
    const tooHigh = validatePatternObservation(makePatternObservation({ confidence: 1.5 }));
    assert.equal(tooHigh.valid, false);
    assert.ok(tooHigh.errors.some((e) => e.includes("confidence")));

    const tooLow = validatePatternObservation(makePatternObservation({ confidence: -0.1 }));
    assert.equal(tooLow.valid, false);
    assert.ok(tooLow.errors.some((e) => e.includes("confidence")));
  });

  it("rejects empty evidenceIds", () => {
    const result = validatePatternObservation(makePatternObservation({ evidenceIds: [] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evidenceIds")));
  });

  it("rejects missing description", () => {
    const result = validatePatternObservation(makePatternObservation({ description: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects missing firstObserved", () => {
    const result = validatePatternObservation(makePatternObservation({ firstObserved: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("firstObserved")));
  });

  it("rejects missing lastObserved", () => {
    const result = validatePatternObservation(makePatternObservation({ lastObserved: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("lastObserved")));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionCandidate
// ---------------------------------------------------------------------------

describe("validateEvolutionCandidate", () => {
  it("accepts a valid candidate", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects null input", () => {
    const result = validateEvolutionCandidate(null);
    assert.equal(result.valid, false);
  });

  it("rejects missing candidateId", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate({ candidateId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("candidateId")));
  });

  it("rejects missing sourcePatternId", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate({ sourcePatternId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("sourcePatternId")));
  });

  it("rejects confidence outside [0, 1]", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate({ confidence: 1.5 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("confidence")));
  });

  it("rejects invalid riskClass", () => {
    const result = validateEvolutionCandidate(
      makeEvolutionCandidate({ riskClass: "critical" as EvolutionRiskClass }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("riskClass")));
  });

  it("rejects missing target", () => {
    const result = validateEvolutionCandidate(
      makeEvolutionCandidate({ target: undefined as unknown as EvolutionTarget }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("target")));
  });

  it("rejects array as target", () => {
    const result = validateEvolutionCandidate(
      makeEvolutionCandidate({ target: [] as unknown as EvolutionTarget }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("target")));
  });

  it("rejects empty evidenceIds", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate({ evidenceIds: [] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evidenceIds")));
  });

  it("rejects missing description", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate({ description: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects missing expectedEffect", () => {
    const result = validateEvolutionCandidate(makeEvolutionCandidate({ expectedEffect: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("expectedEffect")));
  });
});

// ---------------------------------------------------------------------------
// Validate — EvolutionProposalDraft
// ---------------------------------------------------------------------------

describe("validateEvolutionProposalDraft", () => {
  it("accepts a valid draft", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects null input", () => {
    const result = validateEvolutionProposalDraft(null);
    assert.equal(result.valid, false);
  });

  it("rejects missing draftId", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ draftId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("draftId")));
  });

  it("rejects missing sourcePatternId", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ sourcePatternId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("sourcePatternId")));
  });

  it("rejects missing title", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ title: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("title")));
  });

  it("rejects missing description", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ description: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects missing target", () => {
    const result = validateEvolutionProposalDraft(
      makeEvolutionProposalDraft({ target: undefined as unknown as EvolutionTarget }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("target")));
  });

  it("rejects array as target", () => {
    const result = validateEvolutionProposalDraft(
      makeEvolutionProposalDraft({ target: [] as unknown as EvolutionTarget }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("target")));
  });

  it("rejects confidence outside [0, 1]", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ confidence: 1.5 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("confidence")));
  });

  it("rejects invalid riskClass", () => {
    const result = validateEvolutionProposalDraft(
      makeEvolutionProposalDraft({ riskClass: "critical" as EvolutionRiskClass }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("riskClass")));
  });

  it("accepts draft with empty evidenceIds", () => {
    // Drafts may be generated without direct evidence (e.g. from governance signals)
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ evidenceIds: [] }));
    assert.equal(result.valid, true);
  });

  it("rejects missing createdAt", () => {
    const result = validateEvolutionProposalDraft(makeEvolutionProposalDraft({ createdAt: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("createdAt")));
  });
});

// ---------------------------------------------------------------------------
// DiscoveryResult
// ---------------------------------------------------------------------------

describe("DiscoveryResult", () => {
  it("can be constructed with all required fields", () => {
    const result: DiscoveryResult = {
      patterns: [makePatternObservation()],
      candidates: [makeEvolutionCandidate()],
      drafts: [makeEvolutionProposalDraft()],
      metadata: {
        evidenceScanned: 100,
        detectionDurationMs: 250,
        strategiesRun: 2,
      },
    };
    assert.equal(result.patterns.length, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.drafts.length, 1);
    assert.equal(result.metadata.evidenceScanned, 100);
    assert.equal(result.metadata.detectionDurationMs, 250);
    assert.equal(result.metadata.strategiesRun, 2);
  });

  it("allows empty arrays for no discoveries", () => {
    const result: DiscoveryResult = {
      patterns: [],
      candidates: [],
      drafts: [],
      metadata: {
        evidenceScanned: 0,
        detectionDurationMs: 0,
        strategiesRun: 0,
      },
    };
    assert.equal(result.patterns.length, 0);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.drafts.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Non-object input
// ---------------------------------------------------------------------------

describe("validation rejects non-object input", () => {
  const validators = [
    ["validatePatternObservation", validatePatternObservation] as const,
    ["validateEvolutionCandidate", validateEvolutionCandidate] as const,
    ["validateEvolutionProposalDraft", validateEvolutionProposalDraft] as const,
  ];

  for (const [name, fn] of validators) {
    it(`${name} rejects non-object`, () => {
      assert.equal(fn("not-an-object").valid, false);
    });
    it(`${name} rejects array`, () => {
      assert.equal(fn([]).valid, false);
    });
  }
});
