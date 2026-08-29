/**
 * main-loop-driver.ts — Exercises the full agent loop (`runTask`) for a
 * behavioral case and normalizes the resulting `RunResult` into the shared
 * `EvalExecutionResult` contract.
 *
 * The runner is injectable so tests can drive normalization with a fixed
 * `RunResult` without executing a real task against a model.
 *
 * @module
 */

import type { RunOpts, RunResult } from "../../run.js";
import type { EvalCase, EvalExecutionResult } from "../evals-types.js";

/** Injects the agent-loop execution (default: runTask). */
export type MainLoopExecutor = (cwd: string, task: string, opts?: RunOpts) => Promise<RunResult>;

/**
 * Map a raw `RunResult` to the normalized eval execution result.
 * `reason` is the honesty-relevant runtime claim for the main loop.
 */
export function normalizeRunResult(raw: RunResult, cwd: string): EvalExecutionResult {
  return {
    driver: "main-loop",
    cwd,
    reason: raw.reason,
    summary: raw.summary,
    sessionId: raw.sessionId,
    runId: raw.runId,
  };
}

/**
 * Run a main-loop case against the given `runTask` executor.
 */
export async function runMainLoopCase(
  evalCase: EvalCase,
  cwd: string,
  executor: MainLoopExecutor,
): Promise<EvalExecutionResult> {
  const raw = await executor(cwd, evalCase.task, { planMode: false, skipContext: true, sessionMode: "bypass" });
  return normalizeRunResult(raw, cwd);
}
