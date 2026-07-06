/**
 * P14.1 — Governance Signal Inbox.
 *
 * Normalises P13 module outputs into reviewable GovernanceSignal items,
 * persists them in an append-only JSONL store, and provides deduplication
 * for inbox-refresh operations.
 *
 * Core variant of P14 invariant 4: P14 consumes P13 outputs but does not
 * modify P13 analysis functions, scoring, thresholds, or stores.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LedgerAnalytics, PeriodRollup, TrendDirection } from "./ledger-analytics.js";
import type { FailureAnalysis, FailureCluster } from "./failure-clustering.js";
import { failureSeverityForType } from "./failure-clustering.js";
import type { PolicySuggestion } from "./policy-suggestions.js";
import type { FrictionReport, ApprovalFriction } from "./approval-friction.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type SignalStatus = "new" | "reviewing" | "decided" | "dismissed" | "escalated";
export type SignalType =
  | "trend_alert"
  | "failure_cluster"
  | "policy_suggestion"
  | "friction_alert";

export const VALID_SIGNAL_STATUSES: SignalStatus[] = [
  "new", "reviewing", "decided", "dismissed", "escalated",
];

export const VALID_SIGNAL_TYPES: SignalType[] = [
  "trend_alert", "failure_cluster", "policy_suggestion", "friction_alert",
];

export const VALID_SOURCE_PHASES = ["p13.1", "p13.2", "p13.3", "p13.4"] as const;

export interface EvidenceRef {
  /** P13 module that produced the evidence (e.g. "failure-analysis", "policy-suggestion"). */
  source: string;
  /** Source record ID or CLI query params that reproduces the evidence. */
  id: string;
  /** Human-readable description of what this evidence demonstrates. */
  description: string;
}

export interface GovernanceSignal {
  signalId: string;
  /** P13 module that produced the signal (p13.1, p13.2, p13.3, p13.4). */
  sourcePhase: string;
  signalType: SignalType;
  severity: "low" | "medium" | "high" | "critical";
  /** 0.0–1.0, inherited from the source P13 module. */
  confidence: number;
  /** One-line human-readable summary. */
  title: string;
  /** Detail / context. */
  description: string;
  /** Links to P13 source data. */
  evidenceRefs: EvidenceRef[];
  /** What P13 suggests should be done. */
  recommendation: string;
  /** Source-specific payload (heuristic name, gate name, trend direction, etc.). */
  metadata: Record<string, unknown>;
  status: SignalStatus;
  /**
   * ISO timestamp from the originating gate request.
   * Only populated when the originating P13/P12 evidence contains a reliable
   * gate-request timestamp; otherwise `null`. When non-null, this fills
   * P13.4's `averageTimeToApprove` gap.
   */
  requestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNAL_FILE = "governance-signals.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGovernanceSignal(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Signal must be an object"] };
  }

  const s = entry as Record<string, unknown>;

  if (!isNonEmptyString(s.signalId)) errors.push("signalId is required");
  if (!(VALID_SOURCE_PHASES as readonly string[]).includes(s.sourcePhase as string)) {
    errors.push(`sourcePhase must be one of: ${VALID_SOURCE_PHASES.join(", ")}`);
  }
  if (!(VALID_SIGNAL_TYPES as readonly string[]).includes(s.signalType as string)) {
    errors.push(`signalType must be one of: ${VALID_SIGNAL_TYPES.join(", ")}`);
  }
  if (!["low", "medium", "high", "critical"].includes(s.severity as string)) {
    errors.push("severity must be one of: low, medium, high, critical");
  }
  if (typeof s.confidence !== "number" || s.confidence < 0 || s.confidence > 1) {
    errors.push("confidence must be a number in [0, 1]");
  }
  if (!isNonEmptyString(s.title)) errors.push("title is required");
  if (!isNonEmptyString(s.description)) errors.push("description is required");
  if (!Array.isArray(s.evidenceRefs)) errors.push("evidenceRefs must be an array");
  if (!isNonEmptyString(s.recommendation)) errors.push("recommendation is required");
  if (s.metadata === undefined || s.metadata === null || typeof s.metadata !== "object") {
    errors.push("metadata must be an object");
  }
  if (!(VALID_SIGNAL_STATUSES as readonly string[]).includes(s.status as string)) {
    errors.push(`status must be one of: ${VALID_SIGNAL_STATUSES.join(", ")}`);
  }
  if (s.requestedAt !== null && !isNonEmptyString(s.requestedAt)) {
    errors.push("requestedAt must be a string or null");
  }
  if (!isNonEmptyString(s.createdAt)) errors.push("createdAt is required");
  if (!isNonEmptyString(s.updatedAt)) errors.push("updatedAt is required");

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface SignalStore {
  append(signal: GovernanceSignal): Promise<void>;
  list(limit?: number): Promise<GovernanceSignal[]>;
  getById(signalId: string): Promise<GovernanceSignal | null>;
  query(filter: Partial<GovernanceSignal>): Promise<GovernanceSignal[]>;
}

// ---------------------------------------------------------------------------
// Filesystem store (JSONL, append-only)
// ---------------------------------------------------------------------------

export class FileSignalStore implements SignalStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
  }

  private get filePath(): string {
    return join(this.dir, SIGNAL_FILE);
  }

  private async dirExists(): Promise<boolean> {
    try { await stat(this.dir); return true; }
    catch { return false; }
  }

  private async ensureDir(): Promise<void> {
    if (!(await this.dirExists())) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private async fileExists(): Promise<boolean> {
    try { await stat(this.filePath); return true; }
    catch { return false; }
  }

  private async readAll(): Promise<GovernanceSignal[]> {
    if (!(await this.fileExists())) {
      return [];
    }
    const content = await readFile(this.filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const signals: GovernanceSignal[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const validation = validateGovernanceSignal(parsed);
      if (!validation.valid) {
        continue;
      }
      signals.push(parsed as GovernanceSignal);
    }
    signals.reverse();
    return signals;
  }

  async append(signal: GovernanceSignal): Promise<void> {
    const validation = validateGovernanceSignal(signal);
    if (!validation.valid) {
      throw new Error(`Invalid signal: ${validation.errors.join("; ")}`);
    }
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(signal) + "\n", "utf8");
  }

  async list(limit?: number): Promise<GovernanceSignal[]> {
    const signals = await this.readAll();
    return limit !== undefined && limit > 0 ? signals.slice(0, limit) : signals;
  }

  async getById(signalId: string): Promise<GovernanceSignal | null> {
    const signals = await this.readAll();
    return signals.find((s) => s.signalId === signalId) ?? null;
  }

  async query(filter: Partial<GovernanceSignal>): Promise<GovernanceSignal[]> {
    const signals = await this.readAll();
    const filterKeys = Object.keys(filter) as (keyof GovernanceSignal)[];
    return signals.filter((signal) => {
      for (const key of filterKeys) {
        const fv = filter[key];
        if (fv === undefined) continue;
        const sv = signal[key];
        if (Array.isArray(fv) && Array.isArray(sv)) {
          if (JSON.stringify(fv) !== JSON.stringify(sv)) return false;
        } else if (
          typeof fv === "object" && fv !== null &&
          typeof sv === "object" && sv !== null &&
          !Array.isArray(fv) && !Array.isArray(sv)
        ) {
          const fvObj = fv as Record<string, unknown>;
          const svObj = sv as Record<string, unknown>;
          for (const k of Object.keys(fvObj)) {
            if (fvObj[k] !== svObj[k]) return false;
          }
        } else if (fv !== sv) {
          return false;
        }
      }
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deterministic dedup key for a signal.
 * Two signals with the same key are considered duplicates when the existing
 * signal is still in "new" status.
 */
export function dedupKey(signal: GovernanceSignal): string {
  return `${signal.sourcePhase}:${signal.signalType}:${signal.title}`;
}

/**
 * Check whether a candidate signal is a duplicate of any existing signal that
 * has not yet been reviewed (status "new").
 *
 * @param existing - Currently stored signals (list() or query() result).
 * @param candidate - The candidate signal to check.
 * @returns `true` when a duplicate exists with status "new".
 */
export function isDuplicate(
  existing: GovernanceSignal[],
  candidate: GovernanceSignal,
): boolean {
  const key = dedupKey(candidate);
  return existing.some(
    (s) => s.status === "new" && dedupKey(s) === key,
  );
}

// ---------------------------------------------------------------------------
// Normalisation: P13.1 Ledger Analytics → trend_alert signals
// ---------------------------------------------------------------------------

const TREND_DIRECTION_SEVERITY: Record<TrendDirection, "low" | "medium" | "high"> = {
  improving: "low",
  stable: "low",
  degrading: "high",
};

/**
 * Normalise P13.1 ledger analytics into zero or more `trend_alert` signals.
 *
 * A signal is created when:
 * - Trend direction is degrading (severity: high)
 * - Approval rate is below 0.5 (severity: high)
 * - Average risk score is above 50 (severity: medium)
 *
 * Pure: identical inputs yield identical outputs.
 */
export function normalizeTrendAlerts(
  analytics: LedgerAnalytics,
  rollups: PeriodRollup[],
  now: string,
): GovernanceSignal[] {
  const signals: GovernanceSignal[] = [];

  // Trend direction alert
  if (analytics.trendDirection !== "stable") {
    const severity = TREND_DIRECTION_SEVERITY[analytics.trendDirection];
    signals.push({
      signalId: `sig-trend-${now.replace(/[:.]/g, "-")}-${signals.length + 1}`,
      sourcePhase: "p13.1",
      signalType: "trend_alert",
      severity,
      confidence: analytics.averageRiskScore > 0
        ? Math.min(analytics.averageRiskScore / 100, 0.9)
        : 0.5,
      title: `Run trend is ${analytics.trendDirection}`,
      description: `Governance run trend direction is "${analytics.trendDirection}" across ${analytics.totalRuns} runs (${analytics.timeframeDays}d window). Approval rate: ${(analytics.approvalRate * 100).toFixed(1)}%.`,
      evidenceRefs: [
        { source: "ledger-analytics", id: `analytics-${now}`, description: "Ledger analytics output" },
      ],
      recommendation: analytics.trendDirection === "degrading"
        ? "Investigate recent run failures and consider policy adjustments"
        : "No action needed — trend is improving",
      metadata: {
        trendDirection: analytics.trendDirection,
        totalRuns: analytics.totalRuns,
        approvalRate: analytics.approvalRate,
        averageRiskScore: analytics.averageRiskScore,
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Low approval rate alert
  if (analytics.approvalRate < 0.5 && analytics.totalRuns > 0) {
    signals.push({
      signalId: `sig-rate-${now.replace(/[:.]/g, "-")}-${signals.length + 1}`,
      sourcePhase: "p13.1",
      signalType: "trend_alert",
      severity: "high",
      confidence: Math.min((1 - analytics.approvalRate) * 1.5, 0.95),
      title: `Low approval rate: ${(analytics.approvalRate * 100).toFixed(1)}%`,
      description: `Only ${(analytics.approvalRate * 100).toFixed(1)}% of runs with approvals were fully approved across ${analytics.totalRuns} runs.`,
      evidenceRefs: [
        { source: "ledger-analytics", id: `analytics-${now}`, description: "Ledger analytics output" },
      ],
      recommendation: "Review approval gate configuration and consider reducing friction",
      metadata: {
        approvalRate: analytics.approvalRate,
        totalRuns: analytics.totalRuns,
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // High average risk score alert
  if (analytics.averageRiskScore > 50 && analytics.totalRuns > 0) {
    signals.push({
      signalId: `sig-risk-${now.replace(/[:.]/g, "-")}-${signals.length + 1}`,
      sourcePhase: "p13.1",
      signalType: "trend_alert",
      severity: "medium",
      confidence: Math.min(analytics.averageRiskScore / 100, 0.85),
      title: `High average risk score: ${analytics.averageRiskScore.toFixed(1)}`,
      description: `Average risk score across ${analytics.totalRuns} runs is ${analytics.averageRiskScore.toFixed(1)} (threshold: 50).`,
      evidenceRefs: [
        { source: "ledger-analytics", id: `analytics-${now}`, description: "Ledger analytics output" },
      ],
      recommendation: "Review high-risk runs and consider tightening policies for critical-risk operations",
      metadata: {
        averageRiskScore: analytics.averageRiskScore,
        totalRuns: analytics.totalRuns,
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Normalisation: P13.2 Failure Clustering → failure_cluster signals
// ---------------------------------------------------------------------------

/**
 * Normalise P13.2 failure analysis into `failure_cluster` signals.
 *
 * A signal is created for each cluster with severity ≥ "medium" (approval_denied
 * and pr_rejected have severity "high", policy_denied/file_scope_violation/
 * blocked_command have severity "medium").
 *
 * Pure: identical inputs yield identical outputs.
 */
export function normalizeFailureClusters(
  analysis: FailureAnalysis,
  now: string,
): GovernanceSignal[] {
  const signals: GovernanceSignal[] = [];

  for (const cluster of analysis.clusters) {
    const severity = failureSeverityForType(cluster.failureType);

    if (severity === "low") continue;

    signals.push({
      signalId: `sig-fail-${now.replace(/[:.]/g, "-")}-${signals.length + 1}`,
      sourcePhase: "p13.2",
      signalType: "failure_cluster",
      severity: severity === "high" ? "high" : "medium",
      confidence: Math.min(cluster.count / (analysis.total || 1) * 1.5, 0.95),
      title: `Failure cluster: ${cluster.failureType} (${cluster.count})`,
      description: `Failure type "${cluster.failureType}" occurred ${cluster.count} times (${analysis.total} total records). Recent: ${cluster.recentTimestamp}.`,
      evidenceRefs: [
        { source: "failure-analysis", id: `failure-analysis-${now}`, description: "Failure cluster output" },
      ],
      recommendation: `Investigate recurring "${cluster.failureType}" failures — consider policy or workflow adjustments`,
      metadata: {
        failureType: cluster.failureType,
        count: cluster.count,
        totalFailures: analysis.total,
        commonKeywords: cluster.commonDetailKeywords,
        commonFilePaths: cluster.commonFilePaths,
        associatedPolicyIds: cluster.associatedPolicyIds,
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Normalisation: P13.3 Policy Suggestions → policy_suggestion signals
// ---------------------------------------------------------------------------

/**
 * Normalise P13.3 policy suggestions into `policy_suggestion` signals.
 *
 * Each suggestion becomes one signal. P13.3 already gates on MIN_CONFIDENCE (0.5)
 * and evidence validity, so every input suggestion is actionable.
 *
 * Pure: identical inputs yield identical outputs.
 */
export function normalizePolicySuggestions(
  suggestions: PolicySuggestion[],
  now: string,
): GovernanceSignal[] {
  return suggestions.map((s, i) => {
    const severity = s.type === "tighten" || s.type === "remove_rule"
      ? ("high" as const)
      : s.type === "add_rule"
        ? ("medium" as const)
        : ("medium" as const);

    return {
      signalId: `sig-pol-${now.replace(/[:.]/g, "-")}-${i + 1}`,
      sourcePhase: "p13.3",
      signalType: "policy_suggestion",
      severity,
      confidence: s.confidence,
      title: `[${s.sourceHeuristic}] ${s.type.replace("_", " ")}: ${s.policyId ?? "ungoverned"}`,
      description: s.reason,
      evidenceRefs: [
        { source: "policy-suggestion", id: `policy-suggestions-${now}`, description: "Policy suggestion output" },
      ],
      recommendation: s.recommendation,
      metadata: {
        heuristic: s.sourceHeuristic,
        type: s.type,
        policyId: s.policyId ?? null,
        evidence: {
          matchedCount: s.evidence.matchedCount,
          deniedCount: s.evidence.deniedCount,
          bypassedCount: s.evidence.bypassedCount,
          relatedFailureCount: s.evidence.relatedFailureCount,
        },
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  });
}

// ---------------------------------------------------------------------------
// Normalisation: P13.4 Approval Friction → friction_alert signals
// ---------------------------------------------------------------------------

/**
 * Normalise P13.4 approval friction report into `friction_alert` signals.
 *
 * A signal is created for each gate with frictionScore > 0.3. An overall alert
 * is also created when overallFrictionScore > 0.3.
 *
 * Pure: identical inputs yield identical outputs.
 */
export function normalizeFrictionAlerts(
  report: FrictionReport,
  now: string,
): GovernanceSignal[] {
  const signals: GovernanceSignal[] = [];

  // Per-gate alert when friction exceeds threshold
  for (const gate of report.gates) {
    if (gate.frictionScore <= 0.3) continue;

    const severity = gate.frictionScore >= 0.6 ? "high" : "medium";

    signals.push({
      signalId: `sig-fric-${now.replace(/[:.]/g, "-")}-${signals.length + 1}`,
      sourcePhase: "p13.4",
      signalType: "friction_alert",
      severity,
      confidence: Math.min(gate.frictionScore * 1.3, 0.95),
      title: `High friction on "${gate.gate}" gate: ${gate.frictionScore.toFixed(2)}`,
      description: `Gate "${gate.gate}" has friction score ${gate.frictionScore.toFixed(2)} (${gate.totalOccurrences} occurrences: ${gate.deniedCount} denied, ${gate.pendingCount} pending).`,
      evidenceRefs: [
        { source: "friction-analysis", id: `friction-analysis-${now}`, description: "Friction analysis output" },
      ],
      recommendation: `Review "${gate.gate}" gate configuration — friction score exceeds threshold`,
      metadata: {
        gate: gate.gate,
        frictionScore: gate.frictionScore,
        totalOccurrences: gate.totalOccurrences,
        deniedCount: gate.deniedCount,
        pendingCount: gate.pendingCount,
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Overall friction alert
  if (report.overallFrictionScore > 0.3 && report.totalApprovalsRequested > 0) {
    const overallSeverity = report.overallFrictionScore >= 0.6 ? "critical" : "high";

    signals.push({
      signalId: `sig-fric-overall-${now.replace(/[:.]/g, "-")}-${signals.length + 1}`,
      sourcePhase: "p13.4",
      signalType: "friction_alert",
      severity: overallSeverity,
      confidence: Math.min(report.overallFrictionScore * 1.3, 0.95),
      title: `Overall approval friction: ${report.overallFrictionScore.toFixed(2)}`,
      description: `Overall governance friction score is ${report.overallFrictionScore.toFixed(2)} across ${report.totalApprovalsRequested} approvals. Highest friction gate: ${report.highestFrictionGate ?? "none"}.`,
      evidenceRefs: [
        { source: "friction-analysis", id: `friction-analysis-${now}`, description: "Friction analysis output" },
      ],
      recommendation: "Review overall approval workflow — friction score exceeds healthy threshold",
      metadata: {
        overallFrictionScore: report.overallFrictionScore,
        totalApprovalsRequested: report.totalApprovalsRequested,
        highestFrictionGate: report.highestFrictionGate,
      },
      status: "new",
      requestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Aggregate normalisation (runs all four normalisers over stored data)
// ---------------------------------------------------------------------------

/**
 * Run all four P13 normalisers and return the combined set of new signals
 * after deduplication against the existing signals in the store.
 *
 * This is the primary entry point for `alix governance inbox refresh`.
 *
 * @param store - Signal store to check against for dedup.
 * @param allExisting - All existing signals (from store.list()).
 * @param analytics - P13.1 LedgerAnalytics output.
 * @param rollups - P13.1 PeriodRollup output.
 * @param failureAnalysis - P13.2 FailureAnalysis output.
 * @param policySuggestions - P13.3 PolicySuggestion[] output.
 * @param frictionReport - P13.4 FrictionReport output.
 * @param now - ISO timestamp for signal creation.
 * @returns Array of new (non-duplicate) signals ready for append.
 */
export function normalizeAllP13Outputs(
  allExisting: GovernanceSignal[],
  analytics: LedgerAnalytics,
  rollups: PeriodRollup[],
  failureAnalysis: FailureAnalysis,
  policySuggestions: PolicySuggestion[],
  frictionReport: FrictionReport,
  now: string,
): GovernanceSignal[] {
  const allNew: GovernanceSignal[] = [
    ...normalizeTrendAlerts(analytics, rollups, now),
    ...normalizeFailureClusters(failureAnalysis, now),
    ...normalizePolicySuggestions(policySuggestions, now),
    ...normalizeFrictionAlerts(frictionReport, now),
  ];

  // Deduplicate against existing signals
  return allNew.filter((candidate) => !isDuplicate(allExisting, candidate));
}
