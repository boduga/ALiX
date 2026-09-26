import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CoordinationPlanner, DOMAIN_SCOPE_MAP, extractGoalPaths, inferOwnershipScopes } from "../../src/kernel/coordination-planner.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { TaskGraphPlanner } from "../../src/kernel/coordination-planner.js";
import type { TaskGraph, TaskNode } from "../../src/kernel/task-graph.js";
import type { ToolRegistry } from "../../src/tools/tool-registry.js";

function makeNode(id: string, dependencies: string[] = [], overrides: Partial<TaskNode> = {}): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId: "test", title: `Node ${id}`, goal: `Do ${id}`,
    domain: "coding", status: "pending", dependencies,
    requiredCapabilities: ["file.create"],
    riskLevel: "low", approvalMode: "auto",
    inputs: {}, artifacts: [], memoryRefs: [],
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function makeGraph(nodes: TaskNode[]): TaskGraph {
  const now = new Date().toISOString();
  return {
    id: `graph_${randomUUID()}`, schemaVersion: "1.0", workflowId: `wf_${randomUUID()}`,
    rootGoal: "Test", status: "draft", strategy: "sequential",
    nodes, edges: [], createdAt: now, updatedAt: now,
  };
}

function makeMockPlanner(graph: TaskGraph, valid = true, errors: string[] = []): TaskGraphPlanner {
  return {
    plan: async () => ({ graph, rawModelOutput: JSON.stringify(graph), valid, errors }),
  };
}

describe("CoordinationPlanner", () => {
  let cwd: string;
  let store: CoordinationStore;
  let registry: ToolRegistry;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coordination-planner-"));
    store = new CoordinationStore(cwd);
    registry = buildDefaultToolIndex().registry;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates workers from a valid graph", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, true);
    assert.equal(result.run!.workers.length, 2);
  });

  it("round-robins the configured agent pool", async () => {
    const planner = new CoordinationPlanner(cwd, { agentPool: ["agent-a", "agent-b"] }, { store, planner: makeMockPlanner(makeGraph([makeNode("x"), makeNode("y"), makeNode("z")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers.map(w => w.agentId), ["agent-a", "agent-b", "agent-a"]);
  });

  it("labels workers distinctly when pool is empty", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers.map(w => w.agentId), ["coordinator#1", "coordinator#2"]);
  });

  it("blocks invalid planner result", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")]), false, ["model failed"]), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
    assert.equal(result.run!.workers[0].status, "blocked");
  });

  it("blocks a cyclic graph", async () => {
    const graph = makeGraph([makeNode("a", ["b"]), makeNode("b", ["a"])]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
  });

  it("blocks a planner exception", async () => {
    const throwingPlanner: TaskGraphPlanner = { plan: async () => { throw new Error("timeout"); } };
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: throwingPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("timeout")));
  });

  it("assigns ownership scopes by domain", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("coding-node", [], { domain: "coding" }),
      makeNode("docs-node", [], { domain: "docs" }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, DOMAIN_SCOPE_MAP.coding);
    assert.deepEqual(result.run!.workers[1].ownershipScopes, DOMAIN_SCOPE_MAP.docs);
  });

  it("assigns no scopes to confirmed read-only tasks", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("read", [], { requiredCapabilities: ["file.read"] }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, []);
  });

  it("links a relative persisted graph reference", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.ok(result.run!.taskGraphId);
    assert.ok(result.run!.taskGraphRef);
    assert.equal(result.run!.taskGraphRef!.startsWith("/"), false);
    assert.ok(existsSync(join(cwd, result.run!.taskGraphRef!)));
  });

  it("persists the coordination run for reload", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a")])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const loaded = await store.load(result.run!.id);
    assert.ok(loaded);
    assert.equal(loaded.id, result.run!.id);
  });

  it("keeps valid decomposition in planning status", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([makeNode("a"), makeNode("b", ["a"])])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, true);
    assert.equal(result.run!.status, "planning");
  });

  it("remaps node dependencies to worker IDs", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("research"), makeNode("write", ["research"]), makeNode("verify", ["write"]),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const workers = result.run!.workers;
    assert.deepEqual(workers[1].dependencies, [workers[0].id]);
    assert.deepEqual(workers[2].dependencies, [workers[1].id]);
  });

  it("read-only node with an unknown capability claims no ownership", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("unknown", [], { domain: "unknown", requiredCapabilities: ["custom.tool"] }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    // roleForWorker(["custom.tool"]) is explorer → read-only → no write scopes,
    // so the planner must not over-reserve workspace-wide ownership.
    assert.deepEqual(result.run!.workers[0].ownershipScopes, []);
  });

  it("unknown capability does not force workspace-wide ownership on a read-only node", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("unknown", [], { domain: "coding", requiredCapabilities: ["custom.tool"] }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, []);
  });

  it("known writer with an extra unknown capability still claims goal scopes", async () => {
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(makeGraph([
      makeNode("writer", [], {
        goal: "Create `.tmp/w.txt`",
        requiredCapabilities: ["filesystem.write", "custom.tool"],
      }),
    ])), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers[0].ownershipScopes, [".tmp/w.txt"]);
  });

  it("does not persist unsafe graph IDs", async () => {
    const graph = { ...makeGraph([makeNode("a")]), id: "../../outside" };
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph, false, ["invalid output"]), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.taskGraphRef, undefined);
    assert.ok(result.errors.some(e => e.includes("Unsafe graph ID")));
  });

  it("persists invalid planner graph when structurally safe", async () => {
    const graph = makeGraph([makeNode("a")]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph, false, ["model failed"]), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.run!.taskGraphId, graph.id);
    assert.ok(result.run!.taskGraphRef);
    assert.ok(existsSync(join(cwd, result.run!.taskGraphRef!)));
  });

  it("persists cyclic graphs with safe IDs for diagnosis", async () => {
    const graph = makeGraph([makeNode("a", ["b"]), makeNode("b", ["a"])]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.taskGraphId, graph.id);
    assert.ok(result.run!.taskGraphRef);
  });

  it("blocks malformed graph data without throwing", async () => {
    const malformedPlanner = { plan: async () => ({
      graph: { id: "graph-safe", nodes: undefined },
      rawModelOutput: "{}", valid: true, errors: [],
    }) } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: malformedPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
    assert.ok(result.errors.some(e => e.includes("nodes must be an array")));
  });

  it("blocks planner returning null", async () => {
    const malformedPlanner = { plan: async () => null } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: malformedPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("malformed result")));
  });

  it("blocks planner result missing graph", async () => {
    const malformedPlanner = { plan: async () => ({
      rawModelOutput: "", valid: false, errors: [],
    }) } as unknown as TaskGraphPlanner;
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: malformedPlanner, toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, false);
    assert.equal(result.run!.status, "blocked");
  });

  it("normalizes caps-less model nodes to non-empty read-only caps", async () => {
    const graph = makeGraph([
      makeNode("a", [], { requiredCapabilities: [] }),
      makeNode("b", [], { requiredCapabilities: ["not.a.real.cap"] }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, true);
    for (const worker of result.run!.workers) {
      assert.ok(worker.requiredCapabilities.length > 0, `worker ${worker.id} has empty caps`);
    }
    // Node "a" is coding domain with no role: domain default (read-only).
    const capsA = result.run!.workers.find(w => w.sourceNodeId === "a")!.requiredCapabilities;
    assert.deepEqual(capsA, ["filesystem.read"]);
  });

  it("extractGoalPaths finds quoted file paths, skips prose", () => {
    assert.deepEqual(
      extractGoalPaths("Create `.tmp/a.txt` containing 'B done' owning `.tmp/a.txt`"),
      [".tmp/a.txt"],
    );
    assert.deepEqual(extractGoalPaths("Search sources and analyze findings"), []);
    assert.deepEqual(extractGoalPaths("Fetch https://example.com/x.json soon"), []);
  });

  it("extractGoalPaths finds bare unquoted paths", () => {
    assert.deepEqual(
      extractGoalPaths("Create .tmp/pool-e.txt containing exactly E done owning .tmp/pool-e.txt"),
      [".tmp/pool-e.txt"],
    );
    assert.deepEqual(
      extractGoalPaths("Implement validation in src/auth/login.ts and cover it"),
      ["src/auth/login.ts"],
    );
  });

  it("prefers goal paths over domain scopes for writers", async () => {
    const graph = makeGraph([
      makeNode("a", [], {
        goal: "Create `.tmp/a.txt`",
        requiredCapabilities: ["filesystem.write"],
      }),
      makeNode("b", [], {
        goal: "Create `.tmp/b.txt`",
        requiredCapabilities: ["filesystem.write"],
      }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.equal(result.valid, true);
    const scopes = result.run!.workers.map(w => w.ownershipScopes);
    assert.deepEqual(scopes[0], [".tmp/a.txt"]);
    assert.deepEqual(scopes[1], [".tmp/b.txt"]);
    assert.deepEqual(result.run!.workers.map(worker => worker.dependencies), [[], []]);
  });

  it("preserves explicit root ownership when model shortens four worker goals", async () => {
    const base = ".tmp/workbench-e2e-manual-20260923";
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create project.md by reading package.json and README.md" }),
      makeNode("n2", [], { goal: "Create tui.md summarizing src/tui/workbench/" }),
      makeNode("n3", [], { goal: "Create tests.md summarizing tests/tui/workbench/" }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: "Read project.md, tui.md, tests.md, then create final-report.md" }),
    ]);
    const goal = [
      `Worker 1: Create project.md. Own ONLY: ${base}/project.md`,
      `Worker 2: Create tui.md. Own ONLY: ${base}/tui.md`,
      `Worker 3: Create tests.md. Own ONLY: ${base}/tests.md`,
      `Worker 4: Create final-report.md. Own ONLY: ${base}/final-report.md`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true);
    assert.deepEqual(result.run!.workers.map(w => w.ownershipScopes), [
      [`${base}/project.md`], [`${base}/tui.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    const [first, second, third, fourth] = result.run!.workers;
    assert.deepEqual([first.dependencies, second.dependencies, third.dependencies], [[], [], []]);
    assert.deepEqual(fourth.dependencies, [first.id, second.id, third.id]);
    assert.match(fourth.goalPrompt, /Input paths:\n- \.tmp\/workbench-e2e-manual-20260923\/project\.md\n- \.tmp\/workbench-e2e-manual-20260923\/tui\.md\n- \.tmp\/workbench-e2e-manual-20260923\/tests\.md/);
    assert.deepEqual((fourth as unknown as { inputPaths?: string[] }).inputPaths, [
      `${base}/project.md`, `${base}/tui.md`, `${base}/tests.md`,
    ]);
    const stored = await store.load(result.run!.id);
    assert.deepEqual(stored!.workers[3].inputPaths, [
      `${base}/project.md`, `${base}/tui.md`, `${base}/tests.md`,
    ]);
  });

  it("preserves natural-language ownership and dependencies from a four-worker request", async () => {
    const base = ".tmp/workbench-e2e-manual-20260923";
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create project.md from package.json and README.md", domain: "docs" }),
      makeNode("n2", [], { goal: "Create tui.md summarizing src/tui/workbench/", domain: "docs" }),
      makeNode("n3", [], { goal: "Create tests.md summarizing tests/tui/workbench/", domain: "docs" }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: "Create final-report.md", domain: "docs" }),
    ]);
    const goal = [
      "Use exactly four workers.",
      `Worker 1 — owns ONLY ${base}/project.md`,
      `Worker 2 — owns ONLY ${base}/tui.md`,
      `Worker 3 — owns ONLY ${base}/tests.md`,
      `Worker 4 — depends on Workers 1, 2, and 3; owns ONLY ${base}/final-report.md`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true);
    assert.deepEqual(result.run!.workers.map(w => w.ownershipScopes), [
      [`${base}/project.md`], [`${base}/tui.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    const workers = result.run!.workers;
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(w => w.id));
  });

  it("maps numbered-list output paths when worker goals describe research before writing", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Inspect ./package.json and write a short project summary to ${base}/project.md` }),
      makeNode("n2", [], { goal: `Inspect src/tui/workbench and summarize its architecture to ${base}/workbench.md` }),
      makeNode("n3", [], { goal: `Inspect tests/tui/workbench and summarize its test coverage to ${base}/tests.md` }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: `Read ${base}/project.md, ${base}/workbench.md, and ${base}/tests.md, then combine them into ${base}/final-report.md` }),
    ]);
    const goal = [
      "Launch exactly four coordinated workers:",
      `1. Worker “Project summary” — Own only \`${base}/project.md\`; inspect package.json and write a summary.`,
      `2. Worker “Workbench summary” — Own only \`${base}/workbench.md\`; inspect src/tui/workbench and summarize it.`,
      `3. Worker “Workbench tests” — Own only \`${base}/tests.md\`; inspect tests/tui/workbench and summarize coverage.`,
      `4. Worker “Final report” — Own only \`${base}/final-report.md\`; depend on workers 1, 2, and 3; read their outputs and combine them.`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.deepEqual(workers.map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(worker => worker.id));
  });

  it("ignores prose after an ownership clause and still maps named worker sections", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Inspect the repository's package.json and write a short project summary containing name, purpose, and dependencies to ${base}/project.md.` }),
      makeNode("n2", [], { goal: `Inspect src/tui/workbench and its subdirectories, then write an architecture summary to ${base}/workbench.md.` }),
      makeNode("n3", [], { goal: `Inspect tests/tui/workbench and write a coverage summary to ${base}/tests.md.` }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: `Read project.md, workbench.md, and tests.md, combine them into ${base}/final-report.md, and verify that all four files exist.`, domain: "docs" }),
    ]);
    const goal = [
      `Run exactly four coordinated workers writing into ${base}/, with disjoint single-file ownership and one dependency.`,
      "",
      "Deliverables and ownership (each worker owns ONLY its one file):",
      `1. Worker “Project summary” — owns only ${base}/project.md. Inspect the repository's package.json and write a short summary.`,
      `2. Worker “Workbench summary” — owns only ${base}/workbench.md. Inspect src/tui/workbench and summarize its architecture.`,
      `3. Worker “Workbench tests” — owns only ${base}/tests.md. Inspect tests/tui/workbench and summarize its coverage.`,
      `4. Worker “Final report” — owns only ${base}/final-report.md. DEPENDS ON workers 1, 2, and 3. Read their outputs and combine them.`,
      "",
      "Execution constraints:",
      "- Workers 1, 2, and 3 must run in parallel.",
      "- Worker 4 must start only after workers 1, 2, and 3 complete successfully.",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.deepEqual(workers.map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(worker => worker.id));
  });

  it("matches an output stated with the preposition in", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Read package.json at the repo root and write a project summary into ${base}/project.md` }),
      makeNode("n2", [], { goal: `Inspect src/tui/workbench and summarize its architecture into ${base}/workbench.md` }),
      makeNode("n3", [], { goal: `Inspect tests/tui/workbench and summarize its coverage into ${base}/tests.md` }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: `Read ${base}/project.md, ${base}/workbench.md, and ${base}/tests.md, then combine them into a final report in ${base}/final-report.md`, domain: "docs" }),
    ]);
    const goal = [
      `Create exactly four coordinated workers that each write one file under ${base}/.`,
      `Worker 1 — name "Project summary" — owns ONLY ${base}/project.md.`,
      `Worker 2 — name "Workbench summary" — owns ONLY ${base}/workbench.md.`,
      `Worker 3 — name "Workbench tests" — owns ONLY ${base}/tests.md.`,
      `Worker 4 — name "Final report" — owns ONLY ${base}/final-report.md. This worker DEPENDS ON workers 1, 2, and 3.`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.deepEqual(workers.map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(worker => worker.id));
  });

  it("parses `owns only the file X` without claiming inputs named later in the sentence", async () => {
    const base = ".tmp/ownership-clause";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Create the directory ${base}/ if it does not exist`, requiredCapabilities: ["shell.run"], domain: "infra" }),
      makeNode("n2", ["n1"], { goal: `Read CONTEXT.md and write a short glossary of domain terms to ${base}/notes.md.` }),
      makeNode("n3", ["n1"], { goal: `Read docs/post-mvp-backlog.md and write the open risks to ${base}/risks.md.` }),
      makeNode("n4", ["n2", "n3"], { goal: `Read ${base}/notes.md and ${base}/risks.md and combine them into ${base}/merged.md.`, domain: "docs" }),
    ]);
    const goal = [
      "Run a four-worker ownership probe.",
      `1. Worker "Prep" — directory-prep step: create the directory \`${base}/\` only; owns no file. Runs first.`,
      `2. Worker "Notes" — owns only the file \`${base}/notes.md\`; read CONTEXT.md and write a short glossary of domain terms.`,
      `3. Worker "Risks" — owns only the file \`${base}/risks.md\`; read \`docs/post-mvp-backlog.md\` and list the open risks.`,
      `4. Worker "Merge" — owns only the file \`${base}/merged.md\`; depends on Workers 2 and 3; combine their two files.`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    // Each writer owns exactly its output: the inputs read earlier in the same
    // sentence (CONTEXT.md, docs/post-mvp-backlog.md) are not ownership claims.
    assert.deepEqual(workers.slice(1).map(worker => worker.ownershipScopes), [
      [`${base}/notes.md`], [`${base}/risks.md`], [`${base}/merged.md`],
    ]);
    assert.deepEqual(workers[0].ownershipScopes, [base]);
  });

  it("blocks an ownership clause that names no workspace path", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create first.md" }),
      makeNode("n2", [], { goal: "Create second.md" }),
    ]);
    const goal = [
      "Use exactly two workers.",
      "Worker 1: Create first.md. Owns only whatever it needs",
      "Worker 2: Create second.md. Own only .tmp/second.md",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, false);
    assert.equal(result.run?.status, "blocked");
    assert.match(result.errors.join("; "), /names no workspace path/);
    assert.match(result.errors.join("; "), /whatever it needs/);
  });

  it("plans directory prep and verification beside exactly four owned writers", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Create the directory ${base}/ if it does not already exist`, requiredCapabilities: ["shell.run"], domain: "infra" }),
      makeNode("n2", ["n1"], { goal: `Inspect package.json and write a short project summary to ${base}/project.md, owning only that file` }),
      makeNode("n3", ["n1"], { goal: `Inspect src/tui/workbench and write an architecture summary to ${base}/workbench.md, owning only that file` }),
      makeNode("n4", ["n1"], { goal: `Inspect tests/tui/workbench and write a coverage summary to ${base}/tests.md, owning only that file` }),
      makeNode("n5", ["n2", "n3", "n4"], { goal: `Read ${base}/project.md, ${base}/workbench.md, and ${base}/tests.md and combine them into ${base}/final-report.md, owning only that file`, domain: "docs" }),
      makeNode("n6", ["n5"], { goal: `Verify that ${base}/project.md, ${base}/workbench.md, ${base}/tests.md, and ${base}/final-report.md all exist`, requiredCapabilities: ["file.exists"], domain: "infra" }),
    ]);
    const goal = [
      `Create \`${base}/\`.`,
      "",
      "Launch exactly four coordinated workers:",
      `1. Worker “Project summary” — Own only \`${base}/project.md\``,
      `2. Worker “Workbench summary” — Own only \`${base}/workbench.md\``,
      `3. Worker “Workbench tests” — Own only \`${base}/tests.md\``,
      `4. Worker “Final report” — Own only \`${base}/final-report.md\` — Depend on workers 1, 2, and 3.`,
      "",
      "Verify all four files exist before claiming success.",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.equal(workers.length, 6);
    // The four declared paths stay with the four workers the goal names…
    assert.deepEqual(workers.slice(1, 5).map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    // …directory prep is scoped to the directory it creates, not to broad
    // domain defaults, and verification (read-only) claims nothing.
    assert.deepEqual(workers[0].ownershipScopes, [base]);
    assert.deepEqual(workers[5].ownershipScopes, []);
    const finalReport = workers[4];
    assert.deepEqual(finalReport.dependencies, workers.slice(1, 4).map(worker => worker.id));
  });

  it("blocks an extra writer that names an undeclared output", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create first.md" }),
      makeNode("n2", [], { goal: "Create second.md" }),
      makeNode("n3", [], { goal: "Create extra.md" }),
    ]);
    const goal = [
      "Use exactly two workers.",
      "Worker 1: Create first.md. Own only .tmp/first.md",
      "Worker 2: Create second.md. Own only .tmp/second.md",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, false);
    assert.equal(result.run?.status, "blocked");
    assert.match(result.errors.join("; "), /Cannot verify explicit worker count/);
    assert.match(result.errors.join("; "), /n3/);
  });

  it("resolves a bare-filename claim against the node goal that names it", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Read package.json and write ${base}/project.md with a short project summary.` }),
      makeNode("n2", [], { goal: `Inspect src/tui/workbench and write ${base}/workbench.md summarizing its architecture.` }),
      makeNode("n3", [], { goal: `Inspect tests/tui/workbench and write ${base}/tests.md summarizing its coverage.` }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: `Read ${base}/project.md, workbench.md, and tests.md and combine them into ${base}/final-report.md.`, domain: "docs" }),
    ]);
    const goal = [
      `Produce four markdown files inside ${base}/ using four coordinated workers with disjoint ownership.`,
      "Worker 1 (Project summary): writes project.md — read package.json and write a short project summary. Owns only project.md.",
      "Worker 2 (Workbench summary): writes workbench.md — inspect src/tui/workbench and summarize its architecture. Owns only workbench.md.",
      "Worker 3 (Workbench tests): writes tests.md — inspect tests/tui/workbench and summarize its coverage. Owns only tests.md.",
      "Worker 4 (Final report): writes final-report.md — depends on Worker 1, Worker 2 and Worker 3; read their three output files and combine them. Owns only final-report.md.",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.deepEqual(workers.map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(worker => worker.id));
  });

  it("treats exclusive owned-path wording as an exact write boundary", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Read package.json and write a project summary to ${base}/project.md`, domain: "docs" }),
      makeNode("n2", [], { goal: `Read src/tui/workbench and write an architecture summary to ${base}/workbench.md`, domain: "docs" }),
      makeNode("n3", [], { goal: `Read tests/tui/workbench and write a coverage summary to ${base}/tests.md`, domain: "docs" }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: `Read ${base}/project.md, ${base}/workbench.md, and ${base}/tests.md, then write ${base}/final-report.md`, domain: "docs" }),
    ]);
    const goal = [
      "Produce four files using exactly four workers.",
      `Worker 1 — name Project summary. Exclusive owned path: ${base}/project.md.`,
      `Worker 2 — name Workbench summary. Exclusive owned path: ${base}/workbench.md.`,
      `Worker 3 — name Workbench tests. Exclusive owned path: ${base}/tests.md.`,
      `Worker 4 — name Final report. Dependencies: Workers 1, 2, and 3. Exclusive owned path: ${base}/final-report.md.`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.deepEqual(workers.map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(worker => worker.id));
  });

  it("maps owned path only wording with an explicit dependency edge", async () => {
    const base = ".tmp/workbench-runtime-test";
    const graph = makeGraph([
      makeNode("n1", [], { goal: `Read package.json and write a project summary to ${base}/project.md`, domain: "docs" }),
      makeNode("n2", [], { goal: `Read src/tui/workbench and write an architecture summary to ${base}/workbench.md`, domain: "docs" }),
      makeNode("n3", [], { goal: `Read tests/tui/workbench and write a coverage summary to ${base}/tests.md`, domain: "docs" }),
      makeNode("n4", ["n1", "n2", "n3"], { goal: `Read ${base}/project.md, ${base}/workbench.md, and ${base}/tests.md, then write ${base}/final-report.md`, domain: "docs" }),
    ]);
    const goal = [
      "Populate the directory using exactly four workers.",
      `Worker 1 — owned path ONLY ${base}/project.md.`,
      `Worker 2 — owned path ONLY ${base}/workbench.md.`,
      `Worker 3 — owned path ONLY ${base}/tests.md.`,
      `Worker 4 — owned path ONLY ${base}/final-report.md. It DEPENDS ON workers 1, 2, and 3.`,
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true, result.errors.join("; "));
    const workers = result.run!.workers;
    assert.deepEqual(workers.map(worker => worker.ownershipScopes), [
      [`${base}/project.md`], [`${base}/workbench.md`], [`${base}/tests.md`], [`${base}/final-report.md`],
    ]);
    assert.deepEqual(workers[3].dependencies, workers.slice(0, 3).map(worker => worker.id));
  });

  it("blocks a two-worker request when the model adds a third worker", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create first.md" }),
      makeNode("n2", [], { goal: "Create second.md" }),
      makeNode("n3", [], { goal: "Create extra.md" }),
    ]);
    const goal = [
      "Use exactly two workers.",
      "Worker 1: Create first.md. Own only .tmp/first.md",
      "Worker 2: Create second.md. Own only .tmp/second.md",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, false);
    assert.equal(result.run?.status, "blocked");
    assert.match(result.errors.join("; "), /two|2|count/i);
  });

  it("accepts a two-worker request with its stated ownership and dependency", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create first.md" }),
      makeNode("n2", ["n1"], { goal: "Create second.md" }),
    ]);
    const goal = [
      "Use exactly two workers.",
      "Worker 1: Create first.md. Own only .tmp/first.md",
      "Worker 2: Depend on Worker 1. Create second.md. Own only .tmp/second.md",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true);
    assert.deepEqual(result.run!.workers.map(w => w.ownershipScopes), [[".tmp/first.md"], [".tmp/second.md"]]);
    assert.deepEqual(result.run!.workers[1].dependencies, [result.run!.workers[0].id]);
  });

  it("allows an unowned read-only worker beside an explicitly owned writer", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Inspect package.json", requiredCapabilities: ["file.read"] }),
      makeNode("n2", [], { goal: "Create report.md" }),
    ]);
    const goal = [
      "Use exactly two workers.",
      "Worker 1: Inspect package.json.",
      "Worker 2: Create report.md. Own only .tmp/report.md",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, true);
    assert.deepEqual(result.run!.workers.map(w => w.ownershipScopes), [[], [".tmp/report.md"]]);
  });

  it("matches an explicit output when a node goal ends with sentence punctuation", async () => {
    const graph = makeGraph([makeNode("n1", [], { goal: "Create report.md." })]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan("Worker 1: Create report.md. Own only .tmp/report.md", "coordinator", "session-1");

    assert.equal(result.valid, true);
    assert.deepEqual(result.run!.workers[0].ownershipScopes, [".tmp/report.md"]);
  });

  it("blocks dispatch when a stated dependency is absent from the graph", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create first.md" }),
      makeNode("n2", [], { goal: "Create second.md" }),
    ]);
    const goal = [
      "Worker 1: Create first.md. Own ONLY: .tmp/first.md",
      "Worker 2: Depend on Worker 1. Create second.md. Own ONLY: .tmp/second.md",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, false);
    assert.equal(result.run?.status, "blocked");
    assert.match(result.errors.join("; "), /depend/i);
  });

  it("blocks an explicit dependency that cannot be mapped to worker nodes", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Inspect package.json", requiredCapabilities: ["file.read"] }),
      makeNode("n2", [], { goal: "Summarize findings", requiredCapabilities: ["file.read"] }),
    ]);
    const goal = [
      "Use exactly two workers.",
      "Worker 1: Inspect package.json.",
      "Worker 2: Depend on Worker 1. Summarize findings.",
    ].join("\n");
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan(goal, "coordinator", "session-1");

    assert.equal(result.valid, false);
    assert.equal(result.run?.status, "blocked");
    assert.match(result.errors.join("; "), /depend/i);
  });

  it("blocks a read-only worker assigned an explicit output", async () => {
    const graph = makeGraph([
      makeNode("n1", [], { goal: "Create report.md", requiredCapabilities: ["filesystem.read"] }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });

    const result = await planner.plan("Worker 1: Create report.md. Own ONLY: .tmp/report.md", "coordinator", "session-1");

    assert.equal(result.valid, false);
    assert.equal(result.run?.status, "blocked");
  });

  it("serializes vague writers with overlapping ownership in deterministic plan order", async () => {
    const graph = makeGraph([
      makeNode("a", [], { goal: "Improve validation", requiredCapabilities: ["filesystem.write"] }),
      makeNode("b", [], { goal: "Improve error handling", requiredCapabilities: ["filesystem.write"] }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const [first, second] = result.run!.workers;
    assert.deepEqual(first.dependencies, []);
    assert.deepEqual(second.dependencies, [first.id]);
    assert.ok(!second.goalPrompt.includes("Input paths:"), "ordering dependencies must not invent input files");
  });

  it("does not serialize vague read-only workers", async () => {
    const graph = makeGraph([
      makeNode("a", [], { goal: "Inspect validation", requiredCapabilities: ["filesystem.read"] }),
      makeNode("b", [], { goal: "Inspect error handling", requiredCapabilities: ["filesystem.read"] }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    assert.deepEqual(result.run!.workers.map(worker => worker.dependencies), [[], []]);
  });

  it("orders an ambiguous writer after an explicit-path writer whose claim it overlaps", async () => {
    const graph = makeGraph([
      makeNode("explicit", [], { goal: "Edit `src/foo.ts`", requiredCapabilities: ["filesystem.write"] }),
      makeNode("vague", [], { goal: "Improve the codebase", domain: "coding", requiredCapabilities: ["filesystem.write"] }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const explicit = result.run!.workers.find(w => w.sourceNodeId === "explicit")!;
    const vague = result.run!.workers.find(w => w.sourceNodeId === "vague")!;
    assert.deepEqual(explicit.ownershipScopes, ["src/foo.ts"]);
    assert.deepEqual(vague.ownershipScopes, ["src/**", "tests/**", "package.json", "package-lock.json"]);
    // The vague `src/**` claim overlaps the explicit `src/foo.ts` claim, so
    // the vague writer is ordered after it instead of running concurrently.
    assert.ok(vague.dependencies.includes(explicit.id));
  });

  it("persists host metadata and concurrency before the run is saved", async () => {
    const graph = makeGraph([makeNode("a")]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1", {
      hostKind: "inspector",
      sessionMode: "bypass",
      maxConcurrency: 5,
    });
    const loaded = await store.load(result.run!.id);
    assert.equal(loaded!.hostKind, "inspector");
    assert.equal(loaded!.sessionMode, "bypass");
    assert.equal(loaded!.maxConcurrency, 5);
  });

  it("does not duplicate an existing ordering dependency", async () => {
    const graph = makeGraph([
      makeNode("a", [], { goal: "Improve validation", requiredCapabilities: ["filesystem.write"] }),
      makeNode("b", ["a"], { goal: "Improve error handling", requiredCapabilities: ["filesystem.write"] }),
    ]);
    const planner = new CoordinationPlanner(cwd, {}, { store, planner: makeMockPlanner(graph), toolRegistry: registry });
    const result = await planner.plan("Test", "coordinator", "session-1");
    const [first, second] = result.run!.workers;
    assert.deepEqual(second.dependencies, [first.id]);
  });
});
