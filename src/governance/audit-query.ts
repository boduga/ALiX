/**
 * P14.5a — Governance Audit Trail: query helpers.
 *
 * Pure filter functions over GovernanceAuditEvent arrays. All functions
 * accept an event array and return a filtered array, making them
 * composable and testable without store access.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type {
  GovernanceAuditEvent,
  ActorType,
  GovernanceDecision,
} from "./audit-types.js";

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Filter events by actor (type + ID).
 * When actorId is omitted, returns all events for the given actor type.
 */
export function queryByActor(
  events: GovernanceAuditEvent[],
  actorType: ActorType,
  actorId?: string,
): GovernanceAuditEvent[] {
  return events.filter((e) => {
    if (e.actorType !== actorType) return false;
    if (actorId !== undefined && e.actorId !== actorId) return false;
    return true;
  });
}

/**
 * Filter events by policy ID.
 */
export function queryByPolicy(
  events: GovernanceAuditEvent[],
  policyId: string,
): GovernanceAuditEvent[] {
  if (!policyId) return [];
  return events.filter((e) => e.policyId === policyId);
}

/**
 * Filter events by trace ID.
 */
export function queryByTraceId(
  events: GovernanceAuditEvent[],
  traceId: string,
): GovernanceAuditEvent[] {
  if (!traceId) return [];
  return events.filter((e) => e.traceId === traceId);
}

/**
 * Filter events by decision outcome.
 */
export function queryByDecision(
  events: GovernanceAuditEvent[],
  decision: GovernanceDecision,
): GovernanceAuditEvent[] {
  if (!decision) return [];
  return events.filter((e) => e.decision === decision);
}

/**
 * Filter events within an ISO timestamp range (inclusive).
 * Both bounds are optional — omit fromIso for unbounded start,
 * omit toIso for unbounded end.
 */
export function queryByTimeRange(
  events: GovernanceAuditEvent[],
  fromIso?: string,
  toIso?: string,
): GovernanceAuditEvent[] {
  return events.filter((e) => {
    if (fromIso !== undefined && e.timestamp < fromIso) return false;
    if (toIso !== undefined && e.timestamp > toIso) return false;
    return true;
  });
}
