import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DECISION_CONFIG,
  EngineNotRegisteredError,
  EngineUnavailableError,
  EXTERNAL_ROUTING_FALLBACK,
  LOCAL_ENGINE_ID,
  RemoteEngineNotAllowedError,
  buildPlan,
  createDefaultRegistry,
  createEngineRegistry,
  createJevExecutor,
  createLocalBaselineExecutor,
  executeWithFallback,
  registerJevEngine,
  sealForRemote,
  type DecisionConfig,
  type DecisionExecutor,
  type ExecuteInput,
  type ExecutorOutcome,
} from "../../src/decision/index.js";

function sealed(hashPayload: Record<string, unknown> = { claim: "sky blue" }) {
  return sealForRemote("claim-verification", "v1", hashPayload, { now: 1 });
}

function input(overrides?: Partial<ExecuteInput>): ExecuteInput {
  return { decision: "claim-verification", sealed: sealed(), ...overrides };
}

function stubExecutor(
  engineId: string,
  behavior: (input: ExecuteInput) => Promise<ExecutorOutcome> | ExecutorOutcome,
): DecisionExecutor {
  return {
    engineId,
    execute: (i) => Promise.resolve(behavior(i)),
  };
}

describe("local baseline engine", () => {
  it("claim-verification answers insufficient with hash-bound provenance", async () => {
    const outcome = await createLocalBaselineExecutor().execute(input());
    assert.equal(outcome.kind, "choice");
    if (outcome.kind !== "choice") return;
    assert.equal(outcome.choice, "insufficient");
    assert.equal("confidence" in outcome, false);
    assert.equal(outcome.provenance.engineId, LOCAL_ENGINE_ID);
    assert.equal(outcome.provenance.remote, false);
    assert.equal(outcome.provenance.projectionHash, sealed().hash);
  });

  it("scores relevance locally and requires candidates for model-tier", async () => {
    const relevance = await createLocalBaselineExecutor().execute(
      input({ decision: "context-relevance" }),
    );
    assert.equal(relevance.kind, "noul");
    if (relevance.kind !== "noul") return;
    assert.equal(relevance.probability, 0);
    const tier = await createLocalBaselineExecutor().execute(input({ decision: "model-tier" }));
    assert.deepEqual(tier, { kind: "failure", error: "model-tier requires an enabled candidate set" });
  });

  it("rejects incompatible candidate sets instead of coercing", async () => {
    const outcome = await createLocalBaselineExecutor().execute(
      input({ candidates: ["fast", "coding"] }),
    );
    assert.deepEqual(outcome, {
      kind: "failure",
      error: "candidate set incompatible with local baseline",
    });
  });

  it("default registry binds the local executor", () => {
    const engine = createDefaultRegistry().resolve({ engineId: "local" });
    assert.equal(engine.executor?.engineId, LOCAL_ENGINE_ID);
    assert.deepEqual(engine.capabilities, ["choice", "noul"]);
  });
});

describe("jev adapter seam", () => {
  it("disabled by default: no register, constructor refuses", () => {
    const registry = createDefaultRegistry();
    assert.equal(registerJevEngine(registry, { enabled: false }), false);
    assert.equal(registry.has("jev"), false);
    assert.throws(
      () => createJevExecutor({ enabled: false }),
      RemoteEngineNotAllowedError,
    );
  });

  it("enabled without key registers but stays unavailable (J1 wires SDK)", async () => {
    const registry = createDefaultRegistry();
    assert.equal(registerJevEngine(registry, { enabled: true }), true);
    const engine = registry.resolve({ engineId: "jev", allowRemote: true });
    assert.equal(engine.remote, true);
    assert.ok(engine.executor);
    await assert.rejects(
      engine.executor.execute(input()),
      (e: unknown) => e instanceof EngineUnavailableError && /api key missing/.test(e.message),
    );
  });

  it("never reads ambient environment for credentials", async () => {
    process.env.JEV_API_KEY = "junk-from-env";
    try {
      const executor = createJevExecutor({ enabled: true });
      await assert.rejects(executor.execute(input()), /api key missing/);
    } finally {
      delete process.env.JEV_API_KEY;
    }
  });
});

describe("fallback policy", () => {
  it("local-only plan executes primary without fallback", async () => {
    const plan = buildPlan("claim-verification", DEFAULT_DECISION_CONFIG, createDefaultRegistry());
    assert.equal(plan.primaryId, "local");
    assert.equal(plan.fallback, null);
    assert.equal(plan.primarySkipped, undefined);
    const result = await executeWithFallback(plan, input());
    assert.equal(result.usedFallback, false);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].ok, true);
    assert.equal(result.outcome.kind, "choice");
  });

  it("JEV-7: jev-primary config degrades to local when remote not allowed", async () => {
    const config: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      claimVerification: {
        engine: "jev",
        fallback: "local",
        thresholdProfile: "claim-verification/jev/v1",
      },
    };
    const plan = buildPlan("claim-verification", config, createDefaultRegistry());
    assert.equal(plan.primarySkipped, "remote-not-allowed:jev");
    assert.equal(plan.primaryId, "local");
    const result = await executeWithFallback(plan, input());
    assert.equal(result.outcome.kind, "choice");
    if (result.outcome.kind !== "choice") return;
    assert.equal(result.outcome.choice, "insufficient");
  });

  it("unavailable primary engages fallback; attempts recorded", async () => {
    const enabled: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      remote: { jev: { enabled: true } },
      claimVerification: {
        engine: "jev",
        fallback: "local",
        thresholdProfile: "claim-verification/jev/v1",
      },
    };
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true });
    const plan = buildPlan("claim-verification", enabled, registry);
    assert.equal(plan.primaryId, "jev");
    const seen: string[] = [];
    const result = await executeWithFallback(plan, input(), {
      onAttempt: (a) => seen.push(`${a.engineId}:${a.ok}`),
    });
    assert.equal(result.usedFallback, true);
    assert.deepEqual(seen, ["jev:false", "local:true"]);
    assert.equal(result.outcome.kind, "choice");
  });

  it("JEV-1: malformed primary result falls back; double failure is explicit", async () => {
    const registry = createEngineRegistry();
    registry.register({
      id: "wild",
      remote: false,
      capabilities: ["choice"],
      executor: stubExecutor("wild", () => ({ kind: "choice", choice: "execute-plan" }) as unknown as ExecutorOutcome),
    });
    registry.register({
      id: "local",
      remote: false,
      capabilities: ["choice"],
      executor: stubExecutor("local", () => {
        throw new EngineUnavailableError("local", "down");
      }),
    });
    const config: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      claimVerification: { engine: "wild", fallback: "local", thresholdProfile: "t/v1" },
    };
    const plan = buildPlan("claim-verification", config, registry);
    const result = await executeWithFallback(plan, input({ candidates: ["a", "b"] }));
    assert.equal(result.usedFallback, true);
    assert.equal(result.outcome.kind, "failure");
    if (result.outcome.kind !== "failure") return;
    assert.match(result.outcome.error, /primary failed.*fallback failed/s);
  });

  it("timeout engages fallback; engine bugs propagate", async () => {
    const registry = createEngineRegistry();
    registry.register({
      id: "slow",
      remote: false,
      capabilities: ["score"],
      executor: stubExecutor("slow", () => new Promise<ExecutorOutcome>(() => {})),
    });
    registry.register({
      id: "local",
      remote: false,
      capabilities: ["choice"],
      executor: createLocalBaselineExecutor(),
    });
    const config: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      claimVerification: { engine: "slow", fallback: "local", thresholdProfile: "t/v1" },
    };
    const plan = buildPlan("claim-verification", config, registry);
    const result = await executeWithFallback(plan, input(), { timeoutMs: 20 });
    assert.equal(result.usedFallback, true);
    assert.equal(result.outcome.kind, "choice");
    assert.match(result.attempts[0].error ?? "", /timed out/);

    const buggy: DecisionExecutor = stubExecutor("local", () => {
      throw new TypeError("bug");
    });
    await assert.rejects(
      executeWithFallback({ ...plan, primary: buggy, primaryId: "local", fallback: null, fallbackId: null }, input()),
      TypeError,
    );
  });

  it("external-only plan returns explicit failure for the J3 runtime", async () => {
    const plan = buildPlan("model-tier", DEFAULT_DECISION_CONFIG, createDefaultRegistry());
    assert.equal(plan.primary, null);
    assert.equal(plan.externalFallback, EXTERNAL_ROUTING_FALLBACK);
    const result = await executeWithFallback(plan, input({ decision: "model-tier" }));
    assert.equal(result.outcome.kind, "failure");
    assert.equal(result.attempts.length, 0);
  });

  it("unknown engine ids fail closed at plan time", () => {
    const config: DecisionConfig = {
      ...DEFAULT_DECISION_CONFIG,
      claimVerification: { engine: "nope", fallback: "local", thresholdProfile: "t/v1" },
    };
    assert.throws(() => buildPlan("claim-verification", config, createDefaultRegistry()), EngineNotRegisteredError);
  });
});
