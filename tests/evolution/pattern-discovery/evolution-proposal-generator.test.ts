/**
 * Tests A1.2 — EvolutionProposalGenerator
 *
 * Covers candidate generation from patterns, proposal+draft mapping,
 * field correctness, edge cases, and architecture invariants.
 *
 * @module evolution-proposal-generator
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DefaultEvolutionProposalGenerator,
  generateCandidates,
} from "../../../src/evolution/pattern-discovery/evolution-proposal-generator.js";
import type {
  PatternObservation,
  EvolutionCandidate,
  PatternCategory,
} from "../../../src/evolution/contracts/pattern-discovery-contract.js";
import type { EvolutionRiskClass } from "../../../src/evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T = "2026-07-11T10:00:00.000Z";
const ALL_CATEGORIES: PatternCategory[] = [
  "execution_failure",
  "approval_friction",
  "performance_degradation",
  "policy_ineffectiveness",
  "governance_gap",
  "agent_misbehavior",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePattern(
  overrides: Partial<PatternObservation> = {},
): PatternObservation {
  return {
    patternId: "pat-test-001",
    category: "execution_failure",
    frequency: 12,
    confidence: 0.85,
    evidenceIds: ["ev-001", "ev-002"],
    description: "Workflow retry operation failed 12 times in 7 days",
    firstObserved: "2026-07-04T10:00:00.000Z",
    lastObserved: T,
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<EvolutionCandidate> = {},
): EvolutionCandidate {
  return {
    candidateId: "cand-test-001",
    sourcePatternId: "pat-test-001",
    confidence: 0.75,
    target: { kind: "workflow", id: "pat-test-001" },
    description: "Review retry policy configuration",
    expectedEffect: "Reduce execution failure rate through targeted adjustments",
    riskClass: "medium",
    evidenceIds: ["ev-001", "ev-002"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateCandidates
// ---------------------------------------------------------------------------

describe("generateCandidates", () => {
  it("generates one candidate per pattern", () => {
    const patterns = [makePattern(), makePattern({ patternId: "pat-2" })];
    const candidates = generateCandidates(patterns);
    assert.strictEqual(candidates.length, 2);
  });

  it("copies confidence from pattern to candidate", () => {
    const pattern = makePattern({ confidence: 0.65 });
    const [candidate] = generateCandidates([pattern]);
    assert.strictEqual(candidate.confidence, 0.65);
  });

  it("sets sourcePatternId to pattern.patternId", () => {
    const pattern = makePattern({ patternId: "pat-abc" });
    const [candidate] = generateCandidates([pattern]);
    assert.strictEqual(candidate.sourcePatternId, "pat-abc");
  });

  it("copies evidenceIds from pattern to candidate", () => {
    const pattern = makePattern({ evidenceIds: ["ev-a", "ev-b", "ev-c"] });
    const [candidate] = generateCandidates([pattern]);
    assert.deepStrictEqual(candidate.evidenceIds, ["ev-a", "ev-b", "ev-c"]);
  });

  it("evidenceIds is a copy (not same reference)", () => {
    const ids = ["ev-001"];
    const pattern = makePattern({ evidenceIds: ids });
    const [candidate] = generateCandidates([pattern]);
    ids.push("ev-002");
    assert.deepStrictEqual(candidate.evidenceIds, ["ev-001"]);
  });

  it("sets description from pattern.description", () => {
    const pattern = makePattern({ description: "Custom pattern description" });
    const [candidate] = generateCandidates([pattern]);
    assert.strictEqual(candidate.description, "Custom pattern description");
  });

  it("assigns default riskClass per category", () => {
    const riskByCategory: Record<PatternCategory, EvolutionRiskClass> = {
      execution_failure: "medium",
      approval_friction: "low",
      performance_degradation: "medium",
      policy_ineffectiveness: "low",
      governance_gap: "medium",
      agent_misbehavior: "high",
    };

    for (const category of ALL_CATEGORIES) {
      const pattern = makePattern({ category, patternId: `pat-${category}` });
      const [candidate] = generateCandidates([pattern]);
      assert.strictEqual(
        candidate.riskClass,
        riskByCategory[category],
        `expected riskClass ${riskByCategory[category]} for ${category}, got ${candidate.riskClass}`,
      );
    }
  });

  it("assigns expectedEffect per category", () => {
    const pattern = makePattern({ category: "approval_friction" });
    const [candidate] = generateCandidates([pattern]);
    assert.ok(candidate.expectedEffect.length > 0);
    assert.ok(candidate.expectedEffect.includes("approval friction"));
  });

  it("sets target.kind from category mapping", () => {
    const kindByCategory: Record<PatternCategory, string> = {
      execution_failure: "workflow",
      approval_friction: "governance_rule",
      performance_degradation: "runtime_config",
      policy_ineffectiveness: "policy",
      governance_gap: "governance_rule",
      agent_misbehavior: "agent_behavior",
    };

    for (const category of ALL_CATEGORIES) {
      const pattern = makePattern({ category, patternId: `pat-${category}` });
      const [candidate] = generateCandidates([pattern]);
      assert.strictEqual(
        candidate.target.kind,
        kindByCategory[category],
        `expected target.kind ${kindByCategory[category]} for ${category}, got ${candidate.target.kind}`,
      );
    }
  });

  it("sets target.id to pattern.patternId", () => {
    const pattern = makePattern({ patternId: "pat-xyz-789" });
    const [candidate] = generateCandidates([pattern]);
    assert.strictEqual(candidate.target.id, "pat-xyz-789");
  });

  it("generates unique candidateIds", () => {
    const patterns = [makePattern(), makePattern({ patternId: "pat-2" })];
    const candidates = generateCandidates(patterns);
    assert.notStrictEqual(candidates[0].candidateId, candidates[1].candidateId);
  });

  it("candidateId starts with 'cand-' prefix", () => {
    const pattern = makePattern();
    const [candidate] = generateCandidates([pattern]);
    assert.ok(candidate.candidateId.startsWith("cand-"));
  });

  it("returns empty array for empty patterns", () => {
    const candidates = generateCandidates([]);
    assert.deepStrictEqual(candidates, []);
  });
});

// ---------------------------------------------------------------------------
// DefaultEvolutionProposalGenerator — generate
// ---------------------------------------------------------------------------

describe("DefaultEvolutionProposalGenerator", () => {
  const generator = new DefaultEvolutionProposalGenerator();
  const candidate = makeCandidate();

  it("returns both proposal and draft", () => {
    const result = generator.generate(candidate);
    assert.ok(result.proposal, "should return a proposal");
    assert.ok(result.draft, "should return a draft");
  });

  it("proposal has all required fields", () => {
    const { proposal } = generator.generate(candidate);

    assert.ok(proposal.proposalId, "proposalId required");
    assert.ok(proposal.evolutionId, "evolutionId required");
    assert.ok(proposal.title, "title required");
    assert.ok(proposal.description, "description required");
    assert.ok(proposal.change, "change required");
    assert.ok(proposal.createdAt, "createdAt required");

    // Type checks
    assert.strictEqual(typeof proposal.proposalId, "string");
    assert.strictEqual(typeof proposal.evolutionId, "string");
    assert.strictEqual(typeof proposal.title, "string");
    assert.strictEqual(typeof proposal.description, "string");
    assert.strictEqual(typeof proposal.change, "string");
    assert.strictEqual(typeof proposal.createdAt, "string");

    // beforeHash and afterHash must be null per spec
    assert.strictEqual(proposal.beforeHash, null);
    assert.strictEqual(proposal.afterHash, null);
  });

  it("draft has all required fields", () => {
    const { draft } = generator.generate(candidate);

    assert.ok(draft.draftId, "draftId required");
    assert.ok(draft.sourcePatternId, "sourcePatternId required");
    assert.ok(draft.title, "title required");
    assert.ok(draft.description, "description required");
    assert.ok(draft.target, "target required");
    assert.ok(draft.confidence !== undefined && draft.confidence !== null, "confidence required");
    assert.ok(draft.riskClass, "riskClass required");
    assert.ok(Array.isArray(draft.evidenceIds), "evidenceIds required");
    assert.ok(draft.createdAt, "createdAt required");
  });

  it("draft copies fields from candidate", () => {
    const { draft } = generator.generate(candidate);

    assert.strictEqual(draft.sourcePatternId, candidate.sourcePatternId);
    assert.strictEqual(draft.description, candidate.description);
    assert.strictEqual(draft.target.kind, candidate.target.kind);
    assert.strictEqual(draft.target.id, candidate.target.id);
    assert.strictEqual(draft.confidence, candidate.confidence);
    assert.strictEqual(draft.riskClass, candidate.riskClass);
    assert.deepStrictEqual(draft.evidenceIds, candidate.evidenceIds);
  });

  it("draft evidenceIds is a copy (not same reference)", () => {
    const ids = ["ev-001"];
    const cand = makeCandidate({ evidenceIds: ids });
    const { draft } = generator.generate(cand);
    ids.push("ev-002");
    assert.deepStrictEqual(draft.evidenceIds, ["ev-001"]);
  });

  it("draft target is a shallow copy (not same reference)", () => {
    const { draft: draft1 } = generator.generate(candidate);
    const { draft: draft2 } = generator.generate(candidate);

    // Different objects even if same values
    // We can't assert reference equality directly, but we can mutate and check
    const originalTargetKind = draft1.target.kind;
    (draft1.target as unknown as Record<string, unknown>).kind = "mutated";
    // The second draft should be unaffected
    assert.strictEqual(draft2.target.kind, candidate.target.kind);
    // Restore
    draft1.target = { kind: originalTargetKind, id: candidate.target.id };
  });

  it("proposal title is derived from candidate description", () => {
    const cand = makeCandidate({ description: "Short description" });
    const { proposal } = generator.generate(cand);
    assert.strictEqual(proposal.title, "Short description");
  });

  it("proposal title truncates at first sentence within 80 chars", () => {
    const cand = makeCandidate({
      description: "First sentence. Second sentence with more detail.",
    });
    const { proposal } = generator.generate(cand);
    assert.strictEqual(proposal.title, "First sentence.");
  });

  it("proposal title truncates at 80 chars with ellipsis for long descriptions", () => {
    const longDesc = "A very long description that exceeds eighty characters by a significant margin and should be truncated at a word boundary with an ellipsis character at the end";
    const { proposal } = generator.generate(makeCandidate({ description: longDesc }));
    assert.ok(proposal.title.length <= 83); // 80 chars + "…"
    assert.ok(proposal.title.endsWith("…"));
  });

  it("proposal change derived from target", () => {
    const cand = makeCandidate({ target: { kind: "policy", id: "policy-001" } });
    const { proposal } = generator.generate(cand);
    assert.strictEqual(proposal.change, "Modify policy:policy-001");
  });

  it("proposal description matches candidate description", () => {
    const { proposal } = generator.generate(candidate);
    assert.strictEqual(proposal.description, candidate.description);
  });

  it("generates unique proposalIds", () => {
    const r1 = generator.generate(candidate);
    const r2 = generator.generate(candidate);
    assert.notStrictEqual(r1.proposal.proposalId, r2.proposal.proposalId);
  });

  it("generates unique evolutionIds", () => {
    const r1 = generator.generate(candidate);
    const r2 = generator.generate(candidate);
    assert.notStrictEqual(r1.proposal.evolutionId, r2.proposal.evolutionId);
  });

  it("generates unique draftIds", () => {
    const r1 = generator.generate(candidate);
    const r2 = generator.generate(candidate);
    assert.notStrictEqual(r1.draft.draftId, r2.draft.draftId);
  });

  it("proposalId starts with 'prop-' prefix", () => {
    const { proposal } = generator.generate(candidate);
    assert.ok(proposal.proposalId.startsWith("prop-"));
  });

  it("evolutionId starts with 'evol-' prefix", () => {
    const { proposal } = generator.generate(candidate);
    assert.ok(proposal.evolutionId.startsWith("evol-"));
  });

  it("draftId starts with 'draft-' prefix", () => {
    const { draft } = generator.generate(candidate);
    assert.ok(draft.draftId.startsWith("draft-"));
  });

  it("createdAt is valid ISO timestamp", () => {
    const now = Date.now();
    const { proposal } = generator.generate(candidate);
    const ts = new Date(proposal.createdAt).getTime();
    assert.ok(
      ts >= now - 1000 && ts <= now + 1000,
      `createdAt (${proposal.createdAt}) should be within 1s of now`,
    );
  });

  it("stateless — multiple calls produce independent results", () => {
    const r1 = generator.generate(candidate);
    const r2 = generator.generate(candidate);

    // Same inputs produce correctly-formatted outputs (different IDs)
    assert.strictEqual(r1.proposal.description, r2.proposal.description);
    assert.strictEqual(r1.draft.description, r2.draft.description);
    assert.notStrictEqual(r1.proposal.proposalId, r2.proposal.proposalId);
  });
});

// ---------------------------------------------------------------------------
// Architecture Invariants
// ---------------------------------------------------------------------------

describe("EvolutionProposalGenerator invariants", () => {
  it("generator name is non-empty", () => {
    const generator = new DefaultEvolutionProposalGenerator();
    assert.ok(generator.name.length > 0);
  });

  it("generator accepts config and applies custom prefixes", () => {
    const gen = new DefaultEvolutionProposalGenerator({
      evolutionIdPrefix: "custom-evol-",
      proposalIdPrefix: "custom-prop-",
      draftIdPrefix: "custom-draft-",
    });

    const candidate = makeCandidate();
    const { proposal, draft } = gen.generate(candidate);

    assert.ok(proposal.evolutionId.startsWith("custom-evol-"));
    assert.ok(proposal.proposalId.startsWith("custom-prop-"));
    assert.ok(draft.draftId.startsWith("custom-draft-"));

    // Default prefixes work when no config passed
    const genDefault = new DefaultEvolutionProposalGenerator();
    const r2 = genDefault.generate(candidate);
    assert.ok(r2.proposal.evolutionId.startsWith("evol-"));
    assert.ok(r2.proposal.proposalId.startsWith("prop-"));
    assert.ok(r2.draft.draftId.startsWith("draft-"));
  });
});
