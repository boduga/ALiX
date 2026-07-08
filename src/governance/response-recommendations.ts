/**
 * P16.1 — Anomaly Triage Recommendations.
 *
 * Pure mapper: GovernanceAuditAnomaly[] → GovernanceResponseRecommendation[].
 * Zero store access, zero audit imports, zero mutation.
 */

import { createHash } from "node:crypto";
import type { GovernanceAuditAnomaly, AnomalyType } from "./audit-anomalies.js";

export type ResponseRecommendationSeverity = "info" | "warning" | "critical";

export type ResponseRecommendationKind =
  | "investigate_anomaly"
  | "inspect_policy_gap"
  | "verify_audit_integrity";

export interface GovernanceResponseRecommendation {
  recommendationId: string;
  source: "anomaly" | "workbench_signal";
  sourceIds: string[];
  severity: ResponseRecommendationSeverity;
  responseKind: ResponseRecommendationKind;
  title: string;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  proposedAction: string;
  reversible: true;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface GovernanceResponseRecommendationOptions {
  now?: string;
  minSeverity?: ResponseRecommendationSeverity;
}

const SEVERITY_ORDER: Record<ResponseRecommendationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Anomaly types that indicate policy drift or repeated governance patterns. */
const POLICY_ANOMALIES = new Set<AnomalyType>([
  "risk_shift",
  "risk_missing",
  "flip_flop",
]);

function buildRecommendationId(
  responseKind: string,
  severity: string,
  sourceIds: string[],
): string {
  const stable = ["p16.1", responseKind, severity, [...sourceIds].sort().join("|")].join("||");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

const SEVERITY_VALUES = ["critical", "warning", "info"] as const;

export function recommendGovernanceResponsesFromAnomalies(
  anomalies: GovernanceAuditAnomaly[],
  options?: GovernanceResponseRecommendationOptions,
): GovernanceResponseRecommendation[] {
  const now = options?.now ?? new Date().toISOString();

  let filtered = anomalies;
  if (options?.minSeverity) {
    const minIdx = SEVERITY_ORDER[options.minSeverity];
    filtered = anomalies.filter((a) => SEVERITY_ORDER[a.severity] <= minIdx);
  }

  const recommendations: GovernanceResponseRecommendation[] = [];
  for (const a of filtered) {
    const responseKind = pickResponseKind(a);
    const confidence = severityToConfidence(a.severity);
    const proposedAction = buildProposedAction(responseKind);

    recommendations.push({
      recommendationId: buildRecommendationId(responseKind, a.severity, [a.anomalyId]),
      source: "anomaly",
      sourceIds: [a.anomalyId],
      severity: a.severity,
      responseKind,
      title: `Anomaly: ${a.type}`,
      reason: a.reason,
      evidenceRefs: a.evidenceEventIds,
      confidence,
      proposedAction,
      reversible: true,
      createdAt: now,
    });
  }

  // Sort: severity desc → responseKind asc → sourceId asc
  recommendations.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const kind = a.responseKind.localeCompare(b.responseKind);
    if (kind !== 0) return kind;
    const aId = a.sourceIds[0] ?? "";
    const bId = b.sourceIds[0] ?? "";
    return aId.localeCompare(bId);
  });

  return recommendations;
}

function pickResponseKind(anomaly: GovernanceAuditAnomaly): ResponseRecommendationKind {
  if (anomaly.severity === "critical") {
    // Critical always investigate
    return "investigate_anomaly";
  }
  if (anomaly.severity === "info" && POLICY_ANOMALIES.has(anomaly.type)) {
    // Info anomaly indicating policy drift → inspect_policy_gap
    return "inspect_policy_gap";
  }
  return "investigate_anomaly";
}

function severityToConfidence(severity: string): number {
  switch (severity) {
    case "critical": return 0.95;
    case "warning": return 0.75;
    default: return 0.5;
  }
}

function buildProposedAction(kind: ResponseRecommendationKind): string {
  switch (kind) {
    case "investigate_anomaly":
      return "Review the detected anomaly and determine whether remediation is needed";
    case "inspect_policy_gap":
      return "Assess whether the underlying governance policy requires adjustment";
    case "verify_audit_integrity":
      return "Check the audit chain for corruption or data integrity issues";
  }
}
