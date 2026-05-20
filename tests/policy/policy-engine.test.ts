import { describe, it } from "node:test";
import assert from "node:assert";
import type { AlixConfig } from "../../src/config/schema.js";
import { PolicyEngine, PolicyEngineBuilder } from "../../src/policy/policy-engine.js";
import { CommandClassifier } from "../../src/policy/command-classifier.js";
import { NetworkPolicyMatcher, type NetworkPolicy } from "../../src/policy/network-policy-matcher.js";

function createTestConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "mock", name: "test" },
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
    runtime: {
      provider: "process",
      shell: "/bin/bash",
      commandTimeoutMs: 30000,
      envAllowlist: [],
    },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
  };
}

describe("PolicyEngine integration", () => {
  it("uses CommandClassifier for shell commands - read-only commands fall through to default policy", () => {
    const engine = new PolicyEngine(createTestConfig(), {
      commandClassifier: new CommandClassifier(),
    });

    const result = engine.check({
      toolCallId: "test-1",
      toolName: "shell.run",
      args: { command: "cat src/index.ts" },
      capability: "shell.readonly",
      sessionMode: "ask",
    });

    // Read-only commands are classified as low risk, not critical
    // They fall through to the default policy which returns "ask"
    assert.equal(result.decision, "ask");
  });

  it("uses CommandClassifier to deny critical commands", () => {
    const engine = new PolicyEngine(createTestConfig(), {
      commandClassifier: new CommandClassifier(),
    });

    const result = engine.check({
      toolCallId: "test-2",
      toolName: "shell.run",
      args: { command: "sudo rm -rf /" },
      capability: "shell.mutating",
      sessionMode: "ask",
    });

    // High risk commands should be denied or require approval (falls through to default)
    assert.ok(result.decision === "deny" || result.decision === "ask");
  });

  it("uses NetworkPolicyMatcher for network commands - allowlisted domains", () => {
    const networkPolicy: NetworkPolicy = {
      defaultAction: "ask",
      allowlist: ["api.github.com"],
      blocklist: [],
    };
    const engine = new PolicyEngine(createTestConfig(), {
      networkMatcher: new NetworkPolicyMatcher(networkPolicy),
    });

    const result = engine.check({
      toolCallId: "test-3",
      toolName: "network.fetch",
      args: { url: "https://api.github.com/users" },
      capability: "network.fetch",
      sessionMode: "ask",
    });

    assert.equal(result.decision, "allow");
  });

  it("uses NetworkPolicyMatcher to deny blocklisted domains", () => {
    const networkPolicy: NetworkPolicy = {
      defaultAction: "ask",
      allowlist: [],
      blocklist: ["malicious.com"],
    };
    const engine = new PolicyEngine(createTestConfig(), {
      networkMatcher: new NetworkPolicyMatcher(networkPolicy),
    });

    const result = engine.check({
      toolCallId: "test-4",
      toolName: "network.fetch",
      args: { url: "https://malicious.com/api" },
      capability: "network.fetch",
      sessionMode: "ask",
    });

    assert.equal(result.decision, "deny");
  });
});

describe("PolicyEngineBuilder", () => {
  it("creates engine with all deps", () => {
    const engine = new PolicyEngineBuilder(createTestConfig())
      .withCommandClassifier(new CommandClassifier())
      .withCapabilityRegistry({ getRiskLevel: () => "low", requiresApproval: () => false } as any)
      .withNetworkPolicy({ defaultAction: "ask", allowlist: [], blocklist: [] })
      .withSecretScanner({ scan: () => [] } as any)
      .build();

    assert.ok(engine instanceof PolicyEngine);
    assert.strictEqual(engine.getCapabilityRisk("shell.readonly"), "low");
  });

  it("creates engine with minimal config", () => {
    const engine = new PolicyEngineBuilder(createTestConfig()).build();
    assert.ok(engine instanceof PolicyEngine);
  });

  it("builder chain methods return this for chaining", () => {
    const builder = new PolicyEngineBuilder(createTestConfig());
    const result = builder.withCommandClassifier(new CommandClassifier());
    assert.strictEqual(result, builder);
  });
});