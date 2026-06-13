import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortNodesByDependencies, normalizeNode, loadGraph, GraphExecutor } from "../../src/kernel/graph-executor.js";
import type { TaskNode, TaskGraph } from "../../src/kernel/task-graph.js";
import { CardRegistry } from "../../src/registry/card-registry.js";

/**
 * Write a project-level .alix/config.json that pins the mock provider.
 *
 * `loadConfig()` in src/config/loader.ts always reads BOTH the user config
 * (~/.config/alix/config.json) AND the project config (<cwd>/.alix/config.json).
 * On any developer machine where the user config is set up (real API keys,
 * a real provider), the tmpdir-isolated tests below would otherwise fall
 * through to the user config and make real LLM calls — hanging the suite
 * for 30+ seconds per test.
 *
 * Writing a project config in the tmpdir makes the loader merge the mock
 * provider on top of the user config, so `runTask()` always uses the fast
 * deterministic mock.
 */
function writeMockConfig(tmpDir: string, writeFileSync: (path: string, data: string) => void, join: (...parts: string[]) => string, mkdirSync: (path: string, opts?: { recursive?: boolean }) => void) {
  mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".alix", "config.json"),
    JSON.stringify({ model: { provider: "mock", name: "mock" }, mcpServers: [] }),
  );
}

describe("GraphExecutor", () => {

  it("sortNodesByDependencies returns nodes in dependency order", () => {
    const nodes: TaskNode[] = [
      { id: "c", graphId: "g1", title: "C", goal: "c", domain: "x", status: "pending", dependencies: ["a"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
      { id: "a", graphId: "g1", title: "A", goal: "a", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
      { id: "b", graphId: "g1", title: "B", goal: "b", domain: "x", status: "pending", dependencies: ["a"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
    ];
    const sorted = sortNodesByDependencies(nodes);
    const ids = sorted.map(n => n.id);
    assert.equal(ids[0], "a", "a should be first (no deps)");
    assert.ok(ids.indexOf("b") > ids.indexOf("a"), "b should come after a");
    assert.ok(ids.indexOf("c") > ids.indexOf("a"), "c should come after a");
  });

  it("sortNodesByDependencies throws on cycle", () => {
    const nodes: TaskNode[] = [
      { id: "a", graphId: "g1", title: "A", goal: "a", domain: "x", status: "pending", dependencies: ["b"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
      { id: "b", graphId: "g1", title: "B", goal: "b", domain: "x", status: "pending", dependencies: ["a"], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
    ];
    assert.throws(() => sortNodesByDependencies(nodes));
  });

  it("normalizeNode fills missing fields", () => {
    const raw = { id: "n1", graphId: "g1", title: "Test", goal: "test", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" } as TaskNode;
    // Remove optional fields to test defaults
    delete (raw as any).riskLevel;
    delete (raw as any).dependencies;
    const norm = normalizeNode(raw);
    assert.equal(norm.riskLevel, "medium", "default risk is medium");
    assert.deepEqual(norm.dependencies, [], "default deps is empty array");
  });

  it("loadGraph rejects missing graph", async () => {
    await assert.rejects(() => loadGraph("nonexistent_graph", "/tmp"), /Graph not found/);
  });

  it("normalizeNode preserves timeoutMs when set", () => {
    const raw = {
      id: "n1", graphId: "g1", title: "Research", goal: "test",
      domain: "research", status: "pending" as const,
      dependencies: [], requiredCapabilities: ["web.search"],
      riskLevel: "low" as const, approvalMode: "auto" as const,
      inputs: {}, artifacts: [], memoryRefs: [],
      timeoutMs: 120000, maxIterations: 3,
      createdAt: "", updatedAt: "",
    };
    const norm = normalizeNode(raw);
    assert.equal(norm.timeoutMs, 120000);
    assert.equal((norm as any).maxIterations, 3);
  });

  it("sortNodesByDependencies handles empty dependencies", () => {
    const nodes: TaskNode[] = [
      { id: "a", graphId: "g1", title: "A", goal: "a", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" },
    ];
    const sorted = sortNodesByDependencies(nodes);
    assert.equal(sorted.length, 1);
    assert.equal(sorted[0].id, "a");
  });

  it("rerunNode throws for unknown graph", async () => {
    const { GraphExecutor } = await import("../../src/kernel/graph-executor.js");
    const exec = new GraphExecutor("/tmp");
    await assert.rejects(
      () => exec.rerunNode("nonexistent", "node_a"),
      /Graph not found/,
    );
  });

  it("rerunNode throws for non-failed node without force", async () => {
    // Create a minimal graph with a "done" node
    const { randomUUID } = await import("node:crypto");
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = mkdtempSync(join(tmpdir(), "rerun-test-"));
    const graphId = `graph_rerun_test`;
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0", workflowId: "wf_test", rootGoal: "test",
      status: "completed", strategy: "sequential",
      nodes: [{
        id: "node_a", graphId, title: "Node A", goal: "test",
        domain: "test", status: "done", dependencies: [], requiredCapabilities: [],
        riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [],
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));
    const exec = new (await import("../../src/kernel/graph-executor.js")).GraphExecutor(tmpDir);
    await assert.rejects(
      () => exec.rerunNode(graphId, "node_a"),
      /status is "done"/,
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no enforcement: blocked capability continues execution normally", async () => {
    const { randomUUID } = await import("node:crypto");
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = mkdtempSync(join(tmpdir(), "exec-enforce-test-"));
    writeMockConfig(tmpDir, writeFileSync, join, mkdirSync);

    const graphId = "enforce_default_test";
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0", workflowId: "wf_test",
      rootGoal: "test", status: "ready", strategy: "sequential",
      nodes: [{
        id: "node_a", graphId, title: "Node A", goal: "do the thing",
        domain: "general", status: "pending", dependencies: [],
        requiredCapabilities: ["nonexistent.cap"],
        riskLevel: "low", approvalMode: "auto", inputs: {},
        artifacts: [], memoryRefs: [],
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));

    // Empty registry that provides no capabilities
    const registry = new CardRegistry();
    const exec = new GraphExecutor(tmpDir, { registry, enforceCapabilities: false });
    const result = await exec.execute(graphId);

    // Without enforcement the node attempts execution (runTask will fail because
    // there's no real provider, but the executor doesn't stop for capability reasons)
    const node = result.results[0];
    assert.equal(node.nodeId, "node_a");
    assert.ok(node.capabilityResolution, "capability resolution should exist");
    assert.equal(node.capabilityResolution!.status, "blocked");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enforcement: blocked capability short-circuits node", async () => {
    const { randomUUID } = await import("node:crypto");
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = mkdtempSync(join(tmpdir(), "exec-enforce-blocked-"));
    writeMockConfig(tmpDir, writeFileSync, join, mkdirSync);

    const graphId = "enforce_blocked_test";
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0", workflowId: "wf_test",
      rootGoal: "test", status: "ready", strategy: "sequential",
      nodes: [{
        id: "node_b", graphId, title: "Node B", goal: "search the web",
        domain: "general", status: "pending", dependencies: [],
        requiredCapabilities: ["nonexistent.cap"],
        riskLevel: "low", approvalMode: "auto", inputs: {},
        artifacts: [], memoryRefs: [],
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));

    const { PolicyGate } = await import("../../src/policy/policy-gate.js");
    const mockConfig = { version: 1 as const, model: { provider: "mock", name: "test" }, permissions: { default: "allow" as const, tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] }, context: { repoMap: false, repoMapMode: "lite" as const, maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] }, runtime: { provider: "process" as const, shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] }, ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const } };
    const registry = new CardRegistry();
    const exec = new GraphExecutor(tmpDir, { registry, enforceCapabilities: true, policyGate: new PolicyGate(mockConfig, {}), config: mockConfig });
    const result = await exec.execute(graphId);

    assert.equal(result.results.length, 1);
    const node = result.results[0];
    assert.equal(node.status, "blocked");
    assert.match(node.reason!, /Missing capabilities/);
    assert.match(node.reason!, /nonexistent\.cap/);
    assert.equal(result.graphStatus, "failed");
    assert.equal(result.completedNodes, 0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enforcement: needs_approval creates approval request and blocks", async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "exec-enforce-approval-"));
    writeMockConfig(tmpDir, writeFileSync, join, mkdirSync);

    const graphId = "enforce_approval_test";
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0", workflowId: "wf_test",
      rootGoal: "test", status: "ready", strategy: "sequential",
      nodes: [{
        id: "node_c", graphId, title: "Node C", goal: "run shell command",
        domain: "general", status: "pending", dependencies: [],
        requiredCapabilities: ["shell.exec"],
        riskLevel: "high", approvalMode: "ask", inputs: {},
        artifacts: [], memoryRefs: [],
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));

    // Registry with shell_exec tool (high risk)
    const registry = new CardRegistry();
    registry.registerTool({
      id: "shell_exec", name: "Shell Exec", description: "Test shell tool",
      version: "1.0.0", capabilities: ["shell.exec"], riskLevel: "high",
      approvalMode: "ask", sideEffects: "system", enabled: true,
    });

    // PolicyGate that asks for shell.exec
    const policyGate = {
      evaluateCapability: async (req: any) => {
        if (req.capability === "shell.exec") {
          return { requestId: req.requestId, capability: req.capability, decision: "ask" as const, reason: "Shell execution needs approval", matchedRuleId: "ask-shell" };
        }
        return { requestId: req.requestId, capability: req.capability, decision: "allow" as const, reason: "default allow" };
      },
    };

    const mockConfig = {
      permissions: { sessionMode: "ask" as const, tools: {}, default: "allow" as const, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    } as any;

    const approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();
    const exec = new GraphExecutor(tmpDir, { registry, enforceCapabilities: true, policyGate: policyGate as any, config: mockConfig, approvalStore });
    const result = await exec.execute(graphId);

    // needs_approval should block with a pending approval reason
    const node = result.results[0];
    assert.equal(node.status, "blocked");
    assert.ok(node.reason!.includes("Pending approval"), `Expected pending approval reason, got: ${node.reason}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enforcement: policy deny blocks node", async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = mkdtempSync(join(tmpdir(), "exec-policy-deny-"));
    writeMockConfig(tmpDir, writeFileSync, join, mkdirSync);

    const graphId = "policy_deny_test";
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });
    writeFileSync(join(graphsDir, `${graphId}.json`), JSON.stringify({
      id: graphId, schemaVersion: "1.0", workflowId: "wf_test",
      rootGoal: "test", status: "ready", strategy: "sequential",
      nodes: [{
        id: "node_p", graphId, title: "Node P", goal: "search",
        domain: "general", status: "pending", dependencies: [],
        requiredCapabilities: ["web.search"],
        riskLevel: "low", approvalMode: "auto", inputs: {},
        artifacts: [], memoryRefs: [],
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }],
      edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));

    const registry = new CardRegistry();
    registry.registerTool({
      id: "web_search", name: "Web Search", description: "Test web search tool",
      version: "1.0.0", capabilities: ["web.search"], riskLevel: "low",
      approvalMode: "auto", sideEffects: "read", enabled: true,
    });

    const policyGate = {
      evaluateCapability: async (req: any) => {
        if (req.capability === "web.search") {
          return { requestId: req.requestId, capability: req.capability, decision: "deny" as const, reason: "Denied by policy", matchedRuleId: "deny-web" };
        }
        return { requestId: req.requestId, capability: req.capability, decision: "allow" as const, reason: "default allow" };
      },
    };

    const mockConfig = {
      permissions: { sessionMode: "ask" as const, tools: {}, default: "allow" as const, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    } as any;

    const exec = new GraphExecutor(tmpDir, { registry, enforceCapabilities: true, policyGate: policyGate as any, config: mockConfig });
    const result = await exec.execute(graphId);

    const node = result.results[0];
    assert.equal(node.status, "blocked");
    assert.match(node.reason!, /denied|deny|blocked/i);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
