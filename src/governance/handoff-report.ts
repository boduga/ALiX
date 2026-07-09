/**
 * P20.4 — Handoff Report.
 *
 * Read-only operator view of pending, completed, failed, and
 * evidence-missing handoffs. Report state is derived from handoff
 * packages, evidence validations, and execution attempts — the
 * packages themselves are never mutated.
 */

import type { HandoffPackage } from "./handoff-builder.js";
import type { GovernanceExecutionAttempt } from "./execution-recorder.js";
import type { HandoffEvidenceValidation } from "./handoff-evidence.js";

export type HandoffReportStatus =
  | "pending"
  | "evidence_missing"
  | "completed"
  | "failed";

export interface HandoffReportItem {
  handoffId: string;
  planId: string;
  remediationId: string;
  disposition: string;
  status: HandoffReportStatus;
  actionCount: number;
  evidenceRequired: number;
  evidenceCaptured: number;
  executedAt: string | null;
  explicitlyManualOnly: true;
}

export interface HandoffReportTotals {
  pending: number;
  completed: number;
  failed: number;
  evidenceMissing: number;
  total: number;
}

export interface HandoffReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totals: HandoffReportTotals;
  items: HandoffReportItem[];
}

function parseIso(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ISO timestamp "${value}"`);
  }
  return parsed;
}

export function buildHandoffReport(
  handoffs: HandoffPackage[],
  validations: HandoffEvidenceValidation[],
  attempts: GovernanceExecutionAttempt[],
  options: { since?: string; until?: string; now?: string } = {},
): HandoffReport {
  const generatedAt = options.now ?? new Date().toISOString();
  const windowEnd = options.until ?? generatedAt;
  const windowStart =
    options.since ??
    new Date(parseIso(windowEnd) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const windowStartMs = parseIso(windowStart);
  const windowEndMs = parseIso(windowEnd);

  // Index validations by handoffId
  const valByHandoff = new Map<string, HandoffEvidenceValidation>();
  for (const v of validations) {
    if (v.handoffId) valByHandoff.set(v.handoffId, v);
  }

  // Index attempts by planId
  const attemptByPlan = new Map<string, GovernanceExecutionAttempt>();
  for (const a of attempts) {
    attemptByPlan.set(a.planId, a);
  }

  const items: HandoffReportItem[] = [];

  for (const h of handoffs) {
    const generatedMs = parseIso(h.generatedAt);
    if (generatedMs < windowStartMs || generatedMs >= windowEndMs) continue;

    const validation = valByHandoff.get(h.handoffId) ?? null;
    const attempt = attemptByPlan.get(h.planId) ?? null;

    let status: HandoffReportStatus;
    if (attempt && attempt.status === "succeeded") {
      status = "completed";
    } else if (attempt && attempt.status === "failed") {
      status = "failed";
    } else if (validation && !validation.valid) {
      status = "evidence_missing";
    } else if (validation && validation.valid) {
      // Evidence captured but no execution attempt recorded yet
      status = "pending";
    } else {
      status = "pending";
    }

    items.push({
      handoffId: h.handoffId,
      planId: h.planId,
      remediationId: h.remediationId,
      disposition: h.disposition,
      status,
      actionCount: h.actions.length,
      evidenceRequired: h.evidence.filter((e) => e.required).length,
      evidenceCaptured: validation
        ? validation.totalCaptured
        : 0,
      executedAt: attempt?.completedAt ?? null,
      explicitlyManualOnly: true,
    });
  }

  items.sort((a, b) => {
    const order: Record<HandoffReportStatus, number> = {
      pending: 0,
      evidence_missing: 1,
      completed: 2,
      failed: 3,
    };
    return (
      order[a.status] - order[b.status] ||
      a.handoffId.localeCompare(b.handoffId)
    );
  });

  return {
    generatedAt,
    windowStart,
    windowEnd,
    totals: {
      pending: items.filter((i) => i.status === "pending").length,
      completed: items.filter((i) => i.status === "completed").length,
      failed: items.filter((i) => i.status === "failed").length,
      evidenceMissing: items.filter((i) => i.status === "evidence_missing").length,
      total: items.length,
    },
    items,
  };
}
