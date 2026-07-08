/**
 * P16.3 — Governance Workbench Signals.
 *
 * Pure module detecting stale, incomplete, orphaned, unresolved governance
 * items. Returns GovernanceResponseRecommendation[].
 * Zero store access, zero audit imports, zero mutation.
 */

import { createHash } from "node:crypto";
import type {
  GovernanceResponseRecommendation,
  ResponseRecommendationSeverity,
  ResponseRecommendationKind,
  GovernanceResponseRecommendationOptions,
} from "./response-recommendations.js";
import type { GovernanceRemediationProposal, GovernanceRemediationProposalStatus } from "./remediation-queue.js";
import type { OperatorReview } from "./operator-review.js";
import type { OperatorDecision } from "./decision-capture.js";
import type { GovernanceActionProposal } from "./action-queue.js";

export type WorkbenchSignalType =
  | "stale_open_proposal"
  | "unresolved_critical_proposal"
  | "repeatedly_dismissed_pattern"
  | "incomplete_review_metadata"
  | "orphaned_escalation";

export interface GovernanceWorkbenchSignalInput {
  remediationProposals: GovernanceRemediationProposal[];
  responseRecommendations: GovernanceResponseRecommendation[];
  reviews: OperatorReview[];
  decisions: OperatorDecision[];
  actionProposals: GovernanceActionProposal[];
}

export interface GovernanceWorkbenchSignalOptions {
  now: string;
  windowStart?: string;
  windowEnd?: string;
  staleThresholdDays?: number;
  unresolvedCriticalDays?: number;
  dismissedPatternThreshold?: number;
}

const SEVERITY_ORDER: Record<ResponseRecommendationSeverity, number> = { critical: 0, warning: 1, info: 2 };

function buildRecId(signalType: string, targetId: string, windowStart: string, windowEnd: string): string {
  const stable = ["p16.3", signalType, targetId, windowStart, windowEnd].join("||");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function makeRecommendation(
  signalType: WorkbenchSignalType,
  targetId: string,
  severity: ResponseRecommendationSeverity,
  responseKind: ResponseRecommendationKind,
  title: string,
  reason: string,
  evidenceRefs: string[],
  now: string,
  windowStart: string,
  windowEnd: string,
): GovernanceResponseRecommendation {
  return {
    recommendationId: buildRecId(signalType, targetId, windowStart, windowEnd),
    source: "workbench_signal",
    sourceIds: [targetId],
    severity,
    responseKind,
    title,
    reason,
    evidenceRefs,
    confidence: 0.8,
    proposedAction: "Review the workbench signal and determine remediation",
    reversible: true,
    createdAt: now,
    metadata: { signalType, targetId },
  };
}

export function detectWorkbenchSignals(
  input: GovernanceWorkbenchSignalInput,
  options: GovernanceWorkbenchSignalOptions,
): GovernanceResponseRecommendation[] {
  const now = options.now;
  const ws = options.windowStart ?? "";
  const we = options.windowEnd ?? "";
  const staleDays = options.staleThresholdDays ?? 7;
  const criticalDays = options.unresolvedCriticalDays ?? 1;
  const dismissThreshold = options.dismissedPatternThreshold ?? 2;

  const results: GovernanceResponseRecommendation[] = [];

  // 1. Stale open proposals
  for (const p of input.remediationProposals) {
    if (p.status !== "open") continue;
    const ageDays = (new Date(now).getTime() - new Date(p.createdAt).getTime()) / 86_400_000;
    if (ageDays < staleDays) continue;
    results.push(makeRecommendation(
      "stale_open_proposal", p.proposalId, "warning", "investigate_anomaly",
      "Stale open remediation proposal",
      `Proposal ${p.proposalId} has been open for ${Math.round(ageDays)} days (threshold: ${staleDays}d)`,
      [p.proposalId], now, ws, we,
    ));
  }

  // 2. Unresolved critical proposals
  for (const p of input.remediationProposals) {
    if (p.status !== "open") continue;
    if (p.severity !== "critical") continue;
    const ageDays = (new Date(now).getTime() - new Date(p.createdAt).getTime()) / 86_400_000;
    if (ageDays < criticalDays) continue;
    // Avoid duplicate: skip if already emitted as stale
    const alreadyStale = results.some(
      (r) => r.metadata?.signalType === "stale_open_proposal" && r.sourceIds.includes(p.proposalId),
    );
    if (alreadyStale) continue;
    results.push(makeRecommendation(
      "unresolved_critical_proposal", p.proposalId, "critical", "investigate_anomaly",
      "Unresolved critical remediation proposal",
      `Critical proposal ${p.proposalId} unresolved for ${Math.round(ageDays)} days`,
      [p.proposalId], now, ws, we,
    ));
  }

  // 3. Repeatedly dismissed patterns
  const dismissedBySource = new Map<string, number>();
  for (const p of input.remediationProposals) {
    if (p.status !== "dismissed") continue;
    // Find source recommendation type
    const firstSrcId = p.sourceRecommendationIds[0];
    const sourceRec = firstSrcId
      ? input.responseRecommendations.find((r) => r.recommendationId === firstSrcId)
      : undefined;
    const sourceMeta = sourceRec?.metadata;
    const sourceType = sourceMeta && typeof sourceMeta === "object" && "signalType" in sourceMeta
      ? String(sourceMeta.signalType)
      : sourceRec?.responseKind ?? "unknown";
    dismissedBySource.set(sourceType, (dismissedBySource.get(sourceType) ?? 0) + 1);
  }
  for (const [sourceType, count] of dismissedBySource) {
    if (count < dismissThreshold) continue;
    results.push(makeRecommendation(
      "repeatedly_dismissed_pattern", sourceType, "warning", "inspect_policy_gap",
      "Repeatedly dismissed remediation pattern",
      `Source type "${sourceType}" dismissed ${count} times (threshold: ${dismissThreshold})`,
      [], now, ws, we,
    ));
  }

  // 4. Incomplete review metadata
  for (const r of input.reviews) {
    if (r.notes !== null && r.classification !== null) continue;
    const missing: string[] = [];
    if (r.notes === null) missing.push("notes");
    if (r.classification === null) missing.push("classification");
    results.push(makeRecommendation(
      "incomplete_review_metadata", r.reviewId, "info", "complete_review_metadata" as ResponseRecommendationKind,
      "Complete missing review metadata",
      `Review ${r.reviewId} missing: ${missing.join(", ")}`,
      [r.reviewId], now, ws, we,
    ));
  }

  // 5. Orphaned escalations
  for (const d of input.decisions) {
    if (d.decision !== "escalate" && d.decision !== "convert_to_issue") continue;
    const hasProposal = input.actionProposals.some((ap) => ap.decisionId === d.decisionId);
    if (hasProposal) continue;
    results.push(makeRecommendation(
      "orphaned_escalation", d.decisionId, "warning", "investigate_anomaly",
      "Orphaned escalation decision",
      `Decision ${d.decisionId} (${d.decision}) has no matching action proposal`,
      [d.decisionId], now, ws, we,
    ));
  }

  // Sort: severity desc → responseKind asc → targetId asc
  results.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const kind = a.responseKind.localeCompare(b.responseKind);
    if (kind !== 0) return kind;
    const aTgt = (a.sourceIds[0] ?? "");
    const bTgt = (b.sourceIds[0] ?? "");
    return aTgt.localeCompare(bTgt);
  });

  return results;
}
