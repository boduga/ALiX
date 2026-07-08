/**
 * P16.2 — Governance Remediation Queue.
 *
 * Pure mapper: GovernanceResponseRecommendation[] → GovernanceRemediationProposal[].
 * Batches by (responseKind, severity, windowStart, windowEnd). No stores, no CLI, no mutation.
 */

import { createHash } from "node:crypto";
import type { GovernanceResponseRecommendation, ResponseRecommendationKind, ResponseRecommendationSeverity } from "./response-recommendations.js";

export type GovernanceRemediationProposalStatus =
  | "open"
  | "accepted"
  | "dismissed"
  | "resolved"
  | "superseded";

export type GovernanceRemediationResponseKind = ResponseRecommendationKind;

export interface GovernanceRemediationProposal {
  proposalId: string;
  sourceRecommendationIds: string[];
  title: string;
  severity: ResponseRecommendationSeverity;
  windowStart: string;
  windowEnd: string;
  evidenceRefs: string[];
  status: GovernanceRemediationProposalStatus;
  createdAt: string;
  responseKind: GovernanceRemediationResponseKind;
  proposedAction: string;
  reversible: true;
}

export interface GovernanceRemediationProposalOptions {
  windowStart: string;
  windowEnd: string;
  now?: string;
}

type BatchKey = string;

function buildBatchKey(
  kind: GovernanceRemediationResponseKind,
  severity: string,
  windowStart: string,
  windowEnd: string,
): BatchKey {
  return [kind, severity, windowStart, windowEnd].join("||");
}

function buildProposalId(
  kind: string,
  severity: string,
  windowStart: string,
  windowEnd: string,
  sourceIds: string[],
): string {
  const stable = [
    "p16.2",
    kind,
    severity,
    windowStart,
    windowEnd,
    [...sourceIds].sort().join("|"),
  ].join("||");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function highestSeverity(a: ResponseRecommendationSeverity, b: ResponseRecommendationSeverity): ResponseRecommendationSeverity {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b;
}

export function createRemediationProposalsFromRecommendations(
  recommendations: GovernanceResponseRecommendation[],
  options?: GovernanceRemediationProposalOptions,
): GovernanceRemediationProposal[] {
  const now = options?.now ?? new Date().toISOString();
  const windowStart = options?.windowStart ?? "";
  const windowEnd = options?.windowEnd ?? "";

  // Batch by (responseKind, severity, windowStart, windowEnd)
  const batches = new Map<BatchKey, GovernanceResponseRecommendation[]>();

  for (const rec of recommendations) {
    const key = buildBatchKey(rec.responseKind, rec.severity, windowStart, windowEnd);
    const list = batches.get(key) ?? [];
    list.push(rec);
    batches.set(key, list);
  }

  const proposals: GovernanceRemediationProposal[] = [];

  for (const [, batch] of batches) {
    const kind = batch[0]!.responseKind;
    const severity = batch.map((r) => r.severity).reduce(highestSeverity);
    const sourceIds = [...new Set(batch.map((r) => r.sourceIds).flat())].sort();
    const evidenceRefs = [...new Set(batch.map((r) => r.evidenceRefs).flat())].sort();
    const count = batch.length;

    proposals.push({
      proposalId: buildProposalId(kind, severity, windowStart, windowEnd, sourceIds),
      sourceRecommendationIds: sourceIds,
      title: `Remediation: ${kind} (${count} items)`,
      severity,
      windowStart,
      windowEnd,
      evidenceRefs,
      status: "open",
      createdAt: now,
      responseKind: kind,
      proposedAction: batch[0]!.proposedAction,
      reversible: true,
    });
  }

  // Sort: severity desc → createdAt asc → proposalId asc
  proposals.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.proposalId.localeCompare(b.proposalId);
  });

  return proposals;
}
