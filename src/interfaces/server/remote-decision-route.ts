/**
 * G3-C — remote approval decision endpoint (`POST /api/approvals/:id/decision`).
 *
 * The single default-off, non-executing browser write exception (ADR-0015,
 * `src/governance/approvals/AGENTS.md`). It resolves a pending approval through
 * the existing `ApprovalStore` carrying authenticated remote-decision evidence,
 * then attempts the audit projection inline. It adds no approval authority, no
 * scheduler, no state machine, and no execution path.
 *
 * Eligible request = authenticated (bearer) ∧ `approvals:decide` ∧ active
 * operator principal ∧ `canonicalWorkspace ∈ token.workspaceIds` (explicit,
 * nonempty) ∧ trusted TLS transport ∧ approval `pending` and unexpired.
 *
 * Idempotency: an exact retry (`principalId`, `nonce`, `decision`) re-runs every
 * check and returns 200; a conflicting retry is 409 with no state disclosure.
 * Authorization runs BEFORE any approval state is read.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApprovalStore } from "../../governance/approvals/approval-store.js";
import { remoteDecisionRetryKey } from "../../governance/approvals/approval-types.js";
import type { RemoteDecisionEvidence } from "../../governance/approvals/approval-types.js";
import { projectRemoteDecisions } from "../../governance/audit/remote-decision-projection.js";
import { AuditStore } from "../../governance/audit/audit-store.js";
import { signCredentialRef } from "../../governance/security/credentials/srap-evidence.js";
import {
  chooseBackend,
  loadCredentialStoreWithKeychainFallback,
} from "../../governance/security/credentials/backend-selection.js";
import { resolveClientAddress } from "../../governance/security/inspector/client-address.js";
import type { SecurityContext } from "../../governance/security/inspector/security-context.js";
import type { CredentialStore } from "../../governance/security/credentials/credential-store.js";
import type { SecureJsonResponder } from "./secure-response.js";

/** Options threaded from server startup (default-off). */
export interface RemoteDecisionOptions {
  /** Master switch (`ui.security.remoteDecisions.enabled`). Default false. */
  enabled: boolean;
  /** Canonical server workspace root (already canonicalized by `startServer`). */
  canonicalWorkspace: string;
  /** Configured immediate-peer proxy CIDRs. */
  trustedProxyCidrs: string[];
  /**
   * Loader for the approval store. `server.ts` supplies it so the protected
   * `approval-store` import stays on the allowlisted composition root
   * (`tests/architecture/r1-boundary-freeze.test.ts`).
   */
  loadApprovalStore: () => Promise<ApprovalStore>;
}

/** Max accepted request body size (bytes). */
const MAX_BODY_BYTES = 64 * 1024;

const DECISION_PATH = /^\/api\/approvals\/([^/]+)\/decision$/;

interface DecisionBody {
  decision: "approved" | "denied";
  nonce: string;
  reason?: string;
}

/** Read and JSON-parse a bounded request body. Returns null on any failure. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (value: Record<string, unknown> | null): void => {
      if (done) return;
      done = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        finish(text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>));
      } catch {
        finish(null);
      }
    });
    req.on("error", () => finish(null));
    req.on("close", () => finish(null));
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

/**
 * Derive the connection security for evidence. Fails closed (`null`) when the
 * request is neither directly TLS-terminated nor forwarded HTTPS from a
 * configured trusted proxy with one unambiguous `x-forwarded-proto`.
 */
function deriveRemoteTransport(
  req: IncomingMessage,
  trustedProxyCidrs: string[],
): "direct-tls" | "proxy-tls" | null {
  const socket = req.socket as { encrypted?: boolean } | undefined;
  if (socket?.encrypted === true) return "direct-tls";

  const client = resolveClientAddress(req, trustedProxyCidrs);
  if (!client.fromProxy) return null;

  const proto = firstHeader(req.headers["x-forwarded-proto"]);
  if (proto === undefined || proto.includes(",")) return null;
  return proto.trim().toLowerCase() === "https" ? "proxy-tls" : null;
}

/** Parse and validate the decision body. */
function parseBody(body: Record<string, unknown> | null): DecisionBody | null {
  if (body === null) return null;
  const { decision, nonce, reason } = body;
  if (decision !== "approved" && decision !== "denied") return null;
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 256) return null;
  if (reason !== undefined && typeof reason !== "string") return null;
  return { decision, nonce, reason };
}

/**
 * Register the remote decision route. Returns true when this module handled the
 * request (including refusals); false when the path/method did not match.
 */
export function registerRemoteDecisionRoutes(
  root: string,
  method: string,
  pathname: string,
  _res: ServerResponse,
  ctx: SecurityContext | null,
  secure: SecureJsonResponder,
  req: IncomingMessage,
  opts: RemoteDecisionOptions,
): boolean {
  const match = pathname.match(DECISION_PATH);
  if (method !== "POST" || !match) return false;
  const approvalId = match[1];
  void handleDecision(root, approvalId, ctx, secure, req, opts);
  return true;
}

async function handleDecision(
  root: string,
  approvalId: string,
  ctx: SecurityContext | null,
  secure: SecureJsonResponder,
  req: IncomingMessage,
  opts: RemoteDecisionOptions,
): Promise<void> {
  try {
    // 0. Default-off: registered but inert. No disclosure.
    if (!opts.enabled) {
      secure.error("not_found", 404);
      return;
    }

    // 1. Authorization — BEFORE any approval state is read.
    if (!ctx || ctx.authenticated !== true) {
      secure.error("authentication_required", 401);
      return;
    }
    if (ctx.authTransport !== "bearer") {
      // Bearer-only: browser cookie sessions carry no remote-decision authority.
      secure.error("bearer_required", 403);
      return;
    }
    if (!ctx.permissions.includes("approvals:decide")) {
      secure.error("insufficient_permissions", 403);
      return;
    }
    if (ctx.principalId === undefined) {
      // A principal is required; unbound legacy credentials are not eligible.
      secure.error("principal_required", 403);
      return;
    }
    if (ctx.tokenId === undefined || ctx.tokenId.length === 0) {
      // Evidence signs over the credential record id; without one, fail closed.
      secure.error("authentication_required", 401);
      return;
    }
    const workspaceIds = ctx.workspaceIds;
    if (
      !Array.isArray(workspaceIds) ||
      workspaceIds.length === 0 ||
      !workspaceIds.includes(opts.canonicalWorkspace)
    ) {
      // Explicit, nonempty scope containing the canonical server workspace.
      secure.error("workspace_scope_required", 403);
      return;
    }
    const transport = deriveRemoteTransport(req, opts.trustedProxyCidrs);
    if (transport === null) {
      secure.error("insecure_transport", 403);
      return;
    }

    // 2. Body validation.
    const body = parseBody(await readJsonBody(req));
    if (body === null) {
      secure.error("invalid_request", 400);
      return;
    }

    const retryKey = remoteDecisionRetryKey({
      principalId: ctx.principalId,
      nonce: body.nonce,
      decision: body.decision,
    });

    // 3. Approval state (now that the caller is authorized).
    const store = await opts.loadApprovalStore();
    const record = await store.get(approvalId);
    if (!record) {
      secure.error("not_found", 404);
      return;
    }

    if (record.status !== "pending") {
      // Exact retry → idempotent 200; anything else → 409 with NO state disclosure.
      // The `unexpired` leg is not re-applied here: an already-decided approval is
      // being *replayed*, not newly decided, so expiry is moot for the exact retry.
      const stored = record.remoteDecisionEvidence;
      if (stored !== undefined && remoteDecisionRetryKey(stored) === retryKey) {
        secure.ok({ id: approvalId, decision: stored.decision, idempotent: true });
        return;
      }
      secure.error("conflict", 409);
      return;
    }

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      secure.error("expired", 409);
      return;
    }

    // 4. Evidence. Fail closed when the active HMAC key is unavailable OR when
    //    the mandatory key-read audit cannot be durably written.
    const credentialStore = await openCredentialStore();
    const auditStore = new AuditStore(root);
    let credentialRef: string;
    try {
      credentialRef = await signCredentialRef(credentialStore, ctx.tokenId, async (event) => {
        // Durable, non-secret key-read evidence in the authoritative audit chain.
        // Never the key material, credential record id, or request payload.
        await auditStore.append({
          action: "credential.key_read",
          actor: ctx.principalId,
          details: {
            keyVersion: event.keyVersion,
            keyOperation: event.operation,
            keyOutcome: "ok",
            reason: "remote_decision_evidence",
          },
        });
      });
    } catch {
      // No key material, or the key read could not be durably audited →
      // commit no decision (fail closed).
      secure.error("evidence_unavailable", 503);
      return;
    }

    const decisionId = `srap-${createHash("sha256").update(retryKey).digest("hex").slice(0, 32)}`;
    const evidence: RemoteDecisionEvidence = {
      decisionId,
      principalId: ctx.principalId,
      credentialRef,
      decision: body.decision,
      nonce: body.nonce,
      decidedAt: new Date().toISOString(),
      transport,
    };

    // 5. Authoritative resolve (evidence lands in the same ledger commit).
    const resolved = await store.resolveWithEvidence(
      approvalId,
      body.decision,
      evidence,
      body.reason,
    );
    // `resolveWithEvidence` is a no-op if another writer already decided this
    // approval between our read and the commit. Only OUR evidence landing in the
    // committed record counts as success; anything else is a conflicting retry.
    const applied = resolved?.remoteDecisionEvidence;
    if (
      !resolved ||
      resolved.status !== body.decision ||
      applied === undefined ||
      remoteDecisionRetryKey(applied) !== retryKey
    ) {
      secure.error("conflict", 409);
      return;
    }

    // 6. Inline audit projection — a projection failure never changes the outcome.
    try {
      await projectRemoteDecisions(root);
    } catch {
      // Best-effort; the startup/operator repair trigger retries.
    }

    // 7. Acknowledge only after the authoritative append returned.
    secure.ok({ id: approvalId, decision: body.decision });
  } catch {
    secure.error("internal_error", 500);
  }
}

/** Open the credential store (no interactive prompt — fail closed instead). */
async function openCredentialStore(): Promise<CredentialStore> {
  const backend = await chooseBackend();
  return loadCredentialStoreWithKeychainFallback(backend);
}

