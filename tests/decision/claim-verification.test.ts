import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAIM_VERDICTS,
  CLAIM_VERIFICATION_CORPUS,
  DEFAULT_DECISION_CONFIG,
  EngineNotRegisteredError,
  EngineUnavailableError,
  JEV_CLAIM_QUESTION_ID,
  JEV_ENGINE_ID,
  JevWireFormatUnacknowledgedError,
  LOCAL_ENGINE_ID,
  MAX_EVIDENCE_ITEMS,
  MAX_EXCERPT_CHARS,
  MalformedResultError,
  ProjectionRejectedError,
  buildPlan,
  classifyClaimLocally,
  createDecisionJournalStore,
  createDefaultRegistry,
  createJevExecutor,
  isClaimVerdict,
  projectClaimVerification,
  readClaimProjection,
  registerJevEngine,
  runClaimVerificationShadow,
  toJevRequest,
  fromJevResponse,
  type DecisionConfig,
  type JevTransport,
} from "../../src/decision/index.js";

function jevConfig(overrides?: Partial<DecisionConfig>): DecisionConfig {
  return {
    ...DEFAULT_DECISION_CONFIG,
    remote: { jev: { enabled: true } },
    claimVerification: {
      engine: JEV_ENGINE_ID,
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "claim-verification/jev/v1",
    },
    ...overrides,
  };
}

function sealedClaim(claim = "Water boils at 100 degrees Celsius at sea level.", evidence: string[] = ["At sea level, water boils at 100 degrees Celsius."]) {
  return projectClaimVerification({ claim, evidence: evidence.map((excerpt) => ({ excerpt })) });
}

function okTransport(choice: string, confidence?: number): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: [{ id: JEV_CLAIM_QUESTION_ID, choice, ...(confidence !== undefined ? { confidence } : {}) }],
  });
}

describe("claim-verification schema", () => {
  it("enumerates the legal verdict space and rejects unknown values", () => {
    assert.deepEqual([...CLAIM_VERDICTS], ["supported", "contradicted", "insufficient"]);
    assert.equal(isClaimVerdict("supported"), true);
    assert.equal(isClaimVerdict("maybe"), false);
    assert.equal(isClaimVerdict(undefined), false);
  });
});

describe("claim-verification projection", () => {
  it("keeps only claim + bounded evidence excerpts", () => {
    const sealed = sealedClaim("claim", Array.from({ length: 20 }, (_, i) => `excerpt ${i}`));
    const payload = sealed.payload;
    assert.deepEqual(Object.keys(payload).sort(), ["claim", "evidence"]);
    assert.equal(payload.evidence.length, MAX_EVIDENCE_ITEMS);
    assert.equal(sealed.projectorVersion, "claim-verification/v1");
  });

  it("truncates over-long excerpts and drops empties", () => {
    const sealed = projectClaimVerification({
      claim: "x",
      evidence: [{ excerpt: "y".repeat(MAX_EXCERPT_CHARS + 500) }, { excerpt: "   " }],
    });
    assert.equal(sealed.payload.evidence.length, 1);
    assert.ok(sealed.payload.evidence[0].length <= MAX_EXCERPT_CHARS);
  });

  it("missing claim blocks projection (no remote call)", () => {
    assert.throws(() => projectClaimVerification({ claim: "   " }), /non-empty claim/);
  });

  it("JEV-3: secret-bearing evidence rejected at the boundary", () => {
    assert.throws(
      () =>
        projectClaimVerification({
          claim: "The key is valid.",
          evidence: [{ excerpt: "token sk-abcdefghijklmnopqrstuvwx" }],
        }),
      ProjectionRejectedError,
    );
  });

  it("readClaimProjection degrades leniently for local engines", () => {
    assert.deepEqual(readClaimProjection({ claim: "c" }), { claim: "c", evidence: [] });
    assert.deepEqual(readClaimProjection(null), { claim: "", evidence: [] });
  });
});

function evidenceOf(fixture: { evidence?: Array<{ excerpt: string }> }): string[] {
  return (fixture.evidence ?? []).map((entry) => entry.excerpt);
}

describe("local baseline", () => {
  it("classifies the labeled corpus deterministically", () => {
    for (const fixture of CLAIM_VERIFICATION_CORPUS) {
      const first = classifyClaimLocally({ claim: fixture.claim, evidence: evidenceOf(fixture) });
      const second = classifyClaimLocally({ claim: fixture.claim, evidence: evidenceOf(fixture) });
      assert.equal(first.verdict, fixture.expected, `${fixture.id}: ${first.reason}`);
      assert.deepEqual(first, second, `${fixture.id} not deterministic`);
    }
  });

  it("adversarial instruction text cannot move the verdict", () => {
    const fixture = CLAIM_VERIFICATION_CORPUS.find((f) => f.id === "adversarial-injection");
    assert.ok(fixture?.adversarial);
    const verdict = classifyClaimLocally({
      claim: fixture.claim,
      evidence: evidenceOf(fixture),
    });
    assert.equal(verdict.verdict, "contradicted");
    assert.doesNotMatch(verdict.reason, /ignore all previous/i);
  });
});

describe("jev wire mapping", () => {
  it("builds a bounded choice request over the legal verdicts", () => {
    const request = toJevRequest(sealedClaim());
    assert.equal(request.model, "jev-latest");
    assert.equal(request.questions.length, 1);
    assert.equal(request.questions[0].type, "choice");
    assert.deepEqual(request.questions[0].options, [...CLAIM_VERDICTS]);
    assert.match(request.state, /CLAIM:/);
    assert.match(request.state, /EVIDENCE:/);
  });

  it("maps a response to a native ChoiceResult with remote provenance", () => {
    const sealed = sealedClaim();
    const result = fromJevResponse(
      { model: "jev-1.13.0", answers: [{ id: JEV_CLAIM_QUESTION_ID, choice: "supported", confidence: 0.91 }] },
      { projectionHash: sealed.hash, latencyMs: 120 },
    );
    assert.equal(result.kind, "choice");
    assert.equal(result.choice, "supported");
    assert.equal(result.confidence, 0.91);
    assert.equal(result.provenance.engineId, JEV_ENGINE_ID);
    assert.equal(result.provenance.engineVersion, "jev-1.13.0");
    assert.equal(result.provenance.remote, true);
    assert.equal(result.provenance.projectionHash, sealed.hash);
  });

  it("JEV-1: unknown verdict, missing answer, and bad confidence are malformed", () => {
    const ctx = { projectionHash: "sha256:x", latencyMs: 1 };
    assert.throws(
      () => fromJevResponse({ answers: [{ id: JEV_CLAIM_QUESTION_ID, choice: "maybe" }] }, ctx),
      MalformedResultError,
    );
    assert.throws(() => fromJevResponse({ answers: [] }, ctx), MalformedResultError);
    assert.throws(() => fromJevResponse({}, ctx), MalformedResultError);
    assert.throws(
      () => fromJevResponse({ answers: [{ id: JEV_CLAIM_QUESTION_ID, choice: "supported", confidence: 1.4 }] }, ctx),
      MalformedResultError,
    );
  });
});

describe("jev executor", () => {
  it("JEV-7: no key is unavailable (never reads env)", async () => {
    process.env.JEV_API_KEY = "env-should-be-ignored";
    try {
      const executor = createJevExecutor({ enabled: true, acknowledgeUnverifiedWireFormat: true, transport: okTransport("supported") });
      await assert.rejects(executor.execute({ decision: "claim-verification", sealed: sealedClaim() }), /api key missing/);
    } finally {
      delete process.env.JEV_API_KEY;
    }
  });

  it("returns a choice through an injected transport", async () => {
    const executor = createJevExecutor({ enabled: true, apiKey: "k", acknowledgeUnverifiedWireFormat: true, transport: okTransport("contradicted", 0.7) });
    const outcome = await executor.execute({ decision: "claim-verification", sealed: sealedClaim() });
    assert.equal(outcome.kind, "choice");
    if (outcome.kind !== "choice") return;
    assert.equal(outcome.choice, "contradicted");
    assert.equal(outcome.provenance.remote, true);
  });

  it("transport failure is fallback-eligible; malformed is rejected", async () => {
    const failing = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("socket hang up");
      },
    });
    await assert.rejects(
      failing.execute({ decision: "claim-verification", sealed: sealedClaim() }),
      (e: unknown) => e instanceof EngineUnavailableError,
    );

    const malformed = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => ({ answers: [{ id: JEV_CLAIM_QUESTION_ID, choice: "maybe" }] }),
    });
    await assert.rejects(
      malformed.execute({ decision: "claim-verification", sealed: sealedClaim() }),
      (e: unknown) => e instanceof MalformedResultError,
    );
  });

  it("refuses a decision it has no mapping for", async () => {
    const executor = createJevExecutor({ enabled: true, apiKey: "k", acknowledgeUnverifiedWireFormat: true, transport: okTransport("supported") });
    await assert.rejects(
      executor.execute({ decision: "not-a-decision" as never, sealed: sealedClaim() }),
      (e: unknown) => e instanceof EngineUnavailableError && /no mapping/.test(e.message),
    );
  });

  it("refuses to enable remote without wire-format acknowledgement", () => {
    assert.throws(
      () => createJevExecutor({ enabled: true, apiKey: "k" }),
      JevWireFormatUnacknowledgedError,
    );
  });

  it("arch §6: rejects a forged/unsealed projection before transport", async () => {
    let transportCalls = 0;
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        transportCalls += 1;
        return { answers: [{ id: JEV_CLAIM_QUESTION_ID, choice: "supported" }] };
      },
    });
    const forged = {
      sealed: "remote",
      decision: "claim-verification",
      projectorVersion: "claim-verification/v1",
      payload: { claim: "forged", evidence: [] },
      hash: "sha256:deadbeef",
      sealedAt: 1,
    };
    await assert.rejects(
      executor.execute({ decision: "claim-verification", sealed: forged as never }),
      ProjectionRejectedError,
    );
    assert.equal(transportCalls, 0);
  });
});

describe("fallback and capability enforcement", () => {
  it("jev transport failure falls back to the local baseline", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("timeout");
      },
    });
    const plan = buildPlan("claim-verification", jevConfig(), registry);
    assert.equal(plan.primaryId, JEV_ENGINE_ID);
    assert.equal(plan.fallbackId, LOCAL_ENGINE_ID);

    const result = await runClaimVerificationShadow(
      { claim: "Water boils at 100 degrees Celsius at sea level.", evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }] },
      { config: jevConfig(), registry },
    );
    assert.equal(result.observed.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.observed.verdict, "supported");
    assert.equal(result.authority, "none");

    const jevFailure = result.records.find((r) => r.engineId === JEV_ENGINE_ID);
    assert.equal(jevFailure?.outcome.kind, "failure");
    assert.equal(jevFailure?.remote, true);
  });

  it("timeout on the remote attempt engages fallback and journals the failure", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: () => new Promise<never>(() => {}),
    });
    const result = await runClaimVerificationShadow(
      { claim: "The sky appears blue because of Rayleigh scattering.", evidence: [{ excerpt: "Rayleigh scattering makes the sky appear blue." }] },
      { config: jevConfig(), registry, timeoutMs: 25 },
    );
    assert.equal(result.observed.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.observed.verdict, "supported");
    const jevFailure = result.records.find((r) => r.engineId === JEV_ENGINE_ID);
    assert.equal(jevFailure?.outcome.kind, "failure");
    assert.match(
      jevFailure?.outcome.kind === "failure" ? jevFailure.outcome.error : "",
      /timed out/,
    );
  });

  it("an engine that cannot answer the decision fails closed at plan time", () => {
    const registry = createDefaultRegistry();
    registry.register({
      id: "claim-only",
      remote: false,
      capabilities: ["choice"],
      supportsDecision: (decision) => decision === "claim-verification",
      executor: {
        engineId: "claim-only",
        async execute() {
          return { kind: "failure", error: "not applicable" };
        },
      },
    });
    const config = jevConfig({
      modelTier: { engine: "claim-only", fallback: "existing-routing", thresholdProfile: "t/v1" },
    });
    assert.throws(() => buildPlan("model-tier", config, registry), EngineNotRegisteredError);
  });
});

describe("shadow runner", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-claim-shadow-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("journals observed + baseline under one projection hash, grants no authority", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", acknowledgeUnverifiedWireFormat: true, transport: okTransport("contradicted", 0.88) });
    const journal = createDecisionJournalStore(join(dir, "s1"));
    const result = await runClaimVerificationShadow(
      { claim: "Water boils at 100 degrees Celsius at sea level.", evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }] },
      { config: jevConfig(), registry, journal },
    );

    assert.equal(result.observed.engineId, JEV_ENGINE_ID);
    assert.equal(result.observed.verdict, "contradicted");
    assert.equal(result.baseline?.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.baseline?.verdict, "supported");
    assert.equal(result.agree, false);
    assert.equal(result.authority, "none");

    assert.equal(result.records.length, 2);
    const persisted = journal.findByProjectionHash(result.projectionHash);
    assert.equal(persisted.length, 2);
    assert.deepEqual(persisted.map((r) => r.engineId).sort(), [JEV_ENGINE_ID, LOCAL_ENGINE_ID]);
    const jevRecord = persisted.find((r) => r.engineId === JEV_ENGINE_ID);
    assert.equal(jevRecord?.remote, true);
    assert.equal(jevRecord?.redactionApplied, true);
    assert.equal(jevRecord?.thresholdProfile, "claim-verification/jev/v1");
  });

  it("local-only route journals once and skips the redundant baseline", async () => {
    const journal = createDecisionJournalStore(join(dir, "s2"));
    const result = await runClaimVerificationShadow(
      { claim: "The sky appears blue because of Rayleigh scattering.", evidence: [{ excerpt: "Rayleigh scattering makes the sky appear blue." }] },
      { config: DEFAULT_DECISION_CONFIG, registry: createDefaultRegistry(), journal },
    );
    assert.equal(result.observed.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.observed.verdict, "supported");
    assert.equal(result.baseline, undefined);
    assert.equal(result.records.length, 1);
    assert.equal(journal.readAll().length, 1);
  });

  it("agreement is true when observed and baseline match", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", acknowledgeUnverifiedWireFormat: true, transport: okTransport("supported") });
    const result = await runClaimVerificationShadow(
      { claim: "The sky appears blue because of Rayleigh scattering.", evidence: [{ excerpt: "Rayleigh scattering makes the sky appear blue." }] },
      { config: jevConfig(), registry },
    );
    assert.equal(result.agree, true);
  });

  it("projection failure throws before any engine or journal write", async () => {
    const journal = createDecisionJournalStore(join(dir, "s3"));
    await assert.rejects(
      runClaimVerificationShadow(
        { claim: "The token is valid.", evidence: [{ excerpt: "sk-abcdefghijklmnopqrstuvwx" }] },
        { config: jevConfig(), registry: createDefaultRegistry(), journal },
      ),
      ProjectionRejectedError,
    );
    assert.equal(journal.readAll().length, 0);
  });
});
