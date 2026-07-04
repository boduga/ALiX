/**
 * #187 — Normalized diagnostic event type for durable diagnostics telemetry.
 *
 * Maps both ContractDiagnostic and RuntimeDiagnostic into a single
 * normalized shape for persistent storage (JSONL diagnostic event store).
 *
 * Design: docs/architecture/decisions/2026-07-03-diagnostics-telemetry-design.md
 */

import type { ContractDiagnostic } from "../contracts/contract-diagnostics.js";
import type { RuntimeDiagnostic } from "../runtime/runtime-diagnostics.js";

// ---------------------------------------------------------------------------
// Event type
// ---------------------------------------------------------------------------

export type DiagnosticEventType = "contract" | "runtime";
export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  type: DiagnosticEventType;
  domain: string;
  boundary: string;
  operation?: string;
  entityId?: string;
  event: string;
  severity: DiagnosticSeverity;
  attempt?: number;
  maxRetries?: number;
  timeoutMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let counter = 0;

/**
 * Generate a diagnostic event ID.
 * Uses timestamp + counter for uniqueness within a process.
 */
export function nextDiagnosticId(): string {
  const ts = Date.now().toString(36);
  counter = (counter + 1) % 9999;
  return `diag-${ts}-${String(counter).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * Map a RuntimeDiagnostic to a normalized DiagnosticEvent.
 */
export function runtimeDiagToEvent(diag: RuntimeDiagnostic): DiagnosticEvent {
  return {
    id: nextDiagnosticId(),
    timestamp: diag.timestamp,
    type: "runtime",
    domain: "runtime",
    boundary: diag.boundary,
    operation: diag.operation,
    event: diag.event,
    severity: diag.boundary === "retry.attempt" ? "warning" : "error",
    attempt: diag.attempt,
    maxRetries: diag.maxRetries,
    timeoutMs: diag.timeoutMs,
    error: diag.error,
  };
}

/**
 * Map a ContractDiagnostic to a normalized DiagnosticEvent.
 */
export function contractDiagToEvent(diag: ContractDiagnostic): DiagnosticEvent {
  return {
    id: nextDiagnosticId(),
    timestamp: diag.timestamp,
    type: "contract",
    domain: diag.domain,
    boundary: diag.boundary,
    entityId: diag.entityId,
    event: diag.error,
    severity: "error",
    error: diag.error,
  };
}
