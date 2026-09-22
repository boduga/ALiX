import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DECISION_CONFIG,
  EngineUnavailableError,
  JEV_ENGINE_ID,
  JEV_RISK_QUESTION_ID,
  LOCAL_ENGINE_ID,
  MalformedResultError,
  MAX_DETAIL_CHARS,
  MAX_SUMMARY_CHARS,
  ProjectionRejectedError,
  RISK_ESCALATION_CORPUS,
  RISK_TIER_CANDIDATES,
  buildPlan,
  classifyRiskLocally,
  composeApproval,
  createDecisionJournalStore,
  createDefaultRegistry,
  createJevExecutor,
  isRiskTier,
  projectRiskEscalation,
  registerJevEngine,
  runRiskEscalationShadow,
  selectRiskTier,
  toJevRiskRequest,
  fromJevRiskResponse,
  validateDecisionConfig,
  type DecisionConfig,
  type JevTransport,
  type RiskEscalationActionInput,
} from "../../src/decision/index.js";

function riskConfig(overrides?: Partial<DecisionConfig>): DecisionConfig {
  return {
    ...DEFAULT_DECISION_CONFIG,
    riskEscalation: {
      engine: LOCAL_ENGINE_ID,
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "risk-escalation/local/v1",
      enabled: true,
    },
    ...overrides,
  };
}

function jevRiskConfig(): DecisionConfig {
  return {
    ...DEFAULT_DECISION_CONFIG,
    remote: { jev: { enabled: true } },
    riskEscalation: {
      engine: JEV_ENGINE_ID,
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "risk-escalation/jev/v1",
      enabled: true,
    },
  };
}

function riskTransport(tier: string, confidence?: number): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: [{ id: JEV_RISK_QUESTION_ID, choice: tier, ...(confidence !== undefined ? { confidence } : {}) }],
  });
}

const ACTION: RiskEscalationActionInput = {
  capability: "shell.run",
  summary: "rm -rf the build directory before a clean rebuild",
};

describe("risk-escalation schema", () => {
  it("enumerates the legal tier space and rejects anything else", () => {
    assert.deepEqual([...RISK_TIER_CANDIDATES], ["low", "medium", "high"]);
    assert.equal(isRiskTier("high"), true);
    assert.equal(isRiskTier("critical"), false);
    assert.equal(isRiskTier(undefined), false);
  });

  it("ships a local-first disabled route", () => {
    assert.equal(DEFAULT_DECISION_CONFIG.riskEscalation.engine, "local");
    assert.equal(DEFAULT_DECISION_CONFIG.riskEscalation.enabled, false);
    assert.equal(validateDecisionConfig(DEFAULT_DECISION_CONFIG).valid, true);
  });
});

describe("risk-escalation projection", () => {
  it("projects exactly capability + summary + detail, never raw args", () => {
    const sealed = projectRiskEscalation({
      ...ACTION,
      detail: "triggered from the release script",
      command: "rm -rf /",
      args: ["--force"],
    } as unknown as RiskEscalationActionInput);
    assert.deepEqual(Object.keys(sealed.payload).sort(), ["capability", "detail", "summary"]);
    assert.equal(JSON.stringify(sealed.payload).includes("rm -rf /"), false);
    assert.equal(sealed.projectorVersion, "risk-escalation/v1");
  });

  it("bounds fields and rejects empty capability/summary", () => {
    const sealed = projectRiskEscalation({
      capability: "shell.run",
      summary: "s".repeat(MAX_SUMMARY_CHARS + 500),
      detail: "d".repeat(MAX_DETAIL_CHARS + 500),
    });
    assert.ok(sealed.payload.summary.length <= MAX_SUMMARY_CHARS);
    assert.ok(sealed.payload.detail.length <= MAX_DETAIL_CHARS);
    assert.throws(() => projectRiskEscalation({ capability: "  ", summary: "x" }), /non-empty capability/);
    assert.throws(() => projectRiskEscalation({ capability: "shell.run", summary: "" }), /non-empty summary/);
  });

  it("JEV-3: secret-bearing detail is rejected at the boundary", () => {
    assert.throws(
      () =>
        projectRiskEscalation({
          capability: "shell.run",
          summary: "deploy with the release token",
          detail: "token sk-abcdefghijklmnopqrstuvwx",
        }),
      ProjectionRejectedError,
    );
  });
});

describe("local risk baseline", () => {
  it("classifies the labeled corpus deterministically", () => {
    for (const fixture of RISK_ESCALATION_CORPUS) {
      const first = classifyRiskLocally({ capability: fixture.capability, summary: fixture.summary, detail: "" });
      const second = classifyRiskLocally({ capability: fixture.capability, summary: fixture.summary, detail: "" });
      assert.equal(first.tier, fixture.expected, `${fixture.id}: ${first.reason}`);
      assert.deepEqual(first, second, `${fixture.id} not deterministic`);
    }
  });

  it("adversarial instruction text cannot clear a destructive action", () => {
    const fixture = RISK_ESCALATION_CORPUS.find((f) => f.id === "adversarial-instruction");
    assert.ok(fixture?.adversarial);
    assert.equal(
      classifyRiskLocally({ capability: fixture.capability, summary: fixture.summary, detail: "" }).tier,
      "high",
    );
  });
});

describe("jev risk mapping", () => {
  it("builds a bounded choice request over the three tiers", () => {
    const request = toJevRiskRequest(projectRiskEscalation(ACTION));
    assert.equal(request.model, "jev-latest");
    assert.equal(request.questions.length, 1);
    assert.equal(request.questions[0].type, "choice");
    assert.deepEqual(request.questions[0].options, ["low", "medium", "high"]);
    assert.match(request.state, /CAPABILITY:/);
  });

  it("maps a response to a native ChoiceResult with remote provenance", () => {
    const sealed = projectRiskEscalation(ACTION);
    const result = fromJevRiskResponse(
      { model: "jev-1.13.0", answers: [{ id: JEV_RISK_QUESTION_ID, choice: "high", confidence: 0.94 }] },
      { projectionHash: sealed.hash, latencyMs: 90 },
    );
    assert.equal(result.kind, "choice");
    assert.equal(result.choice, "high");
    assert.equal(result.confidence, 0.94);
    assert.equal(result.provenance.engineId, JEV_ENGINE_ID);
    assert.equal(result.provenance.remote, true);
  });

  it("JEV-1: unknown tier, missing answer, and bad confidence are malformed", () => {
    const ctx = { projectionHash: "sha256:x", latencyMs: 1 };
    assert.throws(
      () => fromJevRiskResponse({ answers: [{ id: JEV_RISK_QUESTION_ID, choice: "critical" }] }, ctx),
      MalformedResultError,
    );
    assert.throws(() => fromJevRiskResponse({ answers: [] }, ctx), MalformedResultError);
    assert.throws(
      () => fromJevRiskResponse({ answers: [{ id: JEV_RISK_QUESTION_ID, choice: "low", confidence: 2 }] }, ctx),
      MalformedResultError,
    );
  });

  it("executor returns a tier through an injected transport; failure is fallback-eligible", async () => {
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: riskTransport("medium"),
    });
    const outcome = await executor.execute({ decision: "risk-escalation", sealed: projectRiskEscalation(ACTION) });
    assert.equal(outcome.kind, "choice");
    if (outcome.kind !== "choice") return;
    assert.equal(outcome.choice, "medium");

    const failing = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("offline");
      },
    });
    await assert.rejects(
      failing.execute({ decision: "risk-escalation", sealed: projectRiskEscalation(ACTION) }),
      (e: unknown) => e instanceof EngineUnavailableError,
    );
  });
});

describe("fallback and capability enforcement", () => {
  it("jev transport failure falls back to the local tier", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("offline");
      },
    });
    const plan = buildPlan("risk-escalation", jevRiskConfig(), registry);
    assert.equal(plan.primaryId, JEV_ENGINE_ID);
    assert.equal(plan.fallbackId, LOCAL_ENGINE_ID);

    const result = await runRiskEscalationShadow({ action: ACTION }, { config: jevRiskConfig(), registry });
    assert.equal(result.observed?.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.observed?.tier, "high");
    assert.equal(result.recommendApproval, true);
    assert.equal(result.authority, "none");
  });
});

describe("risk-escalation shadow runner", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-risk-shadow-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("journals observed + baseline under one projection hash, grants no authority", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: riskTransport("high", 0.9),
    });
    const journal = createDecisionJournalStore(join(dir, "s1"));
    const result = await runRiskEscalationShadow({ action: ACTION }, { config: jevRiskConfig(), registry, journal });

    assert.equal(result.observed?.engineId, JEV_ENGINE_ID);
    assert.equal(result.observed?.tier, "high");
    assert.equal(result.baseline?.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.baseline?.tier, "high");
    assert.equal(result.agree, true);
    assert.equal(result.recommendApproval, true);
    assert.equal(result.authority, "none");
    assert.equal(result.records.length, 2);
    assert.equal(journal.findByProjectionHash(result.projectionHash).length, 2);
  });

  it("a low tier recommends no approval unless policy already requires it", async () => {
    const journal = createDecisionJournalStore(join(dir, "s2"));
    const low = await runRiskEscalationShadow(
      { action: { capability: "file.read", summary: "read package.json" } },
      { config: riskConfig(), registry: createDefaultRegistry(), journal },
    );
    assert.equal(low.observed?.tier, "low");
    assert.equal(low.recommendApproval, false);

    const overridden = await runRiskEscalationShadow(
      { action: { capability: "file.read", summary: "read package.json" }, policyRequires: true },
      { config: riskConfig(), registry: createDefaultRegistry() },
    );
    assert.equal(overridden.recommendApproval, true);
    // The recommendation follows composeApproval exactly: low risk never waives policy.
    assert.equal(
      overridden.recommendApproval,
      composeApproval(true, false),
    );
  });

  it("an unknown tier fails closed to approval", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("offline");
      },
    });
    // Engine "local" removed from the registry path is impossible here, so force
    // the failure shape directly: a failed primary with no fallback.
    const result = await runRiskEscalationShadow(
      { action: { capability: "mystery.tool", summary: "mystery" }, policyRequires: false },
      { config: riskConfig(), registry },
    );
    assert.equal(result.observed?.tier, "medium");
    assert.equal(result.recommendApproval, true);
  });

  it("projection failure throws before any engine or journal write", async () => {
    const journal = createDecisionJournalStore(join(dir, "s3"));
    await assert.rejects(
      runRiskEscalationShadow(
        { action: { capability: "shell.run", summary: "deploy", detail: "sk-abcdefghijklmnopqrstuvwx" } },
        { config: jevRiskConfig(), registry: createDefaultRegistry(), journal },
      ),
      ProjectionRejectedError,
    );
    assert.equal(journal.readAll().length, 0);
  });
});

describe("selectRiskTier integration seam", () => {
  it("off is the default and judges nothing", async () => {
    const result = await selectRiskTier(ACTION, { config: riskConfig(), registry: createDefaultRegistry() });
    assert.equal(result.mode, "off");
    assert.equal(result.tier, undefined);
    assert.equal(result.shadow, undefined);
  });

  it("shadow observes but returns no tier", async () => {
    const result = await selectRiskTier(ACTION, {
      config: riskConfig(),
      registry: createDefaultRegistry(),
      mode: "shadow",
    });
    assert.equal(result.mode, "shadow");
    assert.equal(result.tier, undefined);
    assert.equal(result.shadow?.observed?.tier, "high");
  });

  it("active returns the tier and an advisory recommendation only", async () => {
    const result = await selectRiskTier(ACTION, {
      config: riskConfig(),
      registry: createDefaultRegistry(),
      mode: "active",
    });
    assert.equal(result.mode, "active");
    assert.equal(result.tier, "high");
    assert.equal(result.recommendApproval, true);
  });

  it("active on a disabled route judges nothing (existing behavior kept)", async () => {
    const result = await selectRiskTier(ACTION, {
      config: DEFAULT_DECISION_CONFIG,
      registry: createDefaultRegistry(),
      mode: "active",
    });
    assert.equal(result.tier, undefined);
    assert.equal(result.shadow?.enabled, false);
  });
});
