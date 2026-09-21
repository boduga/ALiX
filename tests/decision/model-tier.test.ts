import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DECISION_CONFIG,
  JEV_MODEL_TIER_QUESTION_ID,
  LOCAL_ENGINE_ID,
  MalformedResultError,
  MODEL_TIER_CORPUS,
  ROUTABLE_TIERS,
  assertRoutableTier,
  chooseTierLocally,
  createDecisionJournalStore,
  createDefaultRegistry,
  createJevExecutor,
  describeCurrentRouting,
  fromJevModelTierResponse,
  isRoutableTier,
  listEnabledTiers,
  projectModelTier,
  registerJevEngine,
  resolveTierModel,
  runModelTierShadow,
  selectModelTier,
  tierMatchesCurrentRouting,
  toJevModelTierRequest,
  type JevTransport,
  type ModelTierRequestFeatures,
} from "../../src/decision/index.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AlixConfig } from "../../src/config/schema.js";

const ALL_TIERS_MODELS = {
  default: { provider: "openai", name: "gpt-4o" },
  tiny: { provider: "ollama", name: "llama3.2:1b" },
  fast: { provider: "groq", name: "llama-3.1-8b-instant" },
  coding: { provider: "anthropic", name: "claude-sonnet-4" },
  thinking: { provider: "deepseek", name: "deepseek-reasoner" },
  critic: { provider: "openai", name: "gpt-4o-mini" },
} as const;

function alixConfig(
  models: AlixConfig["models"] = { ...ALL_TIERS_MODELS },
  modelTier: Partial<NonNullable<AlixConfig["decision"]>["modelTier"]> = {},
  decisionOverrides: Partial<NonNullable<AlixConfig["decision"]>> = {},
): AlixConfig {
  return {
    ...DEFAULT_CONFIG,
    models,
    decision: {
      ...DEFAULT_DECISION_CONFIG,
      ...decisionOverrides,
      modelTier: {
        engine: LOCAL_ENGINE_ID,
        fallback: LOCAL_ENGINE_ID,
        thresholdProfile: "model-tier/local/v1",
        enabled: true,
        ...modelTier,
      },
    },
  };
}

const FEATURES: ModelTierRequestFeatures = {
  taskKind: "code",
  promptChars: 4_000,
  needsTools: true,
  needsVision: false,
  longContext: false,
};

function tierTransport(choice: string): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: [{ id: JEV_MODEL_TIER_QUESTION_ID, choice }],
  });
}

describe("canonical tier candidates (JEV-10)", () => {
  it("enumerates only configured canonical tiers", () => {
    assert.deepEqual(listEnabledTiers({ models: { ...ALL_TIERS_MODELS } }), [
      "tiny",
      "fast",
      "default",
      "coding",
      "thinking",
      "critic",
    ]);
    assert.deepEqual(listEnabledTiers({ models: { default: { provider: "openai", name: "gpt-4o" } } }), [
      "default",
    ]);
    assert.deepEqual(listEnabledTiers({ models: {} }), []);
  });

  it("rejects unknown and disabled tiers", () => {
    assert.equal(isRoutableTier("coding"), true);
    assert.equal(isRoutableTier("image"), false);
    assert.equal(isRoutableTier("openai/gpt-4o"), false);
    assert.throws(() => assertRoutableTier("image", ["default"]), /Unknown or disabled model tier/);
    assert.throws(() => assertRoutableTier("coding", ["default"]), /Unknown or disabled model tier/);
  });
});

describe("model-tier projection", () => {
  it("carries features only — never provider or model IDs", () => {
    const sealed = projectModelTier({
      ...FEATURES,
      provider: "openai",
      model: "gpt-4o",
      prompt: "SECRET SOURCE",
    } as unknown as ModelTierRequestFeatures);
    assert.deepEqual(Object.keys(sealed.payload).sort(), [
      "longContext",
      "needsTools",
      "needsVision",
      "promptChars",
      "taskKind",
    ]);
    const serialized = JSON.stringify(sealed.payload);
    assert.equal(serialized.includes("openai"), false);
    assert.equal(serialized.includes("gpt-4o"), false);
    assert.equal(serialized.includes("SECRET SOURCE"), false);
  });

  it("coerces an unknown task kind to other and clamps prompt size", () => {
    const sealed = projectModelTier({
      ...FEATURES,
      taskKind: "novel" as never,
      promptChars: Number.POSITIVE_INFINITY,
    });
    assert.equal(sealed.payload.taskKind, "other");
    assert.equal(sealed.payload.promptChars, 0);
  });
});

describe("local tier baseline", () => {
  it("matches the labeled corpus", () => {
    const enabled = [...ROUTABLE_TIERS];
    for (const fixture of MODEL_TIER_CORPUS) {
      const { tier } = chooseTierLocally(fixture, enabled);
      if (fixture.unsatisfiable) {
        assert.equal(tier, undefined, fixture.id);
        continue;
      }
      assert.equal(tier, fixture.expected, fixture.id);
    }
  });

  it("abstains on vision and when no enabled tier satisfies the request", () => {
    assert.equal(chooseTierLocally({ ...FEATURES, needsVision: true }, [...ROUTABLE_TIERS]).tier, undefined);
    assert.equal(chooseTierLocally(FEATURES, []).tier, undefined);
    assert.equal(chooseTierLocally({ ...FEATURES, taskKind: "code" }, ["tiny"]).tier, undefined);
  });

  it("falls through to an enabled tier in preference order", () => {
    assert.equal(chooseTierLocally(FEATURES, ["default"]).tier, "default");
    assert.equal(chooseTierLocally(FEATURES, ["coding", "default"]).tier, "coding");
  });
});

describe("tier resolution through canonical config", () => {
  it("resolves a tier only via models.*", () => {
    const config = alixConfig();
    assert.deepEqual(resolveTierModel(config, "coding"), { provider: "anthropic", name: "claude-sonnet-4" });
    assert.deepEqual(describeCurrentRouting(config), {
      tier: "default",
      provider: "openai",
      name: "gpt-4o",
    });
    assert.equal(tierMatchesCurrentRouting(config, "coding"), false);
  });

  it("treats a tier pinned to the default model as agreeing with current routing", () => {
    const config = alixConfig({ default: { provider: "openai", name: "gpt-4o" }, coding: { provider: "openai", name: "gpt-4o" } });
    assert.equal(tierMatchesCurrentRouting(config, "coding"), true);
  });

  it("ignores the legacy model projection (no second source of truth)", () => {
    const config = alixConfig({ default: { provider: "openai", name: "gpt-4o" }, coding: { provider: "anthropic", name: "claude-sonnet-4" } });
    const legacy = { ...config, model: { provider: "legacy", name: "legacy-model" } };
    assert.deepEqual(resolveTierModel(legacy, "coding"), { provider: "anthropic", name: "claude-sonnet-4" });
  });
});

describe("jev model-tier mapping", () => {
  it("offers only canonical tier names as options", () => {
    const sealed = projectModelTier(FEATURES);
    const request = toJevModelTierRequest(sealed, ["default", "coding"]);
    const question = request.questions[0];
    assert.equal(question.type, "choice");
    if (question.type !== "choice") return;
    assert.deepEqual(question.options, ["default", "coding"]);
    for (const option of question.options) {
      assert.equal(option.includes("/"), false);
      assert.ok(ROUTABLE_TIERS.includes(option as never));
    }
    assert.equal(JSON.stringify(request).includes("openai"), false);
  });

  it("requires a candidate set", () => {
    assert.throws(() => toJevModelTierRequest(projectModelTier(FEATURES), []), /at least one enabled candidate/);
  });

  it("JEV-10: rejects a provider/model ID or a non-candidate tier", () => {
    const ctx = { projectionHash: "sha256:x", latencyMs: 5 };
    assert.throws(
      () => fromJevModelTierResponse({ answers: [{ id: JEV_MODEL_TIER_QUESTION_ID, choice: "openai/gpt-4o" }] }, ctx, ["default"]),
      MalformedResultError,
    );
    assert.throws(
      () => fromJevModelTierResponse({ answers: [{ id: JEV_MODEL_TIER_QUESTION_ID, choice: "coding" }] }, ctx, ["default"]),
      MalformedResultError,
    );
    const ok = fromJevModelTierResponse(
      { model: "jev-1.13.0", answers: [{ id: JEV_MODEL_TIER_QUESTION_ID, choice: "coding", confidence: 0.8 }] },
      ctx,
      ["default", "coding"],
    );
    assert.equal(ok.kind, "choice");
    assert.equal(ok.choice, "coding");
    assert.equal(ok.provenance.remote, true);
  });

  it("executor answers through an injected transport", async () => {
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: tierTransport("thinking"),
    });
    const sealed = projectModelTier(FEATURES);
    const outcome = await executor.execute({
      decision: "model-tier",
      sealed,
      candidates: ["default", "thinking"],
    });
    assert.equal(outcome.kind, "choice");
    if (outcome.kind !== "choice") return;
    assert.equal(outcome.choice, "thinking");
  });
});

describe("model-tier shadow runner", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-tier-shadow-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("disabled route returns no observation and journals nothing", async () => {
    const journal = createDecisionJournalStore(join(dir, "off"));
    const result = await runModelTierShadow(FEATURES, {
      config: alixConfig({ ...ALL_TIERS_MODELS }, { enabled: false }),
      registry: createDefaultRegistry(),
      journal,
    });
    assert.equal(result.enabled, false);
    assert.equal(result.observed, undefined);
    assert.equal(result.records.length, 0);
    assert.equal(journal.readAll().length, 0);
    assert.equal(result.current.tier, "default");
    assert.equal(result.authority, "none");
  });

  it("local route selects a tier and compares against current routing", async () => {
    const journal = createDecisionJournalStore(join(dir, "local"));
    const result = await runModelTierShadow(FEATURES, {
      config: alixConfig(),
      registry: createDefaultRegistry(),
      journal,
    });
    assert.equal(result.enabled, true);
    assert.equal(result.observed?.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.observed?.tier, "coding");
    assert.equal(result.agree, false);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].outcome.kind, "choice");
    assert.equal(journal.readAll().length, 1);
  });

  it("never puts provider/model IDs on the wire", async () => {
    const seen: string[] = [];
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async (request) => {
        seen.push(JSON.stringify(request));
        return { model: "jev-1.13.0", answers: [{ id: JEV_MODEL_TIER_QUESTION_ID, choice: "coding" }] };
      },
    });
    const config = alixConfig(undefined, {
      engine: "jev",
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "model-tier/jev/v1",
    }, { remote: { jev: { enabled: true } } });
    const result = await runModelTierShadow(FEATURES, { config, registry });
    assert.equal(result.observed?.engineId, "jev");
    assert.equal(result.observed?.tier, "coding");
    assert.equal(seen.length, 1);
    for (const name of ["openai", "gpt-4o", "anthropic", "claude-sonnet-4", "groq"]) {
      assert.equal(seen[0].includes(name), false, name);
    }
  });

  it("falls back to the local tier when the remote engine fails", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      acknowledgeUnverifiedWireFormat: true,
      transport: async () => {
        throw new Error("offline");
      },
    });
    const config = alixConfig(undefined, {
      engine: "jev",
      fallback: LOCAL_ENGINE_ID,
      thresholdProfile: "model-tier/jev/v1",
    }, { remote: { jev: { enabled: true } } });
    const result = await runModelTierShadow(FEATURES, { config, registry });
    assert.equal(result.observed?.engineId, LOCAL_ENGINE_ID);
    assert.equal(result.observed?.tier, "coding");
    const jevFailure = result.records.find((r) => r.engineId === "jev");
    assert.equal(jevFailure?.outcome.kind, "failure");
  });

  it("existing-routing config yields an explicit failure, not a guess", async () => {
    const config = alixConfig(undefined, {
      engine: "existing-routing",
      fallback: "existing-routing",
      thresholdProfile: "model-tier/existing-routing/v1",
    });
    const result = await runModelTierShadow(FEATURES, { config, registry: createDefaultRegistry() });
    assert.equal(result.observed?.tier, undefined);
    assert.equal(result.records[0].outcome.kind, "failure");
  });
});

describe("selectModelTier integration seam", () => {
  it("off is the default and returns no tier", async () => {
    const result = await selectModelTier(FEATURES, {
      config: alixConfig(),
      registry: createDefaultRegistry(),
    });
    assert.equal(result.mode, "off");
    assert.equal(result.tier, undefined);
    assert.equal(result.shadow, undefined);
  });

  it("shadow observes but returns no tier", async () => {
    const result = await selectModelTier(FEATURES, {
      config: alixConfig(),
      registry: createDefaultRegistry(),
      mode: "shadow",
    });
    assert.equal(result.mode, "shadow");
    assert.equal(result.tier, undefined);
    assert.equal(result.shadow?.observed?.tier, "coding");
  });

  it("active returns the selected tier for canonical resolution", async () => {
    const result = await selectModelTier(FEATURES, {
      config: alixConfig(),
      registry: createDefaultRegistry(),
      mode: "active",
    });
    assert.equal(result.mode, "active");
    assert.equal(result.tier, "coding");
    assert.deepEqual(resolveTierModel(alixConfig(), result.tier as "coding"), {
      provider: "anthropic",
      name: "claude-sonnet-4",
    });
  });

  it("active on a disabled route returns no tier (current routing kept)", async () => {
    const result = await selectModelTier(FEATURES, {
      config: alixConfig(undefined, { enabled: false }),
      registry: createDefaultRegistry(),
      mode: "active",
    });
    assert.equal(result.tier, undefined);
    assert.equal(result.shadow?.enabled, false);
  });
});
