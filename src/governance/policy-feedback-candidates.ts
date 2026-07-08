/**
 * P16.4 — Policy Feedback Candidates.
 *
 * Pure module surfacing reviewable policy/rule update candidates from
 * repeated governance patterns. No policy mutation, no enforcement.
 */

import { createHash } from "node:crypto";
import type { GovernanceAuditAnomaly } from "./audit-anomalies.js";
import type { GovernanceRemediationProposal } from "./remediation-queue.js";
import type { GovernanceResponseRecommendation } from "./response-recommendations.js";
import type { GovernanceAuditEvent } from "./audit-types.js";
import type { OperatorReview } from "./operator-review.js";

export type PolicyFeedbackSource = "anomaly" | "remediation" | "workbench_signal" | "operator_outcome";

export interface GovernancePolicyFeedbackCandidate {
  candidateId: string;
  source: PolicyFeedbackSource;
  sourceIds: string[];
  policyArea: string;
  severity: "info" | "warning" | "critical";
  title: string;
  reason: string;
  evidenceRefs: string[];
  proposedPolicyDirection: string;
  confidence: number;
  createdAt: string;
  reversible: true;
}

export interface GovernancePolicyFeedbackCandidateInput {
  anomalies: GovernanceAuditAnomaly[];
  remediationProposals: GovernanceRemediationProposal[];
  responseRecommendations: GovernanceResponseRecommendation[];
  auditEvents: GovernanceAuditEvent[];
  reviews: OperatorReview[];
}

export interface GovernancePolicyFeedbackCandidateOptions {
  now: string;
  windowStart: string;
  windowEnd: string;
  anomalyTypeThreshold?: number;
  dismissedPatternThreshold?: number;
  reversalThreshold?: number;
  unresolvedCriticalThreshold?: number;
  incompleteMetadataThreshold?: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

// ---------------------------------------------------------------------------
// policyArea mapping
// ---------------------------------------------------------------------------

function anomalyPolicyArea(type: string): string {
  const map: Record<string, string> = {
    approval_without_request: "approval_policy",
    escalation_without_review: "escalation_policy",
    terminal_mutation: "terminal_decision_policy",
    flip_flop: "decision_consistency_policy",
    timestamp_regression: "audit_integrity_policy",
    duplicate_event_id: "audit_integrity_policy",
    hash_chain_break: "audit_integrity_policy",
    volume_spike: "governance_volume_policy",
    volume_drop: "governance_volume_policy",
    risk_shift: "risk_review_policy",
    risk_missing: "risk_review_policy",
  };
  return map[type] ?? "governance_general_policy";
}

function workbenchPolicyArea(signalType: string): string {
  const map: Record<string, string> = {
    incomplete_review_metadata: "review_metadata_policy",
    unresolved_critical_proposal: "remediation_sla_policy",
    stale_open_proposal: "remediation_sla_policy",
    repeatedly_dismissed_pattern: "remediation_feedback_policy",
  };
  return map[signalType] ?? "governance_general_policy";
}

// ---------------------------------------------------------------------------
// Candidate ID
// ---------------------------------------------------------------------------

function buildCandidateId(
  source: string, policyArea: string, sourceIds: string[], ws: string, we: string,
): string {
  const stable = ["p16.4", source, policyArea, [...sourceIds].sort().join("|"), ws, we].join("||");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

function computeConfidence(observedCount: number, threshold: number): number {
  return Math.min(1, observedCount / (threshold * 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function detectPolicyFeedbackCandidates(
  input: GovernancePolicyFeedbackCandidateInput,
  options: GovernancePolicyFeedbackCandidateOptions,
): GovernancePolicyFeedbackCandidate[] {
  const now = options.now;
  const ws = options.windowStart;
  const we = options.windowEnd;
  const anomalyThresh = options.anomalyTypeThreshold ?? 3;
  const dismissThresh = options.dismissedPatternThreshold ?? 2;
  const reversalThresh = options.reversalThreshold ?? 2;
  const criticalThresh = options.unresolvedCriticalThreshold ?? 2;
  const metadataThresh = options.incompleteMetadataThreshold ?? 3;

  const candidates: GovernancePolicyFeedbackCandidate[] = [];

  // 1. Repeated anomaly type
  const anomalyCounts = new Map<string, number>();
  const anomalyIds = new Map<string, string[]>();
  for (const a of input.anomalies) {
    if (a.windowStart < ws || a.windowStart >= we) continue;
    const key = a.type;
    anomalyCounts.set(key, (anomalyCounts.get(key) ?? 0) + 1);
    const list = anomalyIds.get(key) ?? [];
    list.push(a.anomalyId);
    anomalyIds.set(key, list);
  }
  for (const [type, count] of anomalyCounts) {
    if (count < anomalyThresh) continue;
    const ids = anomalyIds.get(type)!;
    const area = anomalyPolicyArea(type);
    candidates.push(makeCandidate("anomaly", ids, area, anomalySeverity(type), ids, count, anomalyThresh, now, ws, we));
  }

  // 2. Repeated dismissed pattern
  const dismissCounts = new Map<string, number>();
  const dismissIds = new Map<string, string[]>();
  for (const p of input.remediationProposals) {
    if (p.status !== "dismissed") continue;
    const srcType = "remediation";
    dismissCounts.set(srcType, (dismissCounts.get(srcType) ?? 0) + 1);
    const list = dismissIds.get(srcType) ?? [];
    list.push(p.proposalId);
    dismissIds.set(srcType, list);
  }
  for (const [src, count] of dismissCounts) {
    if (count < dismissThresh) continue;
    const ids = dismissIds.get(src)!;
    candidates.push(makeCandidate("remediation", ids, "remediation_feedback_policy", "warning", ids, count, dismissThresh, now, ws, we));
  }

  // 3. Repeated override/reversal
  const reversalIds: string[] = [];
  // Group events by traceId for contradiction detection
  const traceGroups = new Map<string, GovernanceAuditEvent[]>();
  for (const e of input.auditEvents) {
    if (!e.traceId) continue;
    const list = traceGroups.get(e.traceId) ?? [];
    list.push(e);
    traceGroups.set(e.traceId, list);
  }
  for (const [, trace] of traceGroups) {
    const chrono = [...trace].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    for (let i = 0; i < chrono.length; i++) {
      const e = chrono[i]!;
      if (e.eventType !== "action_denied" && e.eventType !== "action_allowed") continue;
      // Look for override_applied later on same traceId
      const override = chrono.slice(i + 1).find((x) => x.eventType === "override_applied");
      if (override) {
        reversalIds.push(override.eventId);
      }
    }
  }
  const uniqueReversals = [...new Set(reversalIds)];
  if (uniqueReversals.length >= reversalThresh) {
    candidates.push(makeCandidate(
      "operator_outcome", uniqueReversals, "terminal_decision_policy", "warning",
      uniqueReversals, uniqueReversals.length, reversalThresh, now, ws, we,
    ));
  }

  // 4. Unresolved critical workbench signals
  const criticalSignalTypes = ["unresolved_critical_proposal", "stale_open_proposal"];
  const criticalSignals = input.responseRecommendations.filter(
    (r) => r.source === "workbench_signal" && r.severity === "critical" && criticalSignalTypes.includes(
      (r.metadata as Record<string, unknown> | undefined)?.signalType as string ?? "",
    ),
  );
  if (criticalSignals.length >= criticalThresh) {
    const ids = criticalSignals.map((r) => r.recommendationId);
    candidates.push(makeCandidate(
      "workbench_signal", ids, "remediation_sla_policy", "critical",
      ids, ids.length, criticalThresh, now, ws, we,
    ));
  }

  // 5. Recurring incomplete review metadata (grouped by missing field, not reviewer)
  const missingFieldCounts = new Map<string, number>();
  const missingFieldIds = new Map<string, string[]>();
  for (const rev of input.reviews) {
    if (rev.notes === null && rev.classification === null) {
      addMissingField("notes_and_classification", rev.reviewId, missingFieldCounts, missingFieldIds);
    } else if (rev.notes === null) {
      addMissingField("notes", rev.reviewId, missingFieldCounts, missingFieldIds);
    } else if (rev.classification === null) {
      addMissingField("classification", rev.reviewId, missingFieldCounts, missingFieldIds);
    }
  }
  for (const [field, count] of missingFieldCounts) {
    if (count < metadataThresh) continue;
    const ids = missingFieldIds.get(field)!;
    candidates.push(makeCandidate(
      "workbench_signal", ids, "review_metadata_policy",
      "info", ids, count, metadataThresh, now, ws, we,
    ));
  }

  // Sort: severity desc → policyArea asc → candidateId asc
  candidates.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const area = a.policyArea.localeCompare(b.policyArea);
    if (area !== 0) return area;
    return a.candidateId.localeCompare(b.candidateId);
  });

  return candidates;
}

function addMissingField(
  field: string, reviewId: string,
  counts: Map<string, number>, ids: Map<string, string[]>,
) {
  counts.set(field, (counts.get(field) ?? 0) + 1);
  const list = ids.get(field) ?? [];
  list.push(reviewId);
  ids.set(field, list);
}

function makeCandidate(
  source: PolicyFeedbackSource,
  sourceIds: string[],
  policyArea: string,
  severity: "info" | "warning" | "critical",
  evidenceIds: string[],
  observedCount: number,
  threshold: number,
  now: string,
  ws: string,
  we: string,
): GovernancePolicyFeedbackCandidate {
  const sortedSrc = [...new Set(sourceIds)].sort();
  const sortedEv = [...new Set(evidenceIds)].sort();

  return {
    candidateId: buildCandidateId(source, policyArea, sortedSrc, ws, we),
    source,
    sourceIds: sortedSrc,
    policyArea,
    severity,
    title: `Consider reviewing policy for ${policyArea.replace(/_/g, " ")}`,
    reason: `Detected ${observedCount} occurrences (threshold: ${threshold}) in window ${ws} → ${we}`,
    evidenceRefs: sortedEv,
    proposedPolicyDirection: `Review governance rules related to ${policyArea.replace(/_/g, " ")}`,
    confidence: computeConfidence(observedCount, threshold),
    createdAt: now,
    reversible: true,
  };
}

function anomalySeverity(type: string): "info" | "warning" | "critical" {
  const critical = new Set(["timestamp_regression", "duplicate_event_id", "hash_chain_break", "terminal_mutation"]);
  const warning = new Set(["volume_spike", "volume_drop", "risk_shift", "approval_without_request", "escalation_without_review"]);
  if (critical.has(type)) return "critical";
  if (warning.has(type)) return "warning";
  return "info";
}
