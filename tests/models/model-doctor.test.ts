import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDoctor } from "../../src/models/model-doctor.js";
import type { ProfileData } from "../../src/config/profile-types.js";
import type { SystemInfo } from "../../src/config/profile-registry.js";

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return { id: "balanced-local", name: "Balanced Local", description: "", mode: "local-first", hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "ollama", name: "test" } }, ...overrides };
}

function makeSystem(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return { os: "linux", cpu: "x64", ramGb: 16, hasGpu: false, ollamaInstalled: true, ollamaRunning: true, installedModels: ["test-model"], apiProviders: { anthropic: { configured: true, hasKey: true } }, ...overrides };
}

describe("runDoctor", () => {
  it("produces hardware section with RAM", () => {
    assert.ok(runDoctor(makeSystem(), {}, [makeProfile()]).sections.find(s => s.title === "Hardware")?.items.some(i => i.includes("RAM")));
  });
  it("produces local runtime section", () => {
    assert.ok(runDoctor(makeSystem(), {}, [makeProfile()]).sections.find(s => s.title === "Local Runtime"));
  });
  it("marks profile as compatible when hardware passes", () => {
    assert.equal(runDoctor(makeSystem(), {}, [makeProfile()]).profileCompatibility[0].status, "compatible");
  });
  it("marks profile as incompatible when RAM is insufficient", () => {
    const p = makeProfile({ hardware: { minRamGb: 32, recommendedRamGb: 64, requiresGpu: false, minVramGb: 0 } });
    assert.equal(runDoctor(makeSystem({ ramGb: 8 }), {}, [p]).profileCompatibility[0].status, "incompatible");
  });
  it("reports missing API keys as issues", () => {
    const s = makeSystem({ apiProviders: { anthropic: { configured: true, hasKey: false } } });
    assert.ok(runDoctor(s, {}, [makeProfile()]).issues.some(i => i.message.includes("API_KEY")));
  });
  it("reports missing Ollama", () => {
    const s = makeSystem({ ollamaInstalled: false, ollamaRunning: false });
    assert.ok(runDoctor(s, {}, [makeProfile()]).issues.some(i => i.message.includes("Ollama not detected")));
  });
  it("warns when active profile is incompatible", () => {
    const p = makeProfile({ id: "power-local", hardware: { minRamGb: 32, recommendedRamGb: 64, requiresGpu: false, minVramGb: 0 } });
    assert.ok(runDoctor(makeSystem({ ramGb: 8 }), {}, [p], "power-local").issues.some(i => i.message.includes("incompatible")));
  });
});
