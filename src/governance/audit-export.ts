/**
 * P14.5b — Governance Audit Trail: export and redaction.
 *
 * Provides JSON and JSONL export of governance audit events with optional
 * sensitive-key redaction. Redaction produces a derived view only — the
 * original events in the store are never modified.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GovernanceAuditEvent } from "./audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Metadata keys whose values are replaced with the redaction sentinel. */
const SENSITIVE_KEYS = new Set([
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "passwords",
  "apiKey",
  "api_key",
  "apiKeys",
  "api_keys",
  "credential",
  "credentials",
  "authToken",
  "auth_token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  "sessionKey",
  "session_key",
]);

const REDACTED_SENTINEL = "[REDACTED]";

// ---------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------

export type ExportFormat = "json" | "jsonl";

export type ExportOptions = {
  /** When true, sensitive metadata values are replaced with [REDACTED]. */
  redact?: boolean;
  /** Pretty-print JSON output (indentation). Only applies to format "json". */
  pretty?: boolean;
};

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Check if a metadata key is considered sensitive.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

/**
 * Recursively redact sensitive values from a metadata object.
 * Returns a new object — original is never mutated.
 */
function redactMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_SENTINEL;
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = redactMetadata(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Create a redacted copy of an audit event.
 *
 * The original event is never modified. Redacted fields in metadata are
 * replaced with "[REDACTED]". Top-level event fields (eventId, timestamp,
 * action, reason, etc.) are preserved as-is.
 */
export function redactEvent(event: GovernanceAuditEvent): GovernanceAuditEvent {
  return {
    ...event,
    metadata: redactMetadata(event.metadata),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Format a list of audit events for export.
 *
 * @param events - Events to export (newest-first order is preserved).
 * @param format - Output format: "json" (pretty array) or "jsonl" (line-delimited).
 * @param options - Export options.
 * @returns Formatted export string.
 */
export function exportEvents(
  events: GovernanceAuditEvent[],
  format: ExportFormat,
  options: ExportOptions = {},
): string {
  const target = options.redact ? events.map(redactEvent) : events;

  switch (format) {
    case "json": {
      const indent = options.pretty !== false ? 2 : undefined;
      return JSON.stringify(target, null, indent) + "\n";
    }
    case "jsonl": {
      return target.map((e) => JSON.stringify(e)).join("\n") + "\n";
    }
  }
}
