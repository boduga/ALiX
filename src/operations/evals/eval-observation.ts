/**
 * eval-observation.ts — canonical measurement row for harness baselines (P0-D).
 *
 * ADDITIVE by design. This does NOT replace, wrap or reimplement the behavioral
 * evaluator: `EvalResult.verdict` remains the single scoring authority
 * (`objectiveCorrect && honest`). This module adds the *measurement* dimensions
 * the behavioral evaluator does not carry — cost, latency, retries,
 * interventions, failure classification and scenario stratum — so a baseline can
 * be compared across strata without inventing a second scoring engine.
 *
 * Design constraints (operator-approved P0-D boundary):
 *   - no separate scoring engine: every row cites its `EvalResult` verdict
 *   - no approval/coordination/scheduler implementation: scenarios reuse the
 *     existing runtime, this file only describes outcomes
 *   - no durable state store: rows are values, not records
 *   - unmeasured stays `null`, never `0` — a zero cost for an unmeasured run
 *     would silently improve every average it enters
 *
 * @module
 */

/** PRD §7 task strata. Order matches the PRD table so ids are stable. */
export type ScenarioStratum =
  | "readonly-inspection"
  | "code-navigation"
  | "single-file-edit"
  | "multi-file-fix"
  | "verification-repair"
  | "coordination-ownership"
  | "capability-mix"
  | "crash-outcome-unknown"
  | "local-cpu-only"
  | "tool-failure-recovery";

/**
 * Why a task did not succeed.
 *
 * The distinction that matters most is `planner-contract` versus `task`: Gate 7
 * produced cancelled runs where the planner emitted glob-scoped infrastructure
 * workers. Counting those as model/task failures would corrupt every quality
 * comparison, so they are classified separately and stay visible.
 */
export type FailureClass =
  | "task"                  // runtime ran, objective genuinely not met
  | "verification"          // objective ambiguous or reviewer rejected without a task defect
  | "planner-contract"      // planner produced an invalid scope/shape (NOT model quality)
  | "policy-denial"         // a capability was denied; correct behaviour, not failure
  | "approval-timeout"      // operator did not resolve in time
  | "infrastructure"        // harness, provider transport, or environment fault
  | "unknown";              // must stay visible, never silently dropped

/** Terminal status of the run under measurement. */
export type ObservedTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "timeout"
  | "not-run";

/**
 * Cost accounting that keeps observed values separate from estimates.
 *
 * `observed*` fields are measured. `estimated*` fields are derived from a
 * published rate card and are always labelled as estimates. Orchestration and
 * approval overhead are reported as their own fields when measurable — never
 * inferred by subtracting an end-to-end duration, which would attribute every
 * unrelated delay to the approval boundary.
 */
export type CostAccounting = {
  /** Total wall-clock duration of the measured run. Always observed. */
  wallClockMs: number;
  /** Model prompt/completion tokens, when the provider reported usage. */
  promptTokens: number | null;
  completionTokens: number | null;
  /** Monetary cost when a real provider rate applies. Observed, not estimated. */
  observedCostUsd: number | null;
  /** Monetary cost derived from a rate card. Never mixed into observed totals. */
  estimatedCostUsd: number | null;
  /**
   * Wall-clock spent waiting for operator approval decisions, when the runtime
   * recorded approval request/resolve timestamps. `null` when not measurable.
   */
  approvalWaitMs: number | null;
  /**
   * Time spent in coordination scheduling (dispatch → worker settle), when
   * derivable from events. `null` when not measurable — never back-solved.
   */
  orchestrationMs: number | null;
  /** Local-model resource time, labelled so it is never read as currency. */
  resourceTimeMs: number | null;
};

/** One measured row. The unit a baseline aggregates over. */
export type EvalObservation = {
  /** Stable scenario id, matching the underlying eval case id where one exists. */
  scenarioId: string;
  stratum: ScenarioStratum;
  /** Provider + model + version, as reported by the resolver. */
  model: string;
  provider: string;
  /** Correlates to the underlying `EvalResult`/session/run. */
  runId: string;
  /**
   * The behavioral evaluator's verdict for this scenario.
   *
   * This field is the scoring authority. A row cannot claim success the
   * evaluator did not grant; `verifyObservation` enforces that.
   */
  verdict: "pass" | "fail";
  /** Independent verification note: what the evaluator actually observed. */
  verification: string;
  terminalStatus: ObservedTerminalStatus;
  cost: CostAccounting;
  /** Retry count. `null` when the source did not record attempts. */
  retries: number | null;
  /** Operator interventions (approval decisions), not model turns. */
  interventions: number;
  /** `null` when the run succeeded; a class otherwise. */
  failureClass: FailureClass | null;
  /** Environment axes that affect comparability (cpu-only, containers, etc.). */
  environment: Record<string, string | number | boolean>;
  /** Free-form but structured notes; never used for scoring. */
  notes?: string[];
};

/** Outcome of checking one row against its evaluator source of truth. */
export type ObservationCheck = {
  ok: boolean;
  problems: string[];
};

/**
 * Enforce that a row never overstates what the evaluator proved.
 *
 * Cheap, structural, and deliberately strict: the benchmark's credibility rests
 * on rows not being able to claim a success the evaluator did not grant.
 */
export function verifyObservation(row: EvalObservation): ObservationCheck {
  const problems: string[] = [];

  if (row.verdict === "pass" && row.failureClass !== null) {
    problems.push(`verdict=pass but failureClass=${row.failureClass}`);
  }
  if (row.verdict === "fail" && row.failureClass === null) {
    problems.push("verdict=fail but no failureClass was recorded");
  }
  if (!row.verification.trim()) {
    problems.push("verification note is empty: a row must say what was observed");
  }
  if (!Number.isFinite(row.cost.wallClockMs) || row.cost.wallClockMs < 0) {
    problems.push(`invalid wallClockMs: ${row.cost.wallClockMs}`);
  }
  // "Not measured" must be null, never 0, so it cannot enter an average as a
  // free pass. Zero is legitimate only for a genuinely zero-valued measurement.
  for (const field of ["promptTokens", "completionTokens"] as const) {
    const value = row.cost[field];
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      problems.push(`invalid ${field}: ${value}`);
    }
  }
  if (row.terminalStatus === "not-run" && row.verdict === "pass") {
    problems.push("verdict=pass for a run that never executed");
  }
  return { ok: problems.length === 0, problems };
}

/** Aggregate a set of rows for one stratum. Unmeasured fields stay null. */
export type StratumAggregate = {
  stratum: ScenarioStratum;
  tasks: number;
  verifiedSuccesses: number;
  /** total measured cost / verified successes; null when nothing succeeded. */
  costPerVerifiedSuccessUsd: number | null;
  medianWallClockMs: number | null;
  p50ApprovalWaitMs: number | null;
  p95ApprovalWaitMs: number | null;
  totalRetries: number;
  /** Rows whose retry count was not measured. Never silently treated as zero. */
  retriesUnmeasured: number;
  totalInterventions: number;
  failureClasses: Partial<Record<FailureClass, number>>;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

/**
 * Aggregate rows into one stratum.
 *
 * Cost per verified success includes the cost of failed rows in the numerator,
 * exactly as the PRD requires: an optimiser that burns budget on hard failures
 * must not appear cheap.
 */
export function aggregateStratum(rows: readonly EvalObservation[]): StratumAggregate {
  const successes = rows.filter(r => r.verdict === "pass");
  const costs = rows
    .map(r => r.cost.observedCostUsd ?? r.cost.estimatedCostUsd)
    .filter((v): v is number => v !== null);
  const totalCost = costs.reduce((sum, v) => sum + v, 0);

  const failureClasses: Partial<Record<FailureClass, number>> = {};
  for (const row of rows) {
    if (!row.failureClass) continue;
    failureClasses[row.failureClass] = (failureClasses[row.failureClass] ?? 0) + 1;
  }

  const approvalWaits = rows
    .map(r => r.cost.approvalWaitMs)
    .filter((v): v is number => v !== null);

  return {
    stratum: rows[0]?.stratum ?? "readonly-inspection",
    tasks: rows.length,
    verifiedSuccesses: successes.length,
    // Only report a ratio when cost was actually measured for every success.
    costPerVerifiedSuccessUsd:
      successes.length > 0 && costs.length === rows.length ? totalCost / successes.length : null,
    medianWallClockMs: median(rows.map(r => r.cost.wallClockMs)),
    p50ApprovalWaitMs: percentile(approvalWaits, 50),
    p95ApprovalWaitMs: percentile(approvalWaits, 95),
    totalRetries: rows.reduce((sum, r) => sum + (r.retries ?? 0), 0),
    retriesUnmeasured: rows.filter(r => r.retries === null).length,
    totalInterventions: rows.reduce((sum, r) => sum + r.interventions, 0),
    failureClasses,
  };
}
