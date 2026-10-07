// src/contracts/ownership-authority.ts
//
// R1 boundary freeze — OwnershipAuthority.
// Single authority boundary for acquire/validate/renew/release.
// Reuses the canonical scope/record types from src/ownership.

import type {
  AcquireResult,
  OwnershipMode,
  OwnershipRecord,
  OwnershipScope,
} from "../ownership/ownership-types.js";

export type { AcquireResult, OwnershipMode, OwnershipRecord, OwnershipScope };

export interface OwnershipClaim {
  agentId: string;
  taskId?: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
}

export interface OwnershipAuthority {
  acquire(claim: OwnershipClaim): Promise<AcquireResult>;
  validate(agentId: string, scope: OwnershipScope): Promise<boolean>;
  renew(recordId: string): Promise<boolean>;
  release(recordId: string): Promise<boolean>;
}
