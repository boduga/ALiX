import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SignalFrame } from "../../src/runtime/signal-frame.js";
import type { OfferingPlan } from "../../src/runtime/offering-planner.js";
import {
  checkEssenceCompatibility,
  type EssenceProfile,
} from "../../src/agents/essence-profile.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeProfile(overrides: Partial<EssenceProfile> = {}): EssenceProfile {
  return {
    agentId: "test-agent-1",
    role: "caller",
    domains: ["replay"],
    capabilities: ["read", "inspect"],
    constraints: [],
    taboos: [],
    affinity: "general",
    riskTolerance: "medium",
    ...overrides,
  };
}

function makeSignal(overrides: Partial<SignalFrame> = {}): SignalFrame {
  return {
    signalId: "sig-1",
    code: "00000000",
    polarity: "neutral",
    domain: "replay",
    intent: "test intent",
    constraints: [],
    taboos: [],
    evidenceRefs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeOffering(overrides: Partial<OfferingPlan> = {}): OfferingPlan {
  return {
    offeringId: "off-1",
    signalId: "sig-1",
    action: "proceed",
    requiredEvidence: [],
    constraints: [],
    taboos: [],
    successCriteria: ["done"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("essence-profile", () => {
  it("compatible profile with matching domain and affinity → score >= 50, compatible: true", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    const signal = makeSignal({ domain: "replay" });
    // Domain 40 + Affinity match 20 + Safe/low 20 + Neutral no-offering 10 = 90
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.compatible, true);
    assert.ok(result.score >= 50);
    assert.equal(result.score, 90);
  });

  it("incompatible profile with wrong domain → compatible: false, includes 'domain_mismatch'", () => {
    const profile = makeProfile({
      domains: ["research"],
      affinity: "general",
      riskTolerance: "low",
    });
    const signal = makeSignal({ domain: "replay" });
    // Domain 0 + General affinity 10 (general matches everything) + Safe/low 20
    //   + Neutral no-offering 10 = 40  → < 50
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.compatible, false);
    assert.ok(result.reasons.includes("domain_mismatch"));
    assert.equal(result.score, 40);
  });

  it("general affinity gives moderate score boost", () => {
    const generalProfile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "low",
    });
    const matchProfile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });

    const signal = makeSignal({ domain: "replay" });

    const generalResult = checkEssenceCompatibility(generalProfile, signal);
    const matchResult = checkEssenceCompatibility(matchProfile, signal);

    // general: 40+10+20+10 = 80, match: 40+20+20+10 = 90
    assert.equal(generalResult.score, 80);
    assert.equal(matchResult.score, 90);
    assert.ok(matchResult.score > generalResult.score);
  });

  /* ------------------------------------------------------------------ */
  /*  Affinity-to-domain mapping                                        */
  /* ------------------------------------------------------------------ */

  it("coding affinity matches tool task and policy domains", () => {
    const profile = makeProfile({
      domains: ["tool"],
      affinity: "coding",
      riskTolerance: "low",
    });

    const toolSignal = makeSignal({ domain: "tool" });
    const taskSignal = makeSignal({ domain: "task" });
    const replaySignal = makeSignal({ domain: "replay" });

    // coding -> tool: 40+20+20+10 = 90
    const toolResult = checkEssenceCompatibility(profile, toolSignal);
    assert.equal(toolResult.score, 90);

    // coding -> task (via affinity map): but profile.domains doesn't include task
    // 0+20+20+10 = 50 → borderline compatible
    const taskResult = checkEssenceCompatibility(profile, taskSignal);
    assert.equal(taskResult.score, 50);
    assert.ok(taskResult.reasons.includes("domain_mismatch"));

    // coding -> replay: affinity map doesn't include replay, domains don't match
    // 0+0+20+10 = 30 → incompatible
    const replayResult = checkEssenceCompatibility(profile, replaySignal);
    assert.equal(replayResult.score, 30);
    assert.ok(replayResult.reasons.includes("domain_mismatch"));
  });

  it("research affinity matches research memory and chronicle domains", () => {
    const profile = makeProfile({
      domains: ["research"],
      affinity: "research",
      riskTolerance: "low",
    });
    const sig = makeSignal({ domain: "research" });
    // 40+20+20+10 = 90
    const result = checkEssenceCompatibility(profile, sig);
    assert.equal(result.score, 90);
  });

  /* ------------------------------------------------------------------ */
  /*  Risk tolerance                                                     */
  /* ------------------------------------------------------------------ */

  it("high risk tolerance handles dangerous bits", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "high",
    });
    // Signal with policyRisk bit set → dangerous
    const signal = makeSignal({ code: "01000000" });
    // Domain 40 + General 10 + Dangerous/high 20 + Neutral 10 = 80
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.score, 80);
    assert.equal(result.reasons.length, 0);
  });

  it("medium risk tolerance with dangerous bits scores medium", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "medium",
    });
    const signal = makeSignal({ code: "01000000" });
    // Domain 40 + General 10 + Dangerous/medium 10 + Neutral 10 = 70
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.score, 70);
    assert.equal(result.reasons.length, 0);
  });

  it("low risk tolerance rejects dangerous bits (risk_tolerance_exceeded)", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "low",
    });
    const signal = makeSignal({ code: "01000000" });
    // Domain 40 + General 10 + Dangerous/low 0 + risk_tolerance_exceeded + Neutral 10 = 60
    const result = checkEssenceCompatibility(profile, signal);
    assert.ok(result.reasons.includes("risk_tolerance_exceeded"));
    assert.equal(result.score, 60);
  });

  it("safe signal with high risk tolerance scores conservative", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "high",
    });
    const signal = makeSignal({ code: "00000000" });
    // Domain 40 + General 10 + Safe/high 10 + Neutral 10 = 70
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.score, 70);
  });

  /* ------------------------------------------------------------------ */
  /*  Offering alignment                                                 */
  /* ------------------------------------------------------------------ */

  it("offering with ask_approval aligns with low risk tolerance", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "low",
    });
    const signal = makeSignal({ domain: "replay" });
    const offering = makeOffering({ action: "ask_approval" });
    // Domain 40 + General 10 + Safe/low 20 + AskApproval/low 20 = 90
    const result = checkEssenceCompatibility(profile, signal, offering);
    assert.equal(result.score, 90);

    // Contrast: high risk tolerance with ask_approval scores lower
    const highProfile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "high",
    });
    const highResult = checkEssenceCompatibility(
      highProfile,
      signal,
      offering,
    );
    // Domain 40 + General 10 + Safe/high 10 + AskApproval/high 5 = 65
    assert.equal(highResult.score, 65);
  });

  it("offering with pause aligns with nexus role", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "general",
      riskTolerance: "low",
      role: "nexus",
    });
    const signal = makeSignal({ domain: "replay" });
    const offering = makeOffering({ action: "pause" });
    // Domain 40 + General 10 + Safe/low 20 + Pause/nexus 20 = 90
    const result = checkEssenceCompatibility(profile, signal, offering);
    assert.equal(result.score, 90);
  });

  it("proceed offering with violations scores lower than clean proceed", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
      constraints: ["require_approval"],
    });
    // Signal does NOT have require_approval → violation
    const signal = makeSignal({ domain: "replay" });
    const offering = makeOffering({ action: "proceed" });

    // Domain 40 + Affinity 20 + Safe/low 20 + Proceed/dirty 5 - 10 (violation) = 75
    const result = checkEssenceCompatibility(profile, signal, offering);
    // checked via score assertion below
    assert.equal(result.score, 75);

    // Without violations, same profile would get Proceed/clean 20 instead of 5
    const cleanProfile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    const cleanResult = checkEssenceCompatibility(cleanProfile, signal, offering);
    // Domain 40 + Affinity 20 + Safe/low 20 + Proceed/clean 20 = 100
    assert.equal(cleanResult.score, 100);
  });

  it("checkEssenceCompatibility with no offering returns neutral score", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    const signal = makeSignal({ domain: "replay" });
    // Domain 40 + Affinity 20 + Safe/low 20 + No-offering 10 = 90
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.score, 90);

    // Compare: same profile with offering gets same-or-higher
    const offering = makeOffering({ action: "proceed" });
    const withOffering = checkEssenceCompatibility(profile, signal, offering);
    assert.ok(withOffering.score >= result.score);
  });

  /* ------------------------------------------------------------------ */
  /*  Violations                                                         */
  /* ------------------------------------------------------------------ */

  it("constraint violations reduce score", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
      constraints: ["require_approval"],
    });
    const signal = makeSignal({ domain: "replay" });
    // Domain 40 + Affinity 20 + Safe/low 20 + Neutral 10 - 10 (violation) = 80
    const result = checkEssenceCompatibility(profile, signal);
    assert.deepEqual(result.violatedConstraints, ["require_approval"]);
    assert.equal(result.score, 80);
  });

  it("taboo violations reduce score", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
      taboos: ["no_mutation"],
    });
    const signal = makeSignal({
      domain: "replay",
      taboos: ["no_mutation"],
    });
    // Domain 40 + Affinity 20 + Safe/low 20 + Neutral 10 - 10 (violation) = 80
    const result = checkEssenceCompatibility(profile, signal);
    assert.deepEqual(result.violatedTaboos, ["no_mutation"]);
    assert.equal(result.score, 80);
  });

  it("empty constraints/taboos return empty violation lists", () => {
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "replay",
      riskTolerance: "low",
    });
    const signal = makeSignal({
      domain: "replay",
      constraints: ["require_approval"],
      taboos: ["no_mutation"],
    });
    const result = checkEssenceCompatibility(profile, signal);
    assert.deepEqual(result.violatedConstraints, []);
    assert.deepEqual(result.violatedTaboos, []);
  });

  /* ------------------------------------------------------------------ */
  /*  Boundaries                                                         */
  /* ------------------------------------------------------------------ */

  it("score is clamped to 0–100", () => {
    const badProfile = makeProfile({
      domains: ["research"],
      affinity: "coding",
      riskTolerance: "low",
      constraints: ["a", "b", "c", "d", "e"],
    });
    const dangerousSignal = makeSignal({
      domain: "replay",
      code: "01000000",
      taboos: ["no_mutation"],
    });
    // Domain 0 + Affinity 0 + Dangerous/low 0 + risk_tolerance_exceeded
    //   + Neutral 10 - 40 (6 violations capped at 4) = -30 → clamped to 0
    const lowResult = checkEssenceCompatibility(badProfile, dangerousSignal);
    assert.equal(lowResult.score, 0);
  });

  it("boundary score of exactly 50 is compatible", () => {
    // Domain 40 + no affinity bonus (rollback != replay) + safe/low 20
    //   + no-offering 10 - 20 (2 violations) = 50
    const profile = makeProfile({
      domains: ["replay"],
      affinity: "rollback",
      riskTolerance: "low",
      constraints: ["require_approval", "require_policy_check"],
    });
    const signal = makeSignal({
      domain: "replay",
      constraints: [],
    });
    const result = checkEssenceCompatibility(profile, signal);
    assert.equal(result.score, 50);
    assert.equal(result.compatible, true);
    assert.deepEqual(result.violatedConstraints, [
      "require_approval",
      "require_policy_check",
    ]);
  });

  it("all fields present in returned EssenceCompatibility", () => {
    const profile = makeProfile();
    const signal = makeSignal();
    const offering = makeOffering();
    const result = checkEssenceCompatibility(profile, signal, offering);

    assert.ok(Object.hasOwn(result, "compatible"));
    assert.ok(Object.hasOwn(result, "score"));
    assert.ok(Object.hasOwn(result, "reasons"));
    assert.ok(Object.hasOwn(result, "violatedConstraints"));
    assert.ok(Object.hasOwn(result, "violatedTaboos"));

    assert.ok(Array.isArray(result.reasons));
    assert.ok(Array.isArray(result.violatedConstraints));
    assert.ok(Array.isArray(result.violatedTaboos));

    assert.ok(Number.isInteger(result.score));
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);

    assert.equal(typeof result.compatible, "boolean");
  });
});
