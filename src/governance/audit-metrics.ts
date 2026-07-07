/**
 * P15.1 — Governance Trends & Diagnostics: pure audit metric functions.
 *
 * All functions are **pure**: they take GovernanceAuditEvent[] and return
 * plain objects. Zero side effects, zero store access. Every function is
 * unit-testable with inline fixture data.
 *
 * Decision-bearing event types (for decisionRates):
 *   action_allowed   → allowed
 *   action_denied    → denied
 *   action_escalated → escalated
 *   override_applied → overridden
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GovernanceAuditEvent, GovernanceEventType } from "./audit-types.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface DecisionRates {
  allowed: number;
  denied: number;
  escalated: number;
  overridden: number;
}

export interface MetricsSummary {
  totalEvents: number;
  decisionRates: DecisionRates;
  riskDistribution: Record<string, number>;
}

export interface ExplicitDelta {
  totalEvents: number;
  decisionRates: DecisionRates;
  riskDistribution: Record<string, number>;
}

export interface TimeBucket {
  windowStart: string;
  count: number;
}

export interface ActorRow {
  actorId: string;
  count: number;
  lastSeen: string;
}

export interface SubjectRow {
  subjectId: string;
  subjectType: string;
  count: number;
}

export interface PolicyRow {
  policyId: string;
  count: number;
}

export interface TraceVolume {
  totalEvents: number;
  eventsWithTrace: number;
  traceRatio: number;
}

export interface BeforeAfterResult {
  before: MetricsSummary;
  after: MetricsSummary;
  delta: ExplicitDelta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Event types that carry an actionable governance decision. */
const DECISION_EVENT_TYPES: ReadonlySet<GovernanceEventType> = new Set([
  "action_allowed",
  "action_denied",
  "action_escalated",
  "override_applied",
]);

const DECISION_EVENT_MAP: Record<GovernanceEventType, keyof DecisionRates | undefined> = {
  action_allowed: "allowed",
  action_denied: "denied",
  action_escalated: "escalated",
  override_applied: "overridden",
  policy_evaluated: undefined,
  human_approval_requested: undefined,
  human_approval_granted: undefined,
  human_approval_denied: undefined,
  tool_permission_checked: undefined,
  agent_permission_checked: undefined,
  memory_access_checked: undefined,
  model_routing_decision: undefined,
  security_boundary_checked: undefined,
};

const ZERO_RATES: DecisionRates = { allowed: 0, denied: 0, escalated: 0, overridden: 0 };

/** Parse an ISO timestamp to epoch milliseconds (NaN if unparseable). */
function epochMs(ts: string): number {
  const d = new Date(ts).getTime();
  return Number.isNaN(d) ? NaN : d;
}

// ---------------------------------------------------------------------------
// Metric functions
// ---------------------------------------------------------------------------

/** Total number of events in the array. */
export function totalEvents(events: GovernanceAuditEvent[]): number {
  return events.length;
}

/**
 * Count of events per eventType.
 * Rendered output sorted by key ascending (locale-independent).
 */
export function eventTypeDistribution(events: GovernanceAuditEvent[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const e of events) {
    dist[e.eventType] = (dist[e.eventType] ?? 0) + 1;
  }
  return dist;
}

/**
 * Proportion of each decision among decision-bearing events.
 *
 * Decision-bearing event types: action_allowed → allowed,
 * action_denied → denied, action_escalated → escalated,
 * override_applied → overridden.
 *
 * Return proportions (0–1). Return all zeros when no decision-bearing events exist.
 */
export function decisionRates(events: GovernanceAuditEvent[]): DecisionRates {
  const counts = { allowed: 0, denied: 0, escalated: 0, overridden: 0 };
  let total = 0;

  for (const e of events) {
    const bucket = DECISION_EVENT_MAP[e.eventType];
    if (bucket !== undefined) {
      counts[bucket]++;
      total++;
    }
  }

  if (total === 0) return ZERO_RATES;

  return {
    allowed: counts.allowed / total,
    denied: counts.denied / total,
    escalated: counts.escalated / total,
    overridden: counts.overridden / total,
  };
}

/**
 * Count of events per riskLevel.
 * Rendered output sorted by key ascending.
 */
export function riskDistribution(events: GovernanceAuditEvent[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const e of events) {
    dist[e.riskLevel] = (dist[e.riskLevel] ?? 0) + 1;
  }
  return dist;
}

/**
 * Bucket events into equal-sized time windows.
 *
 * Anchors the first bucket at `floor(firstEvent.timestamp / windowMs) * windowMs`.
 * Buckets each event at `floor(event.timestamp / windowMs) * windowMs`.
 * Returns only non-empty buckets, sorted oldest→newest.
 *
 * @throws if windowMs <= 0
 */
export function timeWindowedCounts(events: GovernanceAuditEvent[], windowMs: number): TimeBucket[] {
  if (windowMs <= 0) {
    throw new Error(`windowMs must be positive, got ${windowMs}`);
  }

  if (events.length === 0) return [];

  // Sort by timestamp ascending
  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const firstMs = epochMs(sorted[0]!.timestamp);
  if (Number.isNaN(firstMs)) return []; // Can't bucket if timestamps are unparseable

  const firstBucket = Math.floor(firstMs / windowMs) * windowMs;

  const buckets = new Map<number, number>();
  for (const e of sorted) {
    const ms = epochMs(e.timestamp);
    if (Number.isNaN(ms)) continue;
    const key = Math.floor(ms / windowMs) * windowMs;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return Array.from(buckets.entries())
    .map(([key, count]) => ({ windowStart: new Date(key).toISOString(), count }))
    .sort((a, b) => (a.windowStart < b.windowStart ? -1 : 1));
}

/**
 * Top N actors by event count.
 * Sorted by count descending, then actorId ascending. Default 10.
 */
export function topActors(events: GovernanceAuditEvent[], n = 10): ActorRow[] {
  const actorMap = new Map<string, { count: number; lastSeen: string }>();

  for (const e of events) {
    const existing = actorMap.get(e.actorId);
    if (existing) {
      existing.count++;
      if (e.timestamp > existing.lastSeen) existing.lastSeen = e.timestamp;
    } else {
      actorMap.set(e.actorId, { count: 1, lastSeen: e.timestamp });
    }
  }

  return Array.from(actorMap.entries())
    .map(([actorId, data]) => ({ actorId, count: data.count, lastSeen: data.lastSeen }))
    .sort((a, b) => b.count - a.count || a.actorId.localeCompare(b.actorId))
    .slice(0, n);
}

/**
 * Top N subjects by event count (excludes null subjectIds).
 * Sorted by count descending, then subjectId ascending. Default 10.
 */
export function topSubjects(events: GovernanceAuditEvent[], n = 10): SubjectRow[] {
  const subjMap = new Map<string, { subjectType: string; count: number }>();

  for (const e of events) {
    if (e.subjectId === null) continue;
    const key = e.subjectId;
    const existing = subjMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      subjMap.set(key, { subjectType: e.subjectType, count: 1 });
    }
  }

  return Array.from(subjMap.entries())
    .map(([subjectId, data]) => ({ subjectId, subjectType: data.subjectType, count: data.count }))
    .sort((a, b) => b.count - a.count || a.subjectId.localeCompare(b.subjectId))
    .slice(0, n);
}

/**
 * Policies referenced, ordered by count desc then policyId asc.
 * Excludes null/unset policyIds.
 */
export function policyActivity(events: GovernanceAuditEvent[]): PolicyRow[] {
  const polMap = new Map<string, number>();

  for (const e of events) {
    if (e.policyId === null || e.policyId === undefined) continue;
    polMap.set(e.policyId, (polMap.get(e.policyId) ?? 0) + 1);
  }

  return Array.from(polMap.entries())
    .map(([policyId, count]) => ({ policyId, count }))
    .sort((a, b) => b.count - a.count || a.policyId.localeCompare(b.policyId));
}

/**
 * Trace/session utilization: how many events carry a traceId.
 * traceRatio = eventsWithTrace / totalEvents (0 if empty).
 */
export function traceVolume(events: GovernanceAuditEvent[]): TraceVolume {
  const total = events.length;
  if (total === 0) return { totalEvents: 0, eventsWithTrace: 0, traceRatio: 0 };

  const withTrace = events.filter((e) => e.traceId !== null).length;
  return {
    totalEvents: total,
    eventsWithTrace: withTrace,
    traceRatio: withTrace / total,
  };
}

/**
 * Compare two time windows. Window boundaries are ISO timestamps:
 * `from <= event.timestamp < to` (inclusive lower, exclusive upper).
 *
 * Delta = after - before for each numeric field.
 * riskDistribution delta includes the union of risk keys from both windows.
 */
export function beforeAfterComparison(
  events: GovernanceAuditEvent[],
  beforeFrom: string,
  beforeTo: string,
  afterFrom: string,
  afterTo: string,
): BeforeAfterResult {
  const beforeMs = events.filter((e) => {
    const ms = epochMs(e.timestamp);
    return ms >= epochMs(beforeFrom) && ms < epochMs(beforeTo);
  });
  const afterMs = events.filter((e) => {
    const ms = epochMs(e.timestamp);
    return ms >= epochMs(afterFrom) && ms < epochMs(afterTo);
  });

  const before = buildMetricsSummary(beforeMs);
  const after = buildMetricsSummary(afterMs);

  // Build delta: union of risk keys from both windows
  const allRiskKeys = new Set([
    ...Object.keys(before.riskDistribution),
    ...Object.keys(after.riskDistribution),
  ]);
  const riskDelta: Record<string, number> = {};
  for (const key of allRiskKeys) {
    riskDelta[key] = (after.riskDistribution[key] ?? 0) - (before.riskDistribution[key] ?? 0);
  }

  const delta: ExplicitDelta = {
    totalEvents: after.totalEvents - before.totalEvents,
    decisionRates: {
      allowed: after.decisionRates.allowed - before.decisionRates.allowed,
      denied: after.decisionRates.denied - before.decisionRates.denied,
      escalated: after.decisionRates.escalated - before.decisionRates.escalated,
      overridden: after.decisionRates.overridden - before.decisionRates.overridden,
    },
    riskDistribution: riskDelta,
  };

  return { before, after, delta };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildMetricsSummary(events: GovernanceAuditEvent[]): MetricsSummary {
  return {
    totalEvents: events.length,
    decisionRates: decisionRates(events),
    riskDistribution: riskDistribution(events),
  };
}
