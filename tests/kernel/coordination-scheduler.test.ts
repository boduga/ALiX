/**
 * coordination-scheduler.test.ts — Unit tests for CoordinationScheduler.
 *
 * Tests tick dispatch pipeline, runUntilIdle lifecycle, heartbeats,
 * lease renewal, cancellation, and shutdown.
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
} from "../../src/kernel/coordination-types.js";
import { OwnershipRegistry } from "../../src/ownership/ownership-registry.js";
import type { ExecutionAuthorization } from "../../src/runtime/execution-authorization.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function allowAllAuth(): ExecutionAuthorization {
  return { evaluate: async () => ({ status: "allowed" as const }) } as any;
}

function denyAllAuth(): ExecutionAuthorization {
  return { evaluate: async () => ({ status: "denied" as const, reason: "not permitted" }) } as any;
}

function approvalRequiredAuth(): ExecutionAuthorization {
  let callCount = 0;
  return {
    evaluate: async (req: any) => {
      callCount++;
      // First capability allowed, second asks for approval
      if (req.capability === "safe.cap" || callCount === 1) {
        return { status: "allowed" as const };
      }
      return { status: "approval_required" as const, approvalId: "test-approval-id", reason: "needs human ok" };
    },
  } as any;
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

// ── Immediate executor ──────────────────────────────────────────────────

function immediateExecutor(result: { outcome: "success" | "failure"; failureKind?: string; error?: string } = { outcome: "success" }) {
  return {
    execute: async () => result,
  } as any;
}

// ── Deferred executor (control execution lifecycle from tests) ──────────

type PendingExec = {
  resolve: (value: { outcome: "success" | "failure"; failureKind?: string; error?: string }) => void;
  reject: (err: Error) => void;
};

function createDeferredExecutor(): { executor: any; pending: Map<string, PendingExec> } {
  const pending = new Map<string, PendingExec>();
  const executor = {
    execute: async (worker: any, _context: any, signal: AbortSignal) => {
      return new Promise<{ outcome: "success" | "failure"; failureKind?: string; error?: string }>((resolve, reject) => {
        pending.set(worker.id, { resolve, reject });
        signal.addEventListener("abort", () => {
          reject(new Error("execution aborted"));
        });
      });
    },
  };
  return { executor, pending };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("CoordinationScheduler", () => {
  let cwd: string;
  let store: CoordinationStore;
  let registry: OwnershipRegistry;
  let scheduler: CoordinationScheduler;

  function createScheduler(overrides: {
    executor?: any;
    authorization?: ExecutionAuthorization;
    maxConcurrency?: number;
    maxDispatchPerTick?: number;
  } = {}) {
    return new CoordinationScheduler({
      cwd,
      daemonInstanceId: "daemon-1",
      configProvider: async () => minimalConfig(),
      store,
      authorization: overrides.authorization ?? allowAllAuth(),
      ownershipRegistry: registry,
      executor: overrides.executor ?? immediateExecutor(),
    }, {
      maxConcurrency: overrides.maxConcurrency ?? 4,
      maxDispatchPerTick: overrides.maxDispatchPerTick ?? 5,
      orphanThresholdMs: 60000,
    });
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-sched-"));
    store = new CoordinationStore(cwd);
    registry = new OwnershipRegistry(cwd, { sessionId: "test-session" });
    scheduler = createScheduler();
  });

  afterEach(async () => {
    await scheduler.shutdown();
    rmSync(cwd, { recursive: true, force: true });
  });

  // ── Terminal state handling ───────────────────────────────────────

  it("empty tick returns failed status when run not found", async () => {
    const result = await scheduler.tick("coord_nonexistent");
    assert.equal(result.runStatus, "failed");
    assert.equal(result.dispatched.length, 0);
    assert.equal(result.ready, 0);
    assert.equal(result.examined, 0);
    assert.equal(result.progressMade, false);
  });

  it("tick returns completed status for already-completed run", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    run.status = "completed";
    await store.save(run);

    const result = await scheduler.tick(run.id);
    assert.equal(result.runStatus, "completed");
    assert.equal(result.dispatched.length, 0);
  });

  it("tick returns failed status for already-failed run", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    run.status = "failed";
    await store.save(run);

    const result = await scheduler.tick(run.id);
    assert.equal(result.runStatus, "failed");
    assert.equal(result.dispatched.length, 0);
  });

  // ── Dispatch ordering ─────────────────────────────────────────────

  it("dispatches workers sorted by planOrder ascending", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "order test", coordinatorAgentId: "alix" });
    await store.save(run);

    // Create workers with different planOrders — add them out of order
    const w3 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "last", goalPrompt: "do", planOrder: 3, requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "b", taskLabel: "first", goalPrompt: "do", planOrder: 1, requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    const w2 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "c", taskLabel: "mid", goalPrompt: "do", planOrder: 2, requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, w3);
    await store.addWorker(run.id, w1);
    await store.addWorker(run.id, w2);

    const result = await scheduler.tick(run.id);
    // w1 (planOrder 1), w2 (planOrder 2), w3 (planOrder 3)
    assert.equal(result.dispatched.length, 3);
    assert.deepEqual(result.dispatched, [w1.id, w2.id, w3.id]);
  });

  it("dispatches workers with no planOrder after those with planOrder", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "order test", coordinatorAgentId: "alix" });
    await store.save(run);

    const wNoPlan = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "no plan", goalPrompt: "do", requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    const wPlan = createWorkerAssignment({ coordinationRunId: run.id, agentId: "b", taskLabel: "has plan", goalPrompt: "do", planOrder: 1, requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, wNoPlan);
    await store.addWorker(run.id, wPlan);

    const result = await scheduler.tick(run.id);
    assert.equal(result.dispatched.length, 2);
    assert.equal(result.dispatched[0], wPlan.id);  // planOrder=1 first
    assert.equal(result.dispatched[1], wNoPlan.id); // no planOrder (MAX_SAFE_INTEGER) last
  });

  // ── Authorization ─────────────────────────────────────────────────

  it("authorization denial marks worker as failed", async () => {
    const sched = createScheduler({ authorization: denyAllAuth() });
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "auth test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "denied", goalPrompt: "do",
      requiredCapabilities: ["file.write"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await sched.tick(run.id);
    assert.ok(result.denied.includes(worker.id));
    assert.equal(result.dispatched.length, 0);

    const loaded = await store.load(run.id);
    const w = loaded!.workers[0];
    assert.equal(w.status, "failed");
    assert.equal(w.blockReason, "authorization_denied");
  });

  it("worker with empty capabilities is denied", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "cap test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "no caps", goalPrompt: "do",
      requiredCapabilities: [], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await scheduler.tick(run.id);
    assert.equal(result.dispatched.length, 0);
    assert.ok(result.denied.includes(worker.id));

    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "failed");
  });

  it("approval_required blocks worker without dispatching", async () => {
    const sched = createScheduler({ authorization: approvalRequiredAuth() });
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "approval test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "approve me", goalPrompt: "do",
      requiredCapabilities: ["safe.cap", "risky.cap"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await sched.tick(run.id);
    assert.equal(result.dispatched.length, 0);
    assert.ok(result.awaitingApproval.includes(worker.id));

    const loaded = await store.load(run.id);
    assert.equal(loaded!.workers[0].status, "blocked");
    assert.equal(loaded!.workers[0].blockReason, "approval_required");
  });

  // ── Concurrency and rate limiting ─────────────────────────────────

  it("max concurrency is respected when dispatching", async () => {
    const { executor, pending } = createDeferredExecutor();
    const sched = createScheduler({ executor, maxConcurrency: 3, maxDispatchPerTick: 10 });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "concurrency", coordinatorAgentId: "alix" });
    await store.save(run);

    const workers = Array.from({ length: 6 }, (_, i) =>
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: `w${i}`, taskLabel: `W${i}`, goalPrompt: "do",
        requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
      }),
    );
    for (const w of workers) await store.addWorker(run.id, w);

    const result = await sched.tick(run.id);

    // Only 3 should be dispatched (maxConcurrency=3)
    assert.equal(result.dispatched.length, 3);
    assert.equal(result.availableSlots, 3); // maxConcurrency - activeRunning (0 initially)

    // Resolve pending so shutdown doesn't hang
    for (const [, p] of pending) p.resolve({ outcome: "success" });
    await sched.shutdown();
  });

  it("dispatch is bounded by maxDispatchPerTick", async () => {
    // Use immediate executor since we only check dispatch count, not execution lifecycle
    const sched = createScheduler({ maxConcurrency: 10, maxDispatchPerTick: 2 });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "rate limit", coordinatorAgentId: "alix" });
    await store.save(run);

    const workers = Array.from({ length: 6 }, (_, i) =>
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: `w${i}`, taskLabel: `W${i}`, goalPrompt: "do",
        requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
      }),
    );
    for (const w of workers) await store.addWorker(run.id, w);

    const result = await sched.tick(run.id);

    // Only 2 should be dispatched (maxDispatchPerTick=2 limits before concurrency)
    assert.equal(result.dispatched.length, 2);
  });

  // ── Ownership ─────────────────────────────────────────────────────

  it("ownership conflict sets blockReason without dispatching", async () => {
    const { executor, pending } = createDeferredExecutor();
    const sched = createScheduler({ executor });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "own test", coordinatorAgentId: "alix" });
    await store.save(run);

    // Two workers with overlapping ownership scopes (same path, different agents)
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "agent-a", taskLabel: "A", goalPrompt: "do",
      ownershipClaims: [{ path: "src", recursive: true, sourcePattern: "src/**" }],
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    const w2 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "agent-b", taskLabel: "B", goalPrompt: "do",
      ownershipClaims: [{ path: "src", recursive: true, sourcePattern: "src/**" }],
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, w1);
    await store.addWorker(run.id, w2);

    const result = await sched.tick(run.id);

    // One worker is dispatched (acquired ownership), the other gets ownership conflict.
    // Due to random UUID tiebreaker in the sort, we can't assert which is which.
    assert.equal(result.dispatched.length + result.ownershipConflicts.length, 2);
    assert.equal(result.dispatched.length, 1);
    assert.equal(result.ownershipConflicts.length, 1);

    // Both together should cover all worker IDs
    const allAccounted = new Set([...result.dispatched, ...result.ownershipConflicts]);
    assert.ok(allAccounted.has(w1.id));
    assert.ok(allAccounted.has(w2.id));

    // The conflicted worker should have blockReason set
    const loaded = await store.load(run.id);
    const conflictedWorker = loaded!.workers.find(w => result.ownershipConflicts.includes(w.id));
    assert.equal(conflictedWorker?.blockReason, "ownership_conflict");

    for (const [, p] of pending) p.resolve({ outcome: "success" });
    await sched.shutdown();
  });

  // ── runUntilIdle ───────────────────────────────────────────────────

  it("runUntilIdle completes when all workers succeed", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "idle complete", coordinatorAgentId: "alix" });
    await store.save(run);

    const workers = Array.from({ length: 3 }, (_, i) =>
      createWorkerAssignment({
        coordinationRunId: run.id, agentId: `w${i}`, taskLabel: `W${i}`, goalPrompt: "do",
        requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
      }),
    );
    for (const w of workers) await store.addWorker(run.id, w);

    const result = await scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });

    assert.equal(result.finalStatus, "completed");
    assert.equal(result.stopReason, "completed");
    assert.equal(result.dispatched, 3);
    assert.ok(result.cycles >= 1);
    assert.ok(result.durationMs >= 0);
  });

  it("runUntilIdle stops when approval is required", async () => {
    const sched = createScheduler({ authorization: approvalRequiredAuth() });
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "idle approval", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "needs approval", goalPrompt: "do",
      requiredCapabilities: ["safe.cap", "risky.cap"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await sched.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });

    assert.equal(result.finalStatus, "blocked");
    assert.equal(result.stopReason, "awaiting_approval");
    assert.equal(result.dispatched, 0);
  });

  it("runUntilIdle times out when workers never complete", async () => {
    const { executor } = createDeferredExecutor(); // never resolved
    const sched = createScheduler({ executor });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "timeout test", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "stuck", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    // Only allow 1 tick with some time — the executor never resolves,
    // but there are no idle ticks because the active execution keeps idleTicks=0.
    // To avoid a real timeout, we set a very low timeoutMs and maxIdleTicks.
    const result = await sched.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 200, maxIdleTicks: 1 });

    // With active executions still running and no progress, it should time out
    assert.equal(result.stopReason, "timeout");

    await sched.shutdown();
  });

  // ── Heartbeat ──────────────────────────────────────────────────────

  it("heartbeatActiveWorkers updates running worker timestamps", async () => {
    const { executor, pending } = createDeferredExecutor();
    const sched = createScheduler({ executor });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "hb", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "heartbeat", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    // Dispatch the worker
    const tickResult = await sched.tick(run.id);
    assert.ok(tickResult.dispatched.includes(worker.id));

    // Get the initial heartbeat
    const afterTick = await store.load(run.id);
    const initialHb = afterTick!.workers[0].lastHeartbeatAt;
    assert.ok(initialHb, "heartbeat was set on dispatch");

    // Small delay so the new timestamp differs
    await new Promise(r => setTimeout(r, 5));

    // Update heartbeat
    await sched.heartbeatActiveWorkers();

    const afterHb = await store.load(run.id);
    const updatedHb = afterHb!.workers[0].lastHeartbeatAt;
    assert.ok(updatedHb, "heartbeat was updated");
    assert.ok(updatedHb! > initialHb, "heartbeat timestamp was updated");

    // Cleanup
    for (const [, p] of pending) p.resolve({ outcome: "success" });
    await sched.shutdown();
  });

  // ── Cancel ─────────────────────────────────────────────────────────

  it("cancelRun marks workers in terminal states", async () => {
    const { executor, pending } = createDeferredExecutor();
    const sched = createScheduler({ executor });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "cancel test", coordinatorAgentId: "alix" });
    await store.save(run);

    const w1 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "first", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    const w2 = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w2", taskLabel: "second", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, w1);
    await store.addWorker(run.id, w2);

    // Both workers should be dispatched
    const tickResult = await sched.tick(run.id);
    assert.equal(tickResult.dispatched.length, 2);
    assert.ok(tickResult.dispatched.includes(w1.id));
    assert.ok(tickResult.dispatched.includes(w2.id));

    // Cancel the run
    await sched.cancelRun(run.id);

    // Check final state — both workers must be terminal (failed due to abort,
    // or cancelled by cancelRun). Both are valid outcomes of cancellation.
    const loaded = await store.load(run.id);
    for (const w of loaded!.workers) {
      assert.ok(
        ["failed", "cancelled"].includes(w.status),
        `Worker ${w.id} should be in terminal state, got ${w.status}`,
      );
    }

    // Cleanup — resolve pending so deferred promises settle
    for (const [, p] of pending) p.resolve({ outcome: "success" });
    await sched.shutdown();
  });

  // ── Shutdown ───────────────────────────────────────────────────────

  it("shutdown aborts all active executions and clears map", async () => {
    const { executor, pending } = createDeferredExecutor();
    const sched = createScheduler({ executor });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "shutdown test", coordinatorAgentId: "alix" });
    await store.save(run);

    for (let i = 0; i < 3; i++) {
      const w = createWorkerAssignment({
        coordinationRunId: run.id, agentId: `w${i}`, taskLabel: `W${i}`, goalPrompt: "do",
        requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
      });
      await store.addWorker(run.id, w);
    }

    // Dispatch all 3 workers
    const tickResult = await sched.tick(run.id);
    assert.equal(tickResult.dispatched.length, 3);

    // Shutdown aborts and waits
    await sched.shutdown();

    // All workers should be in terminal state
    const loaded = await store.load(run.id);
    const allTerminal = loaded!.workers.every(w =>
      w.status === "failed" || w.status === "cancelled" || w.status === "completed"
    );
    assert.ok(allTerminal, "all workers reached terminal state after shutdown");

    // Allow any remaining deferred promises to settle
    for (const [, p] of pending) p.resolve({ outcome: "success" });
  });

  // ── Retry ──────────────────────────────────────────────────────────

  it("retries worker on transient failure when attempts remain", async () => {
    let attemptCount = 0;
    const executor = {
      execute: async () => {
        attemptCount++;
        return { outcome: "failure" as const, failureKind: "timeout" as const, error: "timed out" };
      },
    };

    const sched = createScheduler({ executor, maxConcurrency: 1 });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "retry test", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "retry", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    // Tick 1: dispatches, runs, fails, marks pending (attempt 1 < 3)
    const r1 = await sched.tick(run.id);
    assert.equal(r1.dispatched.length, 1);

    // Wait for pending execution to complete (it's immediate executor)
    await new Promise(r => setTimeout(r, 10));

    const afterTick1 = await store.load(run.id);
    assert.equal(afterTick1!.workers[0].status, "pending", "worker was reset to pending for retry");

    // Tick 2: worker is pending again, gets re-dispatched
    const r2 = await sched.tick(run.id);
    assert.equal(r2.dispatched.length, 1);

    await new Promise(r => setTimeout(r, 10));

    const afterTick2 = await store.load(run.id);
    // After tick 2, attempt count = 2 (2 < 3, so still pending)
    assert.equal(afterTick2!.workers[0].status, "pending", "worker still pending for more retries");
  });

  // ── Tick result structure ──────────────────────────────────────────

  it("tick returns well-formed result with all fields", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "complete", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "worker", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await scheduler.tick(run.id);

    // Verify all fields
    assert.equal(result.runId, run.id);
    assert.ok(Array.isArray(result.dispatched));
    assert.ok(Array.isArray(result.awaitingApproval));
    assert.ok(Array.isArray(result.denied));
    assert.ok(Array.isArray(result.ownershipConflicts));
    assert.ok(Array.isArray(result.dependencyBlocked));
    assert.ok(Array.isArray(result.recoveredOrphans));
    assert.equal(typeof result.examined, "number");
    assert.equal(typeof result.ready, "number");
    assert.equal(typeof result.activeRunning, "number");
    assert.equal(typeof result.availableSlots, "number");
    assert.equal(typeof result.runStatus, "string");
    assert.equal(typeof result.progressMade, "boolean");
  });
});
