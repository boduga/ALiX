import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAIM_VERDICTS,
  CLAIM_VERIFICATION_CORPUS,
  DEFAULT_DECISION_CONFIG,
  EngineNotRegisteredError,
  EngineUnavailableError,
  JEV_CLAIM_QUESTION_ID,
  JEV_WIRE_FORMAT_STATUS,
  RemoteEngineNotAllowedError,
  JEV_ENGINE_ID,
  LOCAL_ENGINE_ID,
  MAX_EVIDENCE_ITEMS,
  MAX_EXCERPT_CHARS,
  MalformedResultError,
  ProjectionRejectedError,
  SUPPORT_OVERLAP_THRESHOLD,
  buildPlan,
  classifyClaimLocally,
  createCalibrationProvenance,
  createDecisionJournalStore,
  createDefaultRegistry,
  createExperimentProjectionStore,
  createJevExecutor,
  createProfileRegistry,
  experimentStorePath,
  isClaimVerdict,
  projectClaimVerification,
  readClaimProjection,
  registerJevEngine,
  resolveLocalClaimThreshold,
  runClaimVerificationShadow,
  selectClaimVerification,
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
    answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice, ...(confidence !== undefined ? { confidence } : {}) } },
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

  it("supportOverlapThreshold override flips a borderline verdict; default unchanged", () => {
    // 2/4 claim terms → overlap exactly 0.5: passes the default (strict <).
    const borderline = { claim: "alpha beta gamma delta", evidence: ["alpha beta"] };
    assert.equal(SUPPORT_OVERLAP_THRESHOLD, 0.5);
    assert.equal(classifyClaimLocally(borderline).verdict, "supported");
    assert.equal(
      classifyClaimLocally(borderline, { supportOverlapThreshold: 0.61 }).verdict,
      "insufficient",
    );
    assert.equal(
      classifyClaimLocally(borderline, { supportOverlapThreshold: 0.4 }).verdict,
      "supported",
    );
    // A higher threshold never turns a passing verdict into a contradiction.
    assert.equal(
      classifyClaimLocally({ claim: "alpha beta gamma", evidence: ["alpha beta gamma"] }, {
        supportOverlapThreshold: 1,
      }).verdict,
      "supported",
    );
  });
});

describe("resolveLocalClaimThreshold", () => {
  const provenance = createCalibrationProvenance({
    datasetId: "dataset/1",
    sampleCount: 4,
    metric: "accuracy",
    value: 0.8,
    computedAt: 1,
  });

  it("defaults to 0.5 with no registry or no applicable profile", () => {
    assert.equal(resolveLocalClaimThreshold(DEFAULT_DECISION_CONFIG), SUPPORT_OVERLAP_THRESHOLD);
    assert.equal(
      resolveLocalClaimThreshold(DEFAULT_DECISION_CONFIG, createProfileRegistry()),
      SUPPORT_OVERLAP_THRESHOLD,
    );
  });

  it("configured route profile wins when it is the active local claim profile", () => {
    const registry = createProfileRegistry([
      {
        id: "claim-verification/local/v1",
        decision: "claim-verification",
        engineId: "local",
        threshold: 0.61,
        status: "active",
        provenance,
      },
    ]);
    assert.equal(resolveLocalClaimThreshold(DEFAULT_DECISION_CONFIG, registry), 0.61);
  });

  it("falls back to the scope's active local profile when the configured id is absent or shadow", () => {
    const registry = createProfileRegistry([
      {
        id: "claim-verification/local/v1",
        decision: "claim-verification",
        engineId: "local",
        threshold: 0.7,
        status: "shadow",
        provenance,
      },
      {
        id: "claim-verification/local/v2",
        decision: "claim-verification",
        engineId: "local",
        threshold: 0.61,
        status: "active",
        provenance,
      },
    ]);
    // Configured id points at the shadow profile → active scope profile wins.
    assert.equal(resolveLocalClaimThreshold(DEFAULT_DECISION_CONFIG, registry), 0.61);
    // Configured id unknown → same fallback.
    const unknownId: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      claimVerification: { ...DEFAULT_DECISION_CONFIG.claimVerification, thresholdProfile: "claim-verification/local/v9" },
    };
    assert.equal(resolveLocalClaimThreshold(unknownId, registry), 0.61);
  });

  it("JEV-9: a foreign (jev) profile is never applied to the local baseline", () => {
    const registry = createProfileRegistry([
      {
        id: "claim-verification/jev/v1",
        decision: "claim-verification",
        engineId: "jev",
        threshold: 0.9,
        status: "active",
        provenance,
      },
    ]);
    // Configured route id points at the active jev profile → still 0.5.
    const configured: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      claimVerification: { ...DEFAULT_DECISION_CONFIG.claimVerification, thresholdProfile: "claim-verification/jev/v1" },
    };
    assert.equal(resolveLocalClaimThreshold(configured, registry), SUPPORT_OVERLAP_THRESHOLD);
    // Active local + active jev: the local profile applies, never the jev one.
    const both = createProfileRegistry([
      ...registry.profiles,
      {
        id: "claim-verification/local/v2",
        decision: "claim-verification",
        engineId: "local",
        threshold: 0.61,
        status: "active",
        provenance,
      },
    ]);
    assert.equal(resolveLocalClaimThreshold(configured, both), 0.61);
  });
});

describe("threshold-profile wiring", () => {
  // Overlap exactly 0.5: default passes, 0.61 refuses.
  const borderlineInput = {
    claim: "alpha beta gamma delta",
    evidence: [{ excerpt: "alpha beta" }],
  };

  it("createDefaultRegistry({ claimThreshold }) binds the local executor", async () => {
    const sealed = projectClaimVerification(borderlineInput);

    const tunedEngine = createDefaultRegistry({ claimThreshold: 0.61 }).resolve({
      engineId: LOCAL_ENGINE_ID,
      allowRemote: false,
      decision: "claim-verification",
    });
    assert.ok(tunedEngine.executor);
    const tunedOutcome = await tunedEngine.executor.execute({
      decision: "claim-verification",
      sealed,
    });
    assert.equal(tunedOutcome.kind, "choice");
    if (tunedOutcome.kind === "choice") assert.equal(tunedOutcome.choice, "insufficient");

    const plainEngine = createDefaultRegistry().resolve({
      engineId: LOCAL_ENGINE_ID,
      allowRemote: false,
      decision: "claim-verification",
    });
    assert.ok(plainEngine.executor);
    const plainOutcome = await plainEngine.executor.execute({
      decision: "claim-verification",
      sealed,
    });
    assert.equal(plainOutcome.kind, "choice");
    if (plainOutcome.kind === "choice") assert.equal(plainOutcome.choice, "supported");
  });

  it("selectClaimVerification applies claimThreshold in baseline mode", async () => {
    const journal = createDecisionJournalStore(join(tmpdir(), `cv-threshold-${Date.now()}`));
    const selection = await selectClaimVerification(borderlineInput, {
      config: DEFAULT_DECISION_CONFIG,
      registry: createDefaultRegistry(),
      journal,
      mode: "baseline",
      claimThreshold: 0.61,
    });
    assert.equal(selection.verdict, "insufficient");
    assert.equal(selection.engineId, LOCAL_ENGINE_ID);
    assert.equal(journal.readAll().length, 0);
  });
});

describe("jev wire mapping", () => {
  it("builds a bounded choice request over the legal verdicts", () => {
    const request = toJevRequest(sealedClaim());
    assert.equal(request.model, "jev-latest");
    const question = request.questions[JEV_CLAIM_QUESTION_ID];
    assert.equal(Object.keys(request.questions).length, 1);
    assert.equal(question.type, "choice");
    if (question.type !== "choice") return;
    assert.deepEqual(Object.keys(question.criteria), [...CLAIM_VERDICTS]);
    assert.match(String(request.state), /CLAIM:/);
    assert.match(String(request.state), /EVIDENCE:/);
  });

  it("maps a response to a native ChoiceResult with remote provenance", () => {
    const sealed = sealedClaim();
    const result = fromJevResponse(
      { model: "jev-1.13.0", answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice: "supported", confidence: 0.91 } } },
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
      () => fromJevResponse({ answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice: "maybe" } } }, ctx),
      MalformedResultError,
    );
    assert.throws(() => fromJevResponse({ answers: {} }, ctx), MalformedResultError);
    assert.throws(() => fromJevResponse({}, ctx), MalformedResultError);
    assert.throws(
      () => fromJevResponse({ answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice: "supported", confidence: 1.4 } } }, ctx),
      MalformedResultError,
    );
  });
});

describe("jev executor", () => {
  it("JEV-7: no key is unavailable (never reads env)", async () => {
    process.env.JEV_API_KEY = "env-should-be-ignored";
    try {
      const executor = createJevExecutor({ enabled: true, transport: okTransport("supported") });
      await assert.rejects(executor.execute({ decision: "claim-verification", sealed: sealedClaim() }), /api key missing/);
    } finally {
      delete process.env.JEV_API_KEY;
    }
  });

  it("returns a choice through an injected transport", async () => {
    const executor = createJevExecutor({ enabled: true, apiKey: "k", transport: okTransport("contradicted", 0.7) });
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
      transport: async () => ({ answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice: "maybe" } } }),
    });
    await assert.rejects(
      malformed.execute({ decision: "claim-verification", sealed: sealedClaim() }),
      (e: unknown) => e instanceof MalformedResultError,
    );
  });

  it("refuses a decision it has no mapping for", async () => {
    const executor = createJevExecutor({ enabled: true, apiKey: "k", transport: okTransport("supported") });
    await assert.rejects(
      executor.execute({ decision: "not-a-decision" as never, sealed: sealedClaim() }),
      (e: unknown) => e instanceof EngineUnavailableError && /no mapping/.test(e.message),
    );
  });

  it("the wire shape is verified against the official docs", () => {
    assert.equal(JEV_WIRE_FORMAT_STATUS, "verified-against-docs");
    // Remote still requires an explicit opt-in.
    assert.throws(() => createJevExecutor({ enabled: false }), RemoteEngineNotAllowedError);
  });

  it("arch §6: rejects a forged/unsealed projection before transport", async () => {
    let transportCalls = 0;
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      transport: async () => {
        transportCalls += 1;
        return { answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice: "supported" } } };
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
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted", 0.88) });
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
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("supported") });
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

describe("selectClaimVerification modes", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cv-select-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const input = {
    claim: "Water boils at 100 degrees Celsius at sea level.",
    evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }],
  };

  it("baseline mode: local verdict, no journal records, no shadow observation", async () => {
    const journal = createDecisionJournalStore(join(dir, "baseline"));
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry: createDefaultRegistry(),
      journal,
      mode: "baseline",
    });
    assert.equal(selection.mode, "baseline");
    assert.equal(selection.verdict, "supported");
    assert.equal(selection.engineId, LOCAL_ENGINE_ID);
    assert.equal(selection.shadow, undefined);
    assert.equal(journal.readAll().length, 0);
  });

  it("shadow mode returns the BASELINE verdict while journalling both engines", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(join(dir, "shadow"));
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "shadow",
    });
    // The documented divergence (spec §10): shadow DOES return a verdict,
    // and it is the baseline's — behaviour unchanged, observation added.
    assert.equal(selection.verdict, "supported");
    assert.equal(selection.engineId, LOCAL_ENGINE_ID);
    assert.equal(selection.shadow?.observed.verdict, "contradicted");
    assert.equal(selection.shadow?.agree, false);
    const records = journal.readAll();
    assert.equal(records.length, 2);
    assert.equal(new Set(records.map((r) => r.projectionHash)).size, 1);
  });

  it("active mode returns the observed engine's verdict, still journalling both", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(join(dir, "active"));
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "active",
    });
    assert.equal(selection.verdict, "contradicted");
    assert.equal(selection.engineId, JEV_ENGINE_ID);
    assert.equal(journal.readAll().length, 2);
  });

  it("remote outage in shadow: verdict still returned, no usable pair", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      transport: async () => {
        throw new Error("network down");
      },
    });
    const journal = createDecisionJournalStore(join(dir, "outage"));
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "shadow",
    });
    assert.equal(selection.verdict, "supported");
    const choiceRecords = journal.readAll().filter((r) => r.outcome.kind === "choice");
    assert.ok(choiceRecords.length <= 1, "no comparable pair when the remote degraded");
  });

  it("shadow mode with compareBaseline: false still returns the local verdict", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(join(dir, "no-baseline"));
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "shadow",
      compareBaseline: false,
    });
    // The runner skipped the baseline arm; shadow must still compute the
    // local verdict — never surface the observed (remote) one.
    assert.equal(selection.shadow?.baseline, undefined);
    assert.equal(selection.shadow?.observed.verdict, "contradicted");
    assert.equal(selection.verdict, "supported");
    assert.equal(selection.engineId, LOCAL_ENGINE_ID);
    assert.notEqual(selection.verdict, selection.shadow?.observed.verdict);
  });
});

describe("protected experiment projection store", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cv-experiments-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const record = (hash: string) => ({
    projectionHash: hash,
    decision: "claim-verification" as const,
    claim: "Water boils at 100 degrees Celsius at sea level.",
    evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }],
    createdAt: "2026-09-22T00:00:00.000Z",
  });

  it("resolves ~/.alix/decisions/experiments.jsonl through storeDir, never a bare ~", () => {
    assert.equal(experimentStorePath("/home/u/.alix"), join("/home/u/.alix", "decisions", "experiments.jsonl"));
    const real = experimentStorePath();
    assert.ok(real.endsWith(join(".alix", "decisions", "experiments.jsonl")), real);
    assert.equal(real.includes("~"), false);
  });

  it("round-trips a record and answers has/readByHash", async () => {
    const store = createExperimentProjectionStore(join(dir, ".alix"));
    assert.equal(await store.has("sha256:a"), false);
    await store.append(record("sha256:a"));
    assert.equal(await store.has("sha256:a"), true);
    assert.equal((await store.readByHash("sha256:a"))?.claim, record("sha256:a").claim);
    assert.equal(await store.readByHash("sha256:missing"), undefined);
  });

  it("rejects malformed evidence elements without throwing (line skipped, not typed)", async () => {
    const store = createExperimentProjectionStore(join(dir, ".alix-pin"));
    mkdirSync(join(dir, ".alix-pin", "decisions"), { recursive: true });
    const malformed = {
      projectionHash: "sha256:pin",
      decision: "claim-verification",
      claim: "c",
      evidence: [null],
      createdAt: "2026-09-22T00:00:00.000Z",
    };
    writeFileSync(store.path, JSON.stringify(malformed) + "\n", "utf-8");
    assert.equal(await store.has("sha256:pin"), false);
    assert.equal(await store.readByHash("sha256:pin"), undefined);
  });
});
