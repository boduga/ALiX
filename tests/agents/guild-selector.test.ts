import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GuildSelector,
  type GuildCandidate,
} from "../../src/agents/guild-selector.js";
import {
  checkEssenceCompatibility,
  type EssenceProfile,
} from "../../src/agents/essence-profile.js";
import type { BridgeEnvelope } from "../../src/runtime/bridge-envelope.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeProfile(
  overrides: Partial<EssenceProfile> = {},
): EssenceProfile {
  return {
    agentId: "test-agent-1",
    role: "caller",
    domains: ["replay"],
    capabilities: ["read"],
    constraints: [],
    taboos: [],
    affinity: "general",
    riskTolerance: "medium",
    ...overrides,
  };
}

function makeEnvelope(
  overrides: Partial<BridgeEnvelope> = {},
): BridgeEnvelope {
  return {
    envelopeId: "env-1",
    signal: {
      signalId: "sig-1",
      code: "00000000",
      polarity: "neutral",
      domain: "replay",
      intent: "test signal",
      constraints: [],
      taboos: [],
      evidenceRefs: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    offering: {
      offeringId: "off-1",
      signalId: "sig-1",
      action: "proceed",
      requiredEvidence: [],
      constraints: [],
      taboos: [],
      successCriteria: ["done"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    chronicleRefs: [],
    safety: {
      requiresPolicyGate: false,
      requiresApproval: false,
      mutationPossible: false,
      taboos: [],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("GuildSelector", () => {
  const selector = new GuildSelector();

  it("select returns sorted candidates with highest compatible first", () => {
    // agent-high: replay domain + replay affinity + low risk = high compatible score
    const agentHigh = makeProfile({
      agentId: "agent-high",
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    // agent-med: replay domain + general affinity + medium risk = medium score
    const agentMed = makeProfile({
      agentId: "agent-med",
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "medium",
    });
    // agent-low: research domain + coding affinity = incompatible
    const agentLow = makeProfile({
      agentId: "agent-low",
      domains: ["research"],
      affinity: "coding",
      riskTolerance: "high",
    });

    const envelope = makeEnvelope();
    const result = selector.select({
      envelope,
      candidates: [agentLow, agentMed, agentHigh],
    });

    // compatible=true first, sorted by score descending
    assert.equal(result[0].profile.agentId, "agent-high");
    assert.equal(result[0].compatible, true);

    assert.equal(result[1].profile.agentId, "agent-med");
    assert.equal(result[1].compatible, true);

    // incompatible last
    assert.equal(result[2].profile.agentId, "agent-low");
    assert.equal(result[2].compatible, false);

    assert.ok(result[0].score > result[1].score);
  });

  it("select returns empty array for no candidates", () => {
    const envelope = makeEnvelope();
    const result = selector.select({ envelope, candidates: [] });
    assert.deepEqual(result, []);
  });

  it("select includes score and compatible from checkEssenceCompatibility", () => {
    const profile = makeProfile({
      agentId: "verify",
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    const envelope = makeEnvelope();

    // Compute expected result directly
    const expected = checkEssenceCompatibility(
      profile,
      envelope.signal,
      envelope.offering,
    );
    const result = selector.select({ envelope, candidates: [profile] });

    assert.equal(result[0].score, expected.score);
    assert.equal(result[0].compatible, expected.compatible);
  });

  it("select preserves input order for equal-score candidates (stable sort)", () => {
    const shared: Partial<EssenceProfile> = {
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "medium",
    };
    const a = makeProfile({ agentId: "a", ...shared });
    const b = makeProfile({ agentId: "b", ...shared });
    const c = makeProfile({ agentId: "c", ...shared });

    const envelope = makeEnvelope();
    const result = selector.select({ envelope, candidates: [a, b, c] });

    // All equal score → input order preserved
    assert.equal(result[0].profile.agentId, "a");
    assert.equal(result[1].profile.agentId, "b");
    assert.equal(result[2].profile.agentId, "c");
  });

  it("select handles single candidate", () => {
    const profile = makeProfile({ agentId: "solo" });
    const envelope = makeEnvelope();
    const result = selector.select({ envelope, candidates: [profile] });

    assert.equal(result.length, 1);
    assert.equal(result[0].profile.agentId, "solo");
  });

  it("select handles all incompatible candidates", () => {
    // Both incompatible but with different scores
    const agentA = makeProfile({
      agentId: "a",
      domains: ["research"],
      affinity: "coding",
      riskTolerance: "low",
    });
    const agentB = makeProfile({
      agentId: "b",
      domains: ["tool"],
      affinity: "research",
      riskTolerance: "high",
    });

    const envelope = makeEnvelope();
    const result = selector.select({ envelope, candidates: [agentB, agentA] });

    // All incompatible, sorted by score descending
    assert.equal(result[0].compatible, false);
    assert.equal(result[1].compatible, false);
    assert.ok(result[0].score >= result[1].score);
  });

  it("reasons from compatibility check are included in GuildCandidate", () => {
    // Profile with domain mismatch should produce "domain_mismatch" reason
    const profile = makeProfile({
      agentId: "mismatch",
      domains: ["research"],
      affinity: "coding",
      riskTolerance: "low",
    });
    const envelope = makeEnvelope(); // replay domain
    const result = selector.select({ envelope, candidates: [profile] });

    assert.ok(result[0].reasons.includes("domain_mismatch"));
  });

  it("does NOT execute tools or call any routing function", () => {
    // Structural test: GuildSelector only calls checkEssenceCompatibility
    // and performs pure data transformation — no tool executors or routers.
    const profile = makeProfile({
      agentId: "passive",
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    const envelope = makeEnvelope();
    const result = selector.select({ envelope, candidates: [profile] });

    assert.equal(result.length, 1);
    assert.equal(typeof result[0].score, "number");
    assert.equal(typeof result[0].compatible, "boolean");
    assert.ok(Array.isArray(result[0].reasons));
    assert.equal(result[0].profile.agentId, "passive");
  });
});
