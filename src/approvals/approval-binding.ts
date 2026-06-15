/**
 * approval-binding.ts — Deterministic binding key computation.
 *
 * An approval is valid only for the exact capability + worker + run + scope
 * + request fingerprint + policy revision for which it was issued.
 */

import { createHash } from "node:crypto";
import type { WorkerOwnershipClaim } from "../kernel/coordination-types.js";
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
    // Calculate legacy expiry from createdAt, not from load time
    expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : new Date(new Date(createdAt).getTime() + 30 * 60_000).toISOString(),
  };
}
