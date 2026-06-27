/**
 * P10.8 — Recommendation Effectiveness Intelligence.
 *
 * Pure functions that classify executive recommendations by their disposition
 * (what happened to them — bridged? rejected? stale?) and compute per-signal
 * calibration aggregates.
 *
 * Read-only: no I/O, no mutation, no proposals. The CLI handler (not this
 * module) owns store reads and age computation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RecommendationDisposition =
  | "unreviewed"
  | "stale"
  | "awaiting_review"
  | "approved_pending_apply"
  | "applied"
  | "rejected"
  | "failed"
  | "proposal_missing";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface ClassifyInput {
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendation: string;
  proposalId?: string;
  /** The proposal's status from ProposalStore.load, or null if not found / corrupt. */
  proposalStatus?: ProposalStatus | null;
  /** Days since the source report was generated (only affects unreviewed/stale). */
  ageDays: number;
}

export interface RecommendationEntry {
  reportId: string;
  generatedAt: string;
  recIndex: number;
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendation: string;
  proposalId?: string;
  disposition: RecommendationDisposition;
  ageDays: number;
}

export interface SignalCalibration {
  signal: string;
  total: number;
  unreviewed: number;
  stale: number;
  awaitingReview: number;
  approvedPendingApply: number;
  applied: number;
  rejected: number;
  failed: number;
  proposalMissing: number;
  /** Sum of all 6 bridged states (awaitingReview + approvedPendingApply + applied + rejected + failed + proposalMissing). */
  bridgedCount: number;
  /** bridgedCount / total, [0..1], 2-decimal rounded. */
  actionRate: number;
}

export const EFFECTIVENESS_OK = "ok";
export const EFFECTIVENESS_NO_DATA = "no_data";

export interface EffectivenessResult {
  effectivenessStatus: typeof EFFECTIVENESS_OK | typeof EFFECTIVENESS_NO_DATA;
  generatedAt: string;
  staleThresholdDays: number;
  reportCount: number;
  totalRecommendations: number;
  signalCalibration: SignalCalibration[];
  recommendations: RecommendationEntry[];
  loadWarnings: string[];
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

const DEFAULT_STALE_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyRecommendation(
  input: ClassifyInput,
  staleThresholdDays: number = DEFAULT_STALE_THRESHOLD_DAYS,
): RecommendationDisposition {
  // Unbridged branch (no proposalId)
  if (input.proposalId === undefined) {
    return input.ageDays < staleThresholdDays ? "unreviewed" : "stale";
  }

  // Bridged branch — proposalStatus
  if (input.proposalStatus === null || input.proposalStatus === undefined) {
    return "proposal_missing";
  }

  switch (input.proposalStatus) {
    case "pending":  return "awaiting_review";
    case "approved": return "approved_pending_apply";
    case "applied":  return "applied";
    case "rejected": return "rejected";
    case "failed":   return "failed";
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function computeRecommendationEffectiveness(
  entries: RecommendationEntry[],
  staleThresholdDays: number,
  generatedAt: string,
): EffectivenessResult {
  const sorted = sortRecommendations(entries);

  if (entries.length === 0) {
    return {
      effectivenessStatus: EFFECTIVENESS_NO_DATA,
      generatedAt,
      staleThresholdDays,
      reportCount: 0,
      totalRecommendations: 0,
      signalCalibration: [],
      recommendations: [],
      loadWarnings: [],
    };
  }

  // Per-signal tallies
  const signalMap = new Map<string, SignalCalibration>();

  for (const entry of sorted) {
    let cal = signalMap.get(entry.signal);
    if (!cal) {
      cal = {
        signal: entry.signal,
        total: 0,
        unreviewed: 0, stale: 0,
        awaitingReview: 0, approvedPendingApply: 0,
        applied: 0, rejected: 0, failed: 0,
        proposalMissing: 0,
        bridgedCount: 0,
        actionRate: 0,
      };
      signalMap.set(entry.signal, cal);
    }

    cal.total++;

    switch (entry.disposition) {
      case "unreviewed":              cal.unreviewed++; break;
      case "stale":                    cal.stale++; break;
      case "awaiting_review":          cal.awaitingReview++; cal.bridgedCount++; break;
      case "approved_pending_apply":   cal.approvedPendingApply++; cal.bridgedCount++; break;
      case "applied":                  cal.applied++; cal.bridgedCount++; break;
      case "rejected":                 cal.rejected++; cal.bridgedCount++; break;
      case "failed":                   cal.failed++; cal.bridgedCount++; break;
      case "proposal_missing":         cal.proposalMissing++; cal.bridgedCount++; break;
    }
  }

  // Compute actionRate per signal
  const signalCalibration: SignalCalibration[] = [];
  for (const cal of signalMap.values()) {
    cal.actionRate = cal.total > 0
      ? Math.round((cal.bridgedCount / cal.total) * 100) / 100
      : 0;
    signalCalibration.push(cal);
  }

  // Collect loadWarnings from proposal_missing entries
  const loadWarnings: string[] = [];
  for (const entry of sorted) {
    if (entry.disposition === "proposal_missing" && entry.proposalId) {
      loadWarnings.push(
        `proposal not found: ${entry.proposalId} (rec index ${entry.recIndex} in report ${entry.reportId})`,
      );
    }
  }

  // Report count as distinct reportIds
  const reportIds = new Set(entries.map((e) => e.reportId));

  return {
    effectivenessStatus: EFFECTIVENESS_OK,
    generatedAt,
    staleThresholdDays,
    reportCount: reportIds.size,
    totalRecommendations: entries.length,
    signalCalibration,
    recommendations: sorted,
    loadWarnings,
  };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortRecommendations(entries: RecommendationEntry[]): RecommendationEntry[] {
  return [...entries].sort((a, b) => {
    const dateCmp = b.generatedAt.localeCompare(a.generatedAt);
    if (dateCmp !== 0) return dateCmp;
    const reportCmp = a.reportId.localeCompare(b.reportId);
    if (reportCmp !== 0) return reportCmp;
    return a.recIndex - b.recIndex;
  });
}
