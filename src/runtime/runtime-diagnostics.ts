/**
 * #178 — Structured diagnostics for runtime timeout and retry events.
 *
 * Parallels the contract diagnostics pattern from #170. Diagnostic callbacks
 * fire before throwing — timeout/retry semantics are unchanged.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuntimeBoundary =
  | "timeout"
  | "retry.attempt"
  | "retry.exhausted";

export interface RuntimeDiagnostic {
  domain: "runtime";
  boundary: RuntimeBoundary;
  operation: string;
  event: string;
  attempt?: number;
  maxRetries?: number;
  timeoutMs?: number;
  error?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildRuntimeDiagnostic(
  boundary: RuntimeBoundary,
  operation: string,
  event: string,
  extra?: {
    attempt?: number;
    maxRetries?: number;
    timeoutMs?: number;
    error?: string;
  },
): RuntimeDiagnostic {
  return {
    domain: "runtime",
    boundary,
    operation,
    event,
    ...extra,
    timestamp: new Date().toISOString(),
  };
}

export function formatRuntimeDiagnostic(diag: RuntimeDiagnostic): string {
  let msg = `[runtime] ${diag.boundary}: ${diag.operation} — ${diag.event}`;
  if (diag.attempt !== undefined) msg += ` (attempt ${diag.attempt}/${diag.maxRetries ?? "?"})`;
  if (diag.timeoutMs !== undefined) msg += ` (timeout: ${diag.timeoutMs}ms)`;
  return msg;
}
