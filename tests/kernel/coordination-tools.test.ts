import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCoordinationHandlers,
  COORDINATION_RUN_TOOL,
  COORDINATION_STATUS_TOOL,
  COORDINATION_LIST_TOOL,
  COORDINATION_RESULTS_TOOL,
} from "../../src/kernel/coordination-tools.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import { buildErrorMessage } from "../../src/run.js";
import type { AlixConfig } from "../../src/config/schema.js";

function testConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "test", name: "test-model" },
    permissions: {
      default: "ask",
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: "bypass",
    },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "bash", commandTimeoutMs: 1000, envAllowlist: [] },
    ui: { enabled: false, host: "127.0.0.1", port: 0, transport: "sse" },
  } as unknown as AlixConfig;
}

describe("coordination chat tools", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-tools-"));
    store = new CoordinationStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("exposes run/status/list/results handlers", () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    assert.ok(typeof handlers[COORDINATION_RUN_TOOL] === "function");
    assert.ok(typeof handlers[COORDINATION_STATUS_TOOL] === "function");
    assert.ok(typeof handlers[COORDINATION_LIST_TOOL] === "function");
    assert.ok(typeof handlers[COORDINATION_RESULTS_TOOL] === "function");
  });

  it("run rejects a missing goal without planning", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_RUN_TOOL]({});
    assert.equal(result.kind, "error");
    assert.match(result.message ?? "", /goal/);
  });

  it("plans chat coordination runs in the active parent session", async () => {
    let plannedSessionId: string | undefined;
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        plannedSessionId = sessionId;
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        await store.save(run);
        return { valid: true, errors: [], run };
      },
    } as any;
    const handlers = createCoordinationHandlers({
      cwd, config: testConfig(), store, planner, sessionId: "tui-session-1",
    });

    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "coordinate test" });

    assert.equal(result.kind, "success");
    assert.equal(plannedSessionId, "tui-session-1");
    assert.equal((await store.list())[0]?.sessionId, "tui-session-1");
  });

  it("cancels the run when the operator aborts the turn", async () => {
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        run.hostKind = "cli";
        await store.save(run);
        const queued = createWorkerAssignment({
          coordinationRunId: run.id, agentId: "alix#1", taskLabel: "queued",
          goalPrompt: "do", status: "pending", requiredCapabilities: ["filesystem.write"],
        });
        await store.addWorker(run.id, queued);
        return { valid: true, errors: [], run: { ...run, workers: [queued] } };
      },
    } as any;
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => handlers[COORDINATION_RUN_TOOL](
        { goal: "coordinate" },
        { toolCallId: "call-1", name: COORDINATION_RUN_TOOL, args: {}, signal: controller.signal } as any,
      ),
      (error: Error) => error.name === "ExecutionCancelledError",
    );

    // The run must not linger "running"/"blocked" with workers holding leases:
    // cancellation is terminal and the resume sweeps treat blocked as active.
    const runs = await store.list();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "cancelled");
    assert.equal(runs[0].workers[0].status, "cancelled");
  });

  it("reports a rejected plan as retryable with recovery steps", async () => {
    const planner = {
      plan: async () => ({
        valid: false,
        errors: ["Cannot verify explicit worker count: node n3 is an extra writer with no declared owned path"],
        graph: undefined,
        run: undefined,
      }),
    } as any;
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner });

    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "coordinate wrongly" });

    assert.equal(result.kind, "error");
    assert.match(result.message ?? "", /Coordination plan failed/);
    assert.equal(result.retryable, true);
    assert.match(result.hint ?? "", /exactly one owned path/);
    assert.match(result.hint ?? "", /auxiliary steps/);
    // The rendered message must invite a corrected retry, not forbid it.
    const rendered = buildErrorMessage(result as { kind: "error"; message: string; retryable?: boolean; hint?: string });
    assert.ok(rendered.includes("Hint:"), rendered);
    assert.ok(!rendered.includes("do not retry"), rendered);
  });

  it("reports its completed workers' owned outputs as changed files", async () => {
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        await store.save(run);
        const writer = createWorkerAssignment({
          coordinationRunId: run.id, agentId: "alix#1", taskLabel: "writer", goalPrompt: "write",
          status: "completed", ownershipScopes: [".tmp/out/a.md"],
        });
        await store.addWorker(run.id, writer);
        await store.patchWorker(run.id, writer.id, { status: "completed" });
        return { valid: true, errors: [], run: { ...run, workers: [writer] } };
      },
    } as any;
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner });

    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "write the owned file" });

    // The coordinator never mutates anything itself; this is the executed
    // evidence its workers produced, and the completion gate consumes it.
    assert.equal(result.kind, "success");
    assert.equal(result.changed, true);
    assert.deepEqual(result.changedFiles, [".tmp/out/a.md"]);
  });

  it("claims no changed files when no worker completed", async () => {
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        await store.save(run);
        return { valid: true, errors: [], run };
      },
    } as any;
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner });

    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "nothing to do" });

    assert.equal(result.kind, "success");
    assert.equal(result.changed, undefined);
    assert.equal(result.changedFiles, undefined);
  });

  it("status reports workers by status and failures", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "goal", coordinatorAgentId: "alix" });
    run.status = "failed";
    run.workers = [
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "alix#1", taskLabel: "Do A", goalPrompt: "do a",
        status: "completed", ownershipScopes: [".tmp/a.md"], planOrder: 0,
        resultRef: ".alix/coordination/results/worker_a.json",
      }),
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: "alix#2", taskLabel: "Do B", goalPrompt: "do b",
        status: "failed", error: "boom", attempt: 2, maxAttempts: 3,
      }),
    ];
    run.workers[1].dependencies = [run.workers[0].id];
    await store.save(run);

    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_STATUS_TOOL]({ runId: run.id });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /1 completed, 1 failed/);
    assert.match(result.output ?? "", /boom/);
  });

  it("status answers per-worker identity questions without reading .alix paths", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "goal", coordinatorAgentId: "alix" });
    const first = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "alix#1", taskLabel: "Project summary", goalPrompt: "do a",
      status: "completed", ownershipScopes: [".tmp/workbench-runtime-test/project.md"],
      planOrder: 0, resultRef: ".alix/coordination/results/worker_a.json",
    });
    const second = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "alix#2", taskLabel: "Final report", goalPrompt: "do b",
      status: "completed", ownershipScopes: [".tmp/workbench-runtime-test/final-report.md"],
      planOrder: 1, dependencies: [first.id],
    });
    run.workers = [first, second];
    run.status = "completed";
    await store.save(run);

    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_STATUS_TOOL]({ runId: run.id });

    assert.equal(result.kind, "success");
    const output = result.output ?? "";
    assert.match(output, /Workers \(2\):/);
    // Worker id, label, agent, status, attempt/maxAttempts, order, deps, scope, result ref.
    assert.match(output, new RegExp(`${first.id} \\| Project summary \\| agent alix#1 \\| status completed \\| attempt 0/3 \\| order 0 \\| deps - \\| writes \\.tmp/workbench-runtime-test/project\\.md \\| result \\.alix/coordination/results/worker_a\\.json`));
    assert.match(output, new RegExp(`${second.id} \\| Final report \\| agent alix#2 \\| status completed \\| attempt 0/3 \\| order 1 \\| deps ${first.id}`));
  });

  it("status errors on unknown run id", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_STATUS_TOOL]({ runId: "coord_missing" });
    assert.equal(result.kind, "error");
    assert.match(result.message ?? "", /not found/);
  });

  it("results errors on unknown run id", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_RESULTS_TOOL]({ runId: "coord_missing" });
    assert.equal(result.kind, "error");
  });

  it("list reports no runs when empty", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_LIST_TOOL]({});
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /No coordination runs/);
  });

  it("list returns recent runs newest first, bounded by limit", async () => {
    const older = createCoordinationRun({ sessionId: "s1", rootGoal: "older goal", coordinatorAgentId: "alix" });
    await store.save(older);
    await new Promise((r) => setTimeout(r, 10));
    const newer = createCoordinationRun({ sessionId: "s2", rootGoal: "newer goal", coordinatorAgentId: "alix" });
    await store.save(newer);

    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_LIST_TOOL]({ limit: 1 });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /newer goal/);
    assert.doesNotMatch(result.output ?? "", /older goal/);
  });
});
