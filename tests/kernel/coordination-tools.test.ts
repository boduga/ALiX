import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCancelFailureRecorder,
  createCancelGuard,
  createCoordinationHandlers,
  COORDINATION_RUN_TOOL,
  COORDINATION_STATUS_TOOL,
  COORDINATION_LIST_TOOL,
  COORDINATION_RESULTS_TOOL,
} from "../../src/coordination/kernel/coordination-tools.js";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";
import { buildErrorMessage } from "../../src/run.js";
import type { AlixConfig } from "../../src/operations/config/schema.js";

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

  it("aborts a running worker end-to-end and leaves no lease held", async () => {
    // The gap `deps.executor` closes. Every existing cancel test aborts BEFORE
    // the call, which takes `signal.aborted` at the top of `handleCoordinationRun`
    // and never reaches the abort LISTENER, a worker actually executing, or the
    // in-flight `cancellation()` await. So the branches that decide whether a
    // cancelled run leaves leases held were only covered by unit tests of
    // `createCancelGuard` — which cannot see the scheduler at all.
    //
    // This drives the real entry point with a worker mid-execution.
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const workerStarted = new Promise<void>(resolve => { started = resolve; });
    let aborted = false;
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        run.hostKind = "cli";
        await store.save(run);
        const queued = createWorkerAssignment({
          coordinationRunId: run.id, agentId: "alix#1", taskLabel: "slow",
          goalPrompt: "do", status: "pending", requiredCapabilities: ["filesystem.write"],
        });
        await store.addWorker(run.id, queued);
        return { valid: true, errors: [], run: { ...run, workers: [queued] } };
      },
    } as any;
    const executor = {
      execute: async (_worker: unknown, _context: unknown, signal: AbortSignal) => {
        observedSignal = signal;
        started();
        // Hold the worker open until the abort lands, exactly as a real
        // long-running execution would be.
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
        });
        return { outcome: "failure" as const, error: "aborted" };
      },
    };
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner, executor });
    const controller = new AbortController();

    const pending = handlers[COORDINATION_RUN_TOOL](
      { goal: "coordinate a slow worker" },
      { toolCallId: "call-e2e", name: COORDINATION_RUN_TOOL, args: {}, signal: controller.signal } as any,
    );
    // Abort only once the worker is genuinely mid-execution.
    await workerStarted;
    controller.abort();

    await assert.rejects(
      () => pending,
      (error: Error) => error.name === "ExecutionCancelledError",
    );

    // The worker's own signal must have been aborted, not just the caller's —
    // that is what stops a real child process.
    assert.equal(aborted, true, "worker execution signal should be aborted");
    assert.ok(observedSignal, "the executor should have received a signal");

    // Terminal state, and no lease survives: `cancelRun` releases ownership
    // before marking the worker cancelled, and a run left `running` with a
    // held lease is invisible to the reclaim sweeps.
    const runs = await store.list();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "cancelled");
    for (const worker of runs[0].workers) {
      assert.equal(worker.status, "cancelled");
      assert.deepEqual(worker.leaseIds ?? [], [], "a cancelled worker must hold no lease");
    }
  });

  it("records coordination.cancel.failed when the run cannot be finalized", async () => {
    // The record that proves a cancel did not complete. Without it a failed
    // cancel and a successful one are indistinguishable, and the run stays
    // `running` under an owner the reclaim sweeps will not touch.
    const appended: Array<{ type: string; payload: unknown }> = [];
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
    const failingStore = {
      load: async () => { throw new Error("store unavailable"); },
      updateRun: async () => { throw new Error("store unavailable"); },
      patchWorker: async () => { throw new Error("store unavailable"); },
      save: async () => {},
      addWorker: async () => {},
      list: async () => [],
    } as unknown as CoordinationStore;
    const handlers = createCoordinationHandlers({
      cwd,
      config: testConfig(),
      store: failingStore,
      planner,
      sessionId: "s1",
      eventLog: {
        append: async (event: { type: string; payload: unknown }) => { appended.push(event); },
        readAll: async () => [],
      } as any,
    });

    const controller = new AbortController();
    controller.abort();

    // The turn still reports a cancellation rather than surfacing a store
    // error — but the failure is on the record.
    await assert.rejects(
      () => handlers[COORDINATION_RUN_TOOL](
        { goal: "coordinate" },
        { toolCallId: "call-fail", name: COORDINATION_RUN_TOOL, args: {}, signal: controller.signal } as any,
      ),
      (error: Error) => error.name === "ExecutionCancelledError",
    );

    const recorded = appended.filter(e => e.type === "coordination.cancel.failed");
    assert.equal(recorded.length, 1, "exactly one cancel-failure record");
    const payload = recorded[0].payload as { runId: string; reason: string; error: string };
    assert.match(payload.error, /store unavailable/);
    assert.equal(payload.reason, "operator cancel could not finalize the run");
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

  it("does not report owned outputs as changed files without explicit mutation evidence", async () => {
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

    // Ownership scopes are where a worker MAY write, not proof that it did:
    // a completed worker with no mutation record is not changed-file evidence.
    assert.equal(result.kind, "success");
    assert.notEqual(result.changed, true);
    assert.equal(result.changedFiles, undefined);
  });

  it("reports changed files from explicit worker mutation records", async () => {
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
    // The session recorded the write the worker actually performed.
    const eventLog = {
      readAll: async () => [
        { sessionId: "s1", type: "file.created", payload: { path: ".tmp/out/a.md" } },
      ],
      append: async () => {},
    } as any;
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner, eventLog, sessionId: "s1" });

    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "write the owned file" });

    assert.equal(result.kind, "success");
    assert.equal(result.changed, true);
    assert.deepEqual(result.changedFiles, [".tmp/out/a.md"]);
  });

  it("publishes structured dependency waits before worker dispatch", async () => {
    const appended: { type: string; payload: Record<string, unknown> }[] = [];
    let dependencyId = "";
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        await store.save(run);
        const producer = createWorkerAssignment({
          coordinationRunId: run.id, agentId: "alix#1", taskLabel: "producer", goalPrompt: "produce", status: "completed",
        });
        dependencyId = producer.id;
        const consumer = createWorkerAssignment({
          coordinationRunId: run.id, agentId: "alix#2", taskLabel: "consumer", goalPrompt: "consume",
          status: "completed", dependencies: [producer.id],
        });
        for (const worker of [producer, consumer]) {
          await store.addWorker(run.id, worker);
          await store.patchWorker(run.id, worker.id, { status: "completed" });
        }
        return { valid: true, errors: [], run: { ...run, workers: [producer, consumer] } };
      },
    } as any;
    const eventLog = {
      readAll: async () => [],
      append: async (event: { type: string; payload: Record<string, unknown> }) => { appended.push(event); },
    } as any;
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store, planner, eventLog });
    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "produce then consume" });
    assert.equal(result.kind, "success");
    const assignments = appended.filter(event => event.type === "agent.task_assigned");
    assert.equal(assignments.length, 2);
    assert.deepEqual(assignments.map(event => event.payload.dependencyIds), [[], [dependencyId]]);
    assert.deepEqual(assignments.map(event => event.payload.state), ["queued", "waiting_dependency"]);
    const spawns = appended.filter(event => event.type === "agent.spawned");
    assert.deepEqual(spawns.map(event => event.payload.dependencyIds), [[], [dependencyId]]);
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

/**
 * The recorder is the ONLY record that a cancel failed to finalize its run, and
 * the guard is the only part of the abort path a test can drive:
 * `handleCoordinationRun` builds its scheduler and worker executor internally,
 * so the surrounding flow needs a much larger seam to reach.
 *
 * Together they must guarantee: a REJECTING cancel never surfaces as a tool
 * failure and never escapes unhandled (the operator asked to stop, so a store
 * error would misreport the outcome), AND the failure is recorded — because the
 * run is then still `running` with leases held and only a dead owner is ever
 * reclaimed. The original defect was a closure reading a `const` declared after
 * the cancel sites, which threw a `ReferenceError` inside the `.catch` callback
 * and rejected the cancel promise; tests that injected their own `onFailure`
 * passed straight through it.
 */
describe("cancel failure recorder", () => {
  it("appends coordination.cancel.failed with the run and session it was given", async () => {
    const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const record = createCancelFailureRecorder({
      eventLog: { append: async (e: { type: string; sessionId?: string; payload: Record<string, unknown> }) => { appended.push(e); } } as never,
      runId: "coord_abc",
      sessionId: "coord-gate-test",
    });

    await record(new Error("store write failed"));

    assert.equal(appended.length, 1);
    assert.equal(appended[0].type, "coordination.cancel.failed");
    assert.equal(appended[0].payload.runId, "coord_abc");
    assert.equal(appended[0].payload.error, "store write failed");
    // sessionId is a top-level event field, not part of the payload.
    assert.equal((appended[0] as unknown as { sessionId?: string }).sessionId, "coord-gate-test");
  });

  it("is safe with no event log", async () => {
    const record = createCancelFailureRecorder({ eventLog: undefined, runId: "r", sessionId: "s" });
    await record(new Error("x")); // must not throw
  });

  it("records a stringified non-Error rejection", async () => {
    const appended: Array<{ payload: Record<string, unknown> }> = [];
    const record = createCancelFailureRecorder({
      eventLog: { append: async (e: { type: string; payload: Record<string, unknown> }) => { appended.push(e); } } as never,
      runId: "r", sessionId: "s",
    });
    await record("plain string failure");
    assert.match(String(appended[0].payload.error), /plain string failure/);
  });
});

describe("operator cancel guard", () => {
  it("attaches a handler immediately, so a rejecting cancel is never unhandled", async () => {
    const failures: unknown[] = [];
    const guard = createCancelGuard({
      cancel: () => Promise.reject(new Error("store write failed")),
      onFailure: (err) => { failures.push(err); },
    });

    // Exactly the listener shape: fire and forget, never awaited.
    guard.onAbort();

    // If no handler were attached, this rejection would surface as an
    // unhandledRejection and could take the process down.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(failures.length, 1, "the failure must be recorded, not swallowed");
    assert.match(String((failures[0] as Error).message), /store write failed/);
  });

  it("resolves rather than rejecting, so the turn still reports a cancellation", async () => {
    const guard = createCancelGuard({
      cancel: () => Promise.reject(new Error("nope")),
      onFailure: () => {},
    });
    await guard.cancelRun(); // must NOT throw
  });

  it("only cancels once however many times the listener fires", async () => {
    let calls = 0;
    const guard = createCancelGuard({
      cancel: () => { calls++; return Promise.resolve(); },
      onFailure: () => {},
    });
    guard.onAbort();
    guard.onAbort();
    guard.onAbort();
    await guard.cancellation();
    assert.equal(calls, 1);
  });

  it("exposes no in-flight cancel before the listener fires", () => {
    const guard = createCancelGuard({ cancel: () => Promise.resolve(), onFailure: () => {} });
    assert.equal(guard.cancellation(), undefined);
  });

  it("records the failure when the recorder itself is wired to state read at call time", async () => {
    // Regression guard for the failure path. The defect was a closure reading
    // `sessionId` from a `const` declared AFTER the cancel sites: it threw a
    // `ReferenceError` from inside the `.catch` callback, which REJECTED the
    // cancel promise (it was not swallowed), so the caller saw a ReferenceError
    // where a cancellation was promised. The fix binds the id as a parameter.
    // Synthetic `onFailure` tests could not see the defect because they never
    // reproduced the real closure — see `createCancelFailureRecorder`'s own
    // tests, which drive the extracted recorder.
    const recorded: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const cancelSessionId = "coord-gate-test";
    const guard = createCancelGuard({
      cancel: () => Promise.reject(new Error("store write failed")),
      onFailure: (error) => recorded.push({
        type: "coordination.cancel.failed",
        payload: { sessionId: cancelSessionId, error: String(error) },
      }),
    });

    await guard.cancelRun();

    assert.equal(recorded.length, 1, "the failure must be recorded");
    assert.equal(recorded[0].payload.sessionId, cancelSessionId);
  });

  it("still reports a cancellation when the recorder itself throws", async () => {
    // A broken recorder must not turn a cancellation into a tool failure, and
    // must not leave an unhandled rejection.
    const guard = createCancelGuard({
      cancel: () => Promise.reject(new Error("store write failed")),
      onFailure: () => { throw new Error("recorder exploded"); },
    });
    await guard.cancelRun(); // must resolve
  });

  it("settles the record before cancelRun resolves", async () => {
    // Fire-and-forget meant the turn could end before the only record of a
    // non-finalized run landed. `onFailure` is awaited.
    let settled = false;
    const guard = createCancelGuard({
      cancel: () => Promise.reject(new Error("nope")),
      onFailure: async () => { await new Promise(r => setTimeout(r, 10)); settled = true; },
    });
    await guard.cancelRun();
    assert.equal(settled, true, "the record must land before the turn continues");
  });

  it("still runs a successful cancel without recording a failure", async () => {
    let cancelled = false;
    const failures: unknown[] = [];
    const guard = createCancelGuard({
      cancel: async () => { cancelled = true; },
      onFailure: (err) => { failures.push(err); },
    });
    await guard.cancelRun();
    assert.equal(cancelled, true);
    assert.deepEqual(failures, [], "a successful cancel must not emit a failure event");
  });
});
