import { test } from "node:test";
import assert from "node:assert/strict";
import { createModelResolver } from "../../src/config/model-resolver.js";
import type { AlixConfig, ModelsConfig } from "../../src/config/schema.js";

function config(models: ModelsConfig | undefined): AlixConfig {
  return { models } as AlixConfig;
}

const VALID = { provider: "openai", name: "gpt-4o" };
const THINKING = { provider: "anthropic", name: "claude-opus" };
const NO_MODEL_MSG = "No model configured. Run: alix models set-default";

// --- §3.1 Resolution rules ---

test("resolves models.default when no tier is given", () => {
  const resolved = createModelResolver(config({ default: VALID })).require();
  assert.deepEqual(resolved, VALID);
});

test("tier === 'default' resolves models.default", () => {
  const resolved = createModelResolver(config({ default: VALID })).require("default");
  assert.deepEqual(resolved, VALID);
});

test("explicit non-default tier resolves models[tier]", () => {
  const resolved = createModelResolver(
    config({ default: VALID, thinking: THINKING }),
  ).require("thinking");
  assert.deepEqual(resolved, THINKING);
});

test("missing tier falls back to models.default", () => {
  const resolved = createModelResolver(config({ default: VALID })).require("coding");
  assert.deepEqual(resolved, VALID);
});

// --- §3.4 Failure ---

test("throws when no models object exists", () => {
  assert.throws(() => createModelResolver(config(undefined)).require(), {
    message: NO_MODEL_MSG,
  });
});

test("throws when models.default is absent", () => {
  assert.throws(() => createModelResolver(config({ thinking: THINKING })).require(), {
    message: NO_MODEL_MSG,
  });
});

test("throws when models.default is invalid (empty provider/name)", () => {
  assert.throws(
    () => createModelResolver(config({ default: { provider: "", name: "" } })).require(),
    { message: NO_MODEL_MSG },
  );
});

test("throws when an explicit tier is present but invalid (shadows default, never falls back)", () => {
  assert.throws(
    () =>
      createModelResolver(
        config({ default: VALID, coding: { provider: "", name: "" } }),
      ).require("coding"),
    { message: NO_MODEL_MSG },
  );
});

test("resolves a valid explicit tier even when default is invalid", () => {
  const resolved = createModelResolver(
    config({ default: { provider: "", name: "" }, thinking: THINKING }),
  ).require("thinking");
  assert.deepEqual(resolved, THINKING);
});

// --- §3.2 Resolver restrictions: never reads derived projections ---

test("never reads the legacy config.model projection", () => {
  const cfg = { models: undefined, model: VALID } as AlixConfig;
  assert.throws(() => createModelResolver(cfg).require(), { message: NO_MODEL_MSG });
});

test("never reads config.subagents projections", () => {
  const cfg = {
    models: undefined,
    subagents: { enabled: true, roles: [], coding: VALID },
  } as unknown as AlixConfig;
  assert.throws(() => createModelResolver(cfg).require("coding"), {
    message: NO_MODEL_MSG,
  });
});

test("never reads modelProfile", () => {
  const cfg = {
    models: undefined,
    modelProfile: { name: "pro", version: 1 },
  } as unknown as AlixConfig;
  assert.throws(() => createModelResolver(cfg).require(), { message: NO_MODEL_MSG });
});

// --- §3.3 Defensive copy ---

test("returns a copy: mutating the result does not mutate the config", () => {
  const cfg = config({ default: VALID });
  const resolved = createModelResolver(cfg).require();
  resolved.name = "mutated";
  resolved.temperature = 0.99;
  assert.equal(cfg.models!.default!.name, "gpt-4o");
  assert.equal(cfg.models!.default!.temperature, undefined);
});

test("preserves full ModelConfig metadata through the copy", () => {
  const cfg = config({
    default: {
      provider: "anthropic",
      name: "claude-opus",
      temperature: 0.2,
      maxOutputTokens: 8192,
      maxContextTokens: 200000,
      maxIterations: 8,
      streaming: true,
    },
  });
  const resolved = createModelResolver(cfg).require();
  assert.deepEqual(resolved, cfg.models!.default);
});

// --- §3 resolve (non-throwing variant) ---

test("resolve returns undefined when no model resolves", () => {
  assert.equal(createModelResolver(config(undefined)).resolve(), undefined);
  assert.equal(createModelResolver(config({})).resolve(), undefined);
});

test("resolve resolves default when only default is set", () => {
  assert.deepEqual(createModelResolver(config({ default: VALID })).resolve(), VALID);
});

test("resolve honors the tier fallback (models[tier] ?? models.default)", () => {
  assert.deepEqual(
    createModelResolver(config({ default: VALID })).resolve("thinking"),
    VALID,
    "missing tier falls back to default",
  );
});

test("resolve returns a defensive copy", () => {
  const resolved = createModelResolver(config({ default: VALID })).resolve()!;
  resolved.name = "mutated";
  assert.equal(config({ default: VALID }).models?.default?.name, "gpt-4o");
});
