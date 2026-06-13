import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchHardware, type SystemInfo } from "../../src/config/profile-registry.js";
import { type ProfileData } from "../../src/config/profile-types.js";

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    id: "test-profile",
    name: "Test",
    description: "",
    mode: "local-first",
    hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 },
    models: { default: { provider: "ollama", name: "test-model" } },
    ...overrides,
  };
}

function makeSystem(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    os: "linux", cpu: "x64", ramGb: 16,
    hasGpu: false, ollamaInstalled: true, ollamaRunning: true,
    installedModels: [], apiProviders: {},
    ...overrides,
  };
}

describe("matchHardware", () => {
  it("returns compatible when system meets all requirements", () => {
    assert.equal(matchHardware(makeProfile(), makeSystem({ ramGb: 16 })), "compatible");
  });

  it("returns incompatible when RAM is below minimum", () => {
    const p = makeProfile({ hardware: { minRamGb: 16, recommendedRamGb: 32, requiresGpu: false, minVramGb: 0 } });
    assert.equal(matchHardware(p, makeSystem({ ramGb: 8 })), "incompatible");
  });

  it("returns incompatible when GPU required but absent", () => {
    const p = makeProfile({ hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: true, minVramGb: 8 } });
    assert.equal(matchHardware(p, makeSystem({ ramGb: 32, hasGpu: false })), "incompatible");
  });

  it("returns partial when Ollama is not running for local-first", () => {
    const s = makeSystem({ ramGb: 16, ollamaInstalled: false, ollamaRunning: false });
    assert.equal(matchHardware(makeProfile(), s), "partial");
  });

  it("returns incompatible when cloud-only profile has no API keys", () => {
    const p = makeProfile({ mode: "cloud-only", models: { default: { provider: "anthropic", name: "claude" } } });
    const s = makeSystem({ apiProviders: { anthropic: { configured: true, hasKey: false } } });
    assert.equal(matchHardware(p, s), "incompatible");
  });

  it("returns compatible when cloud-only profile has API keys", () => {
    const p = makeProfile({ mode: "cloud-only", models: { default: { provider: "anthropic", name: "claude" } } });
    const s = makeSystem({ apiProviders: { anthropic: { configured: true, hasKey: true } } });
    assert.equal(matchHardware(p, s), "compatible");
  });

  it("returns compatible for cloud-only with no GPU and no Ollama", () => {
    const p = makeProfile({ mode: "cloud-only", models: { default: { provider: "anthropic", name: "claude" } } });
    const s = makeSystem({ ramGb: 8, hasGpu: false, ollamaInstalled: false, ollamaRunning: false, apiProviders: { anthropic: { configured: true, hasKey: true } } });
    assert.equal(matchHardware(p, s), "compatible");
  });

  it("returns partial when above min but below recommended RAM", () => {
    const p = makeProfile({ hardware: { minRamGb: 8, recommendedRamGb: 32, requiresGpu: false, minVramGb: 0 } });
    assert.equal(matchHardware(p, makeSystem({ ramGb: 16 })), "partial");
  });
});
