import { describe, it } from "node:test";
import assert from "node:assert";
import { SecretScanner } from "../../src/security/secret-scanner.js";
import { PolicyEngine } from "../../src/policy/policy-engine.js";
import type { AlixConfig } from "../../src/config/schema.js";

function createMinimalConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "mock", name: "test-model" },
    permissions: {
      default: "ask",
      tools: {},
      protectedPaths: [],
      denyCommands: [],
      allowNetworkDomains: [],
    },
    context: {
      repoMap: false,
      repoMapMode: "lite",
      maxRepoMapTokens: 1000,
      semanticSearch: false,
      includeGitStatus: false,
      pinnedFiles: [],
    },
    runtime: { provider: "process", shell: "bash", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
  };
}

describe("PolicyEngine Tool Security Integration", () => {
  it("detects secrets in code using SecretScanner", () => {
    const scanner = new SecretScanner();
    const code = 'const key = "sk-1234567890abcdef"';
    const findings = scanner.scan(code);
    assert.ok(findings.length > 0);
    assert.equal(findings[0].type, "api_key");
  });

  it("PolicyEngine checks secrets in shell commands", () => {
    const config = createMinimalConfig();
    const scanner = new SecretScanner();
    const engine = new PolicyEngine(config, { secretScanner: scanner });

    const result = engine.checkSecretExposure('echo "sk-1234567890abcdef"');
    assert.ok(result.hasSecret);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, "api_key");
  });

  it("PolicyEngine requires approval for high-risk capabilities via config policy", () => {
    const config = createMinimalConfig();
    config.permissions.tools = { "shell.exec": "ask" };
    const engine = new PolicyEngine(config);

    const result = engine.check({
      toolCallId: "sec-2",
      toolName: "shell.exec",
      args: {},
      capability: "shell.exec",
      sessionMode: "ask",
    });
    // Config-driven tool policy still gates high-risk capabilities to "ask".
    assert.equal(result.decision, "ask");
  });
});