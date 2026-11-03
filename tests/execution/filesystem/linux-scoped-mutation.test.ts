/**
 * linux-scoped-mutation.test.ts — GE-04 experimental adapter authorization.
 *
 * These are ADVERSARIAL tests over the real durable authorities
 * (ApprovalStore, OwnershipRegistry, computePolicyRevision). They exist to pin
 * the fail-closed composition, not to claim any security qualification: the
 * native helper, executable packaging, cross-platform backends and independent
 * review are still outstanding, and production service selection remains
 * unregistered (`createScopedMutationService` throws).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { closeSharedLedger } from "../../../src/runtime-state/storage/runtime-ledger.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalStore } from "../../../src/governance/approvals/approval-store.js";
import { OwnershipRegistry } from "../../../src/coordination/ownership/ownership-registry.js";
import { computePolicyRevision } from "../../../src/governance/policy/policy-revision.js";
import { ExperimentalLinuxScopedMutationService } from "../../../src/execution/filesystem/linux-scoped-mutation.js";
import {
  computeScopedMutationInvocation,
  createLiveScopedLeaseVerifier,
  createScopedMutationAuthorizationVerifier,
  isTrustedScopedMutationVerifier,
} from "../../../src/execution/filesystem/scoped-mutation-authorization.js";
import type { ScopedMutationAuthority } from "../../../src/execution/filesystem/scoped-mutation.js";
import { assessGe04Reconciliation, inspectGe04UncertainClaims } from "../../../src/execution/filesystem/ge04-recovery.js";
import type { AlixConfig } from "../../../src/operations/config/schema.js";

const config = (overrides: { sessionMode?: "auto" | "ask" | "bypass"; tools?: Record<string, "allow" | "ask" | "deny"> } = {}): AlixConfig => ({
  version: 1,
  model: { provider: "mock", name: "mock", streaming: false, maxIterations: 10, maxContextTokens: 32000 },
  permissions: {
    sessionMode: overrides.sessionMode ?? "ask",
    default: "ask",
    tools: overrides.tools ?? { "file.write": "allow" },
    protectedPaths: [],
    allowNetworkDomains: [],
    denyCommands: [],
  },
  context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
  runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
  ui: { enabled: false, host: "", port: 0, transport: "sse" },
});

type Harness = {
  root: string;
  approvals: ApprovalStore;
  registry: OwnershipRegistry;
  policyRevision: string;
  workerId: string;
  leaseId: string;
  approvalId: string;
  dispose: () => Promise<void>;
};

/**
 * Build real durable state: one active exclusive-write lease over `owned/**`
 * and one approved, exactly-bound single-use approval for `hello.txt`.
 */
async function harness(opts: { content?: string; expiresAt?: string; relativePath?: string } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "ge04-auth-"));
  await mkdir(join(root, "owned"), { recursive: true });
  await mkdir(join(root, "unowned"), { recursive: true });

  const cfg = config();
  const policyRevision = computePolicyRevision(cfg);
  const registry = new OwnershipRegistry(root, { sessionId: "ge04-session" });
  const claim = await registry.acquire({
    agentId: "worker-a",
    scope: { kind: "path", root: join(root, "owned"), recursive: true },
    mode: "exclusive-write",
  });
  assert.equal(claim.acquired, true);

  const approvals = new ApprovalStore(root);
  await approvals.load();
  const authority: ScopedMutationAuthority = {
    workspaceRoot: root,
    ownedScope: "owned",
    workerId: "worker-a",
    policyRevision,
    leaseId: claim.record!.id,
  };
  const invocation = computeScopedMutationInvocation(authority, {
    kind: "create",
    relativePath: opts.relativePath ?? "hello.txt",
    content: Buffer.from(opts.content ?? "hello"),
  });
  const record = await approvals.requestBound({
    reason: "GE-04 test grant",
    bindingKey: "ge04-binding",
    requestFingerprint: "ge04-fingerprint",
    policyRevision,
    capabilities: ["file.create"],
    workerId: "worker-a",
    invocation,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
  });
  await approvals.resolve(record.id, "approved");

  return {
    root,
    approvals,
    registry,
    policyRevision,
    workerId: "worker-a",
    leaseId: claim.record!.id,
    approvalId: record.id,
    dispose: async () => {
      closeSharedLedger(root);
      await rm(root, { recursive: true, force: true });
    },
  };
}

const authorityOf = (h: Harness, overrides: Partial<ScopedMutationAuthority> = {}): ScopedMutationAuthority => ({
  workspaceRoot: h.root,
  ownedScope: "owned",
  workerId: h.workerId,
  policyRevision: h.policyRevision,
  leaseId: h.leaseId,
  approvalId: h.approvalId,
  ...overrides,
});

const createOp = (content = "hello", relativePath = "hello.txt") =>
  ({ kind: "create" as const, relativePath, content: Buffer.from(content) });

/**
 * Deterministic stand-in for the native helper: proves the ADAPTER's ordering
 * (authorize → spawn → revalidate → settle) without claiming fd-safety. The
 * real primitive is exercised by the opt-in GE04_TEST_HELPER suite below.
 */
async function fixtureHelper(root: string): Promise<string> {
  const path = join(root, "fixture-helper.sh");
  await writeFile(path, '#!/bin/sh\nset -e\nprintf \'%s\' "$4" > "$1/$2/$3"\n');
  await chmod(path, 0o755);
  return path;
}

test("GE-04: fabricated store objects cannot mint a trusted verifier", () => {
  assert.throws(() => createScopedMutationAuthorizationVerifier({
    config: config(),
    approvalStore: {} as ApprovalStore,
    registry: {} as OwnershipRegistry,
  }), /real approval and ownership store instances/);
});

test("GE-04: a symlinked nested parent fails the live lease check", async () => {
  const h = await harness();
  const outside = await mkdtemp(join(tmpdir(), "ge04-external-"));
  try {
    await symlink(outside, join(h.root, "owned", "escape"));
    const verifier = createLiveScopedLeaseVerifier(h.registry);
    assert.equal(await verifier(authorityOf(h), createOp("unsafe", "escape/out.txt")), false);
  } finally {
    await h.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});

// ─── The fail-open that shipped: a caller-supplied boolean callback ─────

test("GE-04: a plain callback is not accepted as an authorization verifier", async () => {
  for (const callback of [async () => true, async () => null, () => true] as unknown[]) {
    assert.throws(
      () => new ExperimentalLinuxScopedMutationService("/definitely/missing/helper", callback as never),
      /authorization verifier must be composed from durable authorities/,
    );
  }
});

test("GE-04: only the composed verifier carries the module-private brand", async () => {
  const h = await harness();
  try {
    const verifier = createScopedMutationAuthorizationVerifier({
      config: config(), approvalStore: h.approvals, registry: h.registry,
    });
    assert.equal(isTrustedScopedMutationVerifier(verifier), true);
    assert.equal(isTrustedScopedMutationVerifier(async () => true), false);
    // A forged brand property must not be enough either — the real symbol is
    // module-private, so this is just an unrelated own property.
    const impostor = Object.assign(async () => null, { trusted: true });
    assert.equal(isTrustedScopedMutationVerifier(impostor), false);
  } finally { await h.dispose(); }
});

// ─── Metadata is never self-authenticating ──────────────────────────────

test("GE-04: adapter fails closed on missing authority metadata before any verifier call", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService("/definitely/missing/helper",
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    for (const patch of [{ workerId: "" }, { policyRevision: "" }, { leaseId: "" }, { approvalId: "" }, { approvalId: undefined }]) {
      await assert.rejects(service.mutate(authorityOf(h, patch), createOp()),
        /authoritative mutation verification required/);
    }
    await assert.rejects(service.mutate(authorityOf(h), createOp("hi", "../escape")), /invalid scoped path/);
    await assert.rejects(service.mutate(authorityOf(h, { ownedScope: "../escape" }), createOp()),
      /invalid scoped path/);
  } finally { await h.dispose(); }
});

// ─── Lease: forged / expired / revoked / mismatched ─────────────────────

test("GE-04: live lease verifier rejects forged, revoked, expired and mismatched leases", async () => {
  const h = await harness();
  try {
    const verifier = createLiveScopedLeaseVerifier(h.registry);
    const op = createOp();
    const auth = authorityOf(h);
    assert.equal(await verifier(auth, op), true);
    assert.equal(await verifier({ ...auth, leaseId: "forged" }, op), false);
    assert.equal(await verifier({ ...auth, workerId: "worker-b" }, op), false);
    assert.equal(await verifier({ ...auth, ownedScope: "unowned" }, op), false);
    assert.equal(await verifier(auth, createOp("hello", "../escape")), false);

    const expired = await h.registry.acquire({
      agentId: "worker-a",
      scope: { kind: "path", root: join(h.root, "owned"), recursive: true },
      mode: "exclusive-write", ttlMs: 1,
    });
    assert.equal(expired.acquired, true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(await verifier({ ...auth, leaseId: expired.record!.id }, op), false);

    await h.registry.revoke(h.leaseId);
    assert.equal(await verifier(auth, op), false);
  } finally { await h.dispose(); }
});

test("GE-04: a forged lease cannot spend a real approval", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    await assert.rejects(service.mutate(authorityOf(h, { leaseId: "forged" }), createOp()),
      /authoritative mutation verification required/);
    await h.approvals.load();
    assert.equal(h.approvals.get(h.approvalId)!.status, "approved", "approval must remain unspent");
    await assert.rejects(readFile(join(h.root, "owned", "hello.txt")));
  } finally { await h.dispose(); }
});

// ─── Policy revision ────────────────────────────────────────────────────

test("GE-04: a policy revision mismatch denies without spending the approval", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        // Different policy configuration than the one that issued the grant.
        config: config({ sessionMode: "bypass" }),
        approvalStore: h.approvals, registry: h.registry,
      }));
    await assert.rejects(service.mutate(authorityOf(h), createOp()),
      /authoritative mutation verification required/);
    await h.approvals.load();
    assert.equal(h.approvals.get(h.approvalId)!.status, "approved");

    // A forged authority.revision is not a way around it either.
    const honest = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    await assert.rejects(honest.mutate(authorityOf(h, { policyRevision: "forged-revision" }), createOp()),
      /authoritative mutation verification required/);
    await h.approvals.load();
    assert.equal(h.approvals.get(h.approvalId)!.status, "approved");
  } finally { await h.dispose(); }
});

test("GE-04: an approval recorded under a different policy revision is refused", async () => {
  const h = await harness();
  try {
    const record = h.approvals.get(h.approvalId)!;
    // Simulate a grant issued under an older policy: the store record itself
    // carries the stale revision the scheduler would invalidate on.
    await h.approvals.mutate((records) => {
      const target = records.find((r) => r.id === record.id);
      if (target) target.policyRevision = "older-policy";
    });
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    await assert.rejects(service.mutate(authorityOf(h), createOp()),
      /authoritative mutation verification required/);
  } finally { await h.dispose(); }
});

// ─── Approval lifecycle ─────────────────────────────────────────────────

test("GE-04: forged, pending, expired, revoked and mismatched approvals all fail closed", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    // Forged id.
    await assert.rejects(service.mutate(authorityOf(h, { approvalId: "approval_forged" }), createOp()),
      /authoritative mutation verification required/);

    // Pending (not yet decided).
    const pending = await h.approvals.requestBound({
      reason: "pending", bindingKey: "ge04-pending", requestFingerprint: "f",
      policyRevision: h.policyRevision, capabilities: ["file.create"], workerId: "worker-a",
      invocation: computeScopedMutationInvocation(authorityOf(h), createOp()),
    });
    await assert.rejects(service.mutate(authorityOf(h, { approvalId: pending.id }), createOp()),
      /authoritative mutation verification required/);

    // Expired grant.
    const expired = await h.approvals.requestBound({
      reason: "expired", bindingKey: "ge04-expired", requestFingerprint: "f",
      policyRevision: h.policyRevision, capabilities: ["file.create"], workerId: "worker-a",
      invocation: computeScopedMutationInvocation(authorityOf(h), createOp()),
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    await h.approvals.resolve(expired.id, "approved");
    await assert.rejects(service.mutate(authorityOf(h, { approvalId: expired.id }), createOp()),
      /authoritative mutation verification required/);

    // Revoked grant.
    const revoked = await h.approvals.requestBound({
      reason: "revoked", bindingKey: "ge04-revoked", requestFingerprint: "f",
      policyRevision: h.policyRevision, capabilities: ["file.create"], workerId: "worker-a",
      invocation: computeScopedMutationInvocation(authorityOf(h), createOp()),
    });
    await h.approvals.resolve(revoked.id, "approved");
    await h.approvals.revoke(revoked.id, { actor: "operator", reason: "test" });
    await assert.rejects(service.mutate(authorityOf(h, { approvalId: revoked.id }), createOp()),
      /authoritative mutation verification required/);

    // Wrong worker (binding is per-worker).
    await assert.rejects(service.mutate(authorityOf(h, { workerId: "worker-b" }), createOp()),
      /authoritative mutation verification required/);

    // The genuine grant is still unused after all of that.
    await h.approvals.load();
    assert.equal(h.approvals.get(h.approvalId)!.status, "approved");
    await assert.rejects(readFile(join(h.root, "owned", "hello.txt")));
  } finally { await h.dispose(); }
});

test("GE-04: a grant bound to different bytes or a different target cannot authorize this write", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    await assert.rejects(service.mutate(authorityOf(h), createOp("different bytes")),
      /authoritative mutation verification required/);
    await assert.rejects(service.mutate(authorityOf(h), createOp("hello", "other.txt")),
      /authoritative mutation verification required/);
    await assert.rejects(service.mutate(authorityOf(h, { ownedScope: "unowned" }), createOp()),
      /authoritative mutation verification required/);
    await h.approvals.load();
    assert.equal(h.approvals.get(h.approvalId)!.status, "approved");
  } finally { await h.dispose(); }
});

// ─── Single use ─────────────────────────────────────────────────────────

test("GE-04: a grant is claimed once and a replay is denied", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    assert.deepEqual(await service.mutate(authorityOf(h), createOp()),
      { kind: "created", changed: true });
    await h.approvals.load();
    const spent = h.approvals.get(h.approvalId)!;
    assert.equal(spent.status, "consumed");
    assert.equal(spent.executionOutcome, "succeeded");
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");

    // Replay with the same cited approval: denied, and the file is untouched.
    await assert.rejects(service.mutate(authorityOf(h), createOp("overwritten")),
      /authoritative mutation verification required/);
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");
  } finally { await h.dispose(); }
});

test("GE-04: helper writes then exits nonzero stays unverified and is not replayable", async () => {
  const h = await harness();
  try {
    const helper = join(h.root, "partial-helper.sh");
    await writeFile(helper, '#!/bin/sh\nprintf "%s" "$4" > "$1/$2/$3"\nexit 17\n');
    await chmod(helper, 0o755);
    const service = new ExperimentalLinuxScopedMutationService(helper,
      createScopedMutationAuthorizationVerifier({ config: config(), approvalStore: h.approvals, registry: h.registry }));
    const result = await service.mutate(authorityOf(h), createOp());
    assert.equal(result.kind, "unverified");
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");
    await assert.rejects(service.mutate(authorityOf(h), createOp()), /authoritative mutation verification required/);
  } finally { await h.dispose(); }
});

test("GE-04: a restarted store can inspect an ambiguous consumed claim without replay", async () => {
  const h = await harness();
  try {
    const helper = join(h.root, "partial-restart-helper.sh");
    await writeFile(helper, '#!/bin/sh\nprintf "%s" "$4" > "$1/$2/$3"\nexit 17\n');
    await chmod(helper, 0o755);
    const service = new ExperimentalLinuxScopedMutationService(helper,
      createScopedMutationAuthorizationVerifier({ config: config(), approvalStore: h.approvals, registry: h.registry }));
    assert.equal((await service.mutate(authorityOf(h), createOp())).kind, "unverified");
    const restarted = new ApprovalStore(h.root);
    const claims = await inspectGe04UncertainClaims(restarted);
    assert.ok(claims.some(claim => claim.approvalId === h.approvalId && claim.executionOutcome === "pending"));
    const uncertain = claims.find(claim => claim.approvalId === h.approvalId)!;
    assert.deepEqual(assessGe04Reconciliation(uncertain), {
      approvalId: h.approvalId,
      eligibleForAutomaticTransition: false,
      reason: "missing_trusted_execution_owner_and_native_receipt",
    });
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");
    await assert.rejects(service.mutate(authorityOf(h), createOp()), /authoritative mutation verification required/);
    const after = await inspectGe04UncertainClaims(new ApprovalStore(h.root));
    assert.ok(after.some(claim => claim.approvalId === h.approvalId));
  } finally { await h.dispose(); }
});

test("GE-04: explicit lease revocation waits for fenced mutation", async () => {
  const h = await harness();
  try {
    let signalEntered!: () => void;
    let releaseAction!: () => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const continueAction = new Promise<void>(resolve => { releaseAction = resolve; });
    const fence = h.registry.withExclusiveLeaseFence(h.leaseId, h.workerId,
      join(h.root, "owned", "hello.txt"), async () => {
        signalEntered();
        await continueAction;
        return "completed";
      });
    await entered;
    const competingRegistry = new OwnershipRegistry(h.root);
    let revoked = false;
    const revocation = competingRegistry.revoke(h.leaseId).then(value => { revoked = value; });
    // A second process's revocation must not complete before the held action.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(revoked, false);
    releaseAction();
    assert.deepEqual(await fence, { allowed: true, value: "completed" });
    await revocation;
    assert.equal(revoked, true);
    assert.deepEqual(await h.registry.withExclusiveLeaseFence(h.leaseId, h.workerId,
      join(h.root, "owned", "hello.txt"), async () => "not-run"), { allowed: false });
  } finally { await h.dispose(); }
});

test("GE-04: revoked lease before helper dispatch prevents creation", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({ config: config(), approvalStore: h.approvals, registry: h.registry }));
    const refresh = h.registry.refresh.bind(h.registry);
    let calls = 0;
    h.registry.refresh = async () => {
      await refresh();
      if (++calls === 2) await h.registry.revoke(h.leaseId);
    };
    await assert.rejects(service.mutate(authorityOf(h), createOp()), /authority lapsed before native helper dispatch/);
    await assert.rejects(readFile(join(h.root, "owned", "hello.txt")));
  } finally { await h.dispose(); }
});

// ─── Post-write authority lapse (the residual TOCTOU) ───────────────────

test("GE-04: authority lapsing during the write is reported as unverified, never success", async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(await fixtureHelper(h.root),
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }));
    // Revoke the lease while the helper is running. The fixture helper is a plain
    // shell script, so do it from a timer-free hook: revoke first is not possible
    // (verification would fail), so revoke from the helper itself via env-free
    // sequencing — instead, revoke right after verification by wrapping the
    // registry's refresh used by revalidate().
    const originalRefresh = h.registry.refresh.bind(h.registry);
    let refreshes = 0;
    h.registry.refresh = async () => {
      refreshes++;
      await originalRefresh();
      // First refresh = approval verification; second = pre-dispatch; third = post-write.
      if (refreshes === 3) await h.registry.revoke(h.leaseId);
    };
    const outcome = await service.mutate(authorityOf(h), createOp());
    assert.equal(outcome.kind, "unverified");
    assert.equal(outcome.changed, true);
    assert.match((outcome as { reason: string }).reason, /authority lapsed during scoped mutation/);
    // The write did happen (it cannot be undone from here) — the point is the
    // adapter refuses to report it as an authorized success.
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");
  } finally { await h.dispose(); }
});

// ─── Real native helper (opt-in) ────────────────────────────────────────

test("experimental Linux adapter creates beneath owned root with supplied native helper", {
  skip: process.platform !== "linux" || !process.env.GE04_TEST_HELPER,
}, async () => {
  const h = await harness();
  try {
    const service = new ExperimentalLinuxScopedMutationService(process.env.GE04_TEST_HELPER!,
      createScopedMutationAuthorizationVerifier({
        config: config(), approvalStore: h.approvals, registry: h.registry,
      }), true);
    assert.deepEqual(await service.mutate(authorityOf(h), createOp("hello")),
      { kind: "created", changed: true });
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");

    // Defense in depth: the live lease verifier now refuses an existing
    // symlinked owned root before spending an approval. Independently, the
    // native helper's no-symlink openat2 containment is covered by the
    // standalone GE-04 native adversarial tests.
    await symlink("unowned", join(h.root, "alias"));
    const wideLease = await h.registry.acquire({
      agentId: "worker-a",
      scope: { kind: "path", root: h.root, recursive: true },
      mode: "exclusive-write",
    });
    assert.equal(wideLease.acquired, true);
    const aliasAuthority = authorityOf(h, {
      ownedScope: "alias",
      leaseId: wideLease.record!.id,
    });
    const aliasApproval = await h.approvals.requestBound({
      reason: "alias", bindingKey: "ge04-alias", requestFingerprint: "f",
      policyRevision: h.policyRevision, capabilities: ["file.create"], workerId: "worker-a",
      invocation: computeScopedMutationInvocation(aliasAuthority, createOp("attack", "escape.txt")),
    });
    await h.approvals.resolve(aliasApproval.id, "approved");
    await assert.rejects(
      service.mutate({ ...aliasAuthority, approvalId: aliasApproval.id }, createOp("attack", "escape.txt")),
      /authoritative mutation verification required/,
    );
    await assert.rejects(readFile(join(h.root, "unowned", "escape.txt")));
  } finally { await h.dispose(); }
});

test("GE-04: terminated native helper leaves durable uncertain claim for restart inspection", async () => {
  const h = await harness();
  try {
    const helper = join(h.root, "terminated-helper.sh");
    await writeFile(helper, '#!/bin/sh\nprintf "%s" "$4" > "$1/$2/$3"\nkill -TERM "$$"\n');
    await chmod(helper, 0o755);
    const service = new ExperimentalLinuxScopedMutationService(helper,
      createScopedMutationAuthorizationVerifier({ config: config(), approvalStore: h.approvals, registry: h.registry }));
    const result = await service.mutate(authorityOf(h), createOp());
    assert.equal(result.kind, "unverified");
    assert.equal(await readFile(join(h.root, "owned", "hello.txt"), "utf8"), "hello");
    const claims = await inspectGe04UncertainClaims(new ApprovalStore(h.root));
    const claim = claims.find(item => item.approvalId === h.approvalId);
    assert.equal(claim?.executionOutcome, "pending");
    assert.equal(assessGe04Reconciliation(claim!).eligibleForAutomaticTransition, false);
    await assert.rejects(service.mutate(authorityOf(h), createOp()), /authoritative mutation verification required/);
  } finally { await h.dispose(); }
});
