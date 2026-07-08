/**
 * P15.2 — Governance Anomaly Detection: deterministic, explainable anomaly
 * detection over the governance audit trail.
 *
 * Four detector families: volume, risk, sequence/pattern, continuity.
 * All functions are **pure**: they take GovernanceAuditEvent[] and return
 * GovernanceAuditAnomaly[]. Zero side effects, zero store access.
 *
 * No ML, no statistical models, no actor-behavior drift. Every anomaly is
 * deterministic, explainable, and carries a human-readable reason.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { GovernanceAuditEvent, RiskLevel } from "./audit-types.js";
import { decisionRates, riskDistribution } from "./audit-metrics.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type AnomalySeverity = "info" | "warning" | "critical";

export type AnomalyType =
  // Volume
  | "volume_spike"
  | "volume_drop"
  // Risk
  | "risk_shift"
  | "risk_missing"
  // Sequence
  | "approval_without_request"
  | "escalation_without_review"
  | "terminal_mutation"
  | "flip_flop"
  // Continuity
  | "timestamp_regression"
  | "duplicate_event_id"
  | "hash_chain_break";

export interface GovernanceAuditAnomaly {
  anomalyId: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  /** ISO timestamp of the start of the window (or event timestamp for point anomalies). */
  windowStart: string;
  /** ISO timestamp of the end of the window (or event timestamp for point anomalies). */
  windowEnd: string;
  /** Event IDs that triggered this anomaly. */
  evidenceEventIds: string[];
  /** Human-readable explanation. */
  reason: string;
  /** Optional sub-type metadata. */
  metadata: Record<string, unknown>;
}

export interface AnomalyOptions {
  /** Monitored event types for volume detection (default: the standard set). */
  monitoredEventTypes?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VOLUME_MONITORED_TYPES = [
  "action_denied",
  "action_escalated",
  "override_applied",
  "human_approval_requested",
] as const;

const SUPERVISORY_TYPES = new Set(["human_approval_requested"]);

/**
 * Event types that a terminal event (action_denied, override_applied) would
 * contradict if followed on the same trace+subjectId.
 */
const CONTRADICTORY_TYPES = new Set([
  "action_allowed",
  "action_escalated",
  "override_applied",
  "action_denied",
]);

/**
 * Decision-bearing event types for risk-distribution comparisons.
 * (Same set used by audit-metrics decisionRates.)
 */
const DECISION_BEARING_TYPES = new Set([
  "action_allowed",
  "action_denied",
  "action_escalated",
  "override_applied",
]);

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic anomaly ID from stable fields. */
function buildAnomalyId(
  type: string,
  windowStart: string,
  windowEnd: string,
  evidenceEventIds: string[],
  metadata: Record<string, unknown>,
): string {
  const sortedMetaKeys = Object.keys(metadata).sort();

  const stable = [
    type,
    windowStart,
    windowEnd,
    ...[...evidenceEventIds].sort(), // copy before sort
    JSON.stringify(metadata, sortedMetaKeys, 0),
  ].join("||");

  const hash = createHash("sha256").update(stable).digest("hex").slice(0, 16);
  return `anom_${type}_${hash}`;
}

/** Parse an ISO timestamp to epoch ms (NaN if invalid). */
function epochMs(ts: string): number {
  const d = new Date(ts).getTime();
  return Number.isNaN(d) ? NaN : d;
}

/** Count events of a given type. */
function countByType(events: GovernanceAuditEvent[], type: string): number {
  let c = 0;
  for (const e of events) if (e.eventType === type) c++;
  return c;
}

/** Extract eventIds of events matching a type. */
function idsByType(events: GovernanceAuditEvent[], type: string): string[] {
  return events.filter((e) => e.eventType === type).map((e) => e.eventId);
}

/** Count decision-bearing events in an array. */
function countDecisionEvents(events: GovernanceAuditEvent[]): number {
  let c = 0;
  for (const e of events) if (DECISION_BEARING_TYPES.has(e.eventType)) c++;
  return c;
}

// ---------------------------------------------------------------------------
// Detector A — Volume anomalies
// ---------------------------------------------------------------------------

function detectVolumeAnomalies(
  events: GovernanceAuditEvent[],
  baselineEvents: GovernanceAuditEvent[] | undefined,
): GovernanceAuditAnomaly[] {
  if (!baselineEvents) return [];

  const anomalies: GovernanceAuditAnomaly[] = [];

  for (const type of VOLUME_MONITORED_TYPES) {
    const current = countByType(events, type);
    const baseline = countByType(baselineEvents, type);

    if (baseline > 0) {
      // Normal baseline
      if (current > baseline * 3) {
        anomalies.push(makeVolumeAnomaly("volume_spike", "critical", events, type, current, baseline));
      } else if (current > baseline * 2) {
        anomalies.push(makeVolumeAnomaly("volume_spike", "warning", events, type, current, baseline));
      }
      // Drop — only for supervisory types
      if (SUPERVISORY_TYPES.has(type) && current < baseline * 0.25) {
        anomalies.push(makeVolumeAnomaly("volume_drop", "warning", events, type, current, baseline));
      }
    } else {
      // Zero baseline
      if (current >= 5) {
        anomalies.push(makeVolumeAnomaly("volume_spike", "critical", events, type, current, baseline));
      } else if (current >= 3) {
        anomalies.push(makeVolumeAnomaly("volume_spike", "warning", events, type, current, baseline));
      }
      // current < 3 → no anomaly
    }
  }

  return anomalies;
}

function makeVolumeAnomaly(
  type: AnomalyType,
  severity: AnomalySeverity,
  events: GovernanceAuditEvent[],
  monitoredType: string,
  current: number,
  baseline: number,
): GovernanceAuditAnomaly {
  const ids = idsByType(events, monitoredType);
  const windowStart = events.length > 0
    ? events.reduce((a, b) => a.timestamp < b.timestamp ? a : b).timestamp
    : "";
  const windowEnd = events.length > 0
    ? events.reduce((a, b) => a.timestamp > b.timestamp ? a : b).timestamp
    : "";

  return {
    anomalyId: buildAnomalyId(type, windowStart, windowEnd, ids, { monitoredType, current, baseline }),
    type,
    severity,
    windowStart,
    windowEnd,
    evidenceEventIds: ids,
    reason: `${type === "volume_spike" ? "Spike" : "Drop"} in ${monitoredType}: ${current} events (baseline ${baseline}, ${type === "volume_spike" ? `×${(current / (baseline || 1)).toFixed(1)}` : `${((current / (baseline || 1)) * 100).toFixed(0)}% of baseline`})`,
    metadata: { monitoredType, current, baseline },
  };
}

// ---------------------------------------------------------------------------
// Detector B — Risk anomalies
// ---------------------------------------------------------------------------

function detectRiskAnomalies(
  events: GovernanceAuditEvent[],
  baselineEvents: GovernanceAuditEvent[] | undefined,
): GovernanceAuditAnomaly[] {
  if (!baselineEvents) return [];
  if (countDecisionEvents(events) < 5 || countDecisionEvents(baselineEvents) < 5) return [];

  const anomalies: GovernanceAuditAnomaly[] = [];

  // Risk distribution over decision-bearing events only (per spec requirement)
  const currentDecisionEvents = events.filter((e) => DECISION_BEARING_TYPES.has(e.eventType));
  const baselineDecisionEvents = baselineEvents.filter((e) => DECISION_BEARING_TYPES.has(e.eventType));

  const currentRisk = riskDistribution(currentDecisionEvents);
  const baselineRisk = riskDistribution(baselineDecisionEvents);

  const baselineTotal = baselineDecisionEvents.length;
  const totalCurrent = currentDecisionEvents.length;

  if (baselineTotal === 0 || totalCurrent === 0) return [];

  const emitWindowStart = events.reduce((a, b) => a.timestamp < b.timestamp ? a : b).timestamp;
  const emitWindowEnd = events.reduce((a, b) => a.timestamp > b.timestamp ? a : b).timestamp;

  // Critical risk shift
  const criticalBaseline = baselineRisk["critical"] ?? 0;
  const criticalCurrent = currentRisk["critical"] ?? 0;
  const criticalBaselineRatio = criticalBaseline / baselineTotal;
  const criticalCurrentRatio = criticalCurrent / totalCurrent;

  if (criticalCurrentRatio > criticalBaselineRatio + 0.15) {
    const ids = events.filter((e) => e.riskLevel === "critical").map((e) => e.eventId);
    anomalies.push({
      anomalyId: buildAnomalyId("risk_shift", emitWindowStart, emitWindowEnd, ids, { riskLevel: "critical", currentRatio: criticalCurrentRatio, baselineRatio: criticalBaselineRatio }),
      type: "risk_shift",
      severity: "warning",
      windowStart: emitWindowStart,
      windowEnd: emitWindowEnd,
      evidenceEventIds: ids,
      reason: `Critical-risk events are ${(criticalCurrentRatio * 100).toFixed(1)}% of the window (baseline ${(criticalBaselineRatio * 100).toFixed(1)}%, +${((criticalCurrentRatio - criticalBaselineRatio) * 100).toFixed(1)}pp)`,
      metadata: { riskLevel: "critical", currentRatio: criticalCurrentRatio, baselineRatio: criticalBaselineRatio },
    });
  }

  // High risk shift
  const highBaseline = baselineRisk["high"] ?? 0;
  const highCurrent = currentRisk["high"] ?? 0;
  const highBaselineRatio = baselineTotal > 0 ? highBaseline / baselineTotal : 0;
  const highCurrentRatio = totalCurrent > 0 ? highCurrent / totalCurrent : 0;

  if (highCurrentRatio > highBaselineRatio + 0.2) {
    const ids = events.filter((e) => e.riskLevel === "high").map((e) => e.eventId);
    anomalies.push({
      anomalyId: buildAnomalyId("risk_shift", emitWindowStart, emitWindowEnd, ids, { riskLevel: "high", currentRatio: highCurrentRatio, baselineRatio: highBaselineRatio }),
      type: "risk_shift",
      severity: "warning",
      windowStart: emitWindowStart,
      windowEnd: emitWindowEnd,
      evidenceEventIds: ids,
      reason: `High-risk events are ${(highCurrentRatio * 100).toFixed(1)}% of the window (baseline ${(highBaselineRatio * 100).toFixed(1)}%, +${((highCurrentRatio - highBaselineRatio) * 100).toFixed(1)}pp)`,
      metadata: { riskLevel: "high", currentRatio: highCurrentRatio, baselineRatio: highBaselineRatio },
    });
  }

  // Risk missing
  for (const [level, count] of Object.entries(baselineRisk)) {
    const currentCount = currentRisk[level] ?? 0;
    const baselineRatio = count / baselineTotal;
    if (count >= 5 && baselineRatio >= 0.1 && currentCount === 0) {
      anomalies.push({
        anomalyId: buildAnomalyId("risk_missing", emitWindowStart, emitWindowEnd, [], { riskLevel: level, baselineCount: count, baselineRatio }),
        type: "risk_missing",
        severity: "info",
        windowStart: emitWindowStart,
        windowEnd: emitWindowEnd,
        evidenceEventIds: [],
        reason: `No "${level}"-risk events in the current window (baseline had ${count}, ratio ${(baselineRatio * 100).toFixed(1)}%)`,
        metadata: { riskLevel: level, baselineCount: count, baselineRatio },
      });
    }
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Detector C — Sequence / pattern anomalies
// ---------------------------------------------------------------------------

function detectSequenceAnomalies(
  events: GovernanceAuditEvent[],
  _baselineEvents: GovernanceAuditEvent[] | undefined,
): GovernanceAuditAnomaly[] {
  const anomalies: GovernanceAuditAnomaly[] = [];
  const byTrace = groupByTrace(events);

  for (const [traceId, trace] of byTrace) {
    // ---- Approval without request ----
    for (const e of trace) {
      if (e.eventType !== "action_allowed") continue;
      // Only flag if event metadata suggests human approval was required
      if (!eventRequiresHumanApproval(e)) continue;
      const hasRequest = trace.some(
        (o) => o.eventType === "human_approval_requested" && o.eventId !== e.eventId,
      );
      if (!hasRequest) {
        anomalies.push({
          anomalyId: buildAnomalyId("approval_without_request", e.timestamp, e.timestamp, [e.eventId], { traceId }),
          type: "approval_without_request",
          severity: "warning",
          windowStart: e.timestamp,
          windowEnd: e.timestamp,
          evidenceEventIds: [e.eventId],
          reason: `action_allowed ${e.eventId} on trace ${traceId} has no preceding human_approval_requested event`,
          metadata: { traceId },
        });
      }
    }

    // ---- Escalation without review ----
    for (const e of trace) {
      if (e.eventType !== "action_escalated") continue;
      const hasContext = trace.some(
        (o) =>
          (o.eventType === "human_approval_requested" || o.eventType === "policy_evaluated") &&
          o.eventId !== e.eventId,
      );
      if (!hasContext) {
        anomalies.push({
          anomalyId: buildAnomalyId("escalation_without_review", e.timestamp, e.timestamp, [e.eventId], { traceId }),
          type: "escalation_without_review",
          severity: "warning",
          windowStart: e.timestamp,
          windowEnd: e.timestamp,
          evidenceEventIds: [e.eventId],
          reason: `action_escalated ${e.eventId} on trace ${traceId} has no human_approval_requested or policy_evaluated context`,
          metadata: { traceId },
        });
      }
    }

    // ---- Terminal mutation ----
    const chronoTrace = [...trace].sort((a, b) =>
      epochMs(a.timestamp) - epochMs(b.timestamp),
    );
    for (let i = 0; i < chronoTrace.length; i++) {
      const cur = chronoTrace[i]!;
      if (cur.eventType !== "action_denied" && cur.eventType !== "override_applied") continue;
      for (let j = i + 1; j < chronoTrace.length; j++) {
        const later = chronoTrace[j]!;
        if (later.subjectId !== cur.subjectId) continue;
        if (!CONTRADICTORY_TYPES.has(later.eventType)) continue;
        anomalies.push({
          anomalyId: buildAnomalyId("terminal_mutation", cur.timestamp, later.timestamp, [cur.eventId, later.eventId], { traceId }),
          type: "terminal_mutation",
          severity: "critical",
          windowStart: cur.timestamp,
          windowEnd: later.timestamp,
          evidenceEventIds: [cur.eventId, later.eventId],
          reason: `Event ${cur.eventId} (${cur.eventType}) on trace ${traceId} is followed by contradictory ${later.eventType} ${later.eventId} on the same subject`,
          metadata: { traceId },
        });
      }
    }

    // ---- Flip-flop ----
    const bySubject = groupBySubjectId(chronoTrace);
    for (const [, subjectEvents] of bySubject) {
      if (countAlternations(subjectEvents) >= 3) {
        const ids = subjectEvents.map((x) => x.eventId);
        anomalies.push({
          anomalyId: buildAnomalyId("flip_flop", subjectEvents[0]!.timestamp, subjectEvents[subjectEvents.length - 1]!.timestamp, ids, { traceId, subjectId: subjectEvents[0]!.subjectId }),
          type: "flip_flop",
          severity: "info",
          windowStart: subjectEvents[0]!.timestamp,
          windowEnd: subjectEvents[subjectEvents.length - 1]!.timestamp,
          evidenceEventIds: ids,
          reason: `Repeated allow/deny alternations (${countAlternations(subjectEvents)}) on subject ${subjectEvents[0]!.subjectId} in trace ${traceId}`,
          metadata: { traceId, subjectId: subjectEvents[0]!.subjectId },
        });
      }
    }
  }

  return anomalies;
}

/** Check whether an action_allowed event required prior human approval. */
function eventRequiresHumanApproval(event: GovernanceAuditEvent): boolean {
  // Most existing governance action_allowed events carry metadata indicating
  // whether human approval was required. Check for flags in metadata.
  if (typeof event.metadata === "object" && event.metadata !== null) {
    // An event that explicitly says no human approval was required is not flagged
    if ((event.metadata as Record<string, unknown>).requiresHumanReview === false) return false;
    // Default to flagging if no explicit opt-out
  }
  return true;
}

/** Group events by traceId, skipping null traces. */
function groupByTrace(events: GovernanceAuditEvent[]): Map<string, GovernanceAuditEvent[]> {
  const map = new Map<string, GovernanceAuditEvent[]>();
  for (const e of events) {
    if (!e.traceId) continue;
    const list = map.get(e.traceId);
    if (list) list.push(e);
    else map.set(e.traceId, [e]);
  }
  return map;
}

/** Group events by subjectId, skipping null subjectIds. */
function groupBySubjectId(events: GovernanceAuditEvent[]): Map<string, GovernanceAuditEvent[]> {
  const map = new Map<string, GovernanceAuditEvent[]>();
  for (const e of events) {
    if (!e.subjectId) continue;
    const list = map.get(e.subjectId);
    if (list) list.push(e);
    else map.set(e.subjectId, [e]);
  }
  return map;
}

/** Count allow/deny alternations in a chronological event list. */
function countAlternations(events: GovernanceAuditEvent[]): number {
  const ALLOW_TYPES = new Set(["action_allowed", "action_escalated", "human_approval_granted"]);
  const DENY_TYPES = new Set(["action_denied", "human_approval_denied"]);
  let alternations = 0;
  let prevIsAllow: boolean | null = null;

  for (const e of events) {
    const isAllow = ALLOW_TYPES.has(e.eventType);
    const isDeny = DENY_TYPES.has(e.eventType);
    if (!isAllow && !isDeny) continue;

    if (prevIsAllow !== null && isAllow !== prevIsAllow) {
      alternations++;
    }
    if (isAllow) prevIsAllow = true;
    else if (isDeny) prevIsAllow = false;
  }

  return alternations;
}

// ---------------------------------------------------------------------------
// Detector D — Continuity anomalies
// ---------------------------------------------------------------------------

function detectContinuityAnomalies(
  events: GovernanceAuditEvent[],
): GovernanceAuditAnomaly[] {
  const anomalies: GovernanceAuditAnomaly[] = [];

  if (events.length === 0) return anomalies;

  // ---- Timestamp regression (uses append order, NOT chronological) ----
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    // Lexicographic ISO comparison (valid for ISO 8601 zero-padded strings)
    if (prev.timestamp > curr.timestamp) {
      anomalies.push({
        anomalyId: buildAnomalyId(
          "timestamp_regression",
          prev.timestamp,
          curr.timestamp,
          [prev.eventId, curr.eventId],
          { regression: (epochMs(prev.timestamp) - epochMs(curr.timestamp)) / 1000 + "s" },
        ),
        type: "timestamp_regression",
        severity: "critical",
        windowStart: prev.timestamp,
        windowEnd: curr.timestamp,
        evidenceEventIds: [prev.eventId, curr.eventId],
        reason: `Event ${prev.eventId} (${prev.timestamp}) appears after event ${curr.eventId} (${curr.timestamp}) in append order — timestamp regression of ${((epochMs(prev.timestamp) - epochMs(curr.timestamp)) / 1000).toFixed(0)}s`,
        metadata: {
          earlierEventIdx: i - 1,
          earlierTimestamp: prev.timestamp,
          laterEventIdx: i,
          laterTimestamp: curr.timestamp,
          regressionSeconds: (epochMs(prev.timestamp) - epochMs(curr.timestamp)) / 1000,
        },
      });
    }
  }

  // ---- Duplicate eventId ----
  const seen = new Map<string, string[]>();
  for (const e of events) {
    const list = seen.get(e.eventId);
    if (list) list.push(e.eventId);
    else seen.set(e.eventId, [e.eventId]);
  }
  for (const [eventId, occurrences] of seen) {
    if (occurrences.length > 1) {
      anomalies.push({
        anomalyId: buildAnomalyId("duplicate_event_id", "", "", [eventId], { count: occurrences.length }),
        type: "duplicate_event_id",
        severity: "critical",
        windowStart: events[0]!.timestamp,
        windowEnd: events[events.length - 1]!.timestamp,
        evidenceEventIds: [eventId],
        reason: `Duplicate eventId "${eventId}" found ${occurrences.length} times in the audit trail`,
        metadata: { count: occurrences.length },
      });
    }
  }

  // ---- Hash-chain break (uses append order, NOT chronological) ----
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    if (curr.previousHash !== null && curr.previousHash !== prev.eventHash) {
      anomalies.push({
        anomalyId: buildAnomalyId(
          "hash_chain_break",
          prev.timestamp,
          curr.timestamp,
          [prev.eventId, curr.eventId],
          { expectedHash: prev.eventHash, actualPreviousHash: curr.previousHash },
        ),
        type: "hash_chain_break",
        severity: "critical",
        windowStart: prev.timestamp,
        windowEnd: curr.timestamp,
        evidenceEventIds: [prev.eventId, curr.eventId],
        reason: `Hash-chain break between ${prev.eventId} (hash ${prev.eventHash}) and ${curr.eventId} (previousHash ${curr.previousHash})`,
        metadata: { expectedHash: prev.eventHash, actualPreviousHash: curr.previousHash },
      });
    }
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Detect anomalies in a set of governance audit events.
 *
 * @param events - Events in the current/recent window (append order).
 * @param baselineEvents - Optional events from a baseline/historical window (append order).
 * @param options - Optional configuration (e.g. monitored event types).
 * @returns Deterministically sorted list of anomalies (severity desc, time asc, type asc, id asc).
 */
export function detectAnomalies(
  events: GovernanceAuditEvent[],
  baselineEvents?: GovernanceAuditEvent[],
  _options?: AnomalyOptions,
): GovernanceAuditAnomaly[] {
  const results: GovernanceAuditAnomaly[] = [
    ...detectVolumeAnomalies(events, baselineEvents),
    ...detectRiskAnomalies(events, baselineEvents),
    ...detectSequenceAnomalies(events, baselineEvents),
    ...detectContinuityAnomalies(events),
  ];

  // Sort: severity desc → windowStart asc → type asc → anomalyId asc
  return results.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity];
    const sb = SEVERITY_ORDER[b.severity];
    if (sa !== sb) return sa - sb;
    if (a.windowStart !== b.windowStart) return a.windowStart < b.windowStart ? -1 : 1;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.anomalyId.localeCompare(b.anomalyId);
  });
}
