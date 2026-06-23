/**
 * P8.5a.2d — `alix learning refresh` orchestrator.
 *
 * The ONLY legitimate writer to LearningStore. Iterates an AdapterRegistry
 * (heterogeneous `Record<AdapterName, CalibrationAdapter>` map) rather than
 * an if/else chain — future adapters drop in as a single map entry, no
 * orchestrator changes.
 *
 * Core invariants:
 *   - Best-effort writes: each LearningStore.append wrapped in try/catch;
 *     a single failed append does not abort the rest of the refresh
 *     (per P8 Learning ≠ Mutation invariance).
 *   - Append-only idempotency: calling runLearningRefresh twice with the
 *     same `generatedAt` produces TWO report rows in LearningStore (by
 *     design — refresh = append-only, not idempotent).
 *   - `generatedAt` is the single source of truth for run identity. All
 *     emitted signals, profiles, and the summary report MUST share the
 *     same `generatedAt` so downstream P9 run-identity reconstruction can
 *     reconstruct a refresh run from the artifacts.
 *   - Adapters stay pure — they only READ source stores; they MUST NOT
 *     write to LearningStore. Purity is sentinel-enforced by
 *     `tests/learning/adapter-purity-sentinels.vitest.ts`.
 *
 * @module
 */

import { join } from "node:path";

import { OutcomeStore } from "../adaptation/outcome-store.js";
import { RiskScoreStore } from "../adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../adaptation/governance-review-store.js";

import { LearningStore } from "./learning-store.js";
import type {
  CalibrationProfile,
  LearningReport,
  LearningSignal,
} from "./learning-types.js";
import type {
  AdapterName,
  AdapterResult,
  CalibrationAdapter,
} from "./adapter-diagnostics.js";
import { RecommendationCalibrationAdapter } from "./recommendation-calibration-adapter.js";
import { RiskCalibrationAdapter } from "./risk-calibration-adapter.js";
import { GovernanceCalibrationAdapter } from "./governance-calibration-adapter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;

// AdapterRegistry keys — the orchestrator validates against this set so
// invalid `opts.adapter` strings fail loudly with a clean error rather
// than being silently cast. `Object.keys(buildDefaultAdapters(cwd))`
// could derive it but we hardcode here to keep validation independent of
// store construction (cwd-free validation, fast-fail before any I/O).
const VALID_ADAPTERS: AdapterName[] = [
  "recommendation",
  "risk",
  "governance",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Orchestrator options. `generatedAt`, `learningStore`, and `adapters` are
 * injectable to support determinism in tests AND extensibility (a 4th
 * adapter can drop into the map without modifying the orchestrator).
 */
export interface RunLearningRefreshOptions {
  cwd: string;
  windowDays?: number;
  adapter?: AdapterName | "all";
  /** Injected for determinism in tests; defaults to `new Date().toISOString()`. */
  generatedAt?: string;
  /** Injected for tests; defaults to a new LearningStore under cwd. */
  learningStore?: LearningStore;
  /**
   * Injected for tests + extensibility. Defaults to the standard
   * recommendation/risk/governance registry constructed from
   * OutcomeStore/RiskScoreStore/GovernanceReviewStore under cwd.
   */
  adapters?: Record<AdapterName, CalibrationAdapter>;
}

/** Orchestrator return shape — same for terminal and JSON consumers. */
export interface RunLearningRefreshResult {
  /** Canonical run identifier: `refresh:<generatedAt>`. */
  refreshRunId: string;
  /** One entry per adapter that ran. */
  results: AdapterResult[];
  /** ID of the appended LearningReport (undefined if append failed). */
  reportId?: string;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run a single learning refresh pass.
 *
 * Pure coordination — no business logic. Iterates a heterogeneous
 * AdapterRegistry so future adapters drop in as a single map entry
 * without any orchestrator changes.
 */
export async function runLearningRefresh(
  opts: RunLearningRefreshOptions,
): Promise<RunLearningRefreshResult> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const refreshRunId = `refresh:${generatedAt}`;

  // AdapterRegistry: heterogeneous map. Default constructed from the
  // canonical P7.5p stores under cwd. A caller can override (tests,
  // future extensions) by passing `opts.adapters`.
  const adapters: Record<AdapterName, CalibrationAdapter> =
    opts.adapters ?? buildDefaultAdapters(opts.cwd);

  const which = opts.adapter ?? "all";
  // Defense in depth: the CLI validates `opts.adapter` against the same set
  // but we validate here too so any caller (programmatic, future
  // subcommand, test) gets a clean error rather than `undefined[x]` later.
  if (which !== "all" && !VALID_ADAPTERS.includes(which as AdapterName)) {
    throw new Error(
      `Invalid adapter: "${which}". Valid: ${VALID_ADAPTERS.join(", ")}, all`,
    );
  }
  const selected: CalibrationAdapter[] =
    which === "all"
      ? Object.values(adapters)
      : [adapters[which as AdapterName]];

  const results: AdapterResult[] = [];
  for (const adapter of selected) {
    results.push(await adapter.calibrate({ windowDays, generatedAt }));
  }

  // Sole LearningStore writer (best-effort: log-and-continue on failure).
  const learningStore =
    opts.learningStore ?? new LearningStore(join(opts.cwd, ".alix", "learning"));

  const signalIds: string[] = [];
  const profileIds: string[] = [];

  for (const r of results) {
    for (const s of r.signals) {
      const appended = await safeAppend(() => learningStore.appendSignal(s));
      if (appended?.id) signalIds.push(appended.id);
    }
    for (const p of r.profiles) {
      const appended = await safeAppend(() => learningStore.appendProfile(p));
      if (appended?.id) profileIds.push(appended.id);
    }
  }

  // Build the summary report (one per run). Append-only — two runs with
  // the same generatedAt produce two report rows by design.
  const report = buildRefreshReport({
    windowDays,
    generatedAt,
    refreshRunId,
    results,
    signalIds,
    profileIds,
  });
  const appendedReport = await safeAppend(() => learningStore.appendReport(report));

  return {
    refreshRunId,
    results,
    reportId: appendedReport?.id,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default adapter registry: one entry per AdapterName, constructed from
 * the canonical P7.5p stores under cwd.
 */
function buildDefaultAdapters(
  cwd: string,
): Record<AdapterName, CalibrationAdapter> {
  const outcomeStore = new OutcomeStore(join(cwd, ".alix", "adaptation", "outcomes"));
  const riskStore = new RiskScoreStore(join(cwd, ".alix", "risk-scores"));
  const reviewStore = new GovernanceReviewStore(join(cwd, ".alix", "governance-reviews"));

  return {
    recommendation: new RecommendationCalibrationAdapter(outcomeStore),
    risk: new RiskCalibrationAdapter(riskStore, outcomeStore),
    governance: new GovernanceCalibrationAdapter(reviewStore, outcomeStore),
  };
}

/**
 * Best-effort append: catch and log so a single failure doesn't abort
 * the rest of the refresh (per P8 Learning ≠ Mutation invariance).
 */
async function safeAppend<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(
      `[learning-refresh] append failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * Build a single LearningReport summarizing all adapter results for this
 * refresh run. Subject captures run identity so downstream P9 consumers
 * can reconstruct the run from artifacts alone.
 */
function buildRefreshReport(args: {
  windowDays: number;
  generatedAt: string;
  refreshRunId: string;
  results: AdapterResult[];
  signalIds: string[];
  profileIds: string[];
}): LearningReport {
  const { windowDays, generatedAt, refreshRunId, results, signalIds, profileIds } =
    args;

  // windowEnd = generatedAt; windowStart = generatedAt - windowDays
  const endMs = Date.parse(generatedAt);
  const startMs = endMs - windowDays * 86_400_000;
  const windowStart = new Date(startMs).toISOString();
  const windowEnd = generatedAt;

  const allSignals: LearningSignal[] = results.flatMap((r) => r.signals);
  const allProfiles: CalibrationProfile[] = results.flatMap((r) => r.profiles);

  // Reasons: one-line per-adapter summary.
  const reasons = results.map((r) => {
    const diag = r.diagnostics;
    const excludedSummary =
      Object.keys(diag.excludedReasons).length === 0
        ? "no exclusions"
        : `excluded: ${JSON.stringify(diag.excludedReasons)}`;
    return `${diag.adapter}: ${diag.sourceRecordsRead} read, ${diag.processed} processed, fidelity=${diag.fidelity}, ${excludedSummary}`;
  });

  const sections = results.map((r) => ({
    title: `${r.diagnostics.adapter} calibration`,
    summary: `${r.diagnostics.processed} processed from ${r.diagnostics.sourceRecordsRead} source records (fidelity=${r.diagnostics.fidelity})`,
    signals: r.signals,
    profiles: r.profiles,
    recommendation:
      r.profiles.length > 0
        ? `${r.profiles.length} calibration profile(s) suggested for review`
        : "no calibration profiles suggested",
  }));

  const subject = `Learning refresh (window=${windowDays}d, ${refreshRunId})`;

  return {
    id: "",
    subject,
    // Refresh runs are observational, not decisions: a neutral outcome
    // string + confidence reflecting data coverage keep DecisionArtifact
    // shape satisfied without inventing governance semantics here.
    outcome: "learning_refresh_complete",
    confidence: allSignals.length > 0 ? 1 : 0,
    reasons,
    evidenceRefs: [...signalIds, ...profileIds],
    generatedAt,
    windowDays,
    windowStart,
    windowEnd,
    signals: allSignals,
    profiles: allProfiles,
    sections,
  };
}
