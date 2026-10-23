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
      /**
       * Expected content of `path`. Equality, not existence.
       *
       * An "unchanged" objective that only checks existence passes a REWRITTEN
       * file. A read-only stratum needs source equality to mean unchanged.
       */
      contentEquals?: string;
      /**
       * Other seeded files that must still hold exactly this content.
       *
       * The named `path` alone does not cover a seeded tree: a run can leave
       * `path` intact and rewrite its neighbours.
       */
      unchanged?: Record<string, string>;
      /**
       * Tokens the run's final report must contain.
       *
       * A read-only deliverable is an ANSWER, not a file. Without this the
       * objective passes when the agent reports nothing, or reports the wrong
       * fact. Tokens must be unambiguous (a distinctive value, not a digit that
       * occurs by chance) so a wrong answer cannot satisfy them.
       */
      answerIncludes?: string[];
    }
  | {
      /**
       * Composite objective: EVERY listed file must satisfy its own contract.
       *
       * Additive (stratum 4). It does not introduce a second scoring engine —
       * each entry is evaluated by the same `evaluateObjective` and the results
       * are ANDed, so a multi-file case is exactly "all of these single-file
       * objectives hold".
       */
      kind: "files";
      files: Array<{
        path: string;
        contentEquals?: string;
        contentIncludes?: string[];
        exists?: boolean;
      }>;
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
   * This case's `expected` block is written for the SCRIPTED provider only.
   *
   * Such a case tests a RUNTIME CONTRACT (refusal of a forbidden path, partial
   * completion, malformed-tool-call handling), not model capability. Its
   * `expected.objectiveLanded` is `false` because the scripted scenario is
   * authored to fail, so a real model that simply does the task is scored
   * `false` — not because it misbehaved, but because it did not replay the
   * scripted failure.
   *
   * Marking it here is load-bearing: five unmarked cases silently ran on real
   * models during the 2026-10-22 sweeps and consumed 52.7% of that budget while
   * being structurally incapable of producing a verified success. Real-provider
   * runs skip these by default.
   */
  scriptedExpectationOnly?: boolean;
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
  /**
   * Provider that actually executed this case, when known.
   *
   * Recorded so the stratum-9 CPU-only guard can decide from observed evidence
   * rather than from what the operator intended to configure. A run that
   * silently fell back to a remote provider must not be labelable CPU-only.
   */
  provider?: string;
  /**
   * True when the case carried a scripted scenario but a real provider ran it.
   * The scenario was deliberately NOT fed to the model (it is a deterministic
   * stand-in, not a prompt), so the resulting behaviour is the model's own.
   */
  scriptedScenarioIgnored?: boolean;
  /**
   * Provider-reported usage captured BEFORE the case cwd (and with it the
   * session log) is deleted.
   *
   * `null` means no `model.usage` event was observed — a deterministic case makes
   * no billable call — and must be read as unknown, never as a measured zero.
   * Pricing is applied elsewhere; this is tokens only.
   */
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    observed: boolean;
    records: Array<{
      runId?: string;
      provider?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
    }>;
  };
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
  /**
   * Provider the run was configured to use. `scripted-mock` by default; `ollama`
   * for a local CPU-only (stratum 9) observation.
   */
  provider?: string;
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
