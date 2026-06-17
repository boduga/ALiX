/**
 * coordination-scheduler-replan.test.ts — Tests for mid-execution replanning
 * integration in CoordinationScheduler.
 *
 * Covers:
 * - Scheduler invokes replanner after worker exhausts retries
 * - Scheduler does NOT invoke replanner when retries remain
 * - Scheduler does NOT invoke replanner when no replanner configured (no-op)
 * - Scheduler does NOT invoke replanner when feature is disabled
 * - Scheduler does NOT invoke replanner on completed run
 * - Scheduler does NOT invoke replanner on failed run
 * - Tick loop skips dispatch during "replanning" status
 * - Replan failure (applied=false with errors) restores run to safe status
 * - Replan throw error restores run to safe status
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { CoordinationScheduler } from "../../src/kernel/coordination-scheduler.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
  type CoordinationRun,
} from "../../src/kernel/coordination-types.js";
import { OwnershipRegistry } from "../../src/ownership/ownership-registry.js";
import type { ExecutionAuthorization } from "../../src/runtime/execution-authorization.js";
import type { ReplanResult, ReplanContext } from "../../src/kernel/collaborative-planner.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function allowAllAuth(): ExecutionAuthorization {
  return { evaluate: async () => ({ status: "allowed" as const }) } as any;
}

function minimalConfig() {
  return {
    version: 1 as const,
    model: { provider: "test", name: "test" },
    permissions: {
      default: "allow" as const,
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: "bypass" as const,
    },
    context: {
      repoMap: false,
      repoMapMode: "lite" as const,
      maxRepoMapTokens: 1000,
      semanticSearch: false,
      includeGitStatus: false,
      pinnedFiles: [],
    },
    runtime: {
      provider: "process" as const,
      shell: "/bin/bash",
      commandTimeoutMs: 5000,
      envAllowlist: [],
    },
    ui: { enabled: false, host: "localhost", port: 0, transport: "sse" as const },
  };
}

/** Create an executor that always fails. */
function failingExecutor(failureKind = "execution_error", error = "Worker failed") {
  return {
    execute: async () => ({ outcome: "failure" as const, failureKind, error }),
  } as any;
}

/** Create a mock replanner that records calls and returns a configurable result. */
function createMockReplanner(result: ReplanResult = { run: null, revision: null, applied: true, errors: [] }) {
  const calls: { runId: string; context: ReplanContext }[] = [];
  const replanner = {
    replan: async (runId: string, context: ReplanContext): Promise<ReplanResult> => {
      calls.push({ runId, context });
      return result;
    },
  };
  return { replanner, calls };
}

/**
 * Create a minimal scheduler for replanning tests.
 */
function createMinimalScheduler(overrides: {
  cwd?: string;
  store?: CoordinationStore;
  executor?: any;
  replanner?: any;
  enableMidExecutionReplanning?: boolean;
  authorization?: ExecutionAuthorization;
  maxConcurrency?: number;
} = {}) {
  const cwd = overrides.cwd ?? mkdtempSync(join(tmpdir(), "coord-replan-"));
  const store = overrides.store ?? new CoordinationStore(cwd);
  const registry = new OwnershipRegistry(cwd, { sessionId: "test-session" });

  const scheduler = new CoordinationScheduler({
    cwd,
    daemonInstanceId: "daemon-1",
    configProvider: async () => minimalConfig(),
    store,
    authorization: overrides.authorization ?? allowAllAuth(),
    ownershipRegistry: registry,
    executor: overrides.executor ?? failingExecutor(),
    replanner: overrides.replanner,
  }, {
    maxConcurrency: overrides.maxConcurrency ?? 4,
    maxDispatchPerTick: 5,
    orphanThresholdMs: 60000,
    enableMidExecutionReplanning: overrides.enableMidExecutionReplanning ?? true,
  });

  return { scheduler, cwd, store, registry };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("CoordinationScheduler replanning integration", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-replan-"));
    store = new CoordinationStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // ── Test 1: Invokes replanner after worker exhausts retries ─────────

  it("invokes replanner after worker exhausts retries", async () => {
    const executor = failingExecutor("execution_error", "maxed out");
    const { replanner, calls } = createMockReplanner({ run: null, revision: null, applied: true, errors: [] });

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner, maxConcurrency: 1,
    });

    // Worker with attempt=2, maxAttempts=3 — after dispatch attempt becomes 3,
    // which equals maxAttempts -> no retry -> replan invoked
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "replan test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "replannable", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 2, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    // Replanner should have been called
    assert.equal(calls.length, 1);
    assert.equal(calls[0].runId, run.id);
    assert.equal(calls[0].context.workerId, worker.id);
    assert.equal(calls[0].context.triggeredBy, "worker_failed");
  });

  // ── Test 2: Does NOT invoke replanner when retries remain ──────────

  it("does not invoke replanner when retries remain", async () => {
    const executor = failingExecutor("timeout", "transient blip");
    const { replanner, calls } = createMockReplanner({ run: null, revision: null, applied: true, errors: [] });

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner, maxConcurrency: 1,
    });

    // Worker with attempt=0, maxAttempts=3 — after dispatch attempt becomes 1,
    // 1 < 3 => retryable => replan NOT invoked
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "retry test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "retryable", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    // Replanner should NOT have been called
    assert.equal(calls.length, 0);

    // Worker should be pending (ready for retry)
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "pending");
  });

  // ── Test 3: Does NOT invoke replanner when no replanner configured ──

  it("does not invoke replanner when no replanner configured", async () => {
    const executor = failingExecutor("execution_error", "no replanner");
    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner: undefined, maxConcurrency: 1,
    });

    // Worker with attempt=2, maxAttempts=3 — after dispatch attempt=3, no retries remain
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "none", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 2, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    // Should not throw — replanner is undefined so no-op
    const tickResult = await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    assert.equal(tickResult.dispatched.length, 1);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "failed");
  });

  // ── Test 4: Does NOT invoke replanner when feature disabled ────────

  it("does not invoke replanner when enableMidExecutionReplanning is false", async () => {
    const executor = failingExecutor("execution_error", "disabled");
    const { replanner, calls } = createMockReplanner({ run: null, revision: null, applied: true, errors: [] });

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner,
      enableMidExecutionReplanning: false,
      maxConcurrency: 1,
    });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "disabled", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 2, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    assert.equal(calls.length, 0);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "failed");
  });

  // ── Test 5: Tick returns early when run status is replanning ────────

  it("tick returns early when run status is replanning", async () => {
    const { scheduler } = createMinimalScheduler({ cwd, store });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "replanning test", coordinatorAgentId: "alix" });
    run.status = "replanning";
    await store.save(run);

    const result = await scheduler.tick(run.id);

    assert.equal(result.runStatus, "replanning");
    assert.equal(result.dispatched.length, 0);
    assert.equal(result.examined, 0);
    assert.equal(result.progressMade, false);
  });

  // ── Test 6: Replan applied=false restores run to safe status ────────

  it("restores run to safe status when replan applied=false with errors", async () => {
    const executor = failingExecutor("execution_error", "exhausted");
    const { replanner, calls } = createMockReplanner({
      run: null, revision: null,
      applied: false,
      errors: ["CAS conflict — concurrent replan in progress"],
    });

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner, maxConcurrency: 1,
    });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "replannable", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 2, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    // Replanner was called
    assert.equal(calls.length, 1);

    // Run should NOT be stuck in "replanning"
    const loaded = await store.load(run.id);
    assert.notEqual(loaded!.status, "replanning");
    // With one failed worker and no replan applied, status should be "failed"
    assert.equal(loaded!.status, "failed");
  });

  // ── Test 7: Replan throw restores run to safe status ────────────────

  it("restores run to safe status when replan throws", async () => {
    const executor = failingExecutor("execution_error", "explodes");
    const calls: { runId: string; context: ReplanContext }[] = [];
    const trackedReplanner = {
      replan: async (runId: string, context: ReplanContext): Promise<ReplanResult> => {
        calls.push({ runId, context });
        throw new Error("Replanner crashed");
      },
    };

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner: trackedReplanner, maxConcurrency: 1,
    });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "exploder", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 2, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    // Should not throw — error is caught and logged
    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    // Replanner was called (once)
    assert.equal(calls.length, 1);

    // Run should be restored from "replanning" to safe status
    const loaded = await store.load(run.id);
    assert.notEqual(loaded!.status, "replanning");
    assert.equal(loaded!.status, "failed");
  });

  // ── Test 8: Does NOT invoke replanner on completed run ──────────────

  it("does not invoke replanner when run is already completed", async () => {
    const executor = failingExecutor("execution_error", "too late");
    const { replanner, calls } = createMockReplanner({ run: null, revision: null, applied: true, errors: [] });

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner, maxConcurrency: 1,
    });

    // Manually construct run with completed worker, save atomically (not using addWorker
    // which recomputes status via recomputeRunStatus)
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "completed test", coordinatorAgentId: "alix" });
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "done", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 1, maxAttempts: 1, status: "completed",
    });
    run.workers.push(worker);
    run.status = "completed";
    await store.save(run);

    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    // Tick should return early — worker never dispatched, replanner never called
    assert.equal(calls.length, 0);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.status, "completed");
  });

  // ── Test 9: Does NOT invoke replanner on failed run ────────────────

  it("does not invoke replanner when run is already failed", async () => {
    const executor = failingExecutor("execution_error", "too late");
    const { replanner, calls } = createMockReplanner({ run: null, revision: null, applied: true, errors: [] });

    const { scheduler } = createMinimalScheduler({
      cwd, store, executor, replanner, maxConcurrency: 1,
    });

    // Manually construct run with failed worker, save atomically
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "failed test", coordinatorAgentId: "alix" });
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "failed", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 1, maxAttempts: 1, status: "failed",
    });
    run.workers.push(worker);
    run.status = "failed";
    await store.save(run);

    await scheduler.tick(run.id);
    await new Promise(r => setTimeout(r, 50));

    assert.equal(calls.length, 0);
    const loaded = await store.load(run.id);
    assert.equal(loaded!.status, "failed");
  });

  // ── Test 10: Tick skips dispatch during replanning status (with workers) ─

  it("tick does not dispatch workers when run is in replanning status", async () => {
    const { scheduler } = createMinimalScheduler({ cwd, store });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "blocked", coordinatorAgentId: "alix" });
    run.status = "replanning";
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "blocked", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await scheduler.tick(run.id);

    // Tick should return early without examining any workers
    assert.equal(result.runStatus, "replanning");
    assert.equal(result.dispatched.length, 0);
    assert.equal(result.ready, 0);
    assert.equal(result.examined, 0);
  });
});
