/**
 * coordination-ownership.ts — Ownership adapter for the scheduler.
 *
 * Bridges WorkerOwnershipClaim (portable) → PathScope (registry).
 * Provides atomic acquire, release, and renewal helpers.
 *
 * Key requirements:
 * - Acquire is all-or-nothing with defensive rollback
 * - Uses actual AcquireResult fields (acquired, record, conflict)
 * - Release and renewal respect boolean return values
 * - Invalid claims fail closed
 */

import { resolve, relative, sep } from "node:path";
import type { OwnershipRegistry, AcquireRequest } from "../ownership/ownership-registry.js";
import type { WorkerOwnershipClaim, CoordinationRun, WorkerAssignment } from "./coordination-types.js";

export type WorkerOwnershipAcquireResult =
  | { acquired: true; leaseIds: string[] }
  | { acquired: false; reason: string; conflictingLeaseIds: string[] };

/**
 * Convert a portable claim to an OwnershipScope.
 * Returns null if the claim is invalid (traversal, etc.).
 */
function toOwnershipScope(
  claim: WorkerOwnershipClaim,
  cwd: string,
): { kind: "path"; root: string; recursive: boolean } | null {
  const workspaceRoot = resolve(cwd);
  const root = resolve(workspaceRoot, claim.path);
  const rel = relative(workspaceRoot, root);

  // Reject traversal outside workspace
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    (root === workspaceRoot && claim.path === "..")
  ) {
    return null;
  }

  return { kind: "path" as const, root, recursive: claim.recursive };
}

/**
 * Acquire ownership for all claims of a worker.
 * All-or-nothing: on any conflict, release any acquired leases and return failure.
 */
export async function acquireWorkerOwnership(
  registry: OwnershipRegistry,
  run: CoordinationRun,
  worker: WorkerAssignment,
  cwd: string,
  ttlMs: number,
): Promise<WorkerOwnershipAcquireResult> {
  // Read-only workers skip ownership entirely
  if (!worker.ownershipClaims || worker.ownershipClaims.length === 0) {
    return { acquired: true, leaseIds: [] };
  }

  const reqs: AcquireRequest[] = [];

  for (const claim of worker.ownershipClaims) {
    const scope = toOwnershipScope(claim, cwd);
    if (!scope) {
      return {
        acquired: false,
        reason: `Invalid or unsafe ownership claim: ${claim.path}`,
        conflictingLeaseIds: [],
      };
    }
    reqs.push({
      agentId: worker.agentId,
      scope,
      mode: "exclusive-write",
      taskId: worker.id,
      sessionId: run.sessionId,
      ttlMs,
      reason: `Worker ${worker.id} (${worker.taskLabel})`,
    });
  }

  const results = await registry.acquireMany(reqs);
  const leaseIds: string[] = [];
  const conflictingLeaseIds: string[] = [];
  const conflictReasons: string[] = [];

  for (const result of results) {
    if (result.acquired && result.record) {
      leaseIds.push(result.record.id);
    } else {
      conflictReasons.push(result.conflict?.reason ?? "Unknown ownership conflict");
      if (result.conflict) {
        for (const record of result.conflict.conflictingRecords) {
          conflictingLeaseIds.push(record.id);
        }
      }
    }
  }

  // All-or-nothing: rollback on partial
  if (conflictReasons.length > 0) {
    for (const id of leaseIds) {
      try {
        await registry.release(id);
      } catch {
        /* best-effort rollback */
      }
    }
    return {
      acquired: false,
      reason: `Ownership conflict: ${conflictReasons.join("; ")}`,
      conflictingLeaseIds,
    };
  }

  return { acquired: true, leaseIds };
}

/**
 * Release all lease IDs. Respects boolean return of registry.release().
 */
export async function releaseWorkerOwnership(
  registry: OwnershipRegistry,
  leaseIds: string[],
): Promise<{ released: string[]; failed: string[] }> {
  const released: string[] = [];
  const failed: string[] = [];
  for (const id of leaseIds) {
    try {
      if (await registry.release(id)) {
        released.push(id);
      } else {
        failed.push(id);
      }
    } catch {
      failed.push(id);
    }
  }
  return { released, failed };
}

/**
 * Renew all lease IDs. Respects boolean return of registry.renew().
 */
export async function renewWorkerOwnership(
  registry: OwnershipRegistry,
  leaseIds: string[],
  ttlMs: number,
): Promise<{ renewed: string[]; failed: string[] }> {
  const renewed: string[] = [];
  const failed: string[] = [];
  for (const id of leaseIds) {
    try {
      if (await registry.renew(id, ttlMs)) {
        renewed.push(id);
      } else {
        failed.push(id);
      }
    } catch {
      failed.push(id);
    }
  }
  return { renewed, failed };
}
