/**
 * G3-C — remote-decision authorization parity table + durable key-read evidence.
 *
 * The merge blocker for the remote decision endpoint: the authorization matrix
 * (role × workspace scope × transport × principal × approval state × exact-retry
 * identity) with explicit expected outcomes, broader than the handler. Modelled
 * on `tests/ownership/path-scope.test.ts`: a change that fixes one row must not
 * silently break another.
 *
 * The endpoint is invoked through its real module (`registerRemoteDecisionRoutes`)
 * with the REAL credential store resolved through the platform state-dir override
 * (`setStateDirOverride`) — no production-interface test seam — and a real
 * `ApprovalStore`/`AuditStore` on disk.
 *
 * CONTRIBUTING: this suite drives real timers — `fakeReq` emits its body on
 * `setImmediate` and `invoke` polls until the async handler responds — so every
 * case declares an explicit timeout with that rationale.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import type { ApprovalRequestInput } from "../../src/governance/approvals/approval-store.js";
import { AuditStore } from "../../src/governance/audit/audit-store.js";
import { generateKey } from "../../src/governance/security/credentials/srap-evidence.js";
import {
  writeStoredBackend,
  loadCredentialStoreWithKeychainFallback,
} from "../../src/governance/security/credentials/backend-selection.js";
import {
  setStateDirOverride,
  clearStateDirOverride,
} from "../../src/governance/security/platform/user-state-paths.js";
import { createSecurityContext } from "../../src/governance/security/inspector/security-context.js";
import type { SecurityContext } from "../../src/governance/security/inspector/security-context.js";
import { registerRemoteDecisionRoutes } from "../../src/interfaces/server/remote-decision-route.js";
import type { RemoteDecisionOptions } from "../../src/interfaces/server/remote-decision-route.js";
import type { SecureJsonResponder } from "../../src/interfaces/server/secure-response.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Captured {
  status?: number;
  body?: unknown;
}

function captureResponder(): { responder: SecureJsonResponder; captured: Captured } {
  const captured: Captured = {};
  const responder = {
    ok: (data: unknown) => {
      captured.status = 200;
      captured.body = data;
      return true;
    },
    error: (code: string, status: number) => {
      captured.status = status;
      captured.body = { error: code };
      return true;
    },
  } as unknown as SecureJsonResponder;
  return { responder, captured };
}

function fakeReq(opts: {
  body?: unknown;
  encrypted?: boolean;
  forwardedProto?: string;
  forwardedFor?: string;
} = {}): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  const headers: Record<string, unknown> = {};
  if (opts.forwardedProto !== undefined) headers["x-forwarded-proto"] = opts.forwardedProto;
  if (opts.forwardedFor !== undefined) headers["x-forwarded-for"] = opts.forwardedFor;
  (req as { headers: Record<string, unknown> }).headers = headers;
  (req as { socket: unknown }).socket = { encrypted: opts.encrypted ?? false, remoteAddress: "127.0.0.1" };
  const bodyText = opts.body === undefined ? "" : JSON.stringify(opts.body);
  setImmediate(() => {
    (req as unknown as EventEmitter).emit("data", Buffer.from(bodyText, "utf-8"));
    (req as unknown as EventEmitter).emit("end");
  });
  return req as unknown as IncomingMessage;
}

function ctxWith(over: Partial<SecurityContext>): SecurityContext {
  return createSecurityContext({
    authenticated: true,
    tokenId: "tok-1",
    principalId: "prin_test",
    permissions: ["approvals:read", "approvals:decide"],
    workspaceIds: ["/ws"],
    authTransport: "bearer",
    ...over,
  });
}

async function invoke(
  root: string,
  ctx: SecurityContext | null,
  opts: Partial<RemoteDecisionOptions>,
  req: IncomingMessage,
  approvalId = "apr-1",
): Promise<Captured> {
  const { responder, captured } = captureResponder();
  registerRemoteDecisionRoutes(
    root,
    "POST",
    `/api/approvals/${approvalId}/decision`,
    {} as ServerResponse,
    ctx,
    responder,
    req,
    {
      enabled: opts.enabled ?? true,
      canonicalWorkspace: opts.canonicalWorkspace ?? "/ws",
      trustedProxyCidrs: opts.trustedProxyCidrs ?? [],
      loadApprovalStore: async () => {
        const store = new ApprovalStore(root);
        await store.load();
        return store;
      },
    },
  );
  for (let i = 0; i < 200 && captured.status === undefined; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.notEqual(captured.status, undefined, "handler produced a response");
  return captured;
}

/** The single TLS-safe request used by the allow rows. */
function tlsReq(body: unknown): IncomingMessage {
  return fakeReq({ body, encrypted: true });
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

describe("remote-decision parity", () => {
  let root: string;
  let stateDir: string;
  let approvalId: string;

  async function seedApproval(over: Partial<ApprovalRequestInput> = {}): Promise<string> {
    const store = new ApprovalStore(root);
    await store.load();
    const rec = await store.requestBound({
      reason: "parity",
      bindingKey: `bk-${randomUUID()}`,
      requestFingerprint: "fp",
      policyRevision: "legacy",
      capabilities: ["shell.run"],
      ...over,
    });
    return rec.id;
  }

  /** Persist a corrupt expiry through the authoritative ledger, as a legacy row would load. */
  async function seedApprovalWithExpiry(expiresAt: string | undefined): Promise<string> {
    const id = await seedApproval();
    const store = new ApprovalStore(root);
    await store.load();
    await store.mutate((approvals) => {
      const record = approvals.find((a) => a.id === id);
      if (!record) return;
      if (expiresAt === undefined) delete (record as { expiresAt?: string }).expiresAt;
      else record.expiresAt = expiresAt;
    });
    return id;
  }

  beforeEach(async () => {
    root = join(tmpdir(), `srap-parity-${randomUUID()}`);
    stateDir = join(tmpdir(), `srap-state-${randomUUID()}`);
    await mkdir(root, { recursive: true });

    // Real credential store through the sanctioned platform override — the same
    // resolution the route uses in production (no production test seam).
    setStateDirOverride(stateDir);
    await writeStoredBackend("plain-file");
    const creds = await loadCredentialStoreWithKeychainFallback("plain-file");
    await generateKey(creds);

    approvalId = await seedApproval();
  });

  afterEach(async () => {
    clearStateDirOverride();
    await rm(root, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  // -- Role × permission --------------------------------------------------
  const roleRows: Array<{ name: string; perms: string[]; expected: number }> = [
    { name: "admin (approvals:decide)", perms: ["approvals:read", "approvals:decide"], expected: 200 },
    { name: "operator (approvals:decide)", perms: ["approvals:read", "approvals:decide"], expected: 200 },
    { name: "readonly (no approvals:decide)", perms: ["approvals:read"], expected: 403 },
    { name: "no approvals:read (irrelevant)", perms: [], expected: 403 },
  ];
  for (const row of roleRows) {
    it(`role: ${row.name} → ${row.expected}`, { timeout: 10_000 }, async () => {
      // CONTRIBUTING: real timers (setImmediate body + poll loop) ⇒ 10s cap.
      const c = await invoke(root, ctxWith({ permissions: row.perms }), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
      assert.equal(c.status, row.expected);
    });
  }

  // -- Authentication / transport ----------------------------------------
  it("anonymous (no context) → 401", { timeout: 10_000 }, async () => {
    const c = await invoke(root, null, {}, tlsReq({ decision: "approved", nonce: "n1" }));
    assert.equal(c.status, 401);
  });

  it("loopback development without a token → 401 (no remote decision authority)", { timeout: 10_000 }, async () => {
    // In disabled-loopback-development mode the middleware passes an anonymous
    // context; the route must not derive any authority from loopback.
    const anon = createSecurityContext({ authenticated: false, permissions: [], route: null });
    const c = await invoke(root, anon, {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 401);
  });

  it("cookie session → 403 (bearer-only)", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({ authTransport: "cookie" }), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "bearer_required" });
  });

  it("unbound legacy credential (no principalId) → 403", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({ principalId: undefined }), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "principal_required" });
  });

  it("no token id → 401 (nothing to sign over)", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({ tokenId: undefined }), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 401);
  });

  it("non-TLS, no trusted proxy → 403 (fail closed)", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), {}, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false }), approvalId);
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "insecure_transport" });
  });

  it("forwarded https from an untrusted peer → 403 (fail closed)", { timeout: 10_000 }, async () => {
    const c = await invoke(
      root,
      ctxWith({}),
      { trustedProxyCidrs: ["10.0.0.0/8"] },
      fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false, forwardedProto: "https", forwardedFor: "203.0.113.5" }),
      approvalId,
    );
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "insecure_transport" });
  });

  it("forwarded https from a TRUSTED proxy → 200 (proxy-tls accepted)", { timeout: 10_000 }, async () => {
    const c = await invoke(
      root,
      ctxWith({}),
      { trustedProxyCidrs: ["127.0.0.1/32"] },
      fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false, forwardedProto: "https", forwardedFor: "203.0.113.5" }),
      approvalId,
    );
    assert.equal(c.status, 200);
  });

  it("ambiguous x-forwarded-proto from a trusted proxy → 403 (fail closed)", { timeout: 10_000 }, async () => {
    const c = await invoke(
      root,
      ctxWith({}),
      { trustedProxyCidrs: ["127.0.0.1/32"] },
      fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false, forwardedProto: "https, http", forwardedFor: "203.0.113.5" }),
      approvalId,
    );
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "insecure_transport" });
  });

  it("forwarded http (not https) from a trusted proxy → 403", { timeout: 10_000 }, async () => {
    const c = await invoke(
      root,
      ctxWith({}),
      { trustedProxyCidrs: ["127.0.0.1/32"] },
      fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false, forwardedProto: "http", forwardedFor: "203.0.113.5" }),
      approvalId,
    );
    assert.equal(c.status, 403);
  });

  // -- Workspace scope ----------------------------------------------------
  const scopeRows: Array<{ name: string; workspaceIds: string[] | undefined; expected: number }> = [
    { name: "explicit scope containing canonical workspace", workspaceIds: ["/ws"], expected: 200 },
    { name: "explicit scope excluding canonical workspace", workspaceIds: ["/other"], expected: 403 },
    { name: "explicit empty scope", workspaceIds: [], expected: 403 },
    { name: "missing scope (legacy unscoped)", workspaceIds: undefined, expected: 403 },
  ];
  for (const row of scopeRows) {
    it(`workspace: ${row.name} → ${row.expected}`, { timeout: 10_000 }, async () => {
      // CONTRIBUTING: real timers (setImmediate body + poll loop) ⇒ 10s cap.
      const c = await invoke(root, ctxWith({ workspaceIds: row.workspaceIds }), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
      assert.equal(c.status, row.expected);
    });
  }

  // -- Default-off --------------------------------------------------------
  it("default-off: disabled endpoint refuses with 404 and no disclosure", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), { enabled: false }, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 404);
  });

  // -- Body validation ----------------------------------------------------
  it("missing decision → 400", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), {}, tlsReq({ nonce: "n1" }), approvalId);
    assert.equal(c.status, 400);
  });

  it("missing nonce → 400", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "denied" }), approvalId);
    assert.equal(c.status, 400);
  });

  // -- Approval state -----------------------------------------------------
  it("unknown approval id → 404", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n1" }), "apr-missing");
    assert.equal(c.status, 404);
  });

  it("pending approval + full eligibility → 200", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 200);
    assert.deepEqual(c.body, { id: approvalId, decision: "approved" });
  });

  it("exact retry → 200 idempotent; conflicting retry → 409 with no disclosure", { timeout: 10_000 }, async () => {
    const first = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "retry-1" }), approvalId);
    assert.equal(first.status, 200);

    const retry = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "retry-1" }), approvalId);
    assert.equal(retry.status, 200);
    assert.equal((retry.body as { idempotent?: boolean }).idempotent, true);

    // Different decision (same nonce) → 409, no state echoed.
    const conflict = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "denied", nonce: "retry-1" }), approvalId);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: "conflict" });

    // Different nonce → 409.
    const conflict2 = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "retry-2" }), approvalId);
    assert.equal(conflict2.status, 409);
  });

  it("exact-retry identity: a different principal cannot replay another's decision → 409", { timeout: 10_000 }, async () => {
    const first = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n-prin" }), approvalId);
    assert.equal(first.status, 200);

    // Same approval, same nonce+decision, DIFFERENT principal → not an exact
    // retry; must not be accepted and must leak no state.
    const other = await invoke(root, ctxWith({ principalId: "prin_other" }), {}, tlsReq({ decision: "approved", nonce: "n-prin" }), approvalId);
    assert.equal(other.status, 409);
    assert.deepEqual(other.body, { error: "conflict" });
  });

  it("cross-record: a decision on A leaves B pending, and B's decision does not touch A", { timeout: 10_000 }, async () => {
    const bId = await seedApproval();

    // Decide A successfully.
    const a = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n-a" }), approvalId);
    assert.equal(a.status, 200);

    const store = new ApprovalStore(root);
    await store.load();
    const bBefore = await store.get(bId);
    assert.ok(bBefore);
    assert.equal(bBefore.status, "pending", "B is untouched by A's decision");
    assert.equal(bBefore.remoteDecisionEvidence, undefined, "B carries no evidence");

    // Now decide B; A remains as it was.
    const b = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "denied", nonce: "n-b" }), bId);
    assert.equal(b.status, 200);

    const aAfter = await store.get(approvalId);
    assert.ok(aAfter);
    assert.equal(aAfter.status, "approved", "A keeps its own decision");
    assert.equal(aAfter.remoteDecisionEvidence?.nonce, "n-a");
  });

  it("expired pending approval → 409", { timeout: 10_000 }, async () => {
    const expiredId = await seedApproval({ expiresAt: "2000-01-01T00:00:00.000Z" });
    const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n1" }), expiredId);
    assert.equal(c.status, 409);
    assert.deepEqual(c.body, { error: "expired" });
  });

  for (const [label, expiresAt] of [
    ["missing", undefined],
    ["empty", ""],
    ["malformed", "not-a-date"],
  ] as const) {
    it(`${label} pending approval expiry → 409, never a decision`, { timeout: 10_000 }, async () => {
      // CONTRIBUTING: real timers (setImmediate body + poll loop) ⇒ 10s cap.
      const corruptId = await seedApprovalWithExpiry(expiresAt);
      const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n1" }), corruptId);
      assert.equal(c.status, 409);
      assert.deepEqual(c.body, { error: "expired" });

      const store = new ApprovalStore(root);
      await store.load();
      assert.equal(store.get(corruptId)?.status, "pending", "corrupt authority must not be decided");
      assert.equal(store.get(corruptId)?.remoteDecisionEvidence, undefined);
    });
  }

  // -- Durable key-read evidence ------------------------------------------
  it("records a durable, non-secret key-read audit entry on success", { timeout: 10_000 }, async () => {
    const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 200);

    const entries = await new AuditStore(root).findByAction("credential.key_read");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actor, "prin_test");
    assert.equal(entries[0].details.keyVersion, 1);
    assert.equal(entries[0].details.keyOperation, "sign");
    assert.equal(entries[0].details.keyOutcome, "ok");
    assert.ok(typeof entries[0].timestamp === "string" && entries[0].timestamp.length > 0);
    // Never the key material or the raw credential record id.
    const serialized = JSON.stringify(entries[0]);
    assert.ok(!serialized.includes("hmac-key"));
    assert.ok(!serialized.includes("tok-1"));
  });

  it("fails closed (503, no decision) when the key read cannot be durably audited", { timeout: 10_000 }, async () => {
    // Make the audit log unwritable: a directory where the JSONL file belongs.
    await mkdir(join(root, ".alix", "audit", "audit.jsonl"), { recursive: true });

    const c = await invoke(root, ctxWith({}), {}, tlsReq({ decision: "approved", nonce: "n1" }), approvalId);
    assert.equal(c.status, 503);
    assert.deepEqual(c.body, { error: "evidence_unavailable" });

    // The approval was not decided.
    const store = new ApprovalStore(root);
    await store.load();
    const rec = await store.get(approvalId);
    assert.ok(rec);
    assert.equal(rec.status, "pending", "no decision committed without durable evidence");
    assert.equal(rec.remoteDecisionEvidence, undefined);
  });
});
