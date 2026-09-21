import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DECISION_CONFIG,
  EngineNotRegisteredError,
  RemoteEngineNotAllowedError,
  createDefaultRegistry,
  createEngineRegistry,
  isChoiceResult,
  isNoulResult,
  isRemoteEngineAllowed,
  isScoreResult,
  isValidChoice,
  isValidConfidence,
  isValidProbability,
  isValidScore,
  routePolicyFor,
  validateDecisionConfig,
  validateProvenance,
  type ChoiceResult,
  type DecisionProvenance,
  type NoulResult,
  type ScoreResult,
} from "../../src/decision/index.js";

function provenance(overrides?: Partial<DecisionProvenance>): DecisionProvenance {
  return {
    engineId: "local",
    latencyMs: 3,
    remote: false,
    projectionHash: "sha256:abc",
    ...overrides,
  };
}

describe("decision contracts", () => {
  it("preserves native kinds without flattening", () => {
    const choice: ChoiceResult<string> = { kind: "choice", choice: "a", provenance: provenance() };
    const score: ScoreResult = { kind: "score", score: 0.7, provenance: provenance() };
    const noul: NoulResult = { kind: "noul", probability: 0.2, provenance: provenance() };
    assert.equal(isChoiceResult(choice), true);
    assert.equal(isScoreResult(score), true);
    assert.equal(isNoulResult(noul), true);
    assert.equal(isChoiceResult<string>(score as unknown as ChoiceResult<string>), false);
    // Noul carries probability, never confidence key
    assert.equal("confidence" in noul, false);
  });

  it("JEV-1: unknown choice rejected, never coerced", () => {
    const candidates = ["supported", "contradicted", "insufficient"] as const;
    assert.equal(isValidChoice("supported", candidates), true);
    assert.equal(isValidChoice("execute-plan", candidates), false);
    assert.equal(isValidChoice(undefined, candidates), false);
  });

  it("rejects out-of-range score/probability/confidence", () => {
    assert.equal(isValidScore(0), true);
    assert.equal(isValidScore(1), true);
    assert.equal(isValidScore(-0.1), false);
    assert.equal(isValidScore(1.1), false);
    assert.equal(isValidScore(Number.NaN), false);
    assert.equal(isValidProbability(0.5), true);
    assert.equal(isValidProbability(2), false);
    assert.equal(isValidConfidence(undefined), true);
    assert.equal(isValidConfidence(0.9), true);
    assert.equal(isValidConfidence(1.5), false);
  });

  it("provenance requires engine id, latency, remote flag, projection hash", () => {
    assert.equal(validateProvenance(provenance()), true);
    assert.equal(validateProvenance({ ...provenance(), engineId: "" }), false);
    assert.equal(validateProvenance({ ...provenance(), projectionHash: "" }), false);
    assert.equal(validateProvenance({ ...provenance(), latencyMs: -1 }), false);
  });
});

describe("engine registry", () => {
  it("JEV-7: default registry works with Jev absent", () => {
    const registry = createDefaultRegistry();
    const engine = registry.resolve({ engineId: "local" });
    assert.equal(engine.id, "local");
    assert.equal(engine.remote, false);
  });

  it("remote engine fails closed without opt-in", () => {
    const registry = createEngineRegistry();
    registry.register({ id: "local", remote: false, capabilities: ["choice"] });
    registry.register({ id: "jev", remote: true, capabilities: ["choice"] });
    assert.throws(() => registry.resolve({ engineId: "jev" }), RemoteEngineNotAllowedError);
    const engine = registry.resolve({ engineId: "jev", allowRemote: true });
    assert.equal(engine.id, "jev");
  });

  it("missing engine throws, duplicate register rejected", () => {
    const registry = createDefaultRegistry();
    assert.throws(() => registry.resolve({ engineId: "nope" }), EngineNotRegisteredError);
    assert.throws(() => registry.register({ id: "local", remote: false, capabilities: [] }), /already registered/);
  });
});

describe("decision config", () => {
  it("defaults local-first with Jev disabled", () => {
    const check = validateDecisionConfig(DEFAULT_DECISION_CONFIG);
    assert.equal(check.valid, true);
    assert.equal(DEFAULT_DECISION_CONFIG.remote.jev.enabled, false);
    assert.equal(isRemoteEngineAllowed("local", DEFAULT_DECISION_CONFIG), true);
    assert.equal(isRemoteEngineAllowed("existing-routing", DEFAULT_DECISION_CONFIG), true);
    assert.equal(isRemoteEngineAllowed("jev", DEFAULT_DECISION_CONFIG), false);
  });

  it("Jev allowed only when explicitly enabled", () => {
    const enabled = {
      ...DEFAULT_DECISION_CONFIG,
      remote: { jev: { enabled: true } },
    };
    assert.equal(isRemoteEngineAllowed("jev", enabled), true);
    assert.equal(isRemoteEngineAllowed("unknown-remote", enabled), false);
  });

  it("JEV-9: threshold profiles engine-specific, distinct per route", () => {
    const routes = [
      routePolicyFor(DEFAULT_DECISION_CONFIG, "claim-verification"),
      routePolicyFor(DEFAULT_DECISION_CONFIG, "context-relevance"),
      routePolicyFor(DEFAULT_DECISION_CONFIG, "model-tier"),
    ];
    for (const r of routes) {
      assert.match(r.thresholdProfile, /\//);
    }
    const profiles = new Set(routes.map((r) => r.thresholdProfile));
    assert.equal(profiles.size, 3);
  });

  it("JEV-10: default model-tier route names router, not provider ids", () => {
    const route = routePolicyFor(DEFAULT_DECISION_CONFIG, "model-tier");
    assert.equal(route.engine, "existing-routing");
    assert.equal(route.engine.includes(":"), false);
  });

  it("validator catches empty engine and bad flag", () => {
    const bad = {
      ...DEFAULT_DECISION_CONFIG,
      remote: { jev: { enabled: "yes" } },
      claimVerification: { engine: "", fallback: "local", thresholdProfile: "x" },
    };
    const check = validateDecisionConfig(bad);
    assert.equal(check.valid, false);
    assert.ok(check.issues.some((i) => i.path === "remote.jev.enabled"));
    assert.ok(check.issues.some((i) => i.path === "claimVerification.engine"));
  });
});
