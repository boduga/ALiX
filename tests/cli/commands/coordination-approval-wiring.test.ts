/**
 * coordination-approval-wiring.test.ts — SRAP PR B CLI host parity.
 *
 * The CLI must host coordination on the SAME durable approval authority as the
 * daemon. This is a REAL-COMPONENT integration test for the CLI path: the gate
 * is built by the exported CLI wiring helper `buildCoordinationPolicyGate`,
 * which resolves the project-scoped ApprovalStore exactly as
 * `src/interfaces/cli/commands/coordination.ts` does for `run`/`tick`/`resume`.
 * A mocked `isApproved` callback is deliberately NOT used — the defect class is
 * a fabricated/durable-authority gap, and a mock hides it.
 *
 * Chain under test:
 *
 *   buildCoordinationPolicyGate → PolicyGate → ExecutionAuthorization
 *     → authorizeWorker → CoordinationScheduler (createCoordinationScheduler)
 *     → authoritative ApprovalStore (separate-process resolve) → resumption
 *
 * Verification matrix (SRAP PR B):
 *  1. allowed capability executes normally (no approval)
 *  2. ask-gated capability creates a REAL durable pending approval
 *  3. missing store fails closed — never an `approvalId` of "unknown"
 *  4. a separate process observes the durable approval
 *  5. exact-binding approval resumes the worker and is consumed once
 *  6. wrong worker/run/attempt rejected
 *  7. changed capability set or policy revision rejected
 *  8. consumed/expired approval rejected
 *  9. CLI restart/reload — the binding survives a fresh gate+store
 * 10. host parity with the daemon-wired gate (same decision + binding)
 *
 * The daemon-path regression is the unchanged
 * `tests/kernel/coordination-approval-binding.test.ts` suite (same scheduler,
 * same gate contract), run alongside this file.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCoordinationPolicyGate, resumeCoordinationExecution } from "../../../src/interfaces/cli/commands/coordination.js";
import { PolicyGate } from "../../../src/governance/policy/policy-gate.js";
import { ExecutionAuthorization } from "../../../src/runtime-state/runtime/execution-authorization.js";
import { ApprovalStore } from "../../../src/governance/approvals/approval-store.js";
import { closeSharedLedger } from "../../../src/runtime-state/storage/runtime-ledger.js";
import { removeTempDirSync } from "../../helpers/temp.js";
import { CoordinationStore } from "../../../src/coordination/kernel/coordination-store.js";
import { createCoordinationScheduler } from "../../../src/coordination/kernel/coordination-scheduler.js";
import { OwnershipRegistry } from "../../../src/coordination/ownership/ownership-registry.js";
import { authorizeWorker } from "../../../src/coordination/kernel/coordination-authorization.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
} from "../../../src/coordination/kernel/coordination-types.js";

function minimalConfig(
  overrides: {
    sessionMode?: "auto" | "ask" | "bypass";
    tools?: Record<string, "allow" | "ask" | "deny">;
    default?: "allow" | "ask" | "deny";
  } = {},
) {
  return {
    version: 1 as const,
    model: { provider: "test", name: "test" },
    permissions: {
      default: overrides.default ?? "ask",
      tools: overrides.tools ?? { "filesystem.write": "ask" },
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: overrides.sessionMode ?? "ask",
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

type Config = ReturnType<typeof minimalConfig>;
type ExecutorImpl = (worker: { id: string }) => Promise<{ outcome: "success" | "failure" }>;

type Harness = {
  cwd: string;
  config: Config;
  gate: PolicyGate;
  auth: ExecutionAuthorization;
  store: CoordinationStore;
  registry: OwnershipRegistry;
  scheduler: ReturnType<typeof createCoordinationScheduler>;
};

/** Build a scheduler exactly as the CLI does (factory + real authorization). */
function buildScheduler(
  cwd: string,
  config: Config,
  gate: PolicyGate,
  executorImpl: ExecutorImpl,
  daemonInstanceId = "cli-host",
) {
  const auth = new ExecutionAuthorization({ policyGate: gate });
  const store = new CoordinationStore(cwd);
  const registry = new OwnershipRegistry(cwd, { sessionId: "cli-approval-session" });
  const scheduler = createCoordinationScheduler(
    {
      cwd,
      daemonInstanceId,
      configProvider: async () => config,
      store,
      authorization: auth,
      ownershipRegistry: registry,
      executor: { execute: async (worker: unknown) => executorImpl(worker as { id: string }) } as never,
    },
    { maxConcurrency: 2, orphanThresholdMs: 60_000 },
  );
  return { auth, store, registry, scheduler };
}

/** Build a CLI-hosted harness: the gate comes from the CLI wiring helper. */
async function buildCliHarness(
  config: Config = minimalConfig(),
  executorImpl: ExecutorImpl = async () => ({ outcome: "success" }),
): Promise<Harness> {
  const cwd = mkdtempSync(join(tmpdir(), "coord-cli-approval-"));
  const gate = await buildCoordinationPolicyGate(cwd, config);
  const { auth, store, registry, scheduler } = buildScheduler(cwd, config, gate, executorImpl);
  const harness: Harness = { cwd, config, gate, auth, store, registry, scheduler };
  activeHarnesses.push(harness);
  return harness;
}

async function seedWorker(
  h: Harness,
  opts: {
    capabilities?: string[];
    ownershipClaims?: { path: string; recursive: boolean }[];
    attempt?: number;
    maxAttempts?: number;
  } = {},
) {
  const run = createCoordinationRun({ sessionId: "s1", rootGoal: "cli parity", coordinatorAgentId: "alix" });
  await h.store.save(run);
  const worker = createWorkerAssignment({
    coordinationRunId: run.id,
    agentId: "w1",
    taskLabel: "T",
    goalPrompt: "do",
    requiredCapabilities: opts.capabilities ?? ["filesystem.write"],
    ownershipClaims: opts.ownershipClaims,
    attempt: opts.attempt ?? 0,
    maxAttempts: opts.maxAttempts ?? 3,
  });
  await h.store.addWorker(run.id, worker);
  return { run, worker };
}

/** A separate store instance, standing in for the operator's `alix approvals` process. */
async function operatorStore(cwd: string): Promise<ApprovalStore> {
  const s = new ApprovalStore(cwd);
  await s.load();
  return s;
}

/** Tamper a stored approval through the authoritative mutate() path (ledger commit). */
async function tamper(cwd: string, bindingKey: string, patch: (r: any) => void): Promise<void> {
  const s = new ApprovalStore(cwd);
  await s.load();
  await s.mutate((approvals) => {
    const r = approvals.find((a: any) => a.bindingKey === bindingKey);
    if (r) patch(r);
  });
}

async function blockedBindingKey(h: Harness, runId: string, workerId: string): Promise<string> {
  const w = (await h.store.load(runId))!.workers.find((x) => x.id === workerId)!;
  assert.equal(w.blockReason, "approval_required", "worker must be blocked on approval");
  const key = w.authorizationEvidence?.bindingKey;
  assert.equal(typeof key, "string", "evidence must retain the binding key");
  return key as string;
}

/** Per-test teardown: every harness/temp dir this file builds is registered here. */
const activeHarnesses: Harness[] = [];
const tmpDirs: string[] = [];

describe("SRAP PR B CLI coordination approval-store wiring", () => {
  let h: Harness;

  afterEach(async () => {
    // Close each workspace's shared ledger BEFORE removing it: on Windows an
    // open SQLite connection makes the unlink fail with EBUSY (see
    // runtime-ledger.ts and tests/helpers/temp.ts).
    while (activeHarnesses.length) {
      const a = activeHarnesses.pop()!;
      await a.scheduler.shutdown();
      closeSharedLedger(a.cwd);
      removeTempDirSync(a.cwd);
    }
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      closeSharedLedger(d);
      removeTempDirSync(d);
    }
  });

  // ── 1. Allowed capability ───────────────────────────────────────────

  it("CLI: an allowed capability executes normally and creates no approval", async () => {
    h = await buildCliHarness(minimalConfig({ tools: { "filesystem.write": "allow" } }));
    const { run, worker } = await seedWorker(h);

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });
    assert.equal(result.finalStatus, "completed");
    const w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "completed");

    const op = await operatorStore(h.cwd);
    assert.equal(op.list().length, 0, "an allowed capability must create no durable approval");
  });

  // ── 2 + 4. Creates a REAL durable approval, visible cross-process ────

  it("CLI: an ask-gated capability creates a REAL durable pending approval (never 'unknown')", async () => {
    h = await buildCliHarness();
    const { run, worker } = await seedWorker(h);

    const tick = await h.scheduler.tick(run.id);
    assert.ok(tick.awaitingApproval.includes(worker.id), "worker must await approval");

    const w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "blocked");
    assert.equal(w.blockReason, "approval_required");
    assert.notEqual(w.approvalId, "unknown", "the CLI gate must mint a real approval id");

    const bindingKey = await blockedBindingKey(h, run.id, worker.id);
    // A separate process (fresh store) observes the durable pending record.
    const op = await operatorStore(h.cwd);
    const rec = op.findExact(bindingKey);
    assert.ok(rec, "the durable approval must match the persisted binding key");
    assert.equal(rec!.status, "pending");
    assert.equal(rec!.coordinationRunId, run.id);
    assert.equal(rec!.workerId, worker.id);
    assert.equal(rec!.workerAttempt, worker.attempt);
    assert.deepEqual([...(rec!.capabilities ?? [])].sort(), ["filesystem.write"]);
    assert.ok(!rec!.requestFingerprint.startsWith("legacy:"), "must not be a legacy binding");
    assert.notEqual(rec!.policyRevision, "legacy", "must carry a real policy revision");
  });

  // ── 3. Missing store fails closed ───────────────────────────────────

  it("CLI: a missing approval store fails closed — never approvalId 'unknown'", async () => {
    // Force the helper's REAL failure path: make `.alix` a FILE so the
    // project ledger cannot be opened; `loadApprovalStore` returns undefined
    // and `buildCoordinationPolicyGate` must yield a store-less gate.
    const cwd = mkdtempSync(join(tmpdir(), "coord-cli-nostore-"));
    tmpDirs.push(cwd);
    writeFileSync(join(cwd, ".alix"), "not a directory");
    const gate = await buildCoordinationPolicyGate(cwd, minimalConfig());

    const decision = await gate.evaluateCapability({
      requestId: "r-nostore",
      capability: "filesystem.write",
      cwd,
      sessionMode: "ask",
      sessionId: "s1",
      coordinationRunId: "coord_x",
      workerId: "w_x",
      workerAttempt: 0,
    } as never);
    assert.equal(decision.decision, "deny", "a store-less ask must fail closed");
    assert.equal(decision.matchedRuleId, "approval-store-missing");

    // Full chain: real ExecutionAuthorization → real authorizeWorker must deny
    // and must never surface a pending "unknown".
    const auth = new ExecutionAuthorization({ policyGate: gate });
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "g", coordinatorAgentId: "alix" });
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do",
      requiredCapabilities: ["filesystem.write"],
      attempt: 0,
      maxAttempts: 3,
    });
    const res = await authorizeWorker({ authorization: auth, worker, run, cwd, sessionMode: "ask" });
    assert.equal(res.status, "denied", "a store-less coordination ask must be denied");
    assert.notEqual((res as any).approvalId, "unknown", "never surface 'unknown' as an approval id");
  });

  // ── 5 + 8. Cross-process approve resumes, consumes exactly once ─────

  it("CLI: a separate-process approval is observed, resumes the worker, and is consumed once", async () => {
    h = await buildCliHarness(minimalConfig(), async () => ({ outcome: "success" }));
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);

    const op = await operatorStore(h.cwd);
    assert.equal(op.listPending().length, 1, "the durable pending approval is visible cross-process");
    await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");

    const tick2 = await h.scheduler.tick(run.id);
    assert.ok(tick2.dispatched.includes(worker.id), "worker must dispatch after a cross-process approval");
    assert.ok(!tick2.awaitingApproval.includes(worker.id), "must not re-block against stale state");

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });
    assert.equal(result.finalStatus, "completed", "the run must reach terminal completion");

    const after = await operatorStore(h.cwd);
    assert.equal(after.findExact(bindingKey)!.status, "consumed", "the single-use approval is consumed");
    assert.equal(after.listPending().length, 0, "no stray pending minted by the re-dispatch");

    // A consumed approval cannot authorize again.
    const rec = await h.scheduler.reconcile(run.id);
    assert.equal(rec.approvalResumed.length, 0, "a consumed approval must not resume a worker");
  });

  it("CLI resume never dispatches a denied approval", async () => {
    let executions = 0;
    h = await buildCliHarness(minimalConfig(), async () => {
      executions++;
      return { outcome: "success" };
    });
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);
    const op = await operatorStore(h.cwd);
    const record = op.findExact(bindingKey)!;
    await op.resolve(record.id, "denied", "operator");

    const { execution } = await resumeCoordinationExecution(h.scheduler, run.id);
    assert.equal(execution.dispatched, 0);
    assert.equal(executions, 0);
    assert.equal((await operatorStore(h.cwd)).findExact(bindingKey)!.status, "denied");
  });

  it("CLI resume retains execution ownership until the dispatched worker settles", async () => {
    let executions = 0;
    let started!: () => void;
    let release!: () => void;
    const workerStarted = new Promise<void>(resolve => { started = resolve; });
    const workerGate = new Promise<void>(resolve => { release = resolve; });
    h = await buildCliHarness(minimalConfig(), async () => {
      executions++;
      started();
      await workerGate;
      return { outcome: "success" };
    });
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);
    const op = await operatorStore(h.cwd);
    await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");

    const resume = resumeCoordinationExecution(h.scheduler, run.id);
    await workerStarted;
    let resumeSettled = false;
    void resume.then(() => { resumeSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resumeSettled, false, "resume must await the execution owner, not stop at running state");
    assert.equal((await h.store.load(run.id))!.workers.find(item => item.id === worker.id)!.status, "running");
    release();

    const { execution } = await resume;
    assert.equal(execution.finalStatus, "completed");
    assert.equal((await h.store.load(run.id))!.workers.find(item => item.id === worker.id)!.status, "completed");
    assert.equal((await operatorStore(h.cwd)).findExact(bindingKey)!.status, "consumed");

    const duplicateResume = await resumeCoordinationExecution(h.scheduler, run.id);
    assert.equal(duplicateResume.execution.dispatched, 0, "resuming a completed run must not dispatch twice");
    assert.equal(executions, 1);
  });

  it("CLI: keeps the worker blocked while the approval stays pending cross-process", async () => {
    h = await buildCliHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);

    const op = await operatorStore(h.cwd);
    assert.equal(op.listPending().length, 1, "the pending approval is persisted and visible");

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 300 });
    assert.notEqual(result.finalStatus, "completed", "an unresolved approval must not dispatch");
    const w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "blocked");
    assert.equal(w.blockReason, "approval_required");
  });

  // ── 6 + 7. Binding mismatches rejected ──────────────────────────────

  it("CLI: rejects reconciliation when the binding names a different worker/run/attempt", async () => {
    const patches: Array<(r: any) => void> = [
      (r) => { r.workerId = "someone-else"; },
      (r) => { r.coordinationRunId = "coord_someone_else"; },
      (r) => { r.workerAttempt = 99; },
    ];
    for (const patch of patches) {
      // A fresh workspace per case: tampering one shared record would leak.
      const hh = await buildCliHarness();
      const { run, worker } = await seedWorker(hh);
      await hh.scheduler.tick(run.id);
      const bindingKey = await blockedBindingKey(hh, run.id, worker.id);

      const op = await operatorStore(hh.cwd);
      await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");
      await tamper(hh.cwd, bindingKey, patch);

      const rec = await hh.scheduler.reconcile(run.id);
      assert.equal(rec.approvalResumed.length, 0, "a mismatched binding must not resume");
    }
  });

  it("CLI: rejects reconciliation when the capability set changed", async () => {
    h = await buildCliHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);

    const op = await operatorStore(h.cwd);
    await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");
    await tamper(h.cwd, bindingKey, (r) => { r.capabilities = ["shell.exec"]; });

    const rec = await h.scheduler.reconcile(run.id);
    assert.equal(rec.approvalResumed.length, 0, "a changed capability set must not resume");
  });

  it("CLI: rejects reconciliation when the policy revision changed", async () => {
    h = await buildCliHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);

    const op = await operatorStore(h.cwd);
    await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");
    await tamper(h.cwd, bindingKey, (r) => { r.policyRevision = "some-other-revision"; });

    const rec = await h.scheduler.reconcile(run.id);
    assert.equal(rec.approvalResumed.length, 0, "a changed policy revision must not resume");
  });

  it("CLI: does not resume an expired approval", async () => {
    h = await buildCliHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);

    const op = await operatorStore(h.cwd);
    await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");
    await tamper(h.cwd, bindingKey, (r) => {
      r.expiresAt = new Date(Date.now() - 60_000).toISOString();
    });

    const rec = await h.scheduler.reconcile(run.id);
    assert.equal(rec.approvalResumed.length, 0, "an expired approval must not resume");
  });

  // ── 9. CLI restart/reload ───────────────────────────────────────────

  it("CLI: the approval binding survives a CLI restart (fresh gate + store, same workspace)", async () => {
    h = await buildCliHarness(minimalConfig(), async () => ({ outcome: "success" }));
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = await blockedBindingKey(h, run.id, worker.id);

    const op = await operatorStore(h.cwd);
    await op.resolve(op.findExact(bindingKey)!.id, "approved", "operator");

    // Simulate a NEW CLI process: a brand-new gate resolved from the same cwd.
    const restartedGate = await buildCoordinationPolicyGate(h.cwd, h.config);
    const restarted = buildScheduler(h.cwd, h.config, restartedGate, async () => ({ outcome: "success" }), "cli-restart");
    try {
      const result = await restarted.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });
      assert.equal(result.finalStatus, "completed", "the restarted CLI must resume on the surviving binding");
      const w = (await restarted.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
      assert.equal(w.status, "completed");
      const after = await operatorStore(h.cwd);
      assert.equal(after.findExact(bindingKey)!.status, "consumed", "the surviving approval is consumed once");
    } finally {
      await restarted.scheduler.shutdown();
    }
  });

  // ── 10. Host parity with the daemon-wired gate ──────────────────────

  it("CLI and daemon-wired gates agree on the decision and the binding (host parity)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "coord-cli-parity-"));
    tmpDirs.push(cwd);
    const config = minimalConfig();
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "parity", coordinatorAgentId: "alix" });
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do",
      requiredCapabilities: ["filesystem.write"],
      attempt: 0,
      maxAttempts: 3,
    });
    const request = (requestId: string) => ({
      requestId,
      capability: "filesystem.write",
      cwd,
      sessionMode: "ask" as const,
      sessionId: run.sessionId,
      coordinationRunId: run.id,
      workerId: worker.id,
      workerAttempt: worker.attempt,
      ownershipClaims: worker.ownershipClaims,
    } as never);

    // CLI gate (helper-resolved store).
    const cliGate = await buildCoordinationPolicyGate(cwd, config);
    const cliDecision = await cliGate.evaluateCapability(request("cli-1"));

    // Daemon gate (store injected at construction, exactly as daemon-server.ts does).
    const { loadApprovalStore } = await import("../../../src/governance/approvals/approval-store.js");
    const daemonGate = new PolicyGate(config, { approvalStore: await loadApprovalStore(cwd) });
    const daemonDecision = await daemonGate.evaluateCapability(request("daemon-1"));

    assert.equal(cliDecision.decision, "ask");
    assert.equal(daemonDecision.decision, "ask");
    assert.equal(daemonDecision.approvalId, cliDecision.approvalId, "both hosts resolve the same durable approval");
    assert.equal((daemonDecision as any).bindingKey, (cliDecision as any).bindingKey, "identical binding key");
  });
});
