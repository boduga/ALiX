import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSystem } from "../../src/config/hardware-detect.js";

describe("hardware-detect", () => {
  it("detects OS and CPU without throwing", () => {
    const r = detectSystem();
    assert.ok(["linux", "macos", "windows"].includes(r.os));
    assert.ok(typeof r.cpu === "string");
  });
  it("returns RAM as a number >= 0", () => {
    assert.ok(detectSystem().ramGb >= 0);
  });
  it("hasGpu is a boolean", () => {
    assert.equal(typeof detectSystem().hasGpu, "boolean");
  });
  it("returns installedModels as string array", () => {
    assert.ok(Array.isArray(detectSystem().installedModels));
  });
  it("ollamaInstalled and ollamaRunning are booleans", () => {
    const r = detectSystem();
    assert.equal(typeof r.ollamaInstalled, "boolean");
    assert.equal(typeof r.ollamaRunning, "boolean");
  });
  it("distinguishes configured vs hasKey for API providers", () => {
    const config = { apiKeys: { anthropic: "sk-xxx" }, model: { provider: "openai", name: "gpt-4" } };
    const r = detectSystem(config as any);
    assert.equal(r.apiProviders.anthropic?.hasKey, true);
    assert.equal(r.apiProviders.anthropic?.configured, true);
    assert.equal(r.apiProviders.openai?.hasKey, false);
    assert.equal(r.apiProviders.openai?.configured, true);
  });
  it("returns empty apiProviders without config", () => {
    assert.equal(Object.keys(detectSystem().apiProviders).length, 0);
  });
});
