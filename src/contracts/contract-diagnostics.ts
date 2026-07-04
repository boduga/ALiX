// src/contracts/contract-diagnostics.ts
//
// Contract validation diagnostics — standardized metadata for schema
// failures across provider, planning, and adaptation boundaries.
// Does not change validation semantics — purely additive observability.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContractDomain = "provider" | "planning" | "adaptation";

export type ContractBoundary =
  | "complete.request"
  | "complete.response"
  | "stream.request"
  | "stream.chunk"
  | "negotiate.request"
  | "plan.save"
  | "plan.load"
  | "proposal.save"
  | "proposal.load"
  | "proposal.list";

import type { ExecutionContext } from "../observability/execution-context.js";

export interface ContractDiagnostic {
  domain: ContractDomain;
  boundary: ContractBoundary;
  schema: string;
  error: string;
  entityId?: string;
  timestamp: string;
  context?: ExecutionContext;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ContractDiagnostic for a validation failure.
 */
export function buildDiagnostic(
  domain: ContractDomain,
  boundary: ContractBoundary,
  schema: string,
  error: string,
  entityId?: string,
  context?: ExecutionContext,
): ContractDiagnostic {
  return {
    domain,
    boundary,
    schema,
    error: truncateError(error),
    entityId,
    timestamp: new Date().toISOString(),
    context,
  };
}

/**
 * Format a diagnostic as a structured log line (JSON).
 */
export function formatDiagnostic(diag: ContractDiagnostic): string {
  return `[contract] ${diag.domain}/${diag.boundary}: ${diag.schema} — ${diag.error}${diag.entityId ? ` (id: ${diag.entityId})` : ""}`;
}

/**
 * Truncate long error messages to keep diagnostics readable.
 */
function truncateError(error: string, maxLen = 200): string {
  if (error.length <= maxLen) return error;
  return error.slice(0, maxLen) + "...";
}
