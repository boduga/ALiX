/**
 * P9.5 — Governance Dashboard renderer.
 *
 * Pure formatter. Consumes GovernanceDashboardReport. No data access.
 * Mirrors the P8.5b renderDashboard pattern.
 *
 * @module
 */

import type {
  GovernanceDashboardReport,
  HealthPanel,
  OpenMutationsPanel,
  InvestigationQueuePanel,
  MutationHistoryPanel,
  RevertReadinessPanel,
  DriftIntegrityGapsPanel,
} from "../../governance/governance-dashboard.js";

export interface RenderOptions {
  /** When true, print JSON instead of formatted text. */
  jsonMode?: boolean;
}

export function renderGovernanceDashboard(
  report: GovernanceDashboardReport,
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=".repeat(72));
  console.log("GOVERNANCE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(72));

  renderHealth(report.health);
  console.log("");
  renderOpenMutations(report.openMutations);
  console.log("");
  renderInvestigationQueue(report.investigationQueue);
  console.log("");
  renderMutationHistory(report.mutationHistory);
  console.log("");
  renderRevertReadiness(report.revertReadiness);
  console.log("");
  renderDriftIntegrityGaps(report.driftIntegrityGaps);
  console.log("=".repeat(72));
}

function renderHealth(h: HealthPanel): void {
  console.log("\n[0] MUTATION PIPELINE HEALTH");
  console.log(`  Supported mutation kinds:   ${h.supportedKinds}/${h.totalKinds}     (${h.supportedKindList.join(", ")})`);
  console.log(`  Pending mutation proposals: ${h.pendingProposals}`);
  console.log(`  Blocked unsupported kinds:  ${h.blockedUnsupportedKinds}`);
  console.log(`  Investigation-only recs:    ${h.investigationOnlyRecs}`);
  console.log(`  Recent apply failures:      ${h.recentApplyFailures}`);
  console.log(`  Revert readiness:           ${h.revertReadinessPercent}%    (${h.revertReadyCount} of ${h.totalAppliedMutations} applied mutations have snapshots)`);
}

function renderOpenMutations(p: OpenMutationsPanel): void {
  console.log(`\n[1] OPEN MUTATIONS (${p.totalCount})`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  proposal-id          | rec-id        | status   | kind                    | confidence");
  console.log("  ---------------------+---------------+----------+-------------------------+-----------");
  for (const r of p.rows) {
    console.log(`  ${pad(r.proposalId, 20)} | ${pad(r.recommendationId, 13)} | ${pad(r.status, 8)} | ${pad(r.targetKind, 23)} | ${r.confidence.toFixed(2)}`);
  }
}

function renderInvestigationQueue(p: InvestigationQueuePanel): void {
  console.log(`\n[2] INVESTIGATION QUEUE (${p.totalCount}) [INVESTIGATION — cannot be applied]`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  rec-id        | category              | severity | operator-guidance");
  console.log("  --------------+-----------------------+----------+----------------------------------");
  for (const r of p.rows) {
    console.log(`  ${pad(r.recommendationId, 13)} | ${pad(r.category, 21)} | ${pad(r.severity, 8)} | ${truncate(r.operatorGuidance, 50)}`);
  }
}

function renderMutationHistory(p: MutationHistoryPanel): void {
  console.log(`\n[3] MUTATION HISTORY (${p.totalCount})`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  proposal-id     | kind                  | applied-at          | applied-by      | snapshot");
  console.log("  ----------------+-----------------------+---------------------+-----------------+-----------");
  for (const r of p.rows) {
    const status = r.snapshotStatus === "present" ? "OK" : r.snapshotStatus === "missing" ? "MISSING" : "CORRUPT";
    console.log(`  ${pad(r.proposalId, 15)} | ${pad(r.kind, 21)} | ${pad(r.appliedAt, 19)} | ${pad(r.appliedBy, 15)} | ${status}`);
  }
}

function renderRevertReadiness(p: RevertReadinessPanel): void {
  console.log(`\n[4] REVERT READINESS`);
  console.log(`  Ready:     ${p.ready}`);
  console.log(`  Missing:   ${p.missing}`);
  console.log(`  Corrupted: ${p.corrupted}`);
  console.log(`  Total:     ${p.total}    Percent ready: ${p.percentReady}%`);
}

function renderDriftIntegrityGaps(p: DriftIntegrityGapsPanel): void {
  console.log(`\n[5] DRIFT & INTEGRITY GAPS (${p.totalCount})`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  source        | severity | message");
  console.log("  --------------+----------+----------------------------------------");
  for (const r of p.rows) {
    console.log(`  ${pad(r.source, 13)} | ${pad(r.severity, 8)} | ${truncate(r.message, 70)}`);
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}