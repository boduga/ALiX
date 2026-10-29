/**
 * coordination-approval-binding.test.ts — SRAP approval-binding continuity.
 *
 * PR A regression suite. Drives the REAL component chain:
 *
 *   authorizeWorker → ExecutionAuthorization → PolicyGate → ApprovalStore
 *                    → CoordinationScheduler reconciliation → resumption
 *
 * It must NOT substitute `isApproved: () => true` or inject a fabricated
 * approved binding: the whole point of this defect class is that a fabricated
 * binding hides the propagation gap. Every case here goes through the real
 * ApprovalStore and the real scheduler reconcile path.
 *
 * Defects pinned:
 *  1. Coordination identity never reaches PolicyGate (metadata-only), so the
 *     legacy approval path ran and no binding was ever produced.
 *  2. The coordination branch created the record via legacy `store.request`
 *     and patched fields AFTER the commit, so the authoritative store carried
 *     the legacy binding, not the coordination binding.
 *  3. Reconciliation consumed the single-use approval as a probe, so the
 *     re-dispatch re-authorized against an already-consumed approval and
 *     blocked forever (double consumption).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyGate } from "../../src/governance/policy/policy-gate.js";
import { ExecutionAuthorization } from "../../src/runtime-state/runtime/execution-authorization.js";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { CoordinationScheduler } from "../../src/coordination/kernel/coordination-scheduler.js";
import { OwnershipRegistry } from "../../src/coordination/ownership/ownership-registry.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
} from "../../src/coordination/kernel/coordination-types.js";

function minimalConfig(overrides: { sessionMode?: "auto" | "ask" | "bypass"; tools?: Record<string, "allow" | "ask" | "deny">; default?: "allow" | "ask" | "deny" } = {}) {
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

// ── Real-component harness ──────────────────────────────────────────────

type Harness = {
  cwd: string;
  config: ReturnType<typeof minimalConfig>;
  approvals: ApprovalStore;
  gate: PolicyGate;
  auth: ExecutionAuthorization;
  store: CoordinationStore;
  registry: OwnershipRegistry;
  scheduler: CoordinationScheduler;
};

async function buildHarness(
  config = minimalConfig(),
  executorImpl: (worker: any) => Promise<{ outcome: "success" | "failure" }> = async () => ({ outcome: "success" }),
): Promise<Harness> {
  const cwd = mkdtempSync(join(tmpdir(), "coord-binding-"));
  const approvals = new ApprovalStore(cwd);
  await approvals.load();
  const gate = new PolicyGate(config, { approvalStore: approvals });
  const auth = new ExecutionAuthorization({ policyGate: gate });
  const store = new CoordinationStore(cwd);
  const registry = new OwnershipRegistry(cwd, { sessionId: "binding-session" });
  const scheduler = new CoordinationScheduler(
    {
      cwd,
      daemonInstanceId: "binding-daemon",
      configProvider: async () => config,
      store,
      authorization: auth,
      ownershipRegistry: registry,
      executor: { execute: async (worker: any) => executorImpl(worker) } as any,
    },
    { maxConcurrency: 2, orphanThresholdMs: 60_000 },
  );
  return { cwd, config, approvals, gate, auth, store, registry, scheduler };
}

async function seedWorker(
  h: Harness,
  opts: {
    capabilities?: string[];
    ownershipClaims?: { path: string; recursive: boolean }[];
    attempt?: number;
    maxAttempts?: number;
    runSessionMode?: string;
  } = {},
) {
  const run = createCoordinationRun({
    sessionId: "s1",
    rootGoal: "binding test",
    coordinatorAgentId: "alix",
  });
  if (opts.runSessionMode) (run as any).sessionMode = opts.runSessionMode;
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

async function approveAllPending(h: Harness): Promise<number> {
  let n = 0;
  for (const r of h.approvals.list()) {
    if (r.status === "pending") {
      await h.approvals.resolve(r.id, "approved", "ok");
      n++;
    }
  }
  return n;
}

/**
 * Tamper a stored approval THROUGH the authoritative mutate() path. Writing
 * the JSON projection directly would be ignored: the ledger is authoritative
 * (R2.5) and load() rebuilds from it. This mirrors how a real conflicting
 * record would reach the store.
 */
async function tamperRecord(
  h: Harness,
  bindingKey: string,
  patch: (r: any) => void,
): Promise<void> {
  await h.approvals.mutate((approvals) => {
    const r = approvals.find((a: any) => a.bindingKey === bindingKey);
    if (r) patch(r);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("SRAP coordination approval-binding continuity", () => {
  let h: Harness;

  afterEach(async () => {
    if (h) {
      await h.scheduler.shutdown();
      rmSync(h.cwd, { recursive: true, force: true });
    }
  });

  // ── Context propagation ─────────────────────────────────────────────

  it("propagates coordination identity into PolicyGate (not just metadata)", async () => {
    h = await buildHarness();
    let seen: any;
    const orig = h.gate.evaluateCapability.bind(h.gate);
    (h.gate as any).evaluateCapability = async (req: any) => {
      seen = req;
      return orig(req);
    };

    const { run, worker } = await seedWorker(h);
    const { authorizeWorker } = await import("../../src/coordination/kernel/coordination-authorization.js");
    await authorizeWorker({
      authorization: h.auth,
      worker,
      run,
      cwd: h.cwd,
      sessionMode: "ask",
    });

    assert.ok(seen, "evaluateCapability must be reached");
    assert.equal(seen.coordinationRunId, run.id, "run id must reach the gate");
    assert.equal(seen.workerId, worker.id, "worker id must reach the gate");
    assert.equal(seen.workerAttempt, worker.attempt, "attempt must reach the gate");
  });

  // ── Creation + persistence ──────────────────────────────────────────

  it("creates the approval with the coordination binding and persists it", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);

    const result = await h.scheduler.tick(run.id);
    assert.ok(result.awaitingApproval.includes(worker.id), "worker must await approval");

    const loaded = (await h.store.load(run.id))!;
    const w = loaded.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "blocked");
    assert.equal(w.blockReason, "approval_required");
    const bindingKey = w.authorizationEvidence?.bindingKey;
    assert.equal(typeof bindingKey, "string", "evidence must retain the binding key");
    assert.ok((bindingKey as string).length > 0);

    // The authoritative store (fresh reload from the ledger) carries the binding.
    const reloaded = new ApprovalStore(h.cwd);
    await reloaded.load();
    const record = reloaded.findExact(bindingKey as string);
    assert.ok(record, "stored approval must match evidence.bindingKey");
    assert.equal(record!.coordinationRunId, run.id);
    assert.equal(record!.workerId, worker.id);
    assert.equal(record!.workerAttempt, worker.attempt);
    assert.deepEqual([...(record!.capabilities ?? [])].sort(), ["filesystem.write"]);
    // A fingerprint that is NOT the legacy placeholder.
    assert.ok(!record!.requestFingerprint.startsWith("legacy:"), "must not be a legacy binding");
    assert.notEqual(record!.policyRevision, "legacy", "must carry a real policy revision");
  });

  // ── Blocking → approval → reconciliation → resumption ───────────────

  it("resumes the worker after the exact approval is resolved, and completes", async () => {
    h = await buildHarness(minimalConfig(), async () => ({ outcome: "success" }));
    const { run, worker } = await seedWorker(h);

    await h.scheduler.tick(run.id);
    let w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.blockReason, "approval_required");

    const approved = await approveAllPending(h);
    assert.equal(approved, 1, "exactly one approval to resolve");

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });
    assert.equal(result.finalStatus, "completed", "run must complete after approval");
    w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "completed", "same worker must resume and complete");
  });

  it("consumes the single-use approval exactly once (no double consumption)", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);

    await h.scheduler.tick(run.id);
    const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
      .authorizationEvidence?.bindingKey as string;
    await approveAllPending(h);

    await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });

    const reloaded = new ApprovalStore(h.cwd);
    await reloaded.load();
    const record = reloaded.findExact(bindingKey)!;
    assert.equal(record.status, "consumed", "the single-use approval is consumed");
    assert.equal(record.executionOutcome, "succeeded", "completed worker must write the consumed dispatch approval receipt");
    assert.ok(record.executionOutcomeAt, "terminal dispatch approval receipt is timestamped");
    // No stray second pending approval was minted by the re-dispatch.
    const pending = reloaded.listPending();
    assert.equal(pending.length, 0, "no new pending approval after resumption");
  });

  // ── Security negatives ──────────────────────────────────────────────

  it("a malformed coordination identity is denied, not degraded to legacy", async () => {
    h = await buildHarness();
    const decision = await h.auth.evaluate({
      requestId: "r1",
      capability: "filesystem.write",
      cwd: h.cwd,
      sessionMode: "ask",
      sessionId: "s1",
      source: "agent",
      // workerAttempt missing → invalid
      coordination: { coordinationRunId: "run-1", workerId: "w-1" } as any,
    });
    assert.equal(decision.status, "denied");
    assert.equal((decision as any).policyRuleId, "coordination-identity-invalid");
    // No approval side effect.
    assert.equal(h.approvals.list().length, 0);
  });

  it("rejects reconciliation when the stored binding names a different worker", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    await approveAllPending(h);

    const loaded = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    const bindingKey = loaded.authorizationEvidence?.bindingKey as string;
    await tamperRecord(h, bindingKey, (r) => { r.workerId = "someone-else"; });

    const recResult = await h.scheduler.reconcile(run.id);
    assert.equal(recResult.approvalResumed.length, 0, "mismatched worker must not resume");
  });

  it("rejects reconciliation when the stored binding names a different run", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    await approveAllPending(h);

    const loaded = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    const bindingKey = loaded.authorizationEvidence?.bindingKey as string;
    await tamperRecord(h, bindingKey, (r) => { r.coordinationRunId = "coord_someone_else"; });

    const recResult = await h.scheduler.reconcile(run.id);
    assert.equal(recResult.approvalResumed.length, 0, "mismatched run must not resume");
  });

  it("rejects reconciliation when the stored binding names a different attempt", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    await approveAllPending(h);

    const loaded = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    const bindingKey = loaded.authorizationEvidence?.bindingKey as string;
    await tamperRecord(h, bindingKey, (r) => { r.workerAttempt = 99; });

    const recResult = await h.scheduler.reconcile(run.id);
    assert.equal(recResult.approvalResumed.length, 0, "mismatched attempt must not resume");
  });

  it("rejects reconciliation when the stored ownership claims differ", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h, {
      ownershipClaims: [{ path: "src/a.ts", recursive: false }],
    });
    await h.scheduler.tick(run.id);
    await approveAllPending(h);

    const loaded = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    const bindingKey = loaded.authorizationEvidence?.bindingKey as string;
    await tamperRecord(h, bindingKey, (r) => { r.ownershipClaims = [{ path: "src/OTHER.ts", recursive: false }]; });

    const recResult = await h.scheduler.reconcile(run.id);
    assert.equal(recResult.approvalResumed.length, 0, "mismatched ownership claims must not resume");
  });

  it("does not resume an expired approval", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);

    const loaded = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    const bindingKey = loaded.authorizationEvidence?.bindingKey as string;
    await h.approvals.resolve(h.approvals.findExact(bindingKey)!.id, "approved", "ok");
    await tamperRecord(h, bindingKey, (r) => { r.expiresAt = new Date(Date.now() - 60_000).toISOString(); });

    const recResult = await h.scheduler.reconcile(run.id);
    assert.equal(recResult.approvalResumed.length, 0, "expired approval must not resume");
  });

  it("fails closed on legacy evidence with no binding key", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    // Simulate a legacy worker: evidence with decisions but no bindingKey.
    await h.store.patchWorker(run.id, worker.id, {
      status: "blocked",
      blockReason: "approval_required",
      approvalId: "legacy-approval",
      authorizationEvidence: {
        evaluatedAt: new Date().toISOString(),
        decisions: [{ capability: "filesystem.write", status: "approval_required", approvalId: "legacy-approval" }],
      },
    } as any);

    const recResult = await h.scheduler.reconcile(run.id);
    assert.equal(recResult.approvalResumed.length, 0, "legacy evidence without a binding must fail closed");
  });

  // ── Compatibility ───────────────────────────────────────────────────

  it("keeps non-coordination authorization unchanged (canvas allow path)", async () => {
    h = await buildHarness(minimalConfig({ tools: { "filesystem.write": "allow" } }));
    const decision = await h.auth.evaluate({
      requestId: "r1",
      capability: "filesystem.write",
      cwd: h.cwd,
      sessionMode: "ask",
      sessionId: "s1",
      source: "agent",
    });
    assert.equal(decision.status, "allowed", "allowed capability still allowed without coordination context");
    assert.equal(h.approvals.list().length, 0, "no approval created for an allowed capability");
  });

  // ── Cross-process (long-running daemon) approval freshness ──────────
  //
  // The daemon constructs ONE ApprovalStore for its lifetime; the operator
  // resolves approvals from a SEPARATE `alix approvals` process that writes
  // the authoritative ledger. The daemon's in-memory projection must reflect
  // that decision WITHOUT a restart or a watcher notification. Regression for
  // the SRAP D2 operational defect: a blocked worker re-blocked forever
  // because the authorization read only saw the startup-era projection.

  /** A separate store instance, standing in for the CLI resolver process. */
  async function cliStore(cwd: string): Promise<ApprovalStore> {
    const s = new ApprovalStore(cwd);
    await s.load();
    return s;
  }

  it("resumes and completes when a separate process approves (no restart, no watcher tick)", async () => {
    h = await buildHarness(minimalConfig(), async () => ({ outcome: "success" }));
    const { run, worker } = await seedWorker(h);

    await h.scheduler.tick(run.id);
    const blocked = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(blocked.blockReason, "approval_required");
    const bindingKey = blocked.authorizationEvidence?.bindingKey as string;

    // Operator resolves from a separate process/store; the daemon's shared
    // store never observed the write.
    const cli = await cliStore(h.cwd);
    await cli.resolve(cli.findExact(bindingKey)!.id, "approved", "operator");

    // No watcher tick is delivered — correctness must not depend on one.
    const tick2 = await h.scheduler.tick(run.id);
    assert.ok(tick2.dispatched.includes(worker.id), "worker must dispatch after a cross-process approval");
    assert.ok(!tick2.awaitingApproval.includes(worker.id), "must not re-block against stale in-memory state");

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 5000 });
    assert.equal(result.finalStatus, "completed", "run must reach terminal completion");

    const reloaded = await cliStore(h.cwd);
    assert.equal(reloaded.findExact(bindingKey)!.status, "consumed", "the single-use approval is consumed");
    assert.equal(reloaded.listPending().length, 0, "no stray new pending minted by the re-dispatch");
  });

  it("keeps the worker blocked while a separate process leaves the approval pending", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);

    // A separate process saw the persisted pending approval but did not decide.
    const cli = await cliStore(h.cwd);
    assert.equal(cli.listPending().length, 1, "the pending approval is persisted and visible cross-process");

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 300 });
    assert.notEqual(result.finalStatus, "completed", "an unresolved approval must not dispatch");
    const w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "blocked");
    assert.equal(w.blockReason, "approval_required");
  });

  it("does not dispatch when a separate process denies the approval", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
      .authorizationEvidence?.bindingKey as string;

    const cli = await cliStore(h.cwd);
    await cli.resolve(cli.findExact(bindingKey)!.id, "denied", "operator");

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 300 });
    assert.notEqual(result.finalStatus, "completed", "a denied approval must not dispatch");
    const reloaded = await cliStore(h.cwd);
    assert.equal(reloaded.findExact(bindingKey)!.status, "denied");
    assert.equal(reloaded.listPending().length, 0, "a denial must not mint a fresh pending approval");
  });

  it("does not consume or dispatch an approval revoked by a separate process", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
      .authorizationEvidence?.bindingKey as string;

    const cli = await cliStore(h.cwd);
    const rec = cli.findExact(bindingKey)!;
    await cli.resolve(rec.id, "approved", "operator");
    await cli.revoke(rec.id, { actor: "operator", reason: "changed mind" });

    const result = await h.scheduler.runUntilIdle(run.id, { pollIntervalMs: 10, timeoutMs: 300 });
    assert.notEqual(result.finalStatus, "completed", "a revoked approval must not authorize execution");
    const reloaded = await cliStore(h.cwd);
    const after = reloaded.findExact(bindingKey)!;
    assert.equal(after.status, "revoked");
    assert.notEqual(after.status, "consumed", "a revoked approval is never consumed");
  });

  it("fails closed (no authorization bypass) when the store refresh fails", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
      .authorizationEvidence?.bindingKey as string;

    // A valid approval exists cross-process, so a stale-but-successful read
    // would authorize. Make the authoritative read fail instead.
    const cli = await cliStore(h.cwd);
    await cli.resolve(cli.findExact(bindingKey)!.id, "approved", "operator");

    const original = h.approvals.load.bind(h.approvals);
    (h.approvals as any).load = async () => { throw new Error("ledger unavailable"); };
    try {
      const decision = await h.gate.evaluateCapability({
        requestId: "r-refresh-fail",
        capability: "filesystem.write",
        cwd: h.cwd,
        sessionMode: "ask",
        sessionId: "s1",
        coordinationRunId: run.id,
        workerId: worker.id,
        workerAttempt: worker.attempt,
        ownershipClaims: worker.ownershipClaims,
      } as any);
      assert.equal(decision.decision, "deny", "a failed refresh must fail closed");
      assert.equal(decision.matchedRuleId, "approval-refresh-failed");
    } finally {
      (h.approvals as any).load = original;
    }

    // The approval was NOT consumed: no refresh-failure bypass.
    const reloaded = await cliStore(h.cwd);
    assert.equal(reloaded.findExact(bindingKey)!.status, "approved", "no consumption on a failed refresh");
  });

  it("consumes the approval exactly once across two simultaneous authorization attempts", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
      .authorizationEvidence?.bindingKey as string;

    const cli = await cliStore(h.cwd);
    await cli.resolve(cli.findExact(bindingKey)!.id, "approved", "operator");

    const request = (requestId: string) => ({
      requestId,
      capability: "filesystem.write",
      cwd: h.cwd,
      sessionMode: "ask",
      sessionId: "s1",
      coordinationRunId: run.id,
      workerId: worker.id,
      workerAttempt: worker.attempt,
      ownershipClaims: worker.ownershipClaims,
    } as any);

    const [d1, d2] = await Promise.all([
      h.gate.evaluateCapability(request("r-1")),
      h.gate.evaluateCapability(request("r-2")),
    ]);
    const allows = [d1, d2].filter((d) => d.decision === "allow").length;
    assert.equal(allows, 1, "exactly one attempt may consume the single-use approval");

    const reloaded = await cliStore(h.cwd);
    assert.equal(reloaded.findExact(bindingKey)!.status, "consumed");
  });

  // ── Review verification #2: refresh-failure classification ──────────
  //
  // A failed ledger read must never authorize (fail closed) AND must not be
  // silent: the worker outcome and its evidence must carry a distinct,
  // inspectable cause so an operator can tell a store outage from a policy
  // denial. This drives the whole scheduler path, not just the gate.

  it("classifies a store refresh failure at the worker level without consuming", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);
    await h.scheduler.tick(run.id);
    const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
      .authorizationEvidence?.bindingKey as string;

    // A valid cross-process approval exists, so a stale-but-successful read
    // would authorize. Make the authoritative read fail instead.
    const cli = await cliStore(h.cwd);
    await cli.resolve(cli.findExact(bindingKey)!.id, "approved", "operator");

    const original = h.approvals.load.bind(h.approvals);
    (h.approvals as any).load = async () => { throw new Error("ledger unavailable"); };
    try {
      const tickResult = await h.scheduler.tick(run.id);
      assert.ok(tickResult.denied.includes(worker.id), "the dispatch attempt must be denied");
    } finally {
      (h.approvals as any).load = original;
    }

    // Fail closed: no execution, no consumption of the approved record.
    const w = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!;
    assert.equal(w.status, "failed", "a failed refresh must not run the worker");
    assert.equal(w.blockReason, "authorization_denied");
    assert.equal(w.failureKind, "authorization_denied");

    // Observable + distinctly classified: the evidence names the refresh
    // failure rule and the underlying cause — never a silent failure.
    const decisions = w.authorizationEvidence?.decisions ?? [];
    const refreshFailure = decisions.find((d) => d.policyRuleId === "approval-refresh-failed");
    assert.ok(refreshFailure, "evidence must carry the distinct approval-refresh-failed rule id");
    assert.match(String(refreshFailure!.reason ?? ""), /refresh failed/i,
      "evidence must record the underlying refresh cause");

    const reloaded = await cliStore(h.cwd);
    assert.equal(reloaded.findExact(bindingKey)!.status, "approved",
      "a failed refresh must not consume the approval");
  });

  // ── Review verification #3: refresh is bounded by authorization ─────
  //
  // The added authoritative read must cost one read per REAL authorization
  // attempt, never one per scheduler tick. A blocked worker is not a dispatch
  // candidate, so idle ticks never reach the gate.

  it("reloads the approval store on real authorization attempts only, never on idle ticks", async () => {
    h = await buildHarness();
    const { run, worker } = await seedWorker(h);

    // First tick blocks the worker (approval_required) and creates the approval.
    await h.scheduler.tick(run.id);

    let loads = 0;
    const original = h.approvals.load.bind(h.approvals);
    (h.approvals as any).load = async () => { loads += 1; return original(); };
    try {
      // The worker is `blocked`, not `pending` → not a dispatch candidate →
      // the gate is never invoked. Idle ticks must cost ZERO reads of the
      // gate's authoritative store.
      for (let i = 0; i < 5; i += 1) await h.scheduler.tick(run.id);
      assert.equal(loads, 0, "idle ticks must not reload the gate's approval store");

      // A real authorization attempt (a cross-process approval made the worker
      // dispatchable) costs the boundary read plus at most the atomic
      // consume's own reload — bounded per attempt, not per tick.
      const bindingKey = (await h.store.load(run.id))!.workers.find((x) => x.id === worker.id)!
        .authorizationEvidence?.bindingKey as string;
      const cli = await cliStore(h.cwd);
      await cli.resolve(cli.findExact(bindingKey)!.id, "approved", "operator");
      await h.scheduler.tick(run.id);
      assert.ok(loads >= 1, "an authorization attempt must read fresh persisted state");
      assert.ok(loads <= 2, "the refresh is bounded to the attempt, not the tick");
    } finally {
      (h.approvals as any).load = original;
    }
  });
});
