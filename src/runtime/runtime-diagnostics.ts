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

import type { ExecutionContext } from "../observability/execution-context.js";

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
  context?: ExecutionContext;
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

// ---------------------------------------------------------------------------
// Sink abstraction
// ---------------------------------------------------------------------------

/**
 * Injectable sink for runtime diagnostics.
 * Replace `consoleSink` with a custom implementation for structured logging,
 * filtering, metrics collection, or telemetry integration.
 */
export interface DiagnosticSink {
  emit(diag: RuntimeDiagnostic): void;
}

/**
 * Default sink that writes formatted diagnostics to console.warn.
 * Used by hardened boundaries when no custom sink is provided.
 */
export const consoleSink: DiagnosticSink = {
  emit: (diag: RuntimeDiagnostic) => {
    console.warn(formatRuntimeDiagnostic(diag));
  },
};

/**
 * Create a multiplex sink that fans out to multiple child sinks.
 * Sink failures are isolated — one failing sink does not block others.
 */
export function createMultiplexDiagnosticSink(...sinks: DiagnosticSink[]): DiagnosticSink {
  return {
    emit: (diag: RuntimeDiagnostic) => {
      for (const sink of sinks) {
        try {
          sink.emit(diag);
        } catch {
          // Isolated failure — continue to next sink
        }
      }
    },
  };
}
