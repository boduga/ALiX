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
 * Compute a deterministic binding key from an approval binding.
 * Canonicalizes field ordering via sorted JSON keys.
 */
export function computeBindingKey(binding: ApprovalBinding): string {
  const canonical = JSON.stringify(binding, Object.keys(binding).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Normalize a legacy approval record to the current schema.
 * Fills safe defaults for fields added in lifecycle versions.
 */
export function normalizeApprovalRecord(
  raw: unknown,
  context: { defaultPolicyRevision: string; now: Date },
): ApprovalRecord {
  const r = raw as Record<string, unknown>;
  return {
    id: (r.id as string) ?? `approval_${Date.now()}`,
    schemaVersion: "2.0",
    status: (r.status as ApprovalRecord["status"]) ?? "pending",
    usePolicy: (r.usePolicy as ApprovalRecord["usePolicy"]) ?? "single_use",
    bindingKey: (r.bindingKey as string) ?? "",
    requestFingerprint: (r.requestFingerprint as string) ?? "",
    policyRevision: (r.policyRevision as string) ?? context.defaultPolicyRevision,
    capabilities: (r.capability as string) ? [(r.capability as string)] : ((r.capabilities as string[]) ?? []),
    ownershipClaims: (r.ownershipClaims as WorkerOwnershipClaim[]) ?? [],
    reason: (r.reason as string) ?? "",
    createdAt: (r.createdAt as string) ?? context.now.toISOString(),
    expiresAt: (r.expiresAt as string) ?? new Date(context.now.getTime() + 30 * 60_000).toISOString(),
    // spread remaining fields
    ...(r as any),
  };
}
