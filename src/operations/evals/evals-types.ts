/**
 * evals-types.ts — Shared types for the behavioral / agentic eval suite.
 *
 * The suite independently answers "did ALiX do the right thing?" by comparing
 * evaluator-owned objective expectations against filesystem reality and the
 * runtime-reported status. The worker does not grade itself: objective truth
 * comes from the filesystem, status honesty is scored against an explicit
 * per-case contract.
 *
 * @module
 */

import type { ScriptedScenario } from "./providers/scripted-mock-provider.js";

/** Which runtime a case drives. */
export type EvalDriverKind = "delegate" | "main-loop";

/** Compiled-suite name (mirrors benchmark suites for CLI filtering). */
export type EvalSuite = "behavioral";

/**
 * A filesystem objective the evaluator can independently verify against the
 * eval's temporary `cwd`. All paths are scoped to that `cwd`; escaping paths
 * must be rejected.
 */
export type EvalObjective =
  | {
      kind: "file";
      path: string;
      exists: boolean;
      contentIncludes?: string[];
      contentEquals?: string;
    }
  | {
      kind: "patch";
      path: string;
      expectedContent: string;
    }
  | {
      kind: "replacement";
      path: string;
      expectedContent: string;
    }
  | {
      kind: "unchanged";
      path: string;
    };

/** Expected outcome contract for a single eval case. */
export type EvalExpected = {
  /** True if the objective is expected to have landed. */
  objectiveLanded: boolean;
  /** Set of runtime statuses considered honest for this case. */
  statuses: string[];
};

/** A single behavioral eval case. */
export type EvalCase = {
  /** Stable, kebab-case ID usable to compare across runs. */
  id: string;
  description: string;
  driver: EvalDriverKind;
  task: string;
  objective: EvalObjective;
  expected: EvalExpected;
  /**
   * The deterministic model behavior that drives this case. Replayed by the
   * scripted provider (in-process via the carrier for main-loop, or serialized
   * to the subagent env for delegate). Undefined for pure-evaluator fixtures.
   */
  scenario?: ScriptedScenario;
  /**
   * Initial files laid down in the case's isolated `cwd` before execution
   * (path scoped to `cwd`; parent directories are created). Used to seed
   * files that a patch / replacement case mutates.
   */
  seed?: Record<string, string>;
  /**
   * Subagent (delegate) "owned paths" that define the mutation contract for
   * Matrix-G status computation. Defaults to `["."]` (any in-cwd change counts
   * as covering ownership). Set multiple paths to exercise `partial` outcomes.
   * Ignored by the main-loop driver.
   */
  ownedPaths?: string[];
  /**
   * Evaluator self-test fixture override: when set, the case does NOT execute a
   * runtime driver. The runner emits an execution carrying this reported status
   * and scores honesty against `expected`. Used to prove the evaluator flags
   * dishonest status (synthetic false success / false failure), per §15.
   */
  syntheticStatus?: string;
};

/**
 * Structured evidence of how the objective was (or was not) met. Machine
 * readable so future reporting/comparison code can consume it directly.
 */
export type ObjectiveEvidence = {
  path?: string;
  exists?: boolean;
  changed?: boolean;
  expected?: {
    contentIncludes?: string[];
    contentEquals?: string;
  };
  actual?: {
    content?: string;
  };
  mismatches?: string[];
};

/** Result of evaluating an objective against the post-run filesystem. */
export type ObjectiveOutcome = {
  landed: boolean;
  evidence: ObjectiveEvidence;
};

/** Whether the runtime-reported status was honest per the case contract. */
export type StatusOutcome = {
  actual: string | undefined;
  expected: string[];
  honest: boolean;
};

/** Normalized representation the scoring engine consumes (driver-agnostic). */
export type EvalExecutionResult = {
  driver: EvalDriverKind;
  cwd: string;
  sessionId?: string;
  runId?: string;
  status?: string;
  reason?: string;
  summary?: string;
  findings?: unknown;
  error?: string;
};

/** Final per-case result, separating objective outcome from status outcome. */
export type EvalResult = {
  caseId: string;
  objective: ObjectiveOutcome;
  status: StatusOutcome;
  verdict: "pass" | "fail";
  execution: EvalExecutionResult;
};

/** A full persisted eval run. */
export type EvalRun = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  suite: EvalSuite;
  driver: EvalDriverKind | "both";
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    objectiveLanded: number;
    honest: number;
    durationMs: number;
  };
};
