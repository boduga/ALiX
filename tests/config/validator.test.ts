import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../../src/config/validator.js";
import type { AlixConfig } from "../../src/config/schema.js";

function makeValidConfig(): AlixConfig {
  return {
    version: 1 as const,
    model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
    ui: { enabled: true, host: "localhost", port: 3000, transport: "sse" as const },
    context: { repoMap: true, maxRepoMapTokens: 4096, repoMapMode: "lite" as const, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process" as const, shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    permissions: { protectedPaths: ["/etc", "/var"], denyCommands: ["rm -rf /"], default: "ask" as const, tools: {}, allowNetworkDomains: [] }
  };
}

describe("validateConfig", () => {
  it("returns valid for a correct config", () => {
    const result = validateConfig(makeValidConfig());
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  it("reports error for unknown provider", () => {
    const config = makeValidConfig();
    config.model.provider = "unknown-provider" as any;
    const result = validateConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.path === "model.provider" && i.level === "error"));
  });

  it("reports error when model.name is empty", () => {
    const config = makeValidConfig();
    config.model.name = "" as any;
    const result = validateConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.path === "model.name"));
  });

  it("reports warning when port is below 1024", () => {
    const config = makeValidConfig();
    config.ui.port = 80;
    const result = validateConfig(config);
    assert.ok(result.issues.some(i => i.path === "ui.port" && i.level === "warning"));
  });

  it("reports error when maxRepoMapTokens is not a positive integer", () => {
    const config = makeValidConfig();
    config.context.maxRepoMapTokens = -1;
    const result = validateConfig(config);
    assert.ok(result.issues.some(i => i.path === "context.maxRepoMapTokens" && i.level === "error"));
  });

  it("reports error when commandTimeoutMs is not positive", () => {
    const config = makeValidConfig();
    config.runtime.commandTimeoutMs = 0;
    const result = validateConfig(config);
    assert.ok(result.issues.some(i => i.path === "runtime.commandTimeoutMs" && i.level === "error"));
  });

  it("reports error when permissions.default is invalid", () => {
    const config = makeValidConfig();
    config.permissions.default = "invalid" as any;
    const result = validateConfig(config);
    assert.ok(result.issues.some(i => i.path === "permissions.default" && i.level === "error"));
  });

  it("reports error when repoMapMode is invalid", () => {
    const config = makeValidConfig();
    config.context.repoMapMode = "invalid" as any;
    const result = validateConfig(config);
    assert.ok(result.issues.some(i => i.path === "context.repoMapMode" && i.level === "error"));
  });

  it("reports error when runtime.provider is invalid", () => {
    const config = makeValidConfig();
    config.runtime.provider = "invalid" as any;
    const result = validateConfig(config);
    assert.ok(result.issues.some(i => i.path === "runtime.provider" && i.level === "error"));
  });
});