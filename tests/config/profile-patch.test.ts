import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProfilePatch, applyProfilePatch, PRESERVED_SECTIONS } from "../../src/config/profile-patch.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ProfileData } from "../../src/config/profile-types.js";

function makeMinimalConfig(): AlixConfig {
  return {
    version: 1,
    // Stale loader-derived projections — applyProfilePatch must strip these.
    model: { provider: "ollama", name: "old-model" },
    subagents: { enabled: true, roles: [], coding: { provider: "ollama", name: "old-coding" } },
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

describe("buildProfilePatch (§5.1–§5.2)", () => {
  it("includes modelProfile", () => {
    assert.equal(buildProfilePatch(makeProfile()).modelProfile, "balanced-local");
  });
  it("profile default becomes models.default (not a top-level model)", () => {
    const p = buildProfilePatch(makeProfile());
    assert.equal(p.models?.default?.name, "qwen3:4b");
    assert.equal("model" in p, false);
  });
  it("profile coder becomes models.coding via PROFILE_TIER_MAP", () => {
    const p = buildProfilePatch(makeProfile());
    assert.equal(p.models?.coding?.name, "qwen2.5-coder:7b");
    assert.equal("coder" in p.models, false); // canonical key only, no profile vocab
  });
  it("maps planner/researcher/embeddings through PROFILE_TIER_MAP", () => {
    const profile: ProfileData = {
      ...makeProfile(),
      models: {
        planner: { provider: "anthropic", name: "claude-opus" },
        researcher: { provider: "openai", name: "gpt-4o-mini" },
        embeddings: { provider: "ollama", name: "nomic-embed" },
      },
    };
    const p = buildProfilePatch(profile);
    assert.equal(p.models?.thinking?.name, "claude-opus");
    assert.equal(p.models?.fast?.name, "gpt-4o-mini");
    assert.equal(p.models?.tiny?.name, "nomic-embed");
  });
  it("skips profile tiers with no configuration equivalent (classifier)", () => {
    const profile: ProfileData = {
      ...makeProfile(),
      models: { ...makeProfile().models, classifier: { provider: "ollama", name: "classifier-x" } },
    };
    const p = buildProfilePatch(profile);
    assert.equal("classifier" in p.models, false);
  });
  it("produces no model or subagents on the patch", () => {
    const p = buildProfilePatch(makeProfile());
    assert.equal("model" in p, false);
    assert.equal("subagents" in p, false);
  });
});

describe("applyProfilePatch (§5.3–§5.4)", () => {
  it("updates modelProfile", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.modelProfile, "balanced-local");
  });
  it("writes profile default into models.default", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.models?.default?.name, "qwen3:4b");
  });
  it("writes profile coder into models.coding", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.models?.coding?.name, "qwen2.5-coder:7b");
  });
  it("preserves apiKeys and permissions", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal(r.apiKeys?.anthropic, "sk-preserved");
    assert.equal(r.permissions.default, "allow");
  });
  it("leaves runtime untouched", () => {
    const cfg = makeMinimalConfig();
    cfg.runtime = { ...cfg.runtime, commandTimeoutMs: 90000 };
    const r = applyProfilePatch(cfg, buildProfilePatch(makeProfile()));
    assert.equal(r.runtime?.commandTimeoutMs, 90000); // existing runtime survives untouched
  });
  it("strips stale model and subagent tier projections, keeps behavior config", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    assert.equal("model" in r, false);
    // The `coding` tier key is a loader-derived projection and is dropped;
    // `roles: []` is behavior config (§2.8.1) and survives. `enabled: true`
    // matches the default and is not persisted.
    assert.deepEqual(r.subagents, { roles: [] });
    assert.equal((r.subagents as any)?.coding, undefined);
  });
  it("keeps unrelated existing tiers that the patch does not specify", () => {
    const cfg = makeMinimalConfig();
    cfg.models = { thinking: { provider: "anthropic", name: "claude-opus" }, fast: { provider: "openai", name: "gpt-4o-mini" } };
    const r = applyProfilePatch(cfg, buildProfilePatch(makeProfile()));
    assert.equal(r.models?.thinking?.name, "claude-opus"); // unspecified tier survives
    assert.equal(r.models?.fast?.name, "gpt-4o-mini");
  });
  it("patch tiers win over existing models", () => {
    const cfg = makeMinimalConfig();
    cfg.models = { default: { provider: "ollama", name: "existing-default" }, coding: { provider: "ollama", name: "existing-coding" } };
    const r = applyProfilePatch(cfg, buildProfilePatch(makeProfile()));
    assert.equal(r.models?.default?.name, "qwen3:4b"); // patch wins
    assert.equal(r.models?.coding?.name, "qwen2.5-coder:7b"); // patch wins
  });
  it("returns a PersistedAlixConfig ready for writeConfig", () => {
    const r = applyProfilePatch(makeMinimalConfig(), buildProfilePatch(makeProfile()));
    const serialized = JSON.stringify(r);
    assert.equal(serialized.includes("persistedConfigBrand"), false);
    assert.equal(serialized.includes('"model"'), false);
  });
});
