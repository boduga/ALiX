import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/loader.js";
import { validateConfig } from "../../src/config/validator.js";
import { DEFAULT_DECISION_CONFIG } from "../../src/decision/index.js";
import type { AlixConfig } from "../../src/config/schema.js";

const MINIMAL_CONFIG: AlixConfig = {
  version: 1,
  model: { provider: "test", name: "test-model" },
  permissions: { default: "ask", tools: {}, protectedPaths: [], denyCommands: [], allowNetworkDomains: [] },
  context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
  runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 10000, envAllowlist: [] },
  ui: { enabled: true, host: "127.0.0.1", port: 4137, transport: "sse" },
};

describe("decision config section", () => {
  it("defaults local-first with Jev disabled", () => {
    assert.deepEqual(DEFAULT_CONFIG.decision, DEFAULT_DECISION_CONFIG);
    assert.equal(DEFAULT_CONFIG.decision?.remote.jev.enabled, false);
  });

  it("partial route override preserves siblings", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      decision: {
        claimVerification: { engine: "jev", fallback: "local", thresholdProfile: "t/v1" },
      },
    });
    assert.equal(merged.decision?.claimVerification?.engine, "jev");
    assert.equal(merged.decision?.contextRelevance?.engine, "local");
    assert.equal(merged.decision?.remote.jev.enabled, false);
  });

  it("partial jev flag override preserves routes", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      decision: { remote: { jev: { enabled: true } } },
    });
    assert.equal(merged.decision?.remote.jev.enabled, true);
    assert.equal(merged.decision?.modelTier?.engine, "existing-routing");
  });

  it("absent section stays valid; bad values flagged with paths", () => {
    assert.equal(validateConfig(MINIMAL_CONFIG).valid, true);
    const bad = {
      ...MINIMAL_CONFIG,
      decision: {
        defaultEngine: "jev",
        remote: { jev: { enabled: "yes" } },
        claimVerification: { engine: "", fallback: "local", thresholdProfile: "t/v1" },
      },
    } as unknown as AlixConfig;
    const result = validateConfig(bad);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === "decision.defaultEngine"));
    assert.ok(result.issues.some((i) => i.path === "decision.remote.jev.enabled"));
    assert.ok(result.issues.some((i) => i.path === "decision.claimVerification.engine"));
  });
});
