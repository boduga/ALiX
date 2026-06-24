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