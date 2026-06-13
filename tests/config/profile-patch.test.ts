import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProfilePatch, applyProfilePatch, PRESERVED_SECTIONS } from "../../src/config/profile-patch.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ProfileData } from "../../src/config/profile-types.js";

function makeMinimalConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "ollama", name: "old-model" },
    permissions: { default: "allow" as const, tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, repoMapMode: "lite" as const, maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process" as const, shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const },
    apiKeys: { anthropic: "sk-preserved" },
  };
}

function makeProfile(): ProfileData {
  return {
    id: "balanced-local", name: "Balanced Local", description: "", mode: "local-first",
    hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 },
    models: { default: { provider: "ollama", name: "qwen3:4b", temperature: 0.3, contextWindow: 32768 }, coder: { provider: "ollama", name: "qwen2.5-coder:7b", temperature: 0.1 }, embeddings: { provider: "ollama", name: "test" } },
    runtime: { maxContextTokens: 24000 },
  };
}

describe("buildProfilePatch", () => {
  it("includes modelProfile", () => {
    assert.equal(buildProfilePatch(makeProfile()).modelProfile, "balanced-local");
  });
  it("includes default model as model", () => {
    const p = buildProfilePatch(makeProfile());
    assert.equal(p.model?.name, "qwen3:4b");
  });
  it("includes per-tier mappings", () => {
    assert.ok(buildProfilePatch(makeProfile()).models?.coder);
  });
  it("includes runtime limit", () => {
    assert.equal(buildProfilePatch(makeProfile()).runtime?.maxContextTokens, 24000);
  });
});

describe("applyProfilePatch", () => {
  it("updates modelProfile", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.modelProfile, "balanced-local");
  });
  it("preserves apiKeys", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.apiKeys?.anthropic, "sk-preserved");
  });
  it("preserves permissions", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.permissions.default, "allow");
  });
  it("writes per-tier models", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.models?.coder.name, "qwen2.5-coder:7b");
  });
});
