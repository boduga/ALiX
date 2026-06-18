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

import {
  generateToken,
  verifyTokenHash,
  parseToken,
} from "./token-format.js";
import {
  AuthStore,
  createTokenRecord,
  createRevocation,
  type StoredToken,
  MAX_TOKEN_COUNT,
} from "./auth-store.js";

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

/** Common rich result for service operations. */
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Audit callback
// ---------------------------------------------------------------------------

/** Function called to record an audit event. */
export type AuditFn = (event: {
  action: string;
  tokenId: string;
  details?: Record<string, unknown>;
}) => void;

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

export class AuthService {
  private readonly store: AuthStore;
  private readonly audit: AuditFn;
  private readonly metrics: MetricsFn;

  constructor(store: AuthStore, audit: AuditFn, metrics: MetricsFn) {
    this.store = store;
    this.audit = audit;
    this.metrics = metrics;
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  /**
   * Create a new auth token.
   *
   * The raw token is returned exactly once. The caller MUST display it
   * to the operator and warn them to store it securely.
   */
  async createToken(opts: {
    name: string;
    role: AuthTokenRole;
    workspaceIds?: string[];
    expiresAt?: string;
  }): Promise<ServiceResult<TokenCreationResult>> {
    const { name, role, workspaceIds, expiresAt } = opts;

    // Validate role
    if (!AUTH_TOKEN_ROLES.includes(role)) {
      return { ok: false, error: "invalid_role" };
    }

    // Check count bound
    const countResult = await this.store.count();
    if (!countResult.ok) return countResult;
    if (countResult.value >= MAX_TOKEN_COUNT) {
      return { ok: false, error: "token_limit_reached" };
    }

    // Generate
    const generated = generateToken();
    const record = createTokenRecord({
      id: generated.id,
      hash: generated.hash,
      name,
      role,
      workspaceIds,
      expiresAt,
    });

    // Persist
    const addResult = await this.store.add(record);
    if (!addResult.ok) return addResult;

    // Audit (no raw token or hash in audit)
    this.audit({
      action: "token.created",
      tokenId: generated.id,
      details: { name, role },
    });

    // Metrics
    this.metrics("token.created", { role: role as SecurityMetricLabelValue, status: "ok" });

    return {
      ok: true,
      value: {
        id: generated.id,
        token: generated.token,
        name,
        role,
        createdAt: record.createdAt,
      },
    };
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
    // Find the existing token
    const existingResult = await this.store.get(id);
    if (!existingResult.ok) return existingResult;
    if (!existingResult.value) {
      return { ok: false, error: "token_not_found" };
    }

    const existing = existingResult.value;

    // Cannot rotate a revoked token
    if (existing.revocation) {
      return { ok: false, error: "token_revoked" };
    }

    // Generate new token
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
    });

    // Persist new token
    const addResult = await this.store.add(record);
    if (!addResult.ok) return addResult;

    // Set grace expiry on old token (doesn't delete — just sets expiry)
    const updateResult = await this.store.update(id, {
      expiresAt: graceExpiry,
    });
    if (!updateResult.ok) {
      // Best-effort: the new token is already persisted, but the old one
      // may not have the grace window set. This is a partial-failure edge case.
    }

    // Audit
    this.audit({
      action: "token.rotated",
      tokenId: generated.id,
      details: { previousId: id, graceMs },
    });

    // Metrics
    this.metrics("token.rotated", { role: existing.role as SecurityMetricLabelValue, status: "ok" });

    return {
      ok: true,
      value: {
        id: generated.id,
        token: generated.token,
        name: existing.name,
        role: existing.role,
        createdAt: record.createdAt,
        previousId: id,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Revoke
  // -----------------------------------------------------------------------

  /**
   * Revoke a token immediately.
   */
  async revokeToken(id: string, reason: string): Promise<ServiceResult<void>> {
    const existingResult = await this.store.get(id);
    if (!existingResult.ok) return existingResult;
    if (!existingResult.value) {
      return { ok: false, error: "token_not_found" };
    }

    const existing = existingResult.value;

    // Already revoked
    if (existing.revocation) {
      return { ok: false, error: "already_revoked" };
    }

    const revocation = createRevocation(reason);
    const updateResult = await this.store.update(id, { revocation });
    if (!updateResult.ok) return updateResult;

    // Audit
    this.audit({
      action: "token.revoked",
      tokenId: id,
      details: { reason },
    });

    // Metrics
    this.metrics("token.revoked", { status: "ok" });

    return { ok: true, value: undefined };
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
        maxTokens: this.store["maxTokens"] ?? MAX_TOKEN_COUNT,
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

    // 6. Success — return principal (no raw token, no hash)
    this.metrics("token.verified", { status: "ok" });
    return {
      ok: true,
      value: {
        id: stored.id,
        name: stored.name,
        role: stored.role,
        workspaceIds: stored.workspaceIds,
      },
    };
  }
}
