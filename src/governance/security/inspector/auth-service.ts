/**
 * P4.3-Sb2 — Auth Service
 *
 * Token lifecycle management: create, list, rotate, revoke.
 * This is the business-logic layer above the AuthStore, handling
 * token generation, validation, grace windows, and auditing.
 *
 * Key invariants:
 * - Raw tokens exist only at creation and rotation time.
 * - Token hashes are never included in user-facing output.
 * - All mutations are audited through the provided AuditFn.
 * - Metrics are emitted through the provided MetricsFn (bounded vocabulary).
 *
 * @module
 */

import { join } from "node:path";
import { allowsWorkspace } from "./workspace-scope.js";
import {
  generateToken,
  verifyTokenHash,
  parseToken,
} from "./token-format.js";
import { AuthStore, createTokenRecord, createRevocation, MAX_TOKEN_COUNT } from "./auth-store.js";
import { PrincipalStore, createPrincipalRecord } from "./principal-store.js";
import type { PrincipalRecord } from "./principal-store.js";
import { withStoreLocks } from "./store-lock.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Roles supported for auth tokens. */
export type AuthTokenRole = "readonly" | "operator" | "admin";

/** Allowed roles list. */
export const AUTH_TOKEN_ROLES: readonly AuthTokenRole[] = [
  "readonly",
  "operator",
  "admin",
];

/** Metadata about a token (safe for display — no hash). */
export interface TokenInfo {
  id: string;
  name: string;
  role: string;
  workspaceIds?: string[];
  createdAt: string;
  expiresAt?: string;
  rotatedFrom?: string;
  revoked: boolean;
  revokedAt?: string;
}

/** Result of creating a token. */
export interface TokenCreationResult {
  id: string;
  token: string;
  name: string;
  role: string;
  createdAt: string;
  /** Operator principal this credential is bound to (G3-A′). */
  principalId: string;
}

/** Result of rotating a token. */
export interface TokenRotationResult {
  id: string;
  token: string;
  name: string;
  role: string;
  createdAt: string;
  previousId: string;
}

/** Authenticated identity metadata safe to place in request/session context. */
export interface AuthPrincipal {
  id: string;
  name: string;
  role: string;
  workspaceIds?: string[];
  /**
   * Operator principal bound to this credential, when bound (G3-A′). Absent for
   * a genuinely unbound legacy credential. Distinct from `id` (the credential).
   */
  principalId?: string;
}

/** Report from `alix inspector auth migrate`. */
export interface MigrationReport {
  bound: Array<{ tokenId: string; principalId: string }>;
  skipped: Array<{ tokenId: string; reason: MigrationSkipReason }>;
}

/** Why a token was not bound by migration. */
export type MigrationSkipReason =
  | "already-bound"
  | "revoked"
  | "expired"
  | "principal-not-found"
  | "principal-disabled";

/** Report from `alix inspector auth reconcile` (read-only). */
export interface ReconcileReport {
  /** Principals with zero bound credentials (enrollment never completed). */
  incompleteEnrollments: PrincipalRecord[];
  /** Principals whose every bound credential is revoked or expired. */
  noActiveCredentials: PrincipalRecord[];
  /** Bound credentials whose principal is missing or disabled. */
  danglingBindings: Array<{
    tokenId: string;
    principalId: string;
    reason: "principal-missing" | "principal-disabled";
  }>;
}

/** Common rich result for service operations. */
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Audit callback
// ---------------------------------------------------------------------------

/** Function called to record an audit event.
 * When async, callers that require durability should await it.
 * Server runtime may use fire-and-forget; CLI should await for fail-closed. */
export type AuditFn = (event: {
  action: string;
  tokenId: string;
  details?: Record<string, unknown>;
}) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Metrics callback (bounded vocabulary)
// ---------------------------------------------------------------------------

/** Closed vocabulary of security metric names. */
export type SecurityMetricName =
  | "token.created"
  | "token.rotated"
  | "token.revoked"
  | "token.listed"
  | "token.verified"
  | "token.verification_failed"
  | "token.doctor_checked";

/** Closed vocabulary of metric label keys. */
export type SecurityMetricLabelKey = "role" | "status";

/** Closed vocabulary of metric label values. */
export type SecurityMetricLabelValue =
  | "readonly"
  | "operator"
  | "admin"
  | "ok"
  | "failed";

/** Function called to emit a bounded security metric. */
export type MetricsFn = (
  name: SecurityMetricName,
  labels?: Partial<Record<SecurityMetricLabelKey, SecurityMetricLabelValue>>,
) => void;

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

/**
 * Encode a token's workspace scope for an audit-details payload.
 *
 * The tri-state is deliberate and must stay distinguishable: `null` means the
 * credential carries no scope (legacy unscoped access); `[]` means an explicit
 * deny-all; a nonempty list is the granted scope.
 */
function scopeForAudit(workspaceIds: string[] | undefined): string[] | null {
  return workspaceIds === undefined ? null : workspaceIds;
}

export class AuthService {
  private readonly store: AuthStore;
  private readonly audit: AuditFn;
  private readonly metrics: MetricsFn;
  private readonly principalStore: PrincipalStore;

  constructor(
    store: AuthStore,
    audit: AuditFn,
    metrics: MetricsFn,
    opts?: { principalStore?: PrincipalStore },
  ) {
    this.store = store;
    this.audit = audit;
    this.metrics = metrics;
    this.principalStore =
      opts?.principalStore ??
      new PrincipalStore({ filePath: join(store.getStoreDir(), "principals.json") });
  }

  /** The operator-identity store (identity/status only; not the binding authority). */
  getPrincipalStore(): PrincipalStore {
    return this.principalStore;
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  /**
   * Create a new auth token and its operator principal.
   *
   * The raw token is returned exactly once. The caller MUST display it to the
   * operator and warn them to store it securely.
   *
   * Ordering (G3-A′): under the `principals`→`auth-store` locks, write-ahead
   * audit the intent, then write the principal, then the credential. A crash
   * after the principal write leaves an inert incomplete enrollment (no
   * credential resolves to it), never a credential pointing at a missing
   * principal. Pass `principalId` to adopt an existing (active) principal.
   */
  async createToken(opts: {
    name: string;
    role: AuthTokenRole;
    workspaceIds?: string[];
    expiresAt?: string;
    principalId?: string;
  }): Promise<ServiceResult<TokenCreationResult>> {
    const { name, role, workspaceIds, expiresAt, principalId } = opts;

    // Validate role
    if (!AUTH_TOKEN_ROLES.includes(role)) {
      return { ok: false, error: "invalid_role" };
    }

    const dir = this.store.getStoreDir();
    const work = await withStoreLocks(dir, ["principals", "auth-store"], async (locks) => {
      // Re-read the authoritative count under the lock (no stale snapshot).
      const countResult = await this.store.count();
      if (!countResult.ok) return countResult;
      if (countResult.value >= MAX_TOKEN_COUNT) {
        return { ok: false as const, error: "token_limit_reached" };
      }

      // Resolve the principal to bind (adopt an existing active one, or create).
      let principal: PrincipalRecord;
      let createdPrincipal = false;
      if (principalId !== undefined) {
        const existing = await this.principalStore.get(principalId);
        if (!existing.ok) return existing;
        if (!existing.value) return { ok: false as const, error: "principal_not_found" };
        if (existing.value.status !== "active") {
          return { ok: false as const, error: "principal_disabled" };
        }
        principal = existing.value;
      } else {
        principal = createPrincipalRecord({ name });
        createdPrincipal = true;
      }

      const generated = generateToken();
      const record = createTokenRecord({
        id: generated.id,
        hash: generated.hash,
        name,
        role,
        workspaceIds,
        expiresAt,
        principalId: principal.id,
      });

      // Write-ahead audit: record intent BEFORE any store mutation.
      // Fail-closed (#685): if the audit cannot persist, nothing is created.
      try {
        await this.audit({
          action: "token.created",
          tokenId: generated.id,
          details: {
            name,
            role,
            workspaceIds: scopeForAudit(workspaceIds),
            principalId: principal.id,
          },
        });
      } catch {
        return { ok: false as const, error: "audit_write_failed" };
      }

      // Ordered writes: principal FIRST (partial failure → inert orphan), then
      // the credential.
      if (createdPrincipal) {
        const created = await this.principalStore.createUnder(locks, principal);
        if (!created.ok) return created;
      }
      const addResult = await this.store.addUnder(locks, record);
      if (!addResult.ok) return addResult;

      return {
        ok: true as const,
        value: {
          id: generated.id,
          token: generated.token,
          name,
          role,
          createdAt: record.createdAt,
          principalId: principal.id,
        },
      };
    });

    if (!work.ok) {
      this.metrics("token.created", { role: role as SecurityMetricLabelValue, status: "failed" });
      return { ok: false, error: work.error };
    }
    if (!work.value.ok) {
      this.metrics("token.created", { role: role as SecurityMetricLabelValue, status: "failed" });
      return work.value;
    }
    this.metrics("token.created", { role: role as SecurityMetricLabelValue, status: "ok" });
    return work.value;
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  /**
   * List all tokens (safe metadata only — no hashes, no raw tokens).
   */
  async listTokens(): Promise<ServiceResult<TokenInfo[]>> {
    const result = await this.store.load();
    if (!result.ok) return result;

    const tokens: TokenInfo[] = result.value.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      workspaceIds: t.workspaceIds,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      rotatedFrom: t.rotatedFrom,
      revoked: !!t.revocation,
      revokedAt: t.revocation?.revokedAt,
    }));

    this.metrics("token.listed", { status: "ok" });
    return { ok: true, value: tokens };
  }

  // -----------------------------------------------------------------------
  // Rotate
  // -----------------------------------------------------------------------

  /**
   * Rotate a token: create a new one, set a grace window on the old one.
   *
   * The old token remains valid for the grace period, after which it is
   * rejected. The new raw token is returned exactly once.
   */
  async rotateToken(
    id: string,
    graceMs: number,
  ): Promise<ServiceResult<TokenRotationResult>> {
    const dir = this.store.getStoreDir();
    const work = await withStoreLocks(dir, ["auth-store"], async (locks) => {
      // Re-read authoritative state under the lock (no stale snapshot).
      const existingResult = await this.store.get(id);
      if (!existingResult.ok) return existingResult;
      if (!existingResult.value) {
        return { ok: false as const, error: "token_not_found" };
      }

      const existing = existingResult.value;

      // Cannot rotate a revoked token
      if (existing.revocation) {
        return { ok: false as const, error: "token_revoked" };
      }

      const roleLabel = existing.role as SecurityMetricLabelValue;

      // Generate new token — inheriting the operator principal (identity
      // continuity across rotation; never minted from the credential id).
      const generated = generateToken();
      const graceExpiry = new Date(Date.now() + graceMs).toISOString();
      const record = createTokenRecord({
        id: generated.id,
        hash: generated.hash,
        name: existing.name,
        role: existing.role,
        workspaceIds: existing.workspaceIds,
        rotatedFrom: id,
        expiresAt: graceExpiry,
        principalId: existing.principalId,
      });

      // Write-ahead audit: record intent before mutations.
      // Fail-closed (#685): if the audit cannot persist, neither token is changed.
      try {
        await this.audit({
          action: "token.rotated",
          tokenId: generated.id,
          details: {
            previousId: id,
            graceMs,
            workspaceIds: scopeForAudit(existing.workspaceIds),
            principalId: existing.principalId ?? null,
          },
        });
      } catch {
        this.metrics("token.rotated", { role: roleLabel, status: "failed" });
        return { ok: false as const, error: "audit_write_failed" };
      }

      // Persist new token
      const addResult = await this.store.addUnder(locks, record);
      if (!addResult.ok) return addResult;

      // Set grace expiry on old token (doesn't delete — just sets expiry)
      const updateResult = await this.store.updateUnder(locks, id, {
        expiresAt: graceExpiry,
      });
      if (!updateResult.ok) {
        // Roll back the new token if the old token update fails, preventing both
        // tokens remaining active indefinitely.
        await this.store.updateUnder(locks, generated.id, {
          revocation: createRevocation("rotation_rollback"),
        });
        this.metrics("token.rotated", { role: roleLabel, status: "failed" });
        return {
          ok: false as const,
          error: `Rotation failed: could not expire old token. New token ${generated.id} has been revoked. Error: ${updateResult.error}`,
        };
      }

      this.metrics("token.rotated", { role: roleLabel, status: "ok" });

      return {
        ok: true as const,
        value: {
          id: generated.id,
          token: generated.token,
          name: existing.name,
          role: existing.role,
          createdAt: record.createdAt,
          previousId: id,
        },
      };
    });

    if (!work.ok) return { ok: false, error: work.error };
    return work.value;
  }

  // -----------------------------------------------------------------------
  // Revoke
  // -----------------------------------------------------------------------

  /**
   * Revoke a token immediately.
   */
  async revokeToken(id: string, reason: string): Promise<ServiceResult<void>> {
    const dir = this.store.getStoreDir();
    const work = await withStoreLocks(dir, ["auth-store"], async (locks) => {
      // Re-read authoritative state under the lock (no stale snapshot).
      const existingResult = await this.store.get(id);
      if (!existingResult.ok) return existingResult;
      if (!existingResult.value) {
        return { ok: false as const, error: "token_not_found" };
      }
      const existing = existingResult.value;

      // Already revoked
      if (existing.revocation) {
        return { ok: false as const, error: "already_revoked" };
      }

      const revocation = createRevocation(reason);

      // Write-ahead audit: record intent before mutation.
      // Fail-closed (#685): if the audit cannot persist, the token is not revoked.
      try {
        await this.audit({
          action: "token.revoked",
          tokenId: id,
          details: { reason, principalId: existing.principalId ?? null },
        });
      } catch {
        this.metrics("token.revoked", { status: "failed" });
        return { ok: false as const, error: "audit_write_failed" };
      }

      // Revocation removes authentication eligibility but PRESERVES principalId
      // for historical attribution (G3-A′). `update` merges, so the binding
      // survives; the revoked state already denies access.
      const updateResult = await this.store.updateUnder(locks, id, { revocation });
      if (!updateResult.ok) return updateResult;

      this.metrics("token.revoked", { status: "ok" });
      return { ok: true as const, value: undefined };
    });

    if (!work.ok) return { ok: false, error: work.error };
    return work.value;
  }

  // -----------------------------------------------------------------------
  // Principal lifecycle (G3-A′)
  // -----------------------------------------------------------------------

  /** List operator principals (safe metadata). */
  async listPrincipals(): Promise<ServiceResult<PrincipalRecord[]>> {
    return this.principalStore.list();
  }

  /** Look up a single operator principal. */
  async getPrincipal(id: string): Promise<ServiceResult<PrincipalRecord | null>> {
    return this.principalStore.get(id);
  }

  /** Disable a principal: every bound credential is denied ALL authentication. */
  async disablePrincipal(id: string, reason: string): Promise<ServiceResult<void>> {
    return this.setPrincipalStatus(id, "disabled", reason);
  }

  /** Re-enable a disabled principal (reversible without deleting identity). */
  async enablePrincipal(id: string): Promise<ServiceResult<void>> {
    return this.setPrincipalStatus(id, "active");
  }

  private async setPrincipalStatus(
    id: string,
    status: "active" | "disabled",
    reason?: string,
  ): Promise<ServiceResult<void>> {
    const dir = this.store.getStoreDir();
    const work = await withStoreLocks(dir, ["principals"], async (locks) => {
      // Re-read under the lock (no stale snapshot).
      const existing = await this.principalStore.get(id);
      if (!existing.ok) return existing;
      if (!existing.value) return { ok: false as const, error: "principal_not_found" };

      // Write-ahead audit intent (fail-closed; nothing changes if it fails).
      try {
        await this.audit({
          action: status === "disabled" ? "principal.disabled" : "principal.enabled",
          tokenId: id,
          details: { principalId: id, reason: reason ?? null },
        });
      } catch {
        return { ok: false as const, error: "audit_write_failed" };
      }

      return this.principalStore.setStatusUnder(locks, id, { status, reason });
    });

    if (!work.ok) return { ok: false, error: work.error };
    return work.value;
  }

  /**
   * Bind unbound legacy credentials to operator principals (explicit migration).
   *
   * Under the `principals`→`auth-store` locks, re-reads and binds only tokens
   * that are unbound, non-revoked, and non-expired. An adopted `--principal` is
   * re-checked active under the lock at commit time. Idempotent: already-bound
   * tokens are skipped, so a concurrent migration cannot double-bind. Never
   * resurrects a revoked credential, never overwrites an existing binding.
   */
  async migrate(opts?: { principalId?: string }): Promise<ServiceResult<MigrationReport>> {
    const dir = this.store.getStoreDir();
    const work = await withStoreLocks(dir, ["principals", "auth-store"], async (locks) => {
      const tokensResult = await this.store.load();
      if (!tokensResult.ok) return tokensResult;
      const principalsResult = await this.principalStore.load();
      if (!principalsResult.ok) return principalsResult;

      // Adopted principal must exist and be active — checked under the lock.
      if (opts?.principalId !== undefined) {
        const target = principalsResult.value.find((p) => p.id === opts.principalId);
        if (!target) return { ok: false as const, error: "principal_not_found" };
        if (target.status !== "active") return { ok: false as const, error: "principal_disabled" };
      }

      const now = new Date().toISOString();
      const report: MigrationReport = { bound: [], skipped: [] };

      for (const token of tokensResult.value) {
        if (token.principalId !== undefined) {
          report.skipped.push({ tokenId: token.id, reason: "already-bound" });
          continue;
        }
        if (token.revocation) {
          report.skipped.push({ tokenId: token.id, reason: "revoked" });
          continue;
        }
        if (token.expiresAt && token.expiresAt < now) {
          report.skipped.push({ tokenId: token.id, reason: "expired" });
          continue;
        }

        let targetId: string;
        if (opts?.principalId !== undefined) {
          targetId = opts.principalId;
        } else {
          const created = createPrincipalRecord({ name: token.name });
          const createResult = await this.principalStore.createUnder(locks, created);
          if (!createResult.ok) return createResult;
          targetId = created.id;
        }

        // Write-ahead audit intent, then the binding write.
        try {
          await this.audit({
            action: "token.migrated",
            tokenId: token.id,
            details: { principalId: targetId },
          });
        } catch {
          return { ok: false as const, error: "audit_write_failed" };
        }

        const updateResult = await this.store.updateUnder(locks, token.id, {
          principalId: targetId,
        });
        if (!updateResult.ok) return updateResult;
        report.bound.push({ tokenId: token.id, principalId: targetId });
      }

      return { ok: true as const, value: report };
    });

    if (!work.ok) return { ok: false, error: work.error };
    return work.value;
  }

  /**
   * Report identity inconsistencies without changing anything. Never deletes:
   * removal of an incomplete enrollment is an explicit operator action.
   */
  async reconcile(): Promise<ServiceResult<ReconcileReport>> {
    const tokensResult = await this.store.load();
    if (!tokensResult.ok) return tokensResult;
    const principalsResult = await this.principalStore.load();
    if (!principalsResult.ok) return principalsResult;

    const now = new Date().toISOString();
    const byId = new Map(principalsResult.value.map((p) => [p.id, p]));
    const counts = new Map<string, { active: number }>();
    const dangling: ReconcileReport["danglingBindings"] = [];

    for (const t of tokensResult.value) {
      if (t.principalId === undefined) continue;
      const rec = counts.get(t.principalId) ?? { active: 0 };
      if (!t.revocation && !(t.expiresAt && t.expiresAt < now)) rec.active += 1;
      counts.set(t.principalId, rec);

      const p = byId.get(t.principalId);
      if (!p) dangling.push({ tokenId: t.id, principalId: t.principalId, reason: "principal-missing" });
      else if (p.status !== "active") {
        dangling.push({ tokenId: t.id, principalId: t.principalId, reason: "principal-disabled" });
      }
    }

    const incompleteEnrollments: PrincipalRecord[] = [];
    const noActiveCredentials: PrincipalRecord[] = [];
    for (const p of principalsResult.value) {
      const rec = counts.get(p.id);
      if (!rec) incompleteEnrollments.push(p);
      else if (rec.active === 0) noActiveCredentials.push(p);
    }

    return {
      ok: true,
      value: { incompleteEnrollments, noActiveCredentials, danglingBindings: dangling },
    };
  }

  /**
   * Remove a principal (explicit operator action). Refuses while any credential
   * is still bound — the binding must be cleared deliberately, never implicitly.
   * This is the only path that deletes a principal record; `reconcile` only
   * reports.
   */
  async removePrincipal(id: string): Promise<ServiceResult<void>> {
    const dir = this.store.getStoreDir();
    const work = await withStoreLocks(dir, ["principals", "auth-store"], async (locks) => {
      const principal = await this.principalStore.get(id);
      if (!principal.ok) return principal;
      if (!principal.value) return { ok: false as const, error: "principal_not_found" };

      const tokens = await this.store.load();
      if (!tokens.ok) return tokens;
      if (tokens.value.some((t) => t.principalId === id)) {
        return { ok: false as const, error: "principal_has_bound_credentials" };
      }

      try {
        await this.audit({
          action: "principal.removed",
          tokenId: id,
          details: { principalId: id },
        });
      } catch {
        return { ok: false as const, error: "audit_write_failed" };
      }

      return this.principalStore.removeUnder(locks, id);
    });

    if (!work.ok) return { ok: false, error: work.error };
    return work.value;
  }

  // -----------------------------------------------------------------------
  // Doctor
  // -----------------------------------------------------------------------

  /**
   * Run a health check on the auth store.
   */
  async doctor(): Promise<ServiceResult<{
    totalTokens: number;
    maxTokens: number;
    activeTokens: number;
    revokedTokens: number;
    expiredTokens: number;
    storeExists: boolean;
  }>> {
    const exists = await this.store.exists();
    const result = await this.store.load();
    if (!result.ok) return result;

    const now = new Date().toISOString();
    const tokens = result.value;
    const revoked = tokens.filter((t) => !!t.revocation).length;
    const expired = tokens.filter(
      (t) => !t.revocation && t.expiresAt && t.expiresAt < now,
    ).length;
    const active = tokens.length - revoked - expired;

    this.metrics("token.doctor_checked", { status: "ok" });

    return {
      ok: true,
      value: {
        totalTokens: tokens.length,
        maxTokens: this.store.getMaxTokens(),
        activeTokens: active,
        revokedTokens: revoked,
        expiredTokens: expired,
        storeExists: exists,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Verify (used by the middleware)
  // -----------------------------------------------------------------------

  /**
   * Verify a raw bearer token string.
   *
   * Looks up the token by ID, verifies the hash, checks expiry/grace/revocation,
   * and returns a principal if valid. Returns stable error codes on failure.
   */
  async verifyToken(raw: string): Promise<ServiceResult<{
    id: string;
    name: string;
    role: string;
    workspaceIds?: string[];
    principalId?: string;
  }>> {
    // 1. Parse the token to extract the ID
    const parsed = parseToken(raw);
    if (!parsed.ok) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "invalid_token" };
    }

    // 2. Look up by ID
    const storeResult = await this.store.get(parsed.id);
    if (!storeResult.ok) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "invalid_token" };
    }
    if (!storeResult.value) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "invalid_token" };
    }

    const stored = storeResult.value;

    // 3. Check revocation
    if (stored.revocation) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "token_revoked" };
    }

    // 4. Check expiry
    if (stored.expiresAt) {
      const now = new Date().toISOString();
      if (stored.expiresAt < now) {
        this.metrics("token.verification_failed", { status: "failed" });
        return { ok: false, error: "token_expired" };
      }
    }

    // 5. Verify hash (constant-time)
    const verifyResult = verifyTokenHash(raw, stored.hash);
    if (!verifyResult.ok) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "invalid_token" };
    }

    // 6. Principal binding (G3-A′). A credential bound to a principal whose
    //    state is not active is denied ALL authentication. Only a genuinely
    //    unbound legacy credential falls through to ordinary access.
    if (stored.principalId !== undefined) {
      const bound = await this.checkBoundPrincipal(stored.principalId);
      if (!bound.ok) {
        this.metrics("token.verification_failed", { status: "failed" });
        return { ok: false, error: bound.error };
      }
    }

    // 7. Success — return principal (no raw token, no hash)
    this.metrics("token.verified", { status: "ok" });
    return {
      ok: true,
      value: {
        id: stored.id,
        name: stored.name,
        role: stored.role,
        workspaceIds: stored.workspaceIds,
        principalId: stored.principalId,
      },
    };
  }

  /**
   * Resolve a credential's operator principal and enforce the authentication
   * matrix: an active principal passes; a disabled, missing, or unreadable
   * principal denies all authentication (never falling back to ordinary access).
   */
  private async checkBoundPrincipal(
    principalId: string,
  ): Promise<{ ok: true } | { ok: false; error: "principal_disabled" | "principal_missing" | "principal_unavailable" }> {
    const result = await this.principalStore.get(principalId);
    if (!result.ok) return { ok: false, error: "principal_unavailable" };
    if (!result.value) return { ok: false, error: "principal_missing" };
    if (result.value.status !== "active") return { ok: false, error: "principal_disabled" };
    return { ok: true };
  }

  /**
   * Revalidate a principal by token ID without requiring the raw token.
   *
   * Browser sessions use this on every request so token revocation, expiry,
   * and role changes made by another process take effect immediately. The
   * result never exposes the stored hash or a raw token.
   */
  async verifyPrincipalStatus(id: string): Promise<ServiceResult<AuthPrincipal>> {
    const storeResult = await this.store.get(id);
    if (!storeResult.ok || !storeResult.value) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "invalid_token" };
    }

    const stored = storeResult.value;
    if (stored.revocation) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "token_revoked" };
    }

    if (stored.expiresAt && stored.expiresAt < new Date().toISOString()) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "token_expired" };
    }

    // Operator principal (G3-A′): reapplied on every revalidation so a disable
    // from any process takes effect on the next request. Bound + non-active
    // denies all authentication.
    if (stored.principalId !== undefined) {
      const bound = await this.checkBoundPrincipal(stored.principalId);
      if (!bound.ok) {
        this.metrics("token.verification_failed", { status: "failed" });
        return { ok: false, error: bound.error };
      }
    }

    this.metrics("token.verified", { status: "ok" });
    return {
      ok: true,
      value: {
        id: stored.id,
        name: stored.name,
        role: stored.role,
        workspaceIds: stored.workspaceIds,
        principalId: stored.principalId,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Verify with workspace scope
  // -----------------------------------------------------------------------

  /**
   * Verify a bearer token and check workspace scope.
   *
   * Undefined scope preserves legacy ordinary Inspector access. Empty scope
   * denies access; nonempty scope requires a matching server-derived target.
   * Remote decisions must separately require explicit nonempty scope.
   */
  async verifyTokenForRequest(
    raw: string,
    targetWorkspace?: string,
  ): Promise<ServiceResult<{
    id: string;
    name: string;
    role: string;
    workspaceIds?: string[];
    principalId?: string;
  }>> {
    const result = await this.verifyToken(raw);
    if (!result.ok) return result;

    const principal = result.value;

    if (!allowsWorkspace(principal.workspaceIds, targetWorkspace)) {
      this.metrics("token.verification_failed", { status: "failed" });
      return { ok: false, error: "workspace_mismatch" };
    }

    return result;
  }
}
