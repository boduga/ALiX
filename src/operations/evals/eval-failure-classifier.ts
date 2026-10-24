/**
 * eval-failure-classifier.ts — classify why a measured scenario did not succeed.
 *
 * The distinction that protects benchmark integrity: a planner that emits an
 * invalid scope is a PLANNER-CONTRACT failure, not a model-quality failure.
 * Gate 7 produced exactly that shape (cancelled runs with glob-scoped
 * infrastructure workers), and counting those as task failures would corrupt
 * every cross-model comparison.
 *
 * Classification is evidence-driven: it reads the durable outcome the runtime
 * already produced, and defaults to `unknown` rather than guessing. `unknown`
 * stays visible in aggregates — it is never folded into `task`.
 *
 * @module
 */

import type { FailureClass, ObservedTerminalStatus } from "./eval-observation.js";

export type FailureEvidence = {
  /** Terminal status the runtime reported. */
  terminalStatus: ObservedTerminalStatus;
  /** The behavioral evaluator's verdict for the objective. */
  objectiveLanded: boolean;
  /** Runtime-reported reason/status string, when present. */
  reportedReason?: string;
  /** Bounded error text from the run or its failing worker, when present. */
  errorText?: string;
  /** True when any worker/step was blocked specifically on a policy decision. */
  deniedByPolicy?: boolean;
  /** True when an approval was requested and never resolved before completion. */
  approvalUnresolved?: boolean;
  /** True when the planner rejected its own plan (invalid scope, shape, count). */
  plannerRejected?: boolean;
  /** True when the failure came from the harness, transport or environment. */
  infrastructureFault?: boolean;
  /** True when the objective review rejected the result (verification, not task). */
  verificationRejected?: boolean;
};

/** Phrases that identify a planner-contract failure in runtime text. */
const PLANNER_CONTRACT_MARKERS = [
  "coordination plan failed",
  "rejected plan",
  "explicit worker count",
  "cannot verify explicit",
  "unmappable dependency",
  "ownership claim",
  "invalid scope",
  "glob scope",
];

/** Phrases that identify infrastructure rather than product behaviour. */
const INFRASTRUCTURE_MARKERS = [
  "econnrefused",
  "enotfound",
  "socket hang up",
  "rate limit",
  "429",
  "402",
  "credit",
  "timed out connecting",
  "eai_again",
];

function matches(haystack: string, needles: readonly string[]): boolean {
  const text = haystack.toLowerCase();
  return needles.some(n => text.includes(n));
}

/**
 * Classify a non-successful scenario.
 *
 * Precedence is deliberate and reflects what is most actionable, and what must
 * NOT be attributed to model quality:
 *
 *   1. infrastructure  — the measurement itself is compromised
 *   2. planner-contract — the plan was invalid; model quality was never tested
 *   3. policy-denial   — correct refusal, not a failure
 *   4. approval-timeout — operator did not decide
 *   5. verification    — the objective review rejected the result
 *   6. task            — the runtime ran and genuinely did not meet the objective
 *   7. unknown         — no evidence; stays visible
 */
export function classifyFailure(evidence: FailureEvidence): FailureClass | null {
  if (evidence.objectiveLanded && evidence.terminalStatus === "completed") {
    return null; // success: no failure class
  }

  const text = `${evidence.reportedReason ?? ""} ${evidence.errorText ?? ""}`;

  if (evidence.infrastructureFault || matches(text, INFRASTRUCTURE_MARKERS)) {
    return "infrastructure";
  }
  if (evidence.plannerRejected || matches(text, PLANNER_CONTRACT_MARKERS)) {
    return "planner-contract";
  }
  if (evidence.deniedByPolicy) {
    return "policy-denial";
  }
  if (evidence.approvalUnresolved || evidence.terminalStatus === "timeout") {
    return "approval-timeout";
  }
  if (evidence.verificationRejected) {
    return "verification";
  }
  if (evidence.terminalStatus === "failed" || evidence.terminalStatus === "completed" || evidence.terminalStatus === "blocked") {
    // The runtime produced a terminal outcome that simply did not meet the
    // objective: a genuine task failure.
    return "task";
  }
  if (evidence.terminalStatus === "cancelled" && evidence.plannerRejected === undefined) {
    // A cancellation without planner evidence is still not evidence of a task
    // failure, but it must not vanish into `unknown` if nothing else explains it.
    return "unknown";
  }
  return "unknown";
}
