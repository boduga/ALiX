/**
 * ownership-types.ts — Types for the lease-based ownership registry.
 *
 * Scope is constrained to deterministic path-based ownership.
 * Graph-node and capability scopes are reserved for future versions.
 */

export type OwnershipMode = "exclusive-write" | "shared-read" | "review-only";
export type OwnershipStatus = "active" | "released" | "expired" | "revoked";

export type PathScope = {
  kind: "path";
  root: string;       // resolved absolute path (directory or file)
  recursive: boolean; // if true, covers all descendants
};

// Future: graph-node, capability scopes reserved but not implemented
export type OwnershipScope = PathScope;

export type OwnershipRecord = {
  id: string;
  agentId: string;
  taskId?: string;
  sessionId?: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
  status: OwnershipStatus;
  acquiredAt: string;   // ISO timestamp
  expiresAt: string;    // ISO timestamp
  expiredAt?: string;   // set when expiration transitions active→expired
  releasedAt?: string;  // set on release()
  revokedAt?: string;   // set on revoke()
  reason?: string;
};

/** Conflict matrix result — denied at acquisition time. */
export type AcquireResult = {
  acquired: boolean;
  record?: OwnershipRecord;
  conflict?: {
    reason: string;
    conflictingRecords: OwnershipRecord[];
  };
};

export type OwnershipStore = {
  version: number;
  revision: number;     // incremented on every durable mutation
  records: OwnershipRecord[];
};

/** Asynchronous event sink for ownership lifecycle events. */
export type OwnershipEventSink = {
  emit(event: string, data: Record<string, unknown>): Promise<void>;
};

/**
 * Conflict matrix: existing vs requested.
 * Only exclusive-write conflicts with another exclusive-write or
 * with a prior shared-read that another agent holds.
 */
export function modesConflict(
  existing: OwnershipMode,
  requested: OwnershipMode,
): boolean {
  if (existing === "exclusive-write" && requested === "exclusive-write") return true;
  if (existing === "shared-read" && requested === "exclusive-write") return true;
  return false;
}

/** Ownership event type constants. */
export const OWNERSHIP_EVENT_TYPES = {
  ACQUIRED: "ownership.acquired",
  RELEASED: "ownership.released",
  RENEWED: "ownership.renewed",
  EXPIRED: "ownership.expired",
  CONFLICT: "ownership.conflict",
  REVOKED: "ownership.revoked",
  DENIED: "ownership.denied",
  LOCK_FAILED: "ownership.lock_failed",
} as const;
