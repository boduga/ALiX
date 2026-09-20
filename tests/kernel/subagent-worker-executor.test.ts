import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubagentManager } from "../../src/agents/subagent-manager.js";
import {
  SubagentWorkerExecutor,
  roleForWorker,
  ownedPathsForWorker,
  taskForWorker,
} from "../../src/kernel/subagent-worker-executor.js";
import type { AlixConfig, SubagentTask } from "../../src/config/schema.js";
import type { WorkerAssignment } from "../../src/kernel/coordination-types.js";
import { createWorkerAssignment } from "../../src/kernel/coordination-types.js";

const TEST_SUBAGENT_CFG: AlixConfig["subagents"] = {
  enabled: true,
  roles: [
    { role: "explorer", mode: "read_only", style: "fast", retryCount: 1 },
    { role: "researcher", mode: "read_only", style: "fast", retryCount: 1 },
    { role: "worker", mode: "write", style: "coding", retryCount: 0 },
  ],
  fast: { provider: "test", name: "test-fast" },
  coding: { provider: "test", name: "test-coding" },
  thinking: { provider: "test", name: "test-thinking" },
  critic: { provider: "test", name: "test-critic" },
};

function worker(overrides: Partial<WorkerAssignment> = {}): WorkerAssignment {
  return createWorkerAssignment({
    coordinationRunId: "coord_test",
    agentId: "alix#1",
    taskLabel: "Do",
    goalPrompt: "do it",
    requiredCapabilities: ["filesystem.read"],
    ...overrides,
  });
}

function managerWith(childJs: string): SubagentManager {
  return new SubagentManager({
    sessionId: "test-session",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: { command: process.execPath, args: ["-e", childJs] },
  });
}

const successChild = (id: string) =>
  `console.log(JSON.stringify({ id: "${id}", role: "explorer", status: "success", findings: [{ type: "summary", content: "done" }], events: [] }));`;

describe("roleForWorker", () => {
  it("maps write capabilities to worker", () => {
    assert.equal(roleForWorker(worker({ requiredCapabilities: ["filesystem.read", "filesystem.write"] })), "worker");
    assert.equal(roleForWorker(worker({ requiredCapabilities: ["shell.run"] })), "worker");
  });

  it("maps web capabilities to researcher", () => {
    assert.equal(roleForWorker(worker({ requiredCapabilities: ["web.search"] })), "researcher");
  });

  it("defaults to explorer", () => {
    assert.equal(roleForWorker(worker({ requiredCapabilities: ["filesystem.read"] })), "explorer");
    assert.equal(roleForWorker(worker({ requiredCapabilities: [] })), "explorer");
  });
});

describe("ownedPathsForWorker", () => {
  it("prefers claim paths, dedupes scopes", () => {
    assert.deepEqual(
      ownedPathsForWorker({ ownershipScopes: [".tmp/a.txt", ".tmp/a.txt"], ownershipClaims: [{ path: ".tmp/a.txt" }] } as any),
      [".tmp/a.txt"],
    );
  });
});

describe("taskForWorker", () => {
  it("builds a write task with owned paths", () => {
    const task = taskForWorker(
      worker({ id: "w1", requiredCapabilities: ["filesystem.write"], ownershipScopes: [".tmp/a.txt"] }),
      "sess-1",
      "/tmp",
    );
    assert.equal(task.role, "worker");
    assert.equal(task.mode, "write");
    assert.deepEqual(task.ownedPaths, [".tmp/a.txt"]);
    assert.ok(task.prompt.includes(".tmp/a.txt"));
    assert.equal(task.coordinationRunId, "coord_test");
    assert.equal(task.eventSessionId, "sess-1");
    assert.equal(task.assignedAgentId, "alix#1");
    assert.equal(task.taskLabel, "Do");
  });

  it("builds a read-only task without owned paths", () => {
    const task: SubagentTask = taskForWorker(worker({ id: "w2" }), "sess-1", "/tmp");
    assert.equal(task.role, "explorer");
    assert.equal(task.mode, "read_only");
    assert.equal(task.ownedPaths, undefined);
  });
});

describe("SubagentWorkerExecutor", () => {
  it("maps a successful child to success with findings summary", async () => {
    const executor = new SubagentWorkerExecutor({ manager: managerWith(successChild("w1")) });
    const result = await executor.execute(
      worker({ id: "w1" }),
      { run: {} as any, sessionId: "sess-1", cwd: "/tmp", config: {} as AlixConfig },
      new AbortController().signal,
    );
    assert.equal(result.outcome, "success");
    assert.match(result.summary ?? "", /done/);
  });

  it("runs two workers in parallel through one manager", async () => {
    const delayed = `await new Promise(r => setTimeout(r, 400)); console.log(JSON.stringify({ status: "success", findings: [], events: [] }));`;
    const executor = new SubagentWorkerExecutor({ manager: managerWith(delayed) });
    const ctx = { run: {} as any, sessionId: "sess-1", cwd: "/tmp", config: {} as AlixConfig };
    const pending = Promise.all([
      executor.execute(worker({ id: "pa" }), ctx, new AbortController().signal),
      executor.execute(worker({ id: "pb" }), ctx, new AbortController().signal),
    ]);
    // Deterministic overlap proof: both children tracked before either resolves.
    await new Promise((r) => setImmediate(r));
    assert.equal((executor.subagentManager as unknown as { running: Map<string, unknown> }).running.size, 2);
    const [a, b] = await pending;
    assert.equal(a.outcome, "success");
    assert.equal(b.outcome, "success");
  });

  it("aborted signal cancels the child", async () => {
    const hanging = `setInterval(() => {}, 1000);`;
    const executor = new SubagentWorkerExecutor({ manager: managerWith(hanging) });
    const controller = new AbortController();
    const pending = executor.execute(
      worker({ id: "wc" }),
      { run: {} as any, sessionId: "sess-1", cwd: "/tmp", config: {} as AlixConfig },
      controller.signal,
    );
    await new Promise(r => setTimeout(r, 100));
    controller.abort();
    const result = await pending;
    assert.equal(result.outcome, "failure");
    assert.equal(result.failureKind, "cancelled");
  });

  it("returns cancelled without spawning when already aborted", async () => {
    const executor = new SubagentWorkerExecutor({ manager: managerWith(successChild("w9")) });
    const controller = new AbortController();
    controller.abort();
    const result = await executor.execute(
      worker({ id: "w9" }),
      { run: {} as any, sessionId: "sess-1", cwd: "/tmp", config: {} as AlixConfig },
      controller.signal,
    );
    assert.equal(result.outcome, "failure");
    assert.equal(result.failureKind, "cancelled");
  });
});
