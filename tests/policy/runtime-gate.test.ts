/**
 * runtime-gate.test.ts — Tests for evaluateRuntimeGate()
 *
 * Covers: ready (capability exists + policy allows), blocked (missing capability),
 * blocked (policy denies), needs_approval (policy asks + approvalStore),
 * ready (no requiredCapabilities), most restrictive across caps, ask without store.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRuntimeGate } from "../../src/policy/runtime-gate.js";
import { CardRegistry } from "../../src/registry/card-registry.js";
import type { TaskNode } from "../../src/kernel/task-graph.js";

function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "test_node", graphId: "test_graph", title: "Test Node",
    goal: "test", domain: "general", status: "pending",
    dependencies: [], requiredCapabilities: ["web.search"],
    riskLevel: "low", approvalMode: "auto", inputs: {},
    artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "",
    ...overrides,
  };
}

function makeRegistry(): CardRegistry {
  const r = new CardRegistry();
  r.registerAgent({
    id: "test.agent", name: "Test", description: "Test agent",
    version: "1.0.0", domains: ["general"], capabilities: ["web.search"],
    enabled: true,
  });
  r.registerTool({
    id: "web_search", name: "Web Search", description: "Search",
    version: "1.0.0", capabilities: ["web.search"], riskLevel: "low",
    approvalMode: "auto", sideEffects: "read", enabled: true,
  });
  r.registerTool({
    id: "shell_exec", name: "Shell Exec", description: "Shell",
    version: "1.0.0", capabilities: ["shell.exec"], riskLevel: "high",
    approvalMode: "ask", sideEffects: "system", enabled: true,
  });
  return r;
}

function makePolicyGate(...rules: any[]): any {
  return {
    evaluateCapability: async (req: any) => {
      for (const rule of rules) {
        if (rule.match && rule.match.capability === req.capability) {
          return { requestId: req.requestId, capability: req.capability, decision: rule.decision, reason: rule.reason || "policy match", matchedRuleId: rule.id };
        }
      }
      // Default: allow
      return { requestId: req.requestId, capability: req.capability, decision: "allow", reason: "default allow" };
    },
  };
}

const mockConfig = {
  permissions: { sessionMode: "ask", tools: {}, default: "allow", protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
} as any;

describe("RuntimeGate", () => {
  it("returns ready when capability exists and policy allows", async () => {
    const registry = makeRegistry();
    const policyGate = makePolicyGate({
      id: "allow-search", description: "Allow search",
      match: { capability: "web.search" }, decision: "allow", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["web.search"] }),
      registry, policyGate, config: mockConfig,
    });
    assert.equal(result.status, "ready");
  });

  it("returns blocked when capability is missing", async () => {
    const registry = new CardRegistry();
    const policyGate = makePolicyGate();
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["nonexistent.cap"] }),
      registry, policyGate, config: mockConfig,
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.reason.includes("Missing capabilities"));
  });

  it("returns blocked when policy denies", async () => {
    const registry = makeRegistry();
    const policyGate = makePolicyGate({
      id: "deny-search", description: "Deny search",
      match: { capability: "web.search" }, decision: "deny", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["web.search"] }),
      registry, policyGate, config: mockConfig,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.policyDecision, "deny");
  });

  it("returns needs_approval when policy asks and approvalStore exists", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "runtime-gate-ask-"));
    try {
      const store = new ApprovalStore(tmpDir);
      await store.load();
      const registry = makeRegistry();
      const policyGate = makePolicyGate({
        id: "ask-shell", description: "Ask shell",
        match: { capability: "shell.exec" }, decision: "ask", enabled: true,
        reason: "Shell execution needs approval",
      });
      const result = await evaluateRuntimeGate({
        node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
        registry, policyGate, approvalStore: store, config: mockConfig,
      });
      assert.equal(result.status, "needs_approval");
      assert.equal(result.policyDecision, "ask");
      assert.ok(result.approvalId, "should have created an approval");
      assert.ok(result.reason.includes("Pending approval"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns ready when node has no requiredCapabilities", async () => {
    const registry = new CardRegistry();
    const policyGate = makePolicyGate();
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: [] }),
      registry, policyGate, config: mockConfig,
    });
    assert.equal(result.status, "ready");
  });

  it("applies most restrictive decision across multiple capabilities", async () => {
    const registry = makeRegistry();
    registry.registerAgent({
      id: "writer.agent", name: "Writer", description: "Writes",
      version: "1.0.0", domains: ["general"], capabilities: ["filesystem.write"],
      enabled: true,
    });
    registry.registerTool({
      id: "file_write", name: "File Write", description: "Write",
      version: "1.0.0", capabilities: ["filesystem.write"], riskLevel: "medium",
      approvalMode: "ask", sideEffects: "write", enabled: true,
    });
    const policyGate = makePolicyGate(
      { id: "allow-search", description: "Allow search",
        match: { capability: "web.search" }, decision: "allow", enabled: true },
      { id: "deny-write", description: "Deny write",
        match: { capability: "filesystem.write" }, decision: "deny", enabled: true },
    );
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["web.search", "filesystem.write"] }),
      registry, policyGate, config: mockConfig,
    });
    // deny-write should override allow-search
    assert.equal(result.status, "blocked");
    assert.equal(result.policyDecision, "deny");
  });

  it("ask without approvalStore returns blocked", async () => {
    const registry = makeRegistry();
    const policyGate = makePolicyGate({
      id: "ask-shell", description: "Ask shell",
      match: { capability: "shell.exec" }, decision: "ask", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
      registry, policyGate, config: mockConfig,
      // no approvalStore
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.policyDecision, "ask");
    assert.ok(result.reason.includes("no approval store configured"));
  });

  it("reuses existing pending approval instead of duplicating", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "runtime-gate-reuse-"));
    try {
      const store = new ApprovalStore(tmpDir);
      await store.load();
      // Pre-create a pending approval
      await store.request({
        reason: "existing", graphId: "test_graph", nodeId: "test_node", capability: "shell.exec",
      });
      const registry = makeRegistry();
      const policyGate = makePolicyGate({
        id: "ask-shell", description: "Ask shell",
        match: { capability: "shell.exec" }, decision: "ask", enabled: true,
      });
      const result = await evaluateRuntimeGate({
        node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
        registry, policyGate, approvalStore: store, config: mockConfig,
      });
      assert.equal(result.status, "needs_approval");
      assert.ok(result.approvalId);
      // Should have reused — only 1 approval in store
      assert.equal(store.list().length, 1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns ready when prior approval was approved", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "runtime-gate-approved-"));
    try {
      const store = new ApprovalStore(tmpDir);
      await store.load();
      const rec = await store.request({
        reason: "prior", graphId: "test_graph", nodeId: "test_node", capability: "shell.exec",
      });
      await store.resolve(rec.id, "approved");
      const registry = makeRegistry();
      const policyGate = makePolicyGate({
        id: "ask-shell", description: "Ask shell",
        match: { capability: "shell.exec" }, decision: "ask", enabled: true,
      });
      const result = await evaluateRuntimeGate({
        node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
        registry, policyGate, approvalStore: store, config: mockConfig,
      });
      assert.equal(result.status, "ready");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
