import { describe, it } from "node:test";
import assert from "node:assert";
import { CapabilityRegistry } from "../../src/policy/capability-registry.js";
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

  it("uses CapabilityRegistry for risk classification", () => {
    const registry = new CapabilityRegistry();
    const risk = registry.getRiskLevel("shell.exec");
    assert.equal(risk, "critical");
  });

  it("CapabilityRegistry blocks critical risk tools", () => {
    const registry = new CapabilityRegistry();
    const needsApproval = registry.requiresApproval("shell.exec");
    assert.equal(needsApproval, true);
  });

  it("low risk tools don't require approval", () => {
    const registry = new CapabilityRegistry();
    const needsApproval = registry.requiresApproval("file.read");
    assert.equal(needsApproval, false);
  });

  it("PolicyEngine integrates CapabilityRegistry", () => {
    const config = createMinimalConfig();
    const engine = new PolicyEngine(config);
    const registry = new CapabilityRegistry();
    engine.setCapabilityRegistry(registry);

    const risk = engine.getCapabilityRisk("shell.exec");
    assert.equal(risk, "critical");
  });

  it("PolicyEngine checks secrets in shell commands", () => {
    const config = createMinimalConfig();
    const engine = new PolicyEngine(config);
    const scanner = new SecretScanner();
    engine.setSecretScanner(scanner);

    const result = engine.checkSecretExposure('echo "sk-1234567890abcdef"');
    assert.ok(result.hasSecret);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, "api_key");
  });

  it("PolicyEngine requires approval for critical tools via registry", () => {
    const config = createMinimalConfig();
    const engine = new PolicyEngine(config);
    const registry = new CapabilityRegistry();
    engine.setCapabilityRegistry(registry);

    const requiresApproval = engine.requiresCapabilityApproval("shell.exec");
    assert.equal(requiresApproval, true);
  });
});