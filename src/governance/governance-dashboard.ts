/**
 * P9.5 — Governance Dashboard.
 *
 * Pure read-only aggregation. Consumes P9.0 builders and stores. Never writes.
 * Mirrors the P8.5b Learning Dashboard's aggregator pattern.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GovernanceDashboardOptions {
  /** Repository root. */
  cwd: string;
  /** Window in days for window-bounded queries. Defaults to 90. */
  windowDays?: number;
  /** Fixed timestamp for deterministic output (test-friendly). */
  generatedAt?: string;
}

/**
 * Mutation pipeline health panel — the 5-second answer.
 * "Can ALiX safely apply governance changes right now?"
 */
export interface HealthPanel {
  supportedKinds: number;
  totalKinds: number;
  supportedKindList: string[];
  pendingProposals: number;
  blockedUnsupportedKinds: number;
  investigationOnlyRecs: number;
  recentApplyFailures: number;
  revertReadinessPercent: number;
  revertReadyCount: number;
  totalAppliedMutations: number;
}

export interface OpenMutationRow {
  proposalId: string;
  recommendationId: string;
  status: "pending" | "approved";
  targetKind: string;
  createdAt: string;
  confidence: number;
}

export interface OpenMutationsPanel {
  rows: OpenMutationRow[];
  totalCount: number;
}

export interface InvestigationQueueRow {
  recommendationId: string;
  category: "chain_restoration" | "governance_integrity";
  severity: "low" | "medium" | "high" | "critical";
  createdAt: string;
  operatorGuidance: string;
}

export interface InvestigationQueuePanel {
  rows: InvestigationQueueRow[];
  totalCount: number;
}

export interface MutationHistoryRow {
  proposalId: string;
  kind: string;
  appliedAt: string;
  appliedBy: string;
  snapshotStatus: "present" | "missing" | "corrupted";
}

export interface MutationHistoryPanel {
  rows: MutationHistoryRow[];
  totalCount: number;
}

export interface RevertReadinessPanel {
  ready: number;
  missing: number;
  corrupted: number;
  total: number;
  percentReady: number;
}

export interface DriftIntegrityGapRow {
  source: "drift" | "integrity" | "lens-review" | "health";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  reference: string;
}

export interface DriftIntegrityGapsPanel {
  rows: DriftIntegrityGapRow[];
  totalCount: number;
}

export interface GovernanceDashboardReport {
  schemaVersion: "p9.5.0";
  generatedAt: string;
  windowDays: number;
  health: HealthPanel;
  openMutations: OpenMutationsPanel;
  investigationQueue: InvestigationQueuePanel;
  mutationHistory: MutationHistoryPanel;
  revertReadiness: RevertReadinessPanel;
  driftIntegrityGaps: DriftIntegrityGapsPanel;
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { buildGovernanceHealth } from "./governance-health-builder.js";
import { buildGovernanceAssessment } from "./governance-assessment.js";
import { detectGovernanceDrift } from "./governance-drift-detector.js";
import { buildGovernanceIntegrity } from "./governance-integrity.js";
import { reviewLenses } from "./governance-lens-review.js";
import { GovernanceStore } from "./governance-store.js";
import { ProposalStore } from "../adaptation/proposal-store.js";
import { SnapshotStore } from "../adaptation/snapshot-store.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type { Recommendation } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOVERNANCE_DIR = join(".alix", "governance");
const ADAPTATION_DIR = join(".alix", "adaptation");
const SNAPSHOT_DIR = join(ADAPTATION_DIR, "snapshots");

const SUPPORTED_MUTATION_KINDS: ReadonlySet<string> = new Set([
  "confidence_calibration",
  "lens_adjustment",
  "policy_coverage",
]);

const INVESTIGATION_ONLY_KINDS: ReadonlySet<string> = new Set([
  "chain_restoration",
  "governance_integrity",
]);

const TOTAL_KINDS = SUPPORTED_MUTATION_KINDS.size + INVESTIGATION_ONLY_KINDS.size;
const DEFAULT_WINDOW_DAYS = 90;

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Build the GovernanceDashboardReport. Pure read-only. The only public
 * runtime export of this module. Mirrors P8.5b's buildDashboardReport.
 */
export async function buildGovernanceDashboardReport(
  opts: GovernanceDashboardOptions,
): Promise<GovernanceDashboardReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // ---- 1. Run P9.0 builders in parallel --------------------------------
  const [health, drift, integrity, lensReview] = await Promise.all([
    buildGovernanceHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    detectGovernanceDrift({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    buildGovernanceIntegrity({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    reviewLenses({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
  ]);

  // buildGovernanceAssessment is pure synchronous; consume the health report
  // (signature differs from brief's `{ reports: [] }`; takes GovernanceHealthReport).
  const _assessment = health ? buildGovernanceAssessment(health) : null;

  // ---- 2. Read stores ---------------------------------------------------
  const govStore = new GovernanceStore(join(opts.cwd, GOVERNANCE_DIR));
  const proposalStore = new ProposalStore(join(opts.cwd, ADAPTATION_DIR, "proposals"));
  const snapshotStore = new SnapshotStore(join(opts.cwd, SNAPSHOT_DIR));

  const recommendationReports = await govStore.list("recommendations").catch(() => []);
  const allRecs: Recommendation[] = recommendationReports.flatMap((r) => r.recommendations);

  const pendingProposalsRaw = await proposalStore.list("pending").catch(() => []);
  const approvedProposalsRaw = await proposalStore.list("approved").catch(() => []);
  const appliedProposalsRaw = await proposalStore.list("applied").catch(() => []);

  // ---- 3. Build each panel --------------------------------------------
  const openMutations = buildOpenMutationsPanel(pendingProposalsRaw, approvedProposalsRaw);
  const investigationQueue = buildInvestigationQueuePanel(allRecs);
  const mutationHistory = await buildMutationHistoryPanel(appliedProposalsRaw, snapshotStore);
  const revertReadiness = buildRevertReadinessPanel(mutationHistory);
  const driftIntegrityGaps = buildDriftIntegrityGapsPanel({
    health, drift, integrity, lensReview,
  });

  // ---- 4. Build primary health panel -----------------------------------
  const healthPanel: HealthPanel = {
    supportedKinds: SUPPORTED_MUTATION_KINDS.size,
    totalKinds: TOTAL_KINDS,
    supportedKindList: [...SUPPORTED_MUTATION_KINDS],
    pendingProposals: openMutations.totalCount,
    blockedUnsupportedKinds: 0, // future: count proposals whose kind is not in SUPPORTED
    investigationOnlyRecs: investigationQueue.totalCount,
    recentApplyFailures: 0, // future: filter applied proposals by recent failures
    revertReadinessPercent: revertReadiness.percentReady,
    revertReadyCount: revertReadiness.ready,
    totalAppliedMutations: revertReadiness.total,
  };

  return {
    schemaVersion: "p9.5.0",
    generatedAt,
    windowDays,
    health: healthPanel,
    openMutations,
    investigationQueue,
    mutationHistory,
    revertReadiness,
    driftIntegrityGaps,
  };
}

// ---------------------------------------------------------------------------
// Panel builders (pure helpers)
// ---------------------------------------------------------------------------

function buildOpenMutationsPanel(
  pending: AdaptationProposal[],
  approved: AdaptationProposal[],
): OpenMutationsPanel {
  const rows: OpenMutationRow[] = [];
  for (const p of [...pending, ...approved]) {
    if (p.action !== "governance_change") continue;
    const payload = p.payload as { kind?: string };
    if (!payload.kind || !SUPPORTED_MUTATION_KINDS.has(payload.kind)) continue;
    rows.push({
      proposalId: p.id,
      recommendationId: (p.target as { recommendationId?: string })?.recommendationId ?? "",
      status: p.status as "pending" | "approved",
      targetKind: payload.kind,
      createdAt: p.createdAt,
      confidence: p.sourceConfidence ?? 0,
    });
  }
  return { rows, totalCount: rows.length };
}

function buildInvestigationQueuePanel(allRecs: Recommendation[]): InvestigationQueuePanel {
  const rows: InvestigationQueueRow[] = [];
  for (const rec of allRecs) {
    if (rec.status !== "open") continue;
    if (!INVESTIGATION_ONLY_KINDS.has(rec.category)) continue;
    rows.push({
      recommendationId: rec.id,
      category: rec.category as "chain_restoration" | "governance_integrity",
      severity: rec.priority,
      createdAt: rec.sourceArtifactId, // best-effort; recs don't carry their own createdAt
      operatorGuidance: rec.operatorGuidance,
    });
  }
  return { rows, totalCount: rows.length };
}

async function buildMutationHistoryPanel(
  applied: AdaptationProposal[],
  snapshotStore: SnapshotStore,
): Promise<MutationHistoryPanel> {
  const rows: MutationHistoryRow[] = [];
  for (const p of applied) {
    if (p.action !== "governance_change") continue;
    const payload = p.payload as { kind?: string };
    if (!payload.kind) continue;
    let snapshotStatus: "present" | "missing" | "corrupted" = "missing";
    const verified = await snapshotStore.loadVerified(p.id).catch(() => null);
    if (verified) {
      snapshotStatus = "present";
    } else {
      const unverified = await snapshotStore.load(p.id).catch(() => null);
      if (unverified) snapshotStatus = "corrupted";
    }
    rows.push({
      proposalId: p.id,
      kind: payload.kind,
      appliedAt: p.approvedAt ?? p.createdAt,
      appliedBy: p.approvedBy ?? "unknown",
      snapshotStatus,
    });
  }
  return { rows, totalCount: rows.length };
}

function buildRevertReadinessPanel(history: MutationHistoryPanel): RevertReadinessPanel {
  const ready = history.rows.filter((r) => r.snapshotStatus === "present").length;
  const missing = history.rows.filter((r) => r.snapshotStatus === "missing").length;
  const corrupted = history.rows.filter((r) => r.snapshotStatus === "corrupted").length;
  const total = history.rows.length;
  const percentReady = total === 0 ? 100 : Math.round((ready / total) * 100);
  return { ready, missing, corrupted, total, percentReady };
}

function buildDriftIntegrityGapsPanel(reports: {
  health: Awaited<ReturnType<typeof buildGovernanceHealth>> | null;
  drift: Awaited<ReturnType<typeof detectGovernanceDrift>> | null;
  integrity: Awaited<ReturnType<typeof buildGovernanceIntegrity>> | null;
  lensReview: Awaited<ReturnType<typeof reviewLenses>> | null;
}): DriftIntegrityGapsPanel {
  const rows: DriftIntegrityGapRow[] = [];

  if (reports.drift) {
    for (const f of reports.drift.findings) {
      if (f.severity !== "high" && f.severity !== "critical") continue;
      rows.push({
        source: "drift",
        severity: f.severity,
        message: f.description,
        reference: f.recommendation,
      });
    }
  }

  if (reports.integrity) {
    const m = reports.integrity.metrics;
    if (m.provenanceRate < 60) {
      rows.push({ source: "integrity", severity: m.provenanceRate < 40 ? "high" : "medium",
        message: `Provenance rate ${m.provenanceRate}% (threshold: 60%)`, reference: "integrity.provenanceRate" });
    }
    if (m.explanationRate < 60) {
      rows.push({ source: "integrity", severity: m.explanationRate < 40 ? "high" : "medium",
        message: `Explanation rate ${m.explanationRate}% (threshold: 60%)`, reference: "integrity.explanationRate" });
    }
    if (m.outcomeLinkRate < 60) {
      rows.push({ source: "integrity", severity: m.outcomeLinkRate < 40 ? "high" : "medium",
        message: `Outcome link rate ${m.outcomeLinkRate}% (threshold: 60%)`, reference: "integrity.outcomeLinkRate" });
    }
  }

  if (reports.lensReview) {
    for (const lr of reports.lensReview.lensReviews) {
      if (lr.recommendation === "retire") {
        rows.push({ source: "lens-review", severity: "medium",
          message: `Lens "${lr.lens}" recommended for retirement: ${lr.reason}`, reference: lr.lens });
      }
    }
  }

  return { rows, totalCount: rows.length };
}
