import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_RELEVANCE_CORPUS,
  DEFAULT_DECISION_CONFIG,
  EngineUnavailableError,
  JEV_RELEVANCE_QUESTION_ID,
  LOCAL_ENGINE_ID,
  MAX_ITEM_CHARS,
  MAX_OBJECTIVE_CHARS,
  MalformedResultError,
  ProjectionRejectedError,
  createCalibrationProvenance,
  createDecisionJournalStore,
  createDefaultRegistry,
  createJevExecutor,
  createProfileRegistry,
  fromJevRelevanceResponse,
  projectContextRelevance,
  registerJevEngine,
  resolveProfileForEngine,
  runContextRelevanceShadow,
  scoreRelevanceLocally,
  selectContextItems,
  selectWithEngineThresholds,
  thresholdProfileForEngine,
  toJevRelevanceRequest,
  tryThresholdProfileForEngine,
  type DecisionConfig,
  type JevTransport,
  type ScoredItem,
} from "../../src/decision/index.js";

function relevanceConfig(overrides?: Partial<DecisionConfig>): DecisionConfig {
  return {
    ...DEFAULT_DECISION_CONFIG,
    contextRelevance: {
      engine: LOCAL_ENGINE_ID,
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "context-relevance/local/v1",
      enabled: true,
    },
    ...overrides,
  };
}

/**
 * A promoted registry: the shipped seed is shadow-only, so tests that apply a
 * threshold must inject calibrated profiles (that is the J4 gate).
 */
const ACTIVE_PROFILES = createProfileRegistry([
  {
    id: "context-relevance/local/v1",
    decision: "context-relevance",
    engineId: LOCAL_ENGINE_ID,
    threshold: 0.34,
    status: "active",
    provenance: createCalibrationProvenance({
      datasetId: "fixture/local",
      sampleCount: 40,
      metric: "accuracy",
      value: 0.9,
      computedAt: 1,
    }),
  },
  {
    id: "context-relevance/jev/v1",
    decision: "context-relevance",
    engineId: "jev",
    threshold: 0.5,
    status: "active",
    provenance: createCalibrationProvenance({
      datasetId: "fixture/jev",
      sampleCount: 60,
      metric: "accuracy",
      value: 0.88,
      computedAt: 1,
    }),
  },
]);

function jevRelevanceConfig(): DecisionConfig {
  return relevanceConfig({
    remote: { jev: { enabled: true } },
    contextRelevance: {
      engine: "jev",
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "context-relevance/jev/v1",
      enabled: true,
    },
  });
}

function noulTransport(probability: number): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: [{ id: JEV_RELEVANCE_QUESTION_ID, probability }],
  });
}

const ITEMS = [
  { id: "i1", text: "Provider timeout handling in the contract wrapper." },
  { id: "i2", text: "The marketing site uses a serif display font." },
];

describe("context-relevance projection", () => {
  it("projects exactly objective + one item and drops the correlation id", () => {
    const sealed = projectContextRelevance({
      objective: "Fix the flaky provider timeout test",
      item: { id: "secret-ish-id", text: "Provider timeout handling." },
    });
    assert.deepEqual(Object.keys(sealed.payload).sort(), ["item", "objective"]);
    assert.equal(sealed.payload.item.includes("secret-ish-id"), false);
    assert.equal(sealed.projectorVersion, "context-relevance/v1");
  });

  it("bounds both fields and rejects empties", () => {
    const sealed = projectContextRelevance({
      objective: "o".repeat(MAX_OBJECTIVE_CHARS + 500),
      item: { id: "i", text: "t".repeat(MAX_ITEM_CHARS + 500) },
    });
    assert.ok(sealed.payload.objective.length <= MAX_OBJECTIVE_CHARS);
    assert.ok(sealed.payload.item.length <= MAX_ITEM_CHARS);
    assert.throws(() => projectContextRelevance({ objective: "  ", item: { id: "i", text: "t" } }), /non-empty objective/);
    assert.throws(() => projectContextRelevance({ objective: "o", item: { id: "i", text: " " } }), /non-empty item/);
  });

  it("JEV-3: secret-bearing items are rejected at the boundary", () => {
    assert.throws(
      () =>
        projectContextRelevance({
          objective: "Check the token",
          item: { id: "i", text: "sk-abcdefghijklmnopqrstuvwx" },
        }),
      ProjectionRejectedError,
    );
  });
});

describe("local relevance baseline", () => {
  it("scores the corpus deterministically and matches clear labels", () => {
    for (const fixture of CONTEXT_RELEVANCE_CORPUS) {
      const first = scoreRelevanceLocally({ objective: fixture.objective, item: fixture.item });
      const second = scoreRelevanceLocally({ objective: fixture.objective, item: fixture.item });
      assert.deepEqual(first, second, `${fixture.id} not deterministic`);
      if (fixture.knownBaselineFalsePositive) continue;
      const threshold = thresholdProfileForEngine(LOCAL_ENGINE_ID, ACTIVE_PROFILES).threshold;
      const predicted = first.probability >= threshold ? "relevant" : "irrelevant";
      assert.equal(predicted, fixture.expected, `${fixture.id}: ${first.reason}`);
    }
  });

  it("documents the known lexical-bait false positive", () => {
    const fixture = CONTEXT_RELEVANCE_CORPUS.find((f) => f.knownBaselineFalsePositive);
    assert.ok(fixture);
    const score = scoreRelevanceLocally({ objective: fixture.objective, item: fixture.item });
    assert.ok(score.probability >= thresholdProfileForEngine(LOCAL_ENGINE_ID, ACTIVE_PROFILES).threshold);
    assert.equal(fixture.expected, "irrelevant");
  });

  it("scores zero when the objective carries no content terms", () => {
    assert.equal(scoreRelevanceLocally({ objective: "the of and", item: "anything" }).probability, 0);
  });
});

describe("engine-specific thresholds (JEV-9)", () => {
  it("resolves the profile for the answering engine", () => {
    assert.equal(thresholdProfileForEngine(LOCAL_ENGINE_ID, ACTIVE_PROFILES).id, "context-relevance/local/v1");
    assert.equal(thresholdProfileForEngine("jev", ACTIVE_PROFILES).id, "context-relevance/jev/v1");
    assert.throws(() => thresholdProfileForEngine("mystery", ACTIVE_PROFILES), /No active relevance threshold profile/);
  });

  it("refuses to apply another engine's profile", () => {
    assert.equal(
      resolveProfileForEngine(LOCAL_ENGINE_ID, "context-relevance/jev/v1", ACTIVE_PROFILES).id,
      "context-relevance/local/v1",
    );
    assert.equal(
      resolveProfileForEngine("jev", "context-relevance/jev/v1", ACTIVE_PROFILES).id,
      "context-relevance/jev/v1",
    );
    assert.equal(tryThresholdProfileForEngine("mystery", ACTIVE_PROFILES), undefined);
    assert.throws(() => resolveProfileForEngine("mystery", "context-relevance/local/v1", ACTIVE_PROFILES), /No active relevance threshold profile/);
  });
});

describe("deterministic selection", () => {
  const resolveProfile = (engineId: string) =>
    resolveProfileForEngine(engineId, "context-relevance/local/v1", ACTIVE_PROFILES);

  it("ranks by probability desc, stable on ties, then caps", () => {
    const scores: ScoredItem[] = [
      { id: "a", probability: 0.4, engineId: LOCAL_ENGINE_ID },
      { id: "b", probability: 0.9, engineId: LOCAL_ENGINE_ID },
      { id: "c", probability: 0.4, engineId: LOCAL_ENGINE_ID },
    ];
    const result = selectWithEngineThresholds(scores, { resolveProfile, maxItems: 2 });
    assert.deepEqual(result.selectedIds, ["b", "a"]);
    assert.deepEqual(result.rejectedIds, ["c"]);
  });

  it("applies each item's own engine threshold", () => {
    const scores: ScoredItem[] = [
      { id: "local-mid", probability: 0.4, engineId: LOCAL_ENGINE_ID },
      { id: "jev-mid", probability: 0.4, engineId: "jev" },
    ];
    const result = selectWithEngineThresholds(scores, { resolveProfile });
    assert.deepEqual(result.selectedIds, ["local-mid"]);
    assert.deepEqual(result.thresholdProfileIds, ["context-relevance/local/v1", "context-relevance/jev/v1"]);
    assert.deepEqual(result.thresholds, {
      [LOCAL_ENGINE_ID]: 0.34,
      jev: 0.5,
    });
  });
});

describe("jev relevance mapping", () => {
  it("builds a Noul question with no options", () => {
    const sealed = projectContextRelevance({ objective: "Fix the timeout test", item: { id: "i", text: "timeout test" } });
    const request = toJevRelevanceRequest(sealed);
    assert.equal(request.questions.length, 1);
    assert.equal(request.questions[0].type, "noul");
    assert.equal("options" in request.questions[0], false);
    assert.match(request.state, /OBJECTIVE:/);
    assert.match(request.state, /ITEM:/);
  });

  it("maps a Noul response to NoulResult; malformed is rejected", () => {
    const ctx = { projectionHash: "sha256:x", latencyMs: 42 };
    const ok = fromJevRelevanceResponse(
      { model: "jev-1.13.0", answers: [{ id: JEV_RELEVANCE_QUESTION_ID, probability: 0.73 }] },
      ctx,
    );
    assert.equal(ok.kind, "noul");
    assert.equal(ok.probability, 0.73);
    assert.equal(ok.provenance.remote, true);
    assert.equal("confidence" in ok, false);

    assert.throws(() => fromJevRelevanceResponse({ answers: [] }, ctx), MalformedResultError);
    assert.throws(
      () => fromJevRelevanceResponse({ answers: [{ id: JEV_RELEVANCE_QUESTION_ID, probability: 1.2 }] }, ctx),
      MalformedResultError,
    );
    assert.throws(
      () => fromJevRelevanceResponse({ answers: [{ id: JEV_RELEVANCE_QUESTION_ID, choice: "supported" }] }, ctx),
      MalformedResultError,
    );
  });

  it("executor returns a noul outcome for context-relevance", async () => {
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: noulTransport(0.81),
    });
    const sealed = projectContextRelevance({ objective: "Fix the timeout test", item: { id: "i", text: "timeout test" } });
    const outcome = await executor.execute({ decision: "context-relevance", sealed });
    assert.equal(outcome.kind, "noul");
    if (outcome.kind !== "noul") return;
    assert.equal(outcome.probability, 0.81);
  });

  it("transport failure is fallback-eligible", async () => {
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("offline");
      },
    });
    const sealed = projectContextRelevance({ objective: "o", item: { id: "i", text: "t" } });
    await assert.rejects(
      executor.execute({ decision: "context-relevance", sealed }),
      (e: unknown) => e instanceof EngineUnavailableError,
    );
  });
});

describe("context-relevance shadow runner", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-relevance-shadow-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("disabled route keeps every item and journals nothing", async () => {
    const journal = createDecisionJournalStore(join(dir, "disabled"));
    const result = await runContextRelevanceShadow(
      { objective: "Fix the flaky provider timeout test", items: ITEMS },
      { config: DEFAULT_DECISION_CONFIG, registry: createDefaultRegistry(), profiles: ACTIVE_PROFILES, journal },
    );
    assert.equal(result.enabled, false);
    assert.deepEqual(result.selection.selectedIds, ["i1", "i2"]);
    assert.deepEqual(result.selection.rejectedIds, []);
    assert.equal(result.records.length, 0);
    assert.equal(journal.readAll().length, 0);
    assert.equal(result.authority, "none");
  });

  it("scores each item independently and journals per item", async () => {
    const journal = createDecisionJournalStore(join(dir, "local"));
    const result = await runContextRelevanceShadow(
      { objective: "Fix the flaky provider timeout test", items: ITEMS },
      { config: relevanceConfig(), registry: createDefaultRegistry(), profiles: ACTIVE_PROFILES, journal },
    );
    assert.equal(result.enabled, true);
    assert.equal(result.observations.length, 2);
    assert.deepEqual(result.selection.selectedIds, ["i1"]);
    assert.deepEqual(result.selection.rejectedIds, ["i2"]);
    assert.equal(result.selection.thresholdProfileIds[0], "context-relevance/local/v1");
    assert.equal(result.records.length, 2);
    assert.equal(journal.readAll().length, 2);
    assert.equal(new Set(Object.values(result.projectionHashes)).size, 2);
    const noul = result.records[0].outcome;
    assert.equal(noul.kind, "noul");
  });

  it("falls back to the local profile when the remote engine fails", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("offline");
      },
    });
    const result = await runContextRelevanceShadow(
      { objective: "Fix the flaky provider timeout test", items: [ITEMS[0]] },
      { config: jevRelevanceConfig(), registry, profiles: ACTIVE_PROFILES },
    );
    assert.equal(result.observations[0].engineId, LOCAL_ENGINE_ID);
    assert.equal(result.selection.thresholdProfileIds[0], "context-relevance/local/v1");
    const jevFailure = result.records.find((r) => r.engineId === "jev");
    assert.equal(jevFailure?.outcome.kind, "failure");
    // The journaled profile must match the threshold actually applied per engine.
    assert.equal(jevFailure?.thresholdProfile, "context-relevance/jev/v1");
    const localRecord = result.records.find((r) => r.engineId === LOCAL_ENGINE_ID);
    assert.equal(localRecord?.thresholdProfile, "context-relevance/local/v1");
  });

  it("keeps items no engine could score instead of dropping them", async () => {
    const registry = createDefaultRegistry();
    registry.register({
      id: "dead",
      remote: false,
      capabilities: ["noul"],
      executor: {
        engineId: "dead",
        async execute() {
          throw new EngineUnavailableError("dead", "down");
        },
      },
    });
    const config: DecisionConfig = relevanceConfig({
      contextRelevance: {
        engine: "dead",
        fallback: "dead",
        thresholdProfile: "context-relevance/local/v1",
        enabled: true,
      },
    });
    const result = await runContextRelevanceShadow(
      { objective: "Fix the flaky provider timeout test", items: [ITEMS[0]] },
      { config, registry, profiles: ACTIVE_PROFILES },
    );
    assert.deepEqual(result.unscoredIds, ["i1"]);
    assert.deepEqual(result.selection.selectedIds, ["i1"]);
    assert.deepEqual(result.selection.rejectedIds, []);
    assert.equal(result.records[0].outcome.kind, "failure");
  });

  it("maxItems caps the selection after ranking", async () => {
    const result = await runContextRelevanceShadow(
      { objective: "Fix the flaky provider timeout test", items: ITEMS },
      { config: relevanceConfig(), registry: createDefaultRegistry(), profiles: ACTIVE_PROFILES, maxItems: 1 },
    );
    assert.deepEqual(result.selection.selectedIds, ["i1"]);
  });
});

describe("selectContextItems integration seam", () => {
  it("off (default) is identity and runs no engine", async () => {
    const result = await selectContextItems(ITEMS, "Fix the flaky provider timeout test", {
      config: relevanceConfig(),
      registry: createDefaultRegistry(),
    });
    assert.equal(result.mode, "off");
    assert.deepEqual(result.items.map((i) => i.id), ["i1", "i2"]);
    assert.equal(result.shadow, undefined);
  });

  it("shadow observes but returns every item unchanged", async () => {
    const result = await selectContextItems(ITEMS, "Fix the flaky provider timeout test", {
      config: relevanceConfig(),
      registry: createDefaultRegistry(),
      profiles: ACTIVE_PROFILES,
      mode: "shadow",
    });
    assert.equal(result.mode, "shadow");
    assert.deepEqual(result.items.map((i) => i.id), ["i1", "i2"]);
    assert.equal(result.shadow?.observations.length, 2);
    assert.deepEqual(result.shadow?.selection.selectedIds, ["i1"]);
  });

  it("active returns only the selected items", async () => {
    const result = await selectContextItems(ITEMS, "Fix the flaky provider timeout test", {
      config: relevanceConfig(),
      registry: createDefaultRegistry(),
      profiles: ACTIVE_PROFILES,
      mode: "active",
    });
    assert.equal(result.mode, "active");
    assert.deepEqual(result.items.map((i) => i.id), ["i1"]);
  });

  it("active on a disabled route still passes items through", async () => {
    const result = await selectContextItems(ITEMS, "Fix the flaky provider timeout test", {
      config: DEFAULT_DECISION_CONFIG,
      registry: createDefaultRegistry(),
      mode: "active",
    });
    assert.deepEqual(result.items.map((i) => i.id), ["i1", "i2"]);
    assert.equal(result.shadow?.enabled, false);
  });
});
