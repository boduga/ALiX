import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankProfiles } from "../../src/models/model-fit.js";
import type { ProfileData } from "../../src/config/profile-types.js";
import type { SystemInfo } from "../../src/config/profile-registry.js";

describe("rankProfiles", () => {
  const system: SystemInfo = {
    os: "linux", cpu: "x64", ramGb: 16, hasGpu: true, gpuName: "RTX 3060", vramGb: 12,
    ollamaInstalled: true, ollamaRunning: true, installedModels: ["qwen3:4b"],
    apiProviders: { anthropic: { configured: true, hasKey: true } },
  };
  const profiles: ProfileData[] = [
    { id: "minimal-local", name: "Minimal Local", description: "", mode: "local-first", hardware: { minRamGb: 4, recommendedRamGb: 8, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "ollama", name: "qwen3:4b" }, embeddings: { provider: "ollama", name: "test" } } },
    { id: "balanced-local", name: "Balanced Local", description: "", mode: "local-first", hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "ollama", name: "qwen3:4b" }, coder: { provider: "ollama", name: "qwen2.5-coder:7b" }, embeddings: { provider: "ollama", name: "test" } }, fallbacks: { enabled: true } },
    { id: "all-cloud", name: "All Cloud", description: "", mode: "cloud-only", hardware: { minRamGb: 4, recommendedRamGb: 8, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "anthropic", name: "claude-haiku-4-5" }, coder: { provider: "openai", name: "gpt-4" }, embeddings: { provider: "openai", name: "text-embedding-3-small" } } },
  ];

  it("returns at least one result", () => { assert.ok(rankProfiles(system, profiles).length > 0); });
  it("sorts by rank descending", () => {
    const r = rankProfiles(system, profiles);
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].rank >= r[i].rank);
  });
  it("marks incompatible as not recommended", () => {
    const h: ProfileData = { id: "huge", name: "Huge", description: "", mode: "local-first", hardware: { minRamGb: 128, recommendedRamGb: 256, requiresGpu: true, minVramGb: 48 }, models: { default: { provider: "ollama", name: "huge" } } };
    assert.equal(rankProfiles(system, [h])[0].status, "not recommended");
  });
  it("respects mode filter", () => {
    const r = rankProfiles(system, profiles, { mode: "cloud-only" });
    assert.ok(r.every(p => p.profile.mode === "cloud-only"));
  });
  it("respects role filter", () => { assert.ok(rankProfiles(system, profiles, { role: "coder" }).length > 0); });
});
