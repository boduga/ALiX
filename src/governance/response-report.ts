/**
 * P16.5 — Response Report.
 *
 * Pure composition: counts/groupings over P16.1–P16.4 artifacts.
 * No detection, no mutation, no store/audit imports.
 * Must NOT import or call detectWorkbenchSignals or detectPolicyFeedbackCandidates.
 */

import type { GovernanceResponseRecommendation } from "./response-recommendations.js";
import type { GovernanceRemediationProposal } from "./remediation-queue.js";
import type { GovernancePolicyFeedbackCandidate } from "./policy-feedback-candidates.js";

export interface GovernanceResponseReportInput {
  recommendations: GovernanceResponseRecommendation[];
  remediationProposals: GovernanceRemediationProposal[];
  policyCandidates: GovernancePolicyFeedbackCandidate[];
}

export interface GovernanceResponseReportOptions {
  windowStart: string;
  windowEnd: string;
  now: string;
}

export interface GovernanceResponseReport {
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  summary: GovernanceResponseSummary;
  recommendationSummary: Array<{
    source: GovernanceResponseRecommendation["source"];
    responseKind: GovernanceResponseRecommendation["responseKind"];
    severity: GovernanceResponseRecommendation["severity"];
    count: number;
  }>;
  policyCandidateSummary: Array<{
    policyArea: GovernancePolicyFeedbackCandidate["policyArea"];
    severity: GovernancePolicyFeedbackCandidate["severity"];
    count: number;
  }>;
}

export interface GovernanceResponseSummary {
  totalRecommendations: number;
  totalRemediationProposals: number;
  openRemediationCount: number;
  acceptedRemediationCount: number;
  dismissedRemediationCount: number;
  resolvedRemediationCount: number;
  criticalUnresolvedCount: number;
  staleRemediationCount: number;
  totalPolicyCandidates: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export function buildGovernanceResponseReport(
  input: GovernanceResponseReportInput,
  options: GovernanceResponseReportOptions,
): GovernanceResponseReport {
  // Summary counts
  const totalRecommendations = input.recommendations.length;
  const totalRemediationProposals = input.remediationProposals.length;
  const totalPolicyCandidates = input.policyCandidates.length;

  const openRemediationCount = input.remediationProposals.filter((p) => p.status === "open").length;
  const acceptedRemediationCount = input.remediationProposals.filter((p) => p.status === "accepted").length;
  const dismissedRemediationCount = input.remediationProposals.filter((p) => p.status === "dismissed").length;
  const resolvedRemediationCount = input.remediationProposals.filter((p) => p.status === "resolved").length;

  // stale/open critical from workbench signal metadata ONLY — no timestamp recalculation
  const criticalUnresolvedCount = input.recommendations.filter(
    (r) =>
      r.source === "workbench_signal" &&
      (r.metadata as Record<string, unknown> | undefined)?.signalType === "unresolved_critical_proposal",
  ).length;

  const staleRemediationCount = input.recommendations.filter(
    (r) =>
      r.source === "workbench_signal" &&
      (r.metadata as Record<string, unknown> | undefined)?.signalType === "stale_open_proposal",
  ).length;

  // Group recommendation summary
  const recGroups = new Map<string, { count: number }>();
  for (const r of input.recommendations) {
    const key = `${r.source}::${r.responseKind}::${r.severity}`;
    const g = recGroups.get(key) ?? { count: 0 };
    g.count++;
    recGroups.set(key, g);
  }
  const recommendationSummary = Array.from(recGroups.entries())
    .map(([key, g]) => {
      const [source, responseKind, severity] = key.split("::") as [string, string, string];
      return {
        source: source as GovernanceResponseRecommendation["source"],
        responseKind: responseKind as GovernanceResponseRecommendation["responseKind"],
        severity: severity as GovernanceResponseRecommendation["severity"],
        count: g.count,
      };
    })
    .sort((a, b) => {
      const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sev !== 0) return sev;
      const src = a.source.localeCompare(b.source);
      if (src !== 0) return src;
      return a.responseKind.localeCompare(b.responseKind);
    });

  // Group policy candidate summary
  const polGroups = new Map<string, { count: number }>();
  for (const c of input.policyCandidates) {
    const key = `${c.policyArea}::${c.severity}`;
    const g = polGroups.get(key) ?? { count: 0 };
    g.count++;
    polGroups.set(key, g);
  }
  const policyCandidateSummary = Array.from(polGroups.entries())
    .map(([key, g]) => {
      const [policyArea, severity] = key.split("::") as [string, string];
      return {
        policyArea,
        severity: severity as GovernancePolicyFeedbackCandidate["severity"],
        count: g.count,
      };
    })
    .sort((a, b) => {
      const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sev !== 0) return sev;
      return a.policyArea.localeCompare(b.policyArea);
    });

  return {
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    generatedAt: options.now,
    summary: {
      totalRecommendations,
      totalRemediationProposals,
      openRemediationCount,
      acceptedRemediationCount,
      dismissedRemediationCount,
      resolvedRemediationCount,
      criticalUnresolvedCount,
      staleRemediationCount,
      totalPolicyCandidates,
    },
    recommendationSummary,
    policyCandidateSummary,
  };
}
