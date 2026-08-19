import { describe, it, expect } from "vitest";
import { describeRoutingChain } from "../../src/models/routing-cli.js";
import { NO_MODEL_CONFIGURED_MESSAGE } from "../../src/config/model-resolver.js";
import type { AlixConfig } from "../../src/config/schema.js";

describe("describeRoutingChain — unconfigured-model error path", () => {
  it("throws NO_MODEL_CONFIGURED_MESSAGE when no models.default exists", () => {
    const config = { models: { default: undefined } } as unknown as AlixConfig;
    expect(() => describeRoutingChain(config)).toThrow(NO_MODEL_CONFIGURED_MESSAGE);
  });

  it("throws with a config that names no default at all", () => {
    const config = { models: {} } as unknown as AlixConfig;
    expect(() => describeRoutingChain(config)).toThrow(NO_MODEL_CONFIGURED_MESSAGE);
  });
});
