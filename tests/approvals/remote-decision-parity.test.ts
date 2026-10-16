/**
 * G3-C — remote-decision authorization parity table.
 *
 * The merge blocker for the remote decision endpoint: the authorization matrix
 * (role × workspace scope × transport × principal × approval state × exact-retry
 * identity) with explicit expected outcomes, broader than the handler. Modelled
 * on `tests/ownership/path-scope.test.ts`: a change that fixes one row must not
 * silently break another.
 *
 * The endpoint is invoked directly (`registerRemoteDecisionRoutes`) so every
 * branch is exercised deterministically, with a seeded credential store and a
 * real `ApprovalStore` behind it.
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
import { CredentialStore } from "../../src/governance/security/credentials/credential-store.js";
import { generateKey } from "../../src/governance/security/credentials/srap-evidence.js";
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

/** Minimal SecureJsonResponder that records the single response. */
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

/** Minimal IncomingMessage whose body emits on the next tick. */
function fakeReq(opts: { body?: unknown; encrypted?: boolean; forwardedProto?: string } = {}): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  (req as { headers: Record<string, unknown> }).headers = {};
  if (opts.forwardedProto !== undefined) {
    (req as { headers: Record<string, unknown> }).headers["x-forwarded-proto"] = opts.forwardedProto;
  }
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
  opts: Partial<RemoteDecisionOptions> & Pick<RemoteDecisionOptions, "credentialStore">,
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
      enabled: true,
      canonicalWorkspace: "/ws",
      trustedProxyCidrs: [],
      loadApprovalStore: async () => {
        const store = new ApprovalStore(root);
        await store.load();
        return store;
      },
      ...opts,
    },
  );
  // The handler runs async; yield until the response is captured.
  for (let i = 0; i < 200 && captured.status === undefined; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.notEqual(captured.status, undefined, "handler produced a response");
  return captured;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

describe("remote-decision parity", () => {
  let root: string;
  let creds: CredentialStore;
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

  beforeEach(async () => {
    root = join(tmpdir(), `srap-parity-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    creds = new CredentialStore({ filePath: join(root, "credential-store.json") });
    await creds.load();
    await generateKey(creds);
    approvalId = await seedApproval();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // -- Role × permission --------------------------------------------------
  const roleRows: Array<{ name: string; perms: string[]; expected: number }> = [
    { name: "admin (approvals:decide)", perms: ["approvals:read", "approvals:decide"], expected: 200 },
    { name: "operator (approvals:decide)", perms: ["approvals:read", "approvals:decide"], expected: 200 },
    { name: "readonly (no approvals:decide)", perms: ["approvals:read"], expected: 403 },
    { name: "no approvals:read (irrelevant)", perms: [], expected: 403 },
  ];
  for (const row of roleRows) {
    it(`role: ${row.name} → ${row.expected}`, async () => {
      const c = await invoke(root, ctxWith({ permissions: row.perms }), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }), approvalId);
      assert.equal(c.status, row.expected);
    });
  }

  // -- Authentication / transport ----------------------------------------
  it("anonymous (no context) → 401", async () => {
    const c = await invoke(root, null, { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }));
    assert.equal(c.status, 401);
  });

  it("unauthenticated context → 401", async () => {
    const c = await invoke(root, ctxWith({ authenticated: false }), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }));
    assert.equal(c.status, 401);
  });

  it("cookie session → 403 (bearer-only)", async () => {
    const c = await invoke(root, ctxWith({ authTransport: "cookie" }), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }));
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "bearer_required" });
  });

  it("unbound legacy credential (no principalId) → 403", async () => {
    const c = await invoke(root, ctxWith({ principalId: undefined }), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }));
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "principal_required" });
  });

  it("non-TLS, no trusted proxy → 403 (fail closed)", async () => {
    const c = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false }));
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "insecure_transport" });
  });

  it("forwarded https from an untrusted peer → 403 (fail closed)", async () => {
    const c = await invoke(
      root,
      ctxWith({}),
      { credentialStore: creds, trustedProxyCidrs: ["10.0.0.0/8"] },
      fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: false, forwardedProto: "https" }),
    );
    assert.equal(c.status, 403);
    assert.deepEqual(c.body, { error: "insecure_transport" });
  });

  // -- Workspace scope ----------------------------------------------------
  const scopeRows: Array<{ name: string; workspaceIds: string[] | undefined; expected: number }> = [
    { name: "explicit scope containing canonical workspace", workspaceIds: ["/ws"], expected: 200 },
    { name: "explicit scope excluding canonical workspace", workspaceIds: ["/other"], expected: 403 },
    { name: "explicit empty scope", workspaceIds: [], expected: 403 },
    { name: "missing scope (legacy unscoped)", workspaceIds: undefined, expected: 403 },
  ];
  for (const row of scopeRows) {
    it(`workspace: ${row.name} → ${row.expected}`, async () => {
      const c = await invoke(root, ctxWith({ workspaceIds: row.workspaceIds }), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }), approvalId);
      assert.equal(c.status, row.expected);
    });
  }

  // -- Default-off --------------------------------------------------------
  it("default-off: disabled endpoint refuses with 404 and no disclosure", async () => {
    const c = await invoke(root, ctxWith({}), { credentialStore: creds, enabled: false }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }));
    assert.equal(c.status, 404);
  });

  // -- Body validation ----------------------------------------------------
  it("missing decision → 400", async () => {
    const c = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { nonce: "n1" }, encrypted: true }));
    assert.equal(c.status, 400);
  });

  it("missing nonce → 400", async () => {
    const c = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "denied" }, encrypted: true }));
    assert.equal(c.status, 400);
  });

  // -- Approval state -----------------------------------------------------
  it("unknown approval id → 404", async () => {
    const c = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }), "apr-missing");
    assert.equal(c.status, 404);
  });

  it("pending approval + full eligibility → 200", async () => {
    const c = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }), approvalId);
    assert.equal(c.status, 200);
    assert.deepEqual(c.body, { id: approvalId, decision: "approved" });
  });

  it("exact retry → 200 idempotent; conflicting retry → 409 with no disclosure", async () => {
    const first = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "retry-1" }, encrypted: true }), approvalId);
    assert.equal(first.status, 200);

    // Same principal/nonce/decision → idempotent 200.
    const retry = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "retry-1" }, encrypted: true }), approvalId);
    assert.equal(retry.status, 200);
    assert.equal((retry.body as { idempotent?: boolean }).idempotent, true);

    // Different decision (same nonce) → 409, no state echoed.
    const conflict = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "denied", nonce: "retry-1" }, encrypted: true }), approvalId);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: "conflict" });

    // Different nonce → 409.
    const conflict2 = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "retry-2" }, encrypted: true }), approvalId);
    assert.equal(conflict2.status, 409);
  });

  it("expired pending approval → 409", async () => {
    const expiredId = await seedApproval({ expiresAt: "2000-01-01T00:00:00.000Z" });
    const c = await invoke(root, ctxWith({}), { credentialStore: creds }, fakeReq({ body: { decision: "approved", nonce: "n1" }, encrypted: true }), expiredId);
    assert.equal(c.status, 409);
    assert.deepEqual(c.body, { error: "expired" });
  });
});
