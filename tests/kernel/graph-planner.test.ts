import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGraphSchema, createFallbackGraph, normalizeNodeCapabilities, buildPlanPrompt, DEFAULT_CAPABILITY_CATALOG, GraphPlanner } from "../../src/kernel/graph-planner.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { TaskGraph } from "../../src/kernel/task-graph.js";

describe("GraphPlanner", () => {

  it("validateGraphSchema accepts a valid graph", () => {
    const graph: TaskGraph = {
      id: "graph_test_1",
      schemaVersion: "1.0",
      workflowId: "wf_1",
      rootGoal: "test task",
      status: "draft",
      strategy: "sequential",
      nodes: [{
        id: "node_1", graphId: "graph_test_1", title: "Do thing", goal: "test",
        domain: "coding", status: "pending", dependencies: [],
        requiredCapabilities: [], riskLevel: "low", approvalMode: "auto",
        inputs: {}, artifacts: [], memoryRefs: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("validateGraphSchema rejects missing id", () => {
    const graph = { schemaVersion: "1.0", workflowId: "wf_1", rootGoal: "test", status: "draft", strategy: "sequential", nodes: [], edges: [], createdAt: "", updatedAt: "" } as unknown as TaskGraph;
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("id")));
  });

  it("validateGraphSchema rejects invalid status", () => {
    const graph = { id: "g1", schemaVersion: "1.0", workflowId: "wf_1", rootGoal: "test", status: "invalid_status", strategy: "sequential", nodes: [{ id: "n1", graphId: "g1", title: "x", goal: "x", domain: "x", status: "pending", dependencies: [], requiredCapabilities: [], riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [], memoryRefs: [], createdAt: "", updatedAt: "" }], edges: [], createdAt: "", updatedAt: "" } as unknown as TaskGraph;
    const result = validateGraphSchema(graph);
    assert.equal(result.valid, false);
  });

  it("fallback graph has one node and sequential strategy", () => {
    const graph = createFallbackGraph("test goal", "wf_fallback");
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.strategy, "sequential");
    assert.equal(graph.rootGoal, "test goal");
  });

  it("static catalog mirrors the live registry (no drift)", () => {
    const live = new Set(buildDefaultToolIndex().registry.getAll().flatMap(t => [t.name, t.capabilityId]));
    for (const cap of DEFAULT_CAPABILITY_CATALOG) {
      assert.ok(live.has(cap), `catalog capability missing from registry: ${cap}`);
    }
  });

  it("normalize defaults empty caps by role (read-only only)", () => {
    const catalog = new Set(DEFAULT_CAPABILITY_CATALOG);
    assert.deepEqual(
      normalizeNodeCapabilities({ requiredCapabilities: [], role: "explorer", domain: "coding" }, catalog),
      ["filesystem.read", "filesystem.search", "state.read"],
    );
    assert.deepEqual(
      normalizeNodeCapabilities({ requiredCapabilities: undefined, role: "researcher", domain: "research" }, catalog),
      ["web.search", "web.fetch"],
    );
    // Worker never defaults into write or shell.
    assert.deepEqual(
      normalizeNodeCapabilities({ requiredCapabilities: [], role: "worker", domain: "coding" }, catalog),
      ["filesystem.read"],
    );
  });

  it("normalize falls back to domain then filesystem.read", () => {
    const catalog = new Set(DEFAULT_CAPABILITY_CATALOG);
    assert.deepEqual(
      normalizeNodeCapabilities({ requiredCapabilities: [], domain: "docs" }, catalog),
      ["filesystem.read"],
    );
    assert.deepEqual(
      normalizeNodeCapabilities({}, catalog),
      ["filesystem.read"],
    );
  });

  it("normalize preserves unknown names (unknown-write stays wide)", () => {
    const catalog = new Set(DEFAULT_CAPABILITY_CATALOG);
    // Unknown names are kept verbatim so classifyCapabilities still sees
    // unknown-write and authorizeWorker still judges them — dropping them
    // would under-scope ownership for a genuine writer.
    assert.deepEqual(
      normalizeNodeCapabilities(
        { requiredCapabilities: ["filesystem.write", "made.up.cap"], role: "worker", domain: "coding" },
        catalog,
      ),
      ["filesystem.write", "made.up.cap"],
    );
    assert.deepEqual(
      normalizeNodeCapabilities({ requiredCapabilities: ["custom.tool"], domain: "coding" }, catalog),
      ["custom.tool"],
    );
  });

  it("plan() with caps-less model JSON yields non-empty caps and hybrid strategy", async () => {
    const modelJson = JSON.stringify({
      nodes: [
        { id: "n1", title: "Write A", goal: "Create .tmp/a.txt", domain: "coding", role: "worker" },
        { id: "n2", title: "Write B", goal: "Create .tmp/b.txt", domain: "coding", role: "worker", dependsOn: [] },
      ],
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ json: async () => ({ response: modelJson }) })) as unknown as typeof fetch;
    try {
      const planner = new GraphPlanner({ modelEndpoint: "http://stub", modelName: "stub" });
      const result = await planner.plan("write two files", "wf_test");
      assert.equal(result.valid, true);
      assert.equal(result.graph.nodes.length, 2);
      for (const node of result.graph.nodes) {
        assert.ok(node.requiredCapabilities.length > 0, `node ${node.id} has empty caps`);
      }
      assert.deepEqual(result.graph.nodes[0].dependencies, []);
      assert.equal(result.graph.strategy, "hybrid");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("prompt requests role, capabilities, and dependencies", () => {
    const prompt = buildPlanPrompt(["filesystem.read"]);
    assert.ok(prompt.includes("requiredCapabilities"));
    assert.ok(prompt.includes("dependencies"));
    assert.ok(prompt.includes("filesystem.read"));
    assert.ok(!prompt.includes("{{capabilityCatalog}}"));
  });

  it("uses an injected provider generator instead of the Ollama endpoint", async () => {
    const modelJson = JSON.stringify({
      nodes: [{ id: "n1", title: "Do it", goal: "Do it", domain: "coding", role: "worker" }],
    });
    let calls = 0;
    const planner = new GraphPlanner({
      generate: async () => {
        calls++;
        return modelJson;
      },
    });
    const result = await planner.plan("do it", "wf_generate");
    assert.equal(calls, 1);
    assert.equal(result.valid, true);
    assert.ok(result.graph.nodes[0].requiredCapabilities.length > 0);
  });

  it("repair retry recovers from a title-less first attempt", async () => {
    const bad = JSON.stringify({ nodes: [{ id: "n1", goal: "Do it", domain: "coding" }] });
    const good = JSON.stringify({
      nodes: [{ id: "n1", title: "Do it", goal: "Do it", domain: "coding", role: "worker" }],
    });
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: any) => {
      const body = JSON.parse(init.body);
      seen.push(body.prompt);
      const output = seen.length === 1 ? bad : good;
      return { json: async () => ({ response: output }) };
    }) as unknown as typeof fetch;
    try {
      const planner = new GraphPlanner({ modelEndpoint: "http://stub", modelName: "stub" });
      const result = await planner.plan("do it", "wf_retry");
      assert.equal(result.valid, true);
      assert.equal(seen.length, 2);
      assert.ok(seen[1].includes("missing title"));
      assert.equal(result.graph.nodes[0].title, "Do it");
      assert.ok(result.graph.nodes[0].requiredCapabilities.length > 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("gives up after the repair attempt fails too", async () => {
    const bad = JSON.stringify({ nodes: [{ id: "n1", goal: "Do it" }] });
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return { json: async () => ({ response: bad }) };
    }) as unknown as typeof fetch;
    try {
      const planner = new GraphPlanner({ modelEndpoint: "http://stub", modelName: "stub" });
      const result = await planner.plan("do it", "wf_giveup");
      assert.equal(result.valid, false);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
