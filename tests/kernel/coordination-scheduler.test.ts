/**
 * coordination-scheduler.test.ts — Unit tests for CoordinationScheduler.
 *
 * Tests tick dispatch pipeline, runUntilIdle lifecycle, heartbeats,
 * lease renewal, cancellation, and shutdown.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { CoordinationScheduler } from "../../src/coordination/kernel/coordination-scheduler.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
} from "../../src/coordination/kernel/coordination-types.js";
import { OwnershipRegistry } from "../../src/coordination/ownership/ownership-registry.js";
import { persistGraph } from "../../src/coordination/kernel/graph-planner.js";
import type { ExecutionAuthorization } from "../../src/runtime-state/runtime/execution-authorization.js";
import { waitUntil } from "../helpers/wait-until.js";

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
        // An abort that fires before addEventListener is PERMANENTLY missed —
        // check signal.aborted synchronously so a shutdown() racing a slow
        // store.load() (tick() starts executeWorker without awaiting it) can
        // never leave this promise unsettled. Without this the test hangs at
        // the 30s timeout under full-suite load (passes in isolation).
        if (signal.aborted) {
          reject(new Error("execution aborted"));
          return;
        }
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
    config?: any;
    maxConcurrency?: number;
    maxDispatchPerTick?: number;
    workerTimeoutMs?: number;
  } = {}) {
    return new CoordinationScheduler({
      cwd,
      daemonInstanceId: "daemon-1",
      configProvider: async () => overrides.config ?? minimalConfig(),
      store,
      authorization: overrides.authorization ?? allowAllAuth(),
      ownershipRegistry: registry,
      executor: overrides.executor ?? immediateExecutor(),
    }, {
      maxConcurrency: overrides.maxConcurrency ?? 4,
      maxDispatchPerTick: overrides.maxDispatchPerTick ?? 5,
      orphanThresholdMs: 60000,
      workerTimeoutMs: overrides.workerTimeoutMs,
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

  // ── F5: approval-blocked workers must not be mistaken for idle ─────
  //
  // `awaitingApproval` only reports approval blocks created while dispatching
  // THIS tick's candidates, and candidates require `status === "pending"`. A
  // worker blocked on approval at attempt N is therefore invisible to it from
  // the next tick on, so `runUntilIdle` counted idle and exited with the run
  // still non-terminal — once the operator approved later, nothing ticked the
  // run again and the worker stayed blocked forever (Gate 6 F5).
  describe("F5 — approval-blocked visibility", () => {
    /**
     * Always asks for approval, and flips to allowed on demand. Unlike
     * `approvalRequiredAuth` (which allows the first call), this has no call
     * counter, so a block really persists across ticks.
     */
    function switchableAuth() {
      let allowed = false;
      return {
        allow() { allowed = true; },
        auth: {
          evaluate: async () =>
            allowed
              ? { status: "allowed" as const }
              : { status: "approval_required" as const, approvalId: "test-approval-id", reason: "needs human ok" },
        } as any,
      };
    }

    async function seedBlockedWorker(attempt = 0, maxAttempts = 3) {
      const run = createCoordinationRun({ sessionId: "s1", rootGoal: "f5", coordinatorAgentId: "alix" });
      await store.save(run);
      const worker = createWorkerAssignment({
        coordinationRunId: run.id, agentId: "w1", taskLabel: "blocked", goalPrompt: "do",
        requiredCapabilities: ["risky.cap"], attempt, maxAttempts,
      });
      await store.addWorker(run.id, worker);
      return { run, worker };
    }

    it("an already-blocked approval worker stays visible on later ticks", async () => {
      // The stub asks for approval AND the config must agree: reconciliation
      // now recomputes the policy verdict, so an allow-by-default config would
      // correctly resume the worker instead of leaving it blocked.
      const sched = createScheduler({
        authorization: switchableAuth().auth,
        config: (() => { const c = minimalConfig() as any; c.permissions.default = "ask"; c.permissions.sessionMode = "ask"; c.permissions.tools = { "risky.cap": "ask" }; return c; })(),
      });
      const { run, worker } = await seedBlockedWorker();

      // Tick 1 creates the block; it is reported as a fresh approval wait.
      const first = await sched.tick(run.id);
      assert.ok(first.awaitingApproval.includes(worker.id));
      assert.ok(first.approvalBlocked.includes(worker.id));

      // Tick 2+ sees the worker already blocked. It is still awaiting approval,
      // not idle. This is the assertion the defect violated.
      for (const label of ["tick 2", "tick 3"]) {
        const later = await sched.tick(run.id);
        assert.deepEqual(later.awaitingApproval, [], `${label}: no NEW approval during dispatch`);
        assert.deepEqual(later.approvalBlocked, [worker.id], `${label}: existing block is visible`);
        assert.equal(later.progressMade, false, `${label}: an approval wait is not progress`);
      }
    });

    it("runUntilIdle returns awaiting_approval, not idle, for a pre-existing block", async () => {
      // The stub asks for approval AND the config must agree: reconciliation
      // now recomputes the policy verdict, so an allow-by-default config would
      // correctly resume the worker instead of leaving it blocked.
      const sched = createScheduler({
        authorization: switchableAuth().auth,
        config: (() => { const c = minimalConfig() as any; c.permissions.default = "ask"; c.permissions.sessionMode = "ask"; c.permissions.tools = { "risky.cap": "ask" }; return c; })(),
      });
      const { run, worker } = await seedBlockedWorker();
      // Create the block first, so it is pre-existing when the loop starts.
      await sched.tick(run.id);

      const result = await sched.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000, maxIdleTicks: 5 });

      assert.equal(result.stopReason, "awaiting_approval");
      assert.notEqual(result.stopReason, "idle");
      assert.equal(result.finalStatus, "blocked");
      const loaded = await store.load(run.id);
      // A run whose every worker is blocked/pending recomputes to `blocked`,
      // which is non-terminal — never `completed`/`failed`.
      assert.equal(loaded!.status, "blocked", "an approval wait never finalizes the run");
      assert.ok(["pending", "blocked", "cancelled"].includes(loaded!.status));
      assert.equal(loaded!.workers[0].status, "blocked");
      assert.equal(loaded!.workers[0].id, worker.id);
    });

    it("approval followed by reconciliation makes the worker dispatchable (later attempt)", async () => {
      // A real PolicyGate + ApprovalStore, so the approve -> resume path is the
      // production one (`reconcile` requires an exact binding match).
      const { ApprovalStore } = await import("../../src/governance/approvals/approval-store.js");
      const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
      const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
      const { buildDefaultToolIndex } = await import("../../src/capabilities/tools/tool-registry.js");
      const approvalStore = new ApprovalStore(cwd);
      await approvalStore.load();
      const config = minimalConfig() as any;
      // `minimalConfig` is allow-by-default; asking is the whole point here.
      config.permissions.default = "ask";
      config.permissions.tools = { "risky.cap": "ask" };
      const auth = new ExecutionAuthorization({
        policyGate: new PolicyGate(config, { approvalStore }),
        toolRegistry: buildDefaultToolIndex().registry,
      });
      const executed: string[] = [];
      const sched = new CoordinationScheduler({
        cwd, daemonInstanceId: "daemon-f5", configProvider: async () => config,
        store, authorization: auth, ownershipRegistry: registry,
        executor: { execute: async (w: any) => { executed.push(w.id); return { outcome: "success" }; } } as any,
      }, { maxConcurrency: 2, orphanThresholdMs: 60_000 });

      // Attempt 1 of 3: exactly the "later-attempt approval" shape.
      const run = createCoordinationRun({ sessionId: "s1", rootGoal: "later attempt", coordinatorAgentId: "alix" });
      run.hostKind = "cli";
      run.sessionMode = "ask";
      await store.save(run);
      const worker = createWorkerAssignment({
        coordinationRunId: run.id, agentId: "w1", taskLabel: "later", goalPrompt: "do",
        requiredCapabilities: ["risky.cap"], attempt: 1, maxAttempts: 3,
        ownershipScopes: ["x.md"], ownershipClaims: [{ path: "x.md", recursive: false }],
      });
      await store.addWorker(run.id, worker);

      const blockedTick = await sched.tick(run.id);
      assert.equal(blockedTick.dispatched.length, 0, "a blocked worker must not be dispatched");
      assert.ok(blockedTick.approvalBlocked.includes(worker.id), "the block must be reported");
      assert.deepEqual(executed, [], "nothing executes while blocked");

      // A second tick must still see it as awaiting approval, not idle.
      const stillBlocked = await sched.tick(run.id);
      assert.ok(stillBlocked.approvalBlocked.includes(worker.id));

      const pending = approvalStore.listPending();
      assert.equal(pending.length, 1, "exactly one durable approval");
      await approvalStore.resolve(pending[0]!.id, "approved", "f5-test");

      // Approve -> reconcile resumes it -> dispatch runs it exactly once.
      const resumedTick = await sched.tick(run.id);

      assert.deepEqual(resumedTick.approvalBlocked, [], "a resumed worker must not linger in approvalBlocked");
      assert.ok(resumedTick.dispatched.includes(worker.id), "the approved worker is dispatched");
      // Dispatch starts execution asynchronously; wait for it to settle before
      // asserting the exactly-once contract.
      for (let i = 0; i < 200 && executed.length === 0; i++) {
        await new Promise(r => setTimeout(r, 10));
      }
      await new Promise(r => setTimeout(r, 50));
      assert.equal(executed.length, 1, "exactly one execution");
      assert.equal(executed[0], worker.id);
      assert.equal(approvalStore.listPending().length, 0, "no duplicate approval is minted");

      const loaded = await store.load(run.id);
      const after = loaded!.workers.find(w => w.id === worker.id)!;
      assert.equal(after.status, "completed");
      await sched.shutdown();
    });

    // ── F6: mixed-capability approval reconciliation ──────────────────
    //
    // `requiredCapabilities` is everything a worker needs; each approval record
    // authorizes exactly ONE gated capability. Comparing a record's capabilities
    // against the worker's whole set made any mixed allow/ask worker permanently
    // unresumable. These pin the corrected per-gated-capability contract.
    describe("F6 — mixed-capability approval reconciliation", () => {
      /** A scheduler wired to a real PolicyGate + ApprovalStore. */
      async function realScheduler(tools: Record<string, "allow" | "ask" | "deny">, exec?: any) {
        const { ApprovalStore } = await import("../../src/governance/approvals/approval-store.js");
        const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
        const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
        const { buildDefaultToolIndex } = await import("../../src/capabilities/tools/tool-registry.js");
        const approvalStore = new ApprovalStore(cwd);
        await approvalStore.load();
        const config = minimalConfig() as any;
        config.permissions.default = "ask";
        config.permissions.tools = tools;
        const auth = new ExecutionAuthorization({
          policyGate: new PolicyGate(config, { approvalStore }),
          toolRegistry: buildDefaultToolIndex().registry,
        });
        const executed: string[] = [];
        const sched = new CoordinationScheduler({
          cwd, daemonInstanceId: "daemon-f6", configProvider: async () => config,
          store, authorization: auth, ownershipRegistry: registry,
          executor: exec ?? { execute: async (w: any) => { executed.push(w.id); return { outcome: "success" }; } } as any,
        }, { maxConcurrency: 2, orphanThresholdMs: 60_000 });
        return { sched, approvalStore, executed, config };
      }

      async function seed(caps: string[], attempt = 0) {
        const run = createCoordinationRun({ sessionId: "s1", rootGoal: "f6", coordinatorAgentId: "alix" });
        run.hostKind = "cli";
        run.sessionMode = "ask";
        await store.save(run);
        const worker = createWorkerAssignment({
          coordinationRunId: run.id, agentId: "alix#1", taskLabel: "mixed", goalPrompt: "do",
          requiredCapabilities: caps, attempt, maxAttempts: 3,
          ownershipScopes: ["x.md"], ownershipClaims: [{ path: "x.md", recursive: false }],
        });
        await store.addWorker(run.id, worker);
        return { run, worker };
      }

      async function approveAll(approvalStore: any, runId: string) {
        const pending = approvalStore.listPending().filter((a: any) => a.coordinationRunId === runId);
        for (const a of pending) await approvalStore.resolve(a.id, "approved", "f6-test");
        return pending;
      }

      // Busy-polls the scheduler up to ~2s (200 x 10ms) waiting for dispatch;
      // declared timeout gives headroom on a loaded CI box.
      it("(1) mixed allow/ask: one approval resumes the worker", { timeout: 30_000 }, async () => {
        const { sched, approvalStore, executed } = await realScheduler({ "file.read": "allow", "file.exists": "ask" });
        const { run, worker } = await seed(["file.exists", "file.read"]);

        await sched.tick(run.id);
        assert.equal(executed.length, 0, "nothing runs while gated");
        const pending = await approveAll(approvalStore, run.id);
        assert.equal(pending.length, 1, "only the ask capability needs an approval");
        assert.deepEqual(pending[0].capabilities, ["file.exists"]);

        const resumed = await sched.tick(run.id);
        assert.ok(resumed.dispatched.includes(worker.id), "the worker resumes");
        for (let i = 0; i < 200 && executed.length === 0; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(executed.length, 1, "exactly one execution");
        await sched.shutdown();
      });

      it("(2) two ask capabilities: BOTH approvals are required", async () => {
        const { sched, approvalStore, executed } = await realScheduler({ "cap.a": "ask", "cap.b": "ask" });
        const { run, worker } = await seed(["cap.a", "cap.b"]);

        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter((a: any) => a.coordinationRunId === run.id);
        assert.equal(pending.length, 2, "each gated capability gets its own approval");

        // Approve only ONE: the worker must stay blocked.
        await approvalStore.resolve(pending[0].id, "approved", "f6-test");
        await sched.tick(run.id);
        assert.equal(executed.length, 0, "one approval cannot satisfy two gated capabilities");

        // Approve the second: now it resumes.
        await approvalStore.resolve(pending[1].id, "approved", "f6-test");
        const resumed = await sched.tick(run.id);
        assert.ok(resumed.dispatched.includes(worker.id));
        await sched.shutdown();
      });

      // Busy-polls the scheduler up to ~2s (200 x 10ms) waiting for dispatch;
      // declared timeout gives headroom on a loaded CI box.
      it("(3) allow/allow: no approval is required", { timeout: 30_000 }, async () => {
        const { sched, approvalStore, executed } = await realScheduler({ "file.read": "allow", "file.search": "allow" });
        const { run, worker } = await seed(["file.read", "file.search"]);

        const tick = await sched.tick(run.id);
        assert.ok(tick.dispatched.includes(worker.id));
        assert.equal(approvalStore.list().length, 0, "no approval is minted");
        for (let i = 0; i < 200 && executed.length === 0; i++) await new Promise(r => setTimeout(r, 10));
        await sched.shutdown();
      });

      it("(4) ask/deny: denied, no execution", async () => {
        const { sched, executed } = await realScheduler({ "cap.a": "ask", "cap.b": "deny" });
        const { run } = await seed(["cap.a", "cap.b"]);

        const tick = await sched.tick(run.id);
        assert.deepEqual(tick.dispatched, []);
        const loaded = await store.load(run.id);
        const w = loaded!.workers[0];
        assert.equal(w.status, "failed");
        assert.equal(w.blockReason, "authorization_denied");
        assert.equal(executed.length, 0, "a denial can never be overridden by an ask");
        await sched.shutdown();
      });

      it("(5) missing authorization decision: fails closed", async () => {
        const { sched, executed } = await realScheduler({ "cap.a": "ask" });
        const { run, worker } = await seed(["cap.a"]);
        await sched.tick(run.id);
        // Drop the decision for a required capability: evidence is incomplete.
        await store.patchWorker(run.id, worker.id, { authorizationEvidence: { evaluatedAt: new Date().toISOString(), decisions: [] } });
        const tick = await sched.tick(run.id);
        assert.deepEqual(tick.dispatched, [], "missing evidence must not resume");
        assert.equal(executed.length, 0);
        await sched.shutdown();
      });

      it("(6) stale policy revision: no resume", async () => {
        const { sched, approvalStore, executed, config } = await realScheduler({ "cap.a": "ask" });
        const { run } = await seed(["cap.a"]);
        await sched.tick(run.id);
        const pending = await approveAll(approvalStore, run.id);
        assert.equal(pending.length, 1);

        // Change a policy-relevant field: the approval is now bound to a stale revision.
        (config.permissions.tools as any)["cap.other"] = "allow";
        const tick = await sched.tick(run.id);
        assert.deepEqual(tick.dispatched, [], "an approval from a superseded policy must not authorize");
        assert.equal(executed.length, 0);
        await sched.shutdown();
      });

      it("(7) wrong worker or attempt: no resume", async () => {
        const { sched, approvalStore, executed } = await realScheduler({ "cap.a": "ask" });
        const { run, worker } = await seed(["cap.a"]);
        await sched.tick(run.id);
        const pending = await approveAll(approvalStore, run.id);

        // Bump the attempt: the approval was issued for attempt 0.
        await store.patchWorker(run.id, worker.id, { attempt: 1 });
        const tick = await sched.tick(run.id);
        assert.deepEqual(tick.dispatched, [], "an approval bound to another attempt must not resume");
        assert.equal(executed.length, 0);
        assert.equal(pending.length, 1);
        await sched.shutdown();
      });

      it("(8) duplicate capability entries: no duplicate approval or consumption", async () => {
        const { sched, approvalStore } = await realScheduler({ "cap.a": "ask", "cap.b": "allow" });
        const { run, worker } = await seed(["cap.a", "cap.a", "cap.b"]);

        await sched.tick(run.id);
        const created = approvalStore.list().filter((a: any) => a.coordinationRunId === run.id);
        assert.equal(created.length, 1, "a duplicated capability must not mint two approvals");

        await approveAll(approvalStore, run.id);
        const resumed = await sched.tick(run.id);
        assert.ok(resumed.dispatched.includes(worker.id));
        const after = approvalStore.list().filter((a: any) => a.coordinationRunId === run.id);
        assert.equal(after.length, 1, "resumption must not create a second approval");
        await sched.shutdown();
      });

      it("(9) restart recovery with mixed-capability approvals", async () => {
        const { sched, approvalStore, executed } = await realScheduler({ "file.read": "allow", "file.exists": "ask" });
        const { run, worker } = await seed(["file.exists", "file.read"]);
        await sched.tick(run.id);
        await approveAll(approvalStore, run.id);
        await sched.shutdown();

        // A FRESH scheduler over the same durable state must resume it.
        const { ApprovalStore } = await import("../../src/governance/approvals/approval-store.js");
        const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
        const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
        const { buildDefaultToolIndex } = await import("../../src/capabilities/tools/tool-registry.js");
        const store2 = new ApprovalStore(cwd);
        await store2.load();
        const config = minimalConfig() as any;
        config.permissions.default = "ask";
        config.permissions.tools = { "file.read": "allow", "file.exists": "ask" };
        const restart = new CoordinationScheduler({
          cwd, daemonInstanceId: "daemon-f6-restart", configProvider: async () => config,
          store,
          authorization: new ExecutionAuthorization({
            policyGate: new PolicyGate(config, { approvalStore: store2 }),
            toolRegistry: buildDefaultToolIndex().registry,
          }),
          ownershipRegistry: registry,
          executor: { execute: async (w: any) => { executed.push(w.id); return { outcome: "success" }; } } as any,
        }, { maxConcurrency: 2, orphanThresholdMs: 60_000 });
        const tick = await restart.tick(run.id);
        assert.ok(tick.dispatched.includes(worker.id), "a fresh scheduler resumes the mixed-capability worker");
        await restart.shutdown();
      });

      // Busy-polls the scheduler up to ~2s (200 x 10ms) waiting for dispatch;
      // declared timeout gives headroom on a loaded CI box.
      it("(10) single-capability approval behavior is unchanged", { timeout: 30_000 }, async () => {
        const { sched, approvalStore, executed } = await realScheduler({ "cap.a": "ask" });
        const { run, worker } = await seed(["cap.a"]);
        await sched.tick(run.id);
        const pending = await approveAll(approvalStore, run.id);
        assert.equal(pending.length, 1);
        const resumed = await sched.tick(run.id);
        assert.ok(resumed.dispatched.includes(worker.id));
        for (let i = 0; i < 200 && executed.length === 0; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(executed.length, 1);
        await sched.shutdown();
      });
    });

    // ── F7: an operator DENIAL is terminal for the worker ────────────
    //
    // A denial is a definitive authorization outcome, not a pending approval.
    // Before this, reconciliation only ever resumed on `isApproved === true`,
    // so a denied worker stayed `blocked`/`approval_required` forever: it never
    // failed, dependents were never attributed, and the run could not reach a
    // terminal state. Denial now fails the worker with
    // `failureKind: "approval_denied"`, preserving the denied approval identity
    // and capability, and lets ordinary dependency propagation do the rest.
    describe("F7 — operator denial is terminal", () => {
      async function realSchedulerF7(tools: Record<string, "allow" | "ask" | "deny">) {
        const { ApprovalStore } = await import("../../src/governance/approvals/approval-store.js");
        const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
        const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
        const { buildDefaultToolIndex } = await import("../../src/capabilities/tools/tool-registry.js");
        const approvalStore = new ApprovalStore(cwd);
        await approvalStore.load();
        const config = minimalConfig() as any;
        config.permissions.default = "ask";
        config.permissions.sessionMode = "ask";
        config.permissions.tools = tools;
        const executed: string[] = [];
        const sched = new CoordinationScheduler({
          cwd, daemonInstanceId: "daemon-f7", configProvider: async () => config,
          store, authorization: new ExecutionAuthorization({
            policyGate: new PolicyGate(config, { approvalStore }),
            toolRegistry: buildDefaultToolIndex().registry,
          }),
          ownershipRegistry: registry,
          executor: { execute: async (w: any) => { executed.push(w.id); return { outcome: "success" }; } } as any,
        }, { maxConcurrency: 3, orphanThresholdMs: 60_000 });
        return { sched, approvalStore, executed, config };
      }

      async function seedRun(workers: Array<{ caps: string[]; scopes?: string[]; depsOf?: number; attempt?: number }>) {
        const run = createCoordinationRun({ sessionId: "s1", rootGoal: "f7", coordinatorAgentId: "alix" });
        run.hostKind = "cli";
        run.sessionMode = "ask";
        await store.save(run);
        const created = [];
        for (const spec of workers) {
          const w = createWorkerAssignment({
            coordinationRunId: run.id, agentId: `alix#${created.length + 1}`,
            taskLabel: `w${created.length + 1}`, goalPrompt: "do", status: "pending",
            requiredCapabilities: spec.caps, attempt: spec.attempt ?? 0, maxAttempts: 3,
            ownershipScopes: spec.scopes ?? [],
            ownershipClaims: (spec.scopes ?? []).map(p => ({ path: p, recursive: false })),
          });
          await store.addWorker(run.id, w);
          created.push(w);
        }
        // Wire dependencies after ids exist.
        for (let i = 0; i < workers.length; i++) {
          const spec = workers[i]!;
          if (spec.depsOf === undefined) continue;
          await store.patchWorker(run.id, created[i]!.id, { dependencies: [created[spec.depsOf]!.id] });
        }
        const fresh = await store.load(run.id);
        return { run: fresh!, workers: fresh!.workers };
      }

      it("(1) single worker, one denied approval -> worker fails with approval_denied", async () => {
        const { sched, approvalStore, executed } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([{ caps: ["cap.a"] }]);
        await sched.tick(run.id);

        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        assert.equal(pending.length, 1);
        await approvalStore.resolve(pending[0]!.id, "denied", "f7-test");

        const tick = await sched.tick(run.id);
        const loaded = await store.load(run.id);
        const w = loaded!.workers.find(x => x.id === workers[0]!.id)!;

        assert.equal(w.status, "failed");
        assert.equal(w.failureKind, "approval_denied");
        assert.match(w.error ?? "", /denied/i);
        // The denial evidence is preserved on the record.
        assert.equal((w as any).approvalId, pending[0]!.id);
        assert.equal((w as any).approvalDeniedCapability, "cap.a");
        assert.deepEqual(tick.dispatched, [], "a denied attempt never dispatches");
        assert.equal(executed.length, 0);
        await sched.shutdown();
      });

      it("(2) mixed allow/deny capability decisions: denied worker fails, no execution", async () => {
        const { sched, approvalStore, executed } = await realSchedulerF7({ "cap.allow": "allow", "cap.ask": "ask" });
        const { run, workers } = await seedRun([{ caps: ["cap.allow", "cap.ask"] }]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        await approvalStore.resolve(pending[0]!.id, "denied", "f7-test");

        await sched.tick(run.id);
        const w = (await store.load(run.id))!.workers.find(x => x.id === workers[0]!.id)!;
        assert.equal(w.status, "failed");
        assert.equal(w.failureKind, "approval_denied");
        assert.equal(executed.length, 0);
        await sched.shutdown();
      });

      it("(3) two gated capabilities, one approved and one denied -> fails on the denial", async () => {
        const { sched, approvalStore, executed } = await realSchedulerF7({ "cap.a": "ask", "cap.b": "ask" });
        const { run, workers } = await seedRun([{ caps: ["cap.a", "cap.b"] }]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        assert.equal(pending.length, 2, "each gated capability has its own approval");
        const byCap = new Map(pending.map(p => [p.capabilities![0]!, p]));
        await approvalStore.resolve(byCap.get("cap.a")!.id, "approved", "f7-test");
        await approvalStore.resolve(byCap.get("cap.b")!.id, "denied", "f7-test");

        await sched.tick(run.id);
        const w = (await store.load(run.id))!.workers.find(x => x.id === workers[0]!.id)!;
        assert.equal(w.status, "failed", "one denial is enough to refuse the attempt");
        assert.equal(w.failureKind, "approval_denied");
        assert.equal((w as any).approvalDeniedCapability, "cap.b");
        assert.equal(executed.length, 0);
        await sched.shutdown();
      });

      it("(4) denied worker with dependents: dependents are attributed via propagation", async () => {
        const { sched, approvalStore } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([
          { caps: ["cap.a"], scopes: ["a.md"] },
          { caps: ["cap.a"], scopes: ["b.md"], depsOf: 0 },
        ]);
        await sched.tick(run.id);
        // Deny every pending approval so the producer is refused.
        for (const p of approvalStore.listPending().filter(a => a.coordinationRunId === run.id)) {
          await approvalStore.resolve(p.id, "denied", "f7-test");
        }
        await sched.tick(run.id);

        const loaded = await store.load(run.id);
        const producer = loaded!.workers.find(x => x.id === workers[0]!.id)!;
        const dependent = loaded!.workers.find(x => x.id === workers[1]!.id)!;
        assert.equal(producer.status, "failed");
        assert.equal(producer.failureKind, "approval_denied");
        assert.equal(dependent.status, "blocked");
        assert.equal(dependent.blockReason, "dependency_failed");
        assert.ok(
          (dependent.failureProvenance?.rootCauseWorkerIds ?? []).includes(producer.id),
          "the dependent's failure provenance names the denied worker",
        );
        await sched.shutdown();
      });

      // Busy-polls the scheduler up to ~2s (200 x 10ms) waiting for dispatch;
      // declared timeout gives headroom on a loaded CI box.
      it("(5) denied worker with an independent worker: the independent one keeps its outcome", { timeout: 30_000 }, async () => {
        const { sched, approvalStore, executed } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([
          { caps: ["cap.a"], scopes: ["a.md"] },
          { caps: ["cap.a"], scopes: ["b.md"] },
        ]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        const byWorker = new Map(pending.map(p => [p.workerId!, p]));
        // Deny the first worker, approve the second.
        await approvalStore.resolve(byWorker.get(workers[0]!.id)!.id, "denied", "f7-test");
        await approvalStore.resolve(byWorker.get(workers[1]!.id)!.id, "approved", "f7-test");

        await sched.tick(run.id);
        for (let i = 0; i < 200 && executed.length < 1; i++) await new Promise(r => setTimeout(r, 10));

        const loaded = await store.load(run.id);
        const denied = loaded!.workers.find(x => x.id === workers[0]!.id)!;
        const independent = loaded!.workers.find(x => x.id === workers[1]!.id)!;
        assert.equal(denied.status, "failed");
        assert.equal(denied.failureKind, "approval_denied");
        assert.notEqual(independent.status, "failed", "an independent worker is not failed by another's denial");
        assert.deepEqual(executed, [workers[1]!.id], "only the approved worker executes");
        await sched.shutdown();
      });

      it("(6) repeated reconciliation after denial is idempotent", async () => {
        const { sched, approvalStore } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([{ caps: ["cap.a"] }]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        await approvalStore.resolve(pending[0]!.id, "denied", "f7-test");
        await sched.tick(run.id);
        const first = (await store.load(run.id))!.workers.find(x => x.id === workers[0]!.id)!;
        const firstError = first.error;
        const firstCompletedAt = first.completedAt;

        // Further ticks must not rewrite or revive it.
        await sched.tick(run.id);
        await sched.tick(run.id);
        const later = (await store.load(run.id))!.workers.find(x => x.id === workers[0]!.id)!;
        assert.equal(later.status, "failed");
        assert.equal(later.failureKind, "approval_denied");
        assert.equal(later.error, firstError);
        assert.equal(later.completedAt, firstCompletedAt);
        assert.equal(approvalStore.list().filter(a => a.capabilities?.includes("cap.a")).length, 1, "no new approval");
        await sched.shutdown();
      });

      it("(7) daemon restart after denial stays terminal", async () => {
        const { sched, approvalStore, config } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([{ caps: ["cap.a"] }]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        await approvalStore.resolve(pending[0]!.id, "denied", "f7-test");
        await sched.tick(run.id);
        await sched.shutdown();

        const { ApprovalStore } = await import("../../src/governance/approvals/approval-store.js");
        const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
        const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
        const { buildDefaultToolIndex } = await import("../../src/capabilities/tools/tool-registry.js");
        const store2 = new ApprovalStore(cwd);
        await store2.load();
        const restart = new CoordinationScheduler({
          cwd, daemonInstanceId: "daemon-f7-restart", configProvider: async () => config,
          store, authorization: new ExecutionAuthorization({
            policyGate: new PolicyGate(config, { approvalStore: store2 }),
            toolRegistry: buildDefaultToolIndex().registry,
          }),
          ownershipRegistry: registry,
          executor: immediateExecutor(),
        }, { maxConcurrency: 2, orphanThresholdMs: 60_000 });

        const tick = await restart.tick(run.id);
        const reloaded = (await store.load(run.id))!.workers.find(x => x.id === workers[0]!.id)!;
        assert.equal(reloaded.status, "failed", "a restart must never revive a denied attempt");
        assert.equal(reloaded.failureKind, "approval_denied");
        assert.deepEqual(tick.dispatched, []);
        await restart.shutdown();
      });

      it("(8) a denial bound to another worker/attempt cannot terminate this worker", async () => {
        const { sched, approvalStore } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([
          { caps: ["cap.a"], scopes: ["a.md"] },
          { caps: ["cap.a"], scopes: ["b.md"] },
        ]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        const byWorker = new Map(pending.map(p => [p.workerId!, p]));
        // Deny worker 1 only; worker 2 stays pending.
        await approvalStore.resolve(byWorker.get(workers[0]!.id)!.id, "denied", "f7-test");

        await sched.tick(run.id);
        const loaded = await store.load(run.id);
        const other = loaded!.workers.find(x => x.id === workers[1]!.id)!;
        assert.equal(
          other.status, "blocked",
          "another worker's denial must not terminate this one",
        );
        assert.equal(other.failureKind, undefined);
        await sched.shutdown();
      });

      it("(9) denial produces no successful consumption and no verified-success receipt", async () => {
        const { sched, approvalStore } = await realSchedulerF7({ "cap.a": "ask" });
        const { run } = await seedRun([{ caps: ["cap.a"] }]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        await approvalStore.resolve(pending[0]!.id, "denied", "f7-test");
        await sched.tick(run.id);

        await approvalStore.load();
        const record = approvalStore.list().find(a => a.id === pending[0]!.id)!;
        assert.equal(record.status, "denied", "the denial is preserved, never converted to approval");
        assert.notEqual(record.executionOutcome, "succeeded");
        const loaded = await store.load(run.id);
        assert.notEqual(loaded!.status, "completed", "a denied run is never completed");
        assert.equal(loaded!.aggregateResultRef, undefined, "no aggregate success is invented");
        await sched.shutdown();
      });

      // Busy-polls the scheduler up to ~2s (200 x 10ms) waiting for dispatch;
      // declared timeout gives headroom on a loaded CI box.
      it("(10) approved and pending flows are unchanged", { timeout: 30_000 }, async () => {
        const { sched, approvalStore, executed } = await realSchedulerF7({ "cap.a": "ask" });
        const { run, workers } = await seedRun([
          { caps: ["cap.a"], scopes: ["a.md"] },
          { caps: ["cap.a"], scopes: ["b.md"] },
        ]);
        await sched.tick(run.id);
        const pending = approvalStore.listPending().filter(a => a.coordinationRunId === run.id);
        const byWorker = new Map(pending.map(p => [p.workerId!, p]));
        await approvalStore.resolve(byWorker.get(workers[0]!.id)!.id, "approved", "f7-test");
        // worker 2 stays pending

        await sched.tick(run.id);
        for (let i = 0; i < 200 && executed.length < 1; i++) await new Promise(r => setTimeout(r, 10));
        const loaded = await store.load(run.id);
        const approvedWorker = loaded!.workers.find(x => x.id === workers[0]!.id)!;
        const stillPending = loaded!.workers.find(x => x.id === workers[1]!.id)!;
        assert.equal(approvedWorker.status, "completed", "approval still resumes and completes");
        assert.equal(stillPending.status, "blocked", "a pending approval still keeps waiting");
        assert.equal(stillPending.blockReason, "approval_required");
        assert.deepEqual(executed, [workers[0]!.id]);
        await sched.shutdown();
      });
    });

    it("a genuinely idle run still exits idle", async () => {
      // No workers at all: nothing actionable and no approval block.
      const run = createCoordinationRun({ sessionId: "s1", rootGoal: "nothing", coordinatorAgentId: "alix" });
      await store.save(run);
      const sched = createScheduler({ authorization: allowAllAuth() });

      const result = await sched.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000, maxIdleTicks: 3 });

      assert.equal(result.stopReason, "idle", "the idle exit must not be disabled");
    });

    it("terminal state wins over a leftover approval-blocked worker record", async () => {
      // A terminal run whose worker record still says blocked: terminal
      // precedence must win, so it is never reported as awaiting approval.
      const run = createCoordinationRun({ sessionId: "s1", rootGoal: "terminal", coordinatorAgentId: "alix" });
      run.status = "failed";
      await store.save(run);
      const worker = createWorkerAssignment({
        coordinationRunId: run.id, agentId: "w1", taskLabel: "stale", goalPrompt: "do",
        requiredCapabilities: ["risky.cap"], attempt: 0, maxAttempts: 3,
        status: "blocked", blockReason: "approval_required",
      });
      await store.addWorker(run.id, worker);
      // addWorker recomputes status; force it back to terminal for the test.
      const forced = await store.load(run.id);
      forced!.status = "failed";
      await store.save(forced!);

      // The stub asks for approval AND the config must agree: reconciliation
      // now recomputes the policy verdict, so an allow-by-default config would
      // correctly resume the worker instead of leaving it blocked.
      const sched = createScheduler({
        authorization: switchableAuth().auth,
        config: (() => { const c = minimalConfig() as any; c.permissions.default = "ask"; c.permissions.sessionMode = "ask"; c.permissions.tools = { "risky.cap": "ask" }; return c; })(),
      });
      const result = await sched.tick(run.id);

      assert.equal(result.runStatus, "failed");
      assert.deepEqual(result.approvalBlocked, [], "a terminal run is never awaiting approval");
      assert.equal(result.awaitingApproval.length, 0);
    });

    it("does not create duplicate approvals across repeated ticks", async () => {
      // A real approval store proves the accounting change creates nothing.
      const { ApprovalStore } = await import("../../src/governance/approvals/approval-store.js");
      const approvalStore = new ApprovalStore(cwd);
      await approvalStore.load();
      const { ExecutionAuthorization } = await import("../../src/runtime-state/runtime/execution-authorization.js");
      const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
      const { buildDefaultToolIndex } = await import("../../src/capabilities/tools/tool-registry.js");
      const config = minimalConfig() as any;
      // `minimalConfig` is allow-by-default; asking is the whole point here.
      config.permissions.default = "ask";
      config.permissions.tools = { "risky.cap": "ask" };
      const auth = new ExecutionAuthorization({
        policyGate: new PolicyGate(config, { approvalStore }),
        toolRegistry: buildDefaultToolIndex().registry,
      });
      const sched = new CoordinationScheduler({
        cwd, daemonInstanceId: "daemon-f5", configProvider: async () => config,
        store, authorization: auth, ownershipRegistry: registry, executor: immediateExecutor(),
      }, { maxConcurrency: 2, orphanThresholdMs: 60_000 });

      const run = createCoordinationRun({ sessionId: "s1", rootGoal: "dedupe", coordinatorAgentId: "alix" });
      run.hostKind = "cli"; run.sessionMode = "ask";
      await store.save(run);
      const worker = createWorkerAssignment({
        coordinationRunId: run.id, agentId: "w1", taskLabel: "unknown", goalPrompt: "do",
        requiredCapabilities: ["risky.cap"], attempt: 0, maxAttempts: 3,
        ownershipScopes: ["x.md"], ownershipClaims: [{ path: "x.md", recursive: false }],
      });
      await store.addWorker(run.id, worker);

      for (let i = 0; i < 4; i++) await sched.tick(run.id);
      const all = approvalStore.list().filter(a => a.capabilities?.includes("risky.cap"));
      assert.equal(all.length, 1, `repeated ticks must not mint duplicate approvals, got ${all.length}`);
      assert.equal(approvalStore.listPending().length, 1);
      await sched.shutdown();
    });
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

  it("runUntilIdle still completes when the first terminal completed patch is a transient null", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "flaky patch", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "flaky", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    // Simulate a transient store-read failure on the first completed-status
    // patch (Windows Defender EBUSY shape): patchWorker returns null once,
    // then the real implementation runs on retry.
    const originalPatchWorker = store.patchWorker.bind(store);
    let flakyCalls = 0;
    store.patchWorker = async (runId: string, workerId: string, patch: Record<string, unknown>) => {
      if (patch.status === "completed" && flakyCalls === 0) {
        flakyCalls++;
        return null;
      }
      return originalPatchWorker(runId, workerId, patch);
    };

    try {
      const result = await scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });

      assert.equal(result.finalStatus, "completed");
      assert.equal(result.stopReason, "completed");
      assert.ok(flakyCalls >= 1, "flaky null path was exercised");

      const stored = await store.load(run.id);
      const storedWorker = stored!.workers.find(w => w.id === worker.id)!;
      assert.equal(storedWorker.status, "completed");
    } finally {
      store.patchWorker = originalPatchWorker;
    }
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

  it("runUntilIdle reaps a hung worker at the per-worker ceiling", async () => {
    const { executor } = createDeferredExecutor(); // never resolved
    const sched = createScheduler({ executor });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "watchdog test", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "stuck", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    const result = await sched.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 10000, workerTimeoutMs: 100 });

    // Watchdog fires long before the run budget: worker failed with timeout.
    const stored = await store.load(run.id);
    const storedWorker = stored!.workers.find(w => w.id === worker.id)!;
    assert.equal(storedWorker.status, "failed");
    assert.equal(storedWorker.failureKind, "timeout");
    assert.match(storedWorker.error ?? "", /timed out/);
    assert.ok(result.durationMs < 5000);

    await sched.shutdown();
  });

  it("tick reaps a hung worker at the per-worker ceiling", async () => {
    const { executor } = createDeferredExecutor(); // never resolves
    const sched = createScheduler({ executor, workerTimeoutMs: 40 });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "tick watchdog", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "stuck", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);

    await sched.tick(run.id); // dispatch
    await new Promise(r => setTimeout(r, 80));
    await sched.tick(run.id); // reap before reconcile

    const stored = await store.load(run.id);
    const storedWorker = stored!.workers.find(w => w.id === worker.id)!;
    assert.equal(storedWorker.status, "failed");
    assert.equal(storedWorker.failureKind, "timeout");

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
    // The run itself is terminal: recomputeRunStatus maps an all-cancelled run
    // to "blocked", which the resume sweeps still treat as active.
    assert.equal(loaded!.status, "cancelled");
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

  it("cancelRun releases leases and marks the persisted graph cancelled", async () => {
    const { executor, pending } = createDeferredExecutor();
    const sched = createScheduler({ executor });

    const graph = {
      id: "graph_cancel_case",
      schemaVersion: "1.0",
      workflowId: "wf_cancel_case",
      rootGoal: "cancel case",
      status: "running" as const,
      strategy: "sequential" as const,
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await persistGraph(graph as any, cwd);

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "cancel case", coordinatorAgentId: "alix" });
    run.taskGraphId = graph.id;
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "first", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
      ownershipScopes: [".tmp/cancel-case.md"],
      ownershipClaims: [{ path: ".tmp/cancel-case.md", recursive: false, sourcePattern: ".tmp/cancel-case.md" }],
    });
    await store.addWorker(run.id, worker);
    await sched.tick(run.id);
    const leased = (await store.load(run.id))!.workers[0].leaseIds ?? [];
    assert.ok(leased.length > 0, "worker should hold an ownership lease while running");

    await sched.cancelRun(run.id);

    // Leases are released, not merely detached from the worker record: an
    // active registry record would block the next run until its TTL.
    for (const leaseId of leased) {
      const record = registry.get(leaseId);
      assert.equal(record?.status, "released", `lease ${leaseId} should be released`);
    }
    const persistedGraph = JSON.parse(
      await readFile(join(cwd, ".alix", "graphs", `${graph.id}.json`), "utf-8"),
    );
    assert.equal(persistedGraph.status, "cancelled");

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

    // Wait for the async execution to settle and reset the worker to
    // pending (poll instead of a fixed sleep — load-insensitive).
    for (let i = 0; i < 200; i++) {
      const current = (await store.load(run.id))!.workers[0];
      if (current.status === "pending") break;
      await new Promise(r => setTimeout(r, 10));
    }

    const afterTick1 = await store.load(run.id);
    assert.equal(afterTick1!.workers[0].status, "pending", "worker was reset to pending for retry");

    // Tick 2: worker is pending again, gets re-dispatched
    const r2 = await sched.tick(run.id);
    assert.equal(r2.dispatched.length, 1);

    // Poll until the second attempt settles back to pending (attempt 2 < 3).
    for (let i = 0; i < 200; i++) {
      const current = (await store.load(run.id))!.workers[0];
      if (current.status === "pending" && (current.attempt ?? 0) >= 2) break;
      await new Promise(r => setTimeout(r, 10));
    }

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

// ── tick.completed emission gating ──────────────────────────────────────
//
// `coordination.tick.completed` records a MEANINGFUL transition, not a poll
// heartbeat. Pinned because session 1791853059081 emitted 331 ticks (98%
// no-ops, 26% of the session log) and each write contended for the
// events.jsonl append lock a worker's correctness events needed.

describe("CoordinationScheduler — tick.completed emission gating", () => {
  let cwd: string;
  let store: CoordinationStore;
  let registry: OwnershipRegistry;

  function recordingEventLog() {
    const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
    return {
      appended,
      log: {
        append: async (event: { type: string; payload: Record<string, unknown> }) => {
          appended.push({ type: event.type, payload: event.payload });
        },
        readAll: async () => [],
      } as any,
      ticks: () => appended.filter(e => e.type === "coordination.tick.completed"),
    };
  }

  function build(executor: any, log: any, authorization: ExecutionAuthorization = allowAllAuth()) {
    return new CoordinationScheduler({
      cwd,
      daemonInstanceId: "daemon-tick",
      configProvider: async () => minimalConfig(),
      store,
      authorization,
      ownershipRegistry: registry,
      executor,
      eventLog: log,
    }, { maxConcurrency: 4, orphanThresholdMs: 60000 });
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-tick-"));
    store = new CoordinationStore(cwd);
    registry = new OwnershipRegistry(cwd, { sessionId: "tick-session" });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("emits nothing for an idle tick (no dispatch, no change)", async () => {
    const rec = recordingEventLog();
    const scheduler = build(immediateExecutor(), rec.log);
    // A run whose only worker is dependency-blocked cannot dispatch — an
    // idle poll. It must record nothing.
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "idle", coordinatorAgentId: "alix" });
    await store.save(run);
    await scheduler.tick(run.id); // first tick: no ready workers, nothing changes
    rec.appended.length = 0;
    await scheduler.tick(run.id); // repeated idle poll
    assert.equal(rec.ticks().length, 0);
    await scheduler.shutdown();
  });

  it("emits exactly one event when a tick dispatches", async () => {
    const rec = recordingEventLog();
    const scheduler = build(immediateExecutor(), rec.log);
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "dispatch", coordinatorAgentId: "alix" });
    await store.save(run);
    const w = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "w", goalPrompt: "do", requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, w);
    const result = await scheduler.tick(run.id);
    assert.equal(result.dispatched.length, 1);
    assert.equal(rec.ticks().length, 1);
    assert.deepEqual(rec.ticks()[0]!.payload.dispatched, [w.id]);
    await scheduler.shutdown();
  });

  it("emits once for a denial and once for an approval wait, nothing when idle", async () => {
    const rec = recordingEventLog();
    const scheduler = build(immediateExecutor(), rec.log, denyAllAuth());
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "deny", coordinatorAgentId: "alix" });
    await store.save(run);
    const w = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "w", goalPrompt: "do", requiredCapabilities: ["file.write"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, w);
    await scheduler.tick(run.id);
    const first = rec.ticks();
    assert.equal(first.length, 1);
    assert.deepEqual(first[0]!.payload.denied, [w.id]);
    // The worker is now failed(denied); re-ticking is idle → no further event.
    await scheduler.tick(run.id);
    assert.equal(rec.ticks().length, 1);
    await scheduler.shutdown();
  });

  // Workload: polls until the run settles (waitUntil budget 8s) plus reactive
  // ticks. Timeout is the workload bound; the assertions are the contract.
  it("emits exactly one terminal tick, whenever the transition is observed", { timeout: 30_000 }, async () => {
    const rec = recordingEventLog();
    const scheduler = build(immediateExecutor(), rec.log);
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "terminal", coordinatorAgentId: "alix" });
    await store.save(run);
    const w = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "w", goalPrompt: "do", requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, w);

    // Dispatch the worker; its execution settles asynchronously, so the run's
    // terminal status may appear after the dispatching tick. Keep ticking until
    // it is observed, then assert a terminal tick exists and repeated terminal
    // polls never add another.
    await scheduler.tick(run.id);
    await waitUntil(async () => (await store.load(run.id))?.status === "completed", 8_000);
    // Poll until the terminal transition is OBSERVED (entry-guard or in-tick).
    let guard = 0;
    while (!rec.ticks().some((t) => t.payload.runStatus === "completed") && guard++ < 5) {
      await scheduler.tick(run.id);
    }
    const terminalTicks = rec.ticks().filter((t) => t.payload.runStatus === "completed");
    assert.equal(terminalTicks.length, 1, "exactly one terminal tick");
    const afterTerminal = rec.ticks().length;
    // Repeated terminal polls return via the entry guard → no duplicate event.
    await scheduler.tick(run.id);
    await scheduler.tick(run.id);
    assert.equal(rec.ticks().length, afterTerminal);
    await scheduler.shutdown();
  });

  it("records scheduler metrics on the MetricsSink path (never the EventLog)", async () => {
    const rec = recordingEventLog();
    const observations: Array<{ name: string; value: number; type?: string }> = [];
    const scheduler = new CoordinationScheduler({
      cwd,
      daemonInstanceId: "daemon-metrics",
      configProvider: async () => minimalConfig(),
      store,
      authorization: allowAllAuth(),
      ownershipRegistry: registry,
      executor: immediateExecutor(),
      eventLog: rec.log,
      metricsSink: { observe: (o) => observations.push({ name: o.name, value: o.value, type: o.type }) },
    }, { maxConcurrency: 4, orphanThresholdMs: 60000 });

    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "metrics", coordinatorAgentId: "alix" });
    await store.save(run);
    const w = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "w", goalPrompt: "do", requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, w);

    await scheduler.tick(run.id); // a useful tick (dispatch)
    await scheduler.tick(run.id); // idle tick (worker already running/completed)

    const names = observations.map((o) => o.name);
    const sum = (n: string) => observations.filter((o) => o.name === n).reduce((s, o) => s + o.value, 0);
    assert.equal(sum("coordination_ticks_total"), 2);
    assert.equal(sum("coordination_ticks_useful_total"), 1);
    assert.equal(sum("coordination_dispatches_total"), 1);
    assert.ok(names.includes("coordination_tick_duration_ms"));
    assert.ok(names.includes("coordination_reconciliation_duration_ms"));
    // Durations are timers, counters are deltas — the type is always supplied.
    assert.equal(observations.find((o) => o.name === "coordination_tick_duration_ms")?.type, "histogram_sample");
    assert.equal(observations.find((o) => o.name === "coordination_ticks_total")?.type, "counter_delta");
    // No scheduler metric leaked into the authoritative EventLog.
    assert.equal(rec.appended.some((e) => String(e.payload?.name ?? "").startsWith("coordination_")), false);
    await scheduler.shutdown();
  });
});

// ── runUntilIdle event-driven cadence (P4) ──────────────────────────────
//
// While workers are active the loop waits on settlement instead of ticking
// every poll: a full tick runs only on settlement, watchdog expiry, reap, or
// idle dispatch. Pinned because the old tick-every-poll loop ran ~240 cycles
// for a 241s run, each tick doing reconcile + store loads for no new
// information.

describe("CoordinationScheduler — runUntilIdle event-driven cadence", () => {
  let cwd: string;
  let store: CoordinationStore;
  let registry: OwnershipRegistry;

  function build(executor: any) {
    return new CoordinationScheduler({
      cwd,
      daemonInstanceId: "daemon-cadence",
      configProvider: async () => minimalConfig(),
      store,
      authorization: allowAllAuth(),
      ownershipRegistry: registry,
      executor,
    }, { maxConcurrency: 4, orphanThresholdMs: 60000 });
  }

  async function seedOneWorker(runGoal = "cadence") {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: runGoal, coordinatorAgentId: "alix" });
    await store.save(run);
    const w = createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "w", goalPrompt: "do", requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3 });
    await store.addWorker(run.id, w);
    return { run, worker: w };
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-cadence-"));
    store = new CoordinationStore(cwd);
    registry = new OwnershipRegistry(cwd, { sessionId: "cadence-session" });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // Workload: one 300ms run budget bounds a worker that never settles; the
  // timeout below is the workload bound, not a tight assertion (slow runners
  // must not flake: the loop exits on timeoutMs, never on tick count).
  it("ticks once while a worker runs past the timeout (no per-poll ticks)", { timeout: 30_000 }, async () => {
    const { executor } = createDeferredExecutor(); // never settles
    const scheduler = build(executor);
    const { run } = await seedOneWorker("cadence-timeout");
    // Watchdog (1000ms default at poll 10) exceeds the run timeout, and the
    // worker never settles: exactly the dispatch tick, then event-driven
    // waits until the timeout — the old loop would tick ~30 times here.
    const result = await scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 300, workerTimeoutMs: 60_000 });
    assert.equal(result.stopReason, "timeout");
    assert.ok(result.cycles <= 2, `expected ~1 tick, got ${result.cycles}`);
    assert.ok(result.cycles >= 1);
    await scheduler.shutdown();
  });

  // Workload: same never-settling worker with a 50ms watchdog over a 300ms
  // budget; generous timeout so loaded CI never flakes on the wall clock.
  it("watchdog ticks bound idle polling while workers hang", { timeout: 30_000 }, async () => {
    const { executor } = createDeferredExecutor(); // never settles
    const scheduler = build(executor);
    const { run } = await seedOneWorker("cadence-watchdog");
    // A 50ms watchdog over 300ms: a handful of ticks — far below per-poll (~30).
    const result = await scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 300, workerTimeoutMs: 60_000, watchdogIntervalMs: 50 });
    assert.equal(result.stopReason, "timeout");
    assert.ok(result.cycles >= 2, `watchdog should tick more than once, got ${result.cycles}`);
    assert.ok(result.cycles <= 12, `watchdog must bound ticks, got ${result.cycles}`);
    await scheduler.shutdown();
  });

  // Workload: resolve after executor registration; assertions cover completion
  // and dispatch without depending on scheduler or store latency.
  it("a settling worker wakes the loop promptly and completes", { timeout: 30_000 }, async () => {
    const { executor, pending } = createDeferredExecutor();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const observedExecutor = {
      execute: (worker: any, context: any, signal: AbortSignal) => {
        const execution = executor.execute(worker, context, signal);
        markStarted();
        return execution;
      },
    };
    const scheduler = build(observedExecutor);
    const { run, worker } = await seedOneWorker("cadence-settle");
    const runPromise = scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });
    await started;
    const deferred = pending.get(worker.id);
    assert.ok(deferred, `executor should register worker ${worker.id} before settlement`);
    deferred.resolve({ outcome: "success" });
    const result = await runPromise;
    assert.equal(result.finalStatus, "completed");
    assert.equal(result.dispatched, 1);
    assert.ok(result.cycles <= 8, `settlement should complete in a few ticks, got ${result.cycles}`);
    await scheduler.shutdown();
  });
});
