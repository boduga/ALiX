/**
 * gate7-observation-adapter.ts — thin adapter from Gate 7 evidence rows to the
 * canonical observation schema.
 *
 * WHY THIS EXISTS: Gate 7 produced the only proven coordination/approval/crash
 * scenarios ALiX has, but their results live in driver `summary.json` files that
 * are not part of the evaluator. Rewriting those scenarios from scratch would
 * duplicate tested logic AND silently change the test oracle.
 *
 * WHAT THIS IS NOT: a scoring engine, a benchmark runner, an approval
 * implementation, a scheduler, or a state store. It is a pure mapping from an
 * already-produced summary to an `EvalObservation`. The verdict is taken from
 * the summary's own independent assertions — this adapter never decides success
 * itself.
 *
 * The operator-approved P0-D boundary is that the behavioral evaluator keeps
 * ownership of case identity, execution, scoring and reporting. This adapter is
 * the seam that lets proven Gate 7 scenarios feed that evaluator without
 * establishing a second runner.
 *
 * NEGATIVE SCENARIOS — read this before interpreting a row:
 * some scenarios (failure propagation, denial handling) EXPECT the run to fail.
 * For those a row is `verdict: "pass"` with `terminalStatus: "failed"` and
 * `failureClass: null`, because the scenario contract held and there was no
 * *unexpected* failure. That combination is not contradictory: `verdict`
 * describes whether the scenario behaved as specified, `terminalStatus`
 * describes what the runtime did, and `failureClass` describes why the runtime
 * fell short of a *success* expectation. A failure class is only recorded when
 * the row fails.
 *
 * @module
 */

import { classifyFailure, type FailureEvidence } from "./eval-failure-classifier.js";
import type {
  CostAccounting,
  EvalObservation,
  ObservedTerminalStatus,
  ScenarioStratum,
} from "./eval-observation.js";

/**
 * The subset of a Gate 7 driver summary this adapter consumes.
 *
 * Kept structurally loose on purpose: the Python drivers emit a superset and
 * will keep evolving. Only these fields are relied upon, and each is validated
 * before use.
 */
export type Gate7Summary = {
  run?: {
    id?: string;
    status?: string;
    workers?: Array<{ status?: string; failureKind?: string | null; scopes?: string[] }>;
  };
  aggregate?: { status?: string; outcome?: string; complete?: boolean } | null;
  artifacts?: Record<string, string | null>;
  approvals?: Array<{
    id?: string;
    status?: string;
    capabilities?: string[];
    executionOutcome?: string | null;
  }>;
  operator_decisions?: Array<{ decision?: string; post_run?: boolean }>;
  pending_left?: string[];
  provider?: string;
  model?: string;
};

export type AdapterInput = {
  scenarioId: string;
  stratum: ScenarioStratum;
  /** The driver's own PASS/FAIL verdict, from its independent assertions. */
  driverVerdict: "pass" | "fail";
  summary: Gate7Summary;
  /** Wall clock the driver measured, if it recorded one. */
  wallClockMs: number;
  /** Expected artifact contents, so verification is not just "a file exists". */
  expectedArtifacts?: Record<string, string>;
  environment?: Record<string, string | number | boolean>;
  notes?: string[];
};

function normalizeStatus(value: string | undefined): ObservedTerminalStatus {
  switch ((value ?? "").toLowerCase()) {
    case "completed":
    case "success":
      return "completed";
    case "failed":
    case "failure":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "blocked":
      return "blocked";
    case "timeout":
      return "timeout";
    default:
      return "not-run";
  }
}

/**
 * Verify artifacts against expected content.
 *
 * Deliberately stricter than "exists": Gate 7 established that an artifact
 * existing is not a pass. A trailing-newline difference is tolerated because the
 * original drivers did, and the exact bytes remain in the summary.
 */
function verifyArtifacts(
  summary: Gate7Summary,
  expected: Record<string, string> | undefined,
): { ok: boolean; note: string } {
  if (!expected || Object.keys(expected).length === 0) {
    return { ok: true, note: "no artifact contract declared" };
  }
  const actual = summary.artifacts ?? {};
  const problems: string[] = [];
  for (const [path, content] of Object.entries(expected)) {
    const got = actual[path];
    if (typeof got !== "string") {
      problems.push(`${path}: missing`);
      continue;
    }
    if (got.replace(/\n+$/, "") !== content.replace(/\n+$/, "")) {
      problems.push(`${path}: content mismatch`);
    }
  }
  return problems.length === 0
    ? { ok: true, note: `artifacts verified: ${Object.keys(expected).join(", ")}` }
    : { ok: false, note: `artifact problems: ${problems.join("; ")}` };
}

/**
 * Build a canonical observation from a Gate 7 summary.
 *
 * The returned verdict is `driverVerdict` AND artifact verification: a driver
 * that says PASS while its artifacts do not match cannot produce a passing row.
 */
export function observationFromGate7(input: AdapterInput): EvalObservation {
  const { summary } = input;
  const terminalStatus = normalizeStatus(summary.run?.status);
  const artifacts = verifyArtifacts(summary, input.expectedArtifacts);

  const verdict: "pass" | "fail" =
    input.driverVerdict === "pass" && artifacts.ok ? "pass" : "fail";

  const approvals = summary.approvals ?? [];
  const decisions = summary.operator_decisions ?? [];
  const workerFailures = (summary.run?.workers ?? []).filter(w => w.status === "failed");

  const denied = approvals.some(a => a.status === "denied");
  const pending = (summary.pending_left ?? []).length > 0;

  const evidence: FailureEvidence = {
    terminalStatus,
    objectiveLanded: artifacts.ok && terminalStatus === "completed",
    ...(summary.aggregate?.outcome ? { reportedReason: summary.aggregate.outcome } : {}),
    ...(workerFailures.length > 0
      ? { errorText: workerFailures.map(w => w.failureKind ?? "").join(" ") }
      : {}),
    deniedByPolicy: denied,
    approvalUnresolved: pending,
    // A cancelled run whose workers were never dispatched is the planner-variance
    // shape; the classifier still needs the text, so this stays undefined unless
    // the summary actually says so.
  };

  const failureClass = verdict === "pass" ? null : classifyFailure(evidence);

  // Cost: only wall clock is observed. Tokens/cost/approval-wait are NOT in the
  // Gate 7 summaries, so they stay null — "not measured", never zero.
  const cost: CostAccounting = {
    wallClockMs: input.wallClockMs,
    promptTokens: null,
    completionTokens: null,
    observedCostUsd: null,
    estimatedCostUsd: null,
    approvalWaitMs: null,
    orchestrationMs: null,
    resourceTimeMs: null,
  };

  return {
    scenarioId: input.scenarioId,
    stratum: input.stratum,
    model: summary.model ?? "unknown",
    provider: summary.provider ?? "unknown",
    runId: summary.run?.id ?? "unknown",
    verdict,
    verification: `${artifacts.note}; workers=${(summary.run?.workers ?? []).length}; approvals=${approvals.length}`,
    terminalStatus,
    cost,
    // Retries are not recorded in the Gate 7 summaries. Null is the honest
    // value; `0` would be a fabricated measurement that improves any average.
    retries: null,
    interventions: decisions.filter(d => !d.post_run).length,
    failureClass,
    environment: input.environment ?? {},
    ...(input.notes ? { notes: input.notes } : {}),
  };
}
