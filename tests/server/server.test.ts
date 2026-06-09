/**
 * server.test.ts — Tests for registry API routes.
 *
 * Validates card loading from disk, default fallback,
 * and live HTTP endpoint responses.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { get } from "node:http";

describe("Registry HTTP API", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "server-registry-test-"));
    // Create agent card files
    const agentsDir = join(tmpDir, ".alix", "cards", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "custom.json"), JSON.stringify({
      id: "custom.test", name: "Custom", description: "A custom agent",
      version: "1.0.0", domains: ["custom"], capabilities: ["custom.test"],
      enabled: true,
    }));
    // Create tool card files
    const toolsDir = join(tmpDir, ".alix", "cards", "tools");
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(join(toolsDir, "search.json"), JSON.stringify({
      id: "custom.search", name: "Custom Search", description: "A custom search tool",
      version: "1.0.0", capabilities: ["custom.search"], riskLevel: "low",
      approvalMode: "auto", sideEffects: "read", enabled: true,
    }));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadCardRegistry loads custom card from disk", async () => {
    const { loadCardRegistry } = await import("../../src/registry/card-loader.js");
    const registry = await loadCardRegistry(tmpDir);
    const agents = registry.listAgents(true);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "custom.test");
  });

  it("default registry when no cards dir exists", async () => {
    const { loadCardRegistry, defaultAgentCards, defaultToolCards } = await import("../../src/registry/card-loader.js");
    const blankDir = mkdtempSync(join(tmpdir(), "server-registry-blank-"));
    try {
      const registry = await loadCardRegistry(blankDir);
      assert.equal(registry.listAgents(true).length, defaultAgentCards().length);
      assert.equal(registry.listTools(true).length, defaultToolCards().length);
    } finally {
      rmSync(blankDir, { recursive: true, force: true });
    }
  });

  it("GET /api/registry/agents returns JSON array", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/registry/agents`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data), "response should be an array");
      assert.ok(data.length >= 1, "should have at least the custom agent");
      const custom = data.find((a: any) => a.id === "custom.test");
      assert.ok(custom, "custom.test agent should be present");
      assert.equal(custom.name, "Custom");
    } finally {
      await close();
    }
  });

  it("GET /api/registry/tools returns JSON array with custom tool", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/registry/tools`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data), "response should be an array");
      assert.ok(data.length >= 1, "should have at least the custom tool");
      const custom = data.find((t: any) => t.id === "custom.search");
      assert.ok(custom, "custom.search tool should be present");
      assert.equal(custom.name, "Custom Search");
    } finally {
      await close();
    }
  });
});

describe("Graph list API", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "graph-list-test-"));
    const graphsDir = join(tmpDir, ".alix", "graphs");
    mkdirSync(graphsDir, { recursive: true });

    // Valid graph
    writeFileSync(join(graphsDir, "graph_a.json"), JSON.stringify({
      id: "graph_a", rootGoal: "Research task", status: "completed",
      strategy: "sequential", createdAt: "2026-06-01", updatedAt: "2026-06-02",
      nodes: [
        { id: "n1", status: "done" },
        { id: "n2", status: "failed" },
        { id: "n3", status: "blocked" },
      ],
    }));

    // Run file (should be ignored)
    writeFileSync(join(graphsDir, "graph_a.runs.json"), JSON.stringify([{ attempt: 1 }]));

    // Invalid JSON file (should not break response)
    writeFileSync(join(graphsDir, "bad.json"), "not valid json");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns [] when no graph dir exists", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const blankDir = mkdtempSync(join(tmpdir(), "no-graphs-"));
    const { url, close } = await startServer(blankDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/graphs`);
      assert.equal(body, "[]");
    } finally {
      await close();
      rmSync(blankDir, { recursive: true, force: true });
    }
  });

  it("returns graph_a with full metadata", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/graphs`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
      const ga = data.find((g: any) => g.graphId === "graph_a");
      assert.ok(ga, "graph_a should appear");
      assert.equal(ga.nodeCount, 3);
      assert.equal(ga.completedNodes, 1);
      assert.equal(ga.failedNodes, 1);
      assert.equal(ga.blockedNodes, 1);
      assert.equal(ga.status, "completed");
      assert.equal(ga.strategy, "sequential");
      assert.equal(ga.hasRuns, true);
    } finally {
      await close();
      // tmpDir cleaned in after()
    }
  });

  it("skips .runs.json files and invalid JSON", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/graphs`);
      const data = JSON.parse(body);
      // graph_a is the only valid graph file; runs/bad are skipped
      assert.equal(data.length, 1);
      assert.equal(data[0].graphId, "graph_a");
    } finally {
      await close();
      // tmpDir cleaned in after()
    }
  });
});

describe("Policy API", () => {
  it("GET /api/policy/rules returns default rules array", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "policy-api-test-"));
    try {
      const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/policy/rules`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 8);
      assert.ok(data.some((r: any) => r.id === "allow-web-search"));
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("GET /api/policy/eval returns decision", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "policy-eval-api-"));
    try {
      const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/policy/eval?capability=shell.exec&risk=high`);
      const result = JSON.parse(body);
      assert.equal(result.decision, "ask");
      assert.ok(result.matchedRuleId);
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("GET /api/policy/eval returns deny for unknown", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "policy-eval-unknown-"));
    try {
      const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/policy/eval?capability=something.unknown&risk=critical`);
      const result = JSON.parse(body);
      assert.equal(result.decision, "deny");
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Approvals API", () => {
  it("GET /api/approvals returns array", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "approvals-api-test-"));
    try {
      const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/approvals`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data));
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Audit API", () => {
  it("GET /api/audit returns array", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-api-test-"));
    try {
      const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/audit`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data));
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

/**
 * Helper: perform an HTTP GET and return the full body as a string.
 */
async function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => void (body += chunk));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}
