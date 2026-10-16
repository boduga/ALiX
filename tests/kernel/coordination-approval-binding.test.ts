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
});
