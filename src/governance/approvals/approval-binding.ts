/**
 * approval-binding.ts — Deterministic binding key computation.
 *
 * An approval is valid only for the exact capability + worker + run + scope
 * + request fingerprint + policy revision for which it was issued.
 */

import { createHash } from "node:crypto";
import type { WorkerOwnershipClaim } from "../../coordination/kernel/coordination-types.js";
import type { ApprovalRecord } from "./approval-types.js";

export type ApprovalBinding = {
  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  capabilities: string[];
  ownershipClaims?: WorkerOwnershipClaim[];
  ownershipClaimsHash?: string;
  requestFingerprint: string;
  policyRevision: string;
};

/**
 * Compute a deterministic hash of ownership claims.
 * Sorts by path then recursive flag for canonical ordering.
 */
export function computeOwnershipClaimsHash(claims: WorkerOwnershipClaim[]): string {
  const canonical = [...claims]
    .sort((a, b) => a.path.localeCompare(b.path) || Number(a.recursive) - Number(b.recursive))
    .map(c => ({ path: c.path, recursive: c.recursive }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Recursively canonicalize a value for deterministic JSON serialization.
 * Sorts object keys alphabetically at every nesting level.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/**
 * Compute a deterministic binding key from an approval binding.
 * Canonicalizes field ordering via recursive sorted keys.
 */
export function computeBindingKey(binding: ApprovalBinding): string {
  const canonical = JSON.stringify(canonicalize(binding));
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The exact invocation an approval authorizes.
 *
 * Persisted on the record at creation and re-derived at authorization time so a
 * reused request id cannot carry an approval across a changed argument set,
 * capability, tool, workspace, session, or agent. Every field is host-derived;
 * none may come from prompt-supplied authority.
 */
export interface InvocationIdentity {
  capability: string;
  toolName?: string;
  /** Canonical absolute workspace root. */
  workspace: string;
  argsHash: string;
  sessionId?: string;
  agentId?: string;
}

/**
 * Deterministic fingerprint over the full invocation identity.
 *
 * Reuses the same recursive key sort as `computeBindingKey` so two equivalent
 * argument objects cannot produce different fingerprints through key order.
 */
export function computeInvocationFingerprint(identity: InvocationIdentity): string {
  const canonical = JSON.stringify(canonicalize(identity));
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compare a persisted invocation fingerprint against the current request.
 *
 * A record that carries no fingerprint predates this binding. Legacy records
 * are NOT silently trusted: they fail closed and the caller must re-request
 * operator approval.
 */
export function invocationMatches(
  record: { invocationFingerprint?: string },
  identity: InvocationIdentity,
): boolean {
  if (!record.invocationFingerprint) return false;
  return record.invocationFingerprint === computeInvocationFingerprint(identity);
}

export type ApprovalExpiryState = "valid" | "expired" | "invalid";

/**
 * Authority expiry is security-significant persisted data. Missing, empty, or
 * unparsable values are corrupt authority and must never become "no expiry".
 *
 * Lives beside the binding rules (not in the protected approval store) so every
 * authorization, reconciliation, and consumption path can share ONE verdict
 * without opening a second store import.
 */
export function approvalExpiryState(expiresAt: unknown, now: Date = new Date()): ApprovalExpiryState {
  if (typeof expiresAt !== "string" || expiresAt.trim().length === 0) return "invalid";
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return "invalid";
  return expiryMs <= now.getTime() ? "expired" : "valid";
}

const VALID_STATUSES: readonly string[] = ["pending", "approved", "denied", "consumed", "expired", "revoked", "invalidated"];
const VALID_POLICIES: readonly string[] = ["single_use", "worker_attempt", "coordination_run", "session"];

function isValidStatus(s: unknown): s is "pending" | "approved" | "denied" | "consumed" | "expired" | "revoked" | "invalidated" {
  return typeof s === "string" && VALID_STATUSES.includes(s);
}

function isValidPolicy(s: unknown): s is "single_use" | "worker_attempt" | "coordination_run" | "session" {
  return typeof s === "string" && VALID_POLICIES.includes(s);
}

/**
 * Normalize a legacy approval record to the current schema.
 * Fills safe defaults for fields added in lifecycle versions.
 * Spreads raw fields FIRST, then overrides with validated safe values
 * so legacy data cannot overwrite schemaVersion, status, or usePolicy.
 */
export function normalizeApprovalRecord(
  raw: unknown,
  context: { defaultPolicyRevision: string; now: Date },
): ApprovalRecord {
  const r = raw as Record<string, unknown>;
  const createdAt = (r.createdAt as string) ?? context.now.toISOString();
  return {
    // Spread raw record first — gives us all legacy/unknown fields
    ...(r as any),
    // Then override with validated safe values
    id: typeof r.id === "string" ? r.id : `approval_${Date.now()}`,
    schemaVersion: "2.0" as const,
    status: isValidStatus(r.status) ? r.status : "pending",
    usePolicy: isValidPolicy(r.usePolicy) ? r.usePolicy : "single_use",
    bindingKey: typeof r.bindingKey === "string" ? r.bindingKey : "",
    requestFingerprint: typeof r.requestFingerprint === "string" ? r.requestFingerprint : "",
    policyRevision: typeof r.policyRevision === "string" ? r.policyRevision : context.defaultPolicyRevision,
    capabilities: typeof r.capability === "string" ? [r.capability] : (Array.isArray(r.capabilities) ? r.capabilities : []),
    ownershipClaims: Array.isArray(r.ownershipClaims) ? r.ownershipClaims : [],
    reason: typeof r.reason === "string" ? r.reason : "",
    createdAt,
    // Missing legacy expiry is corrupt authority, not an implicit 30-minute grant.
    // Preserve it as invalid so every authorization/consumption path fails closed.
    expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : "",
  };
}
