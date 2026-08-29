/**
 * delegate-driver.ts — Exercises the Matrix-G delegate runtime
 * (`SubagentManager.spawn`) for a behavioral case and normalizes the
 * resulting `SubagentResult` into the shared `EvalExecutionResult` contract.
 *
 * The executor is injectable so tests can drive normalization with a fixed
 * `SubagentResult` without spawning a real subprocess model. The default
 * executor spawns a real `alix run --subagent` subprocess in the eval cwd,
 * passing the case's scripted scenario via env so the registered scripted
 * provider drives deterministic filesystem mutations in the child.
 *
 * @module
 */

import type { AlixConfig, SubagentResult, SubagentTask } from "../../config/schema.js";
import type { EvalCase, EvalExecutionResult } from "../evals-types.js";

/** Injects the delegate execution (default: SubagentManager.spawn). */
export type DelegateExecutor = (
  task: SubagentTask,
  cwd: string,
  scenarioJson?: string,
) => Promise<SubagentResult>;

/**
 * Map a raw `SubagentResult` to the normalized eval execution result.
 * `status` is the honesty-relevant runtime claim.
 */
export function normalizeSubagentResult(raw: SubagentResult, cwd: string): EvalExecutionResult {
  return {
    driver: "delegate",
    cwd,
    status: raw.status,
    sessionId: raw.id,
    findings: raw.findings,
    error: raw.error,
  };
}

/**
 * The default delegate executor: spawns a real subagent subprocess via
 * `SubagentManager.spawn`, isolated to the eval `cwd` with the scripted
 * scenario transported through the child environment.
 */
export function createSubagentExecutor(
  config: AlixConfig,
  opts?: { sessionId?: string },
): DelegateExecutor {
  return async (task, cwd, scenarioJson) => {
    const { SubagentManager } = await import("../../agents/subagent-manager.js");
    const manager = new SubagentManager({
      sessionId: opts?.sessionId ?? `eval-${task.id}`,
      config,
    });
    try {
      return await manager.spawn({
        ...task,
        cwd,
        scriptedScenarioJson: scenarioJson,
      });
    } finally {
      manager.shutdown();
    }
  };
}

/**
 * Run a delegate case against the given `SubagentTask` executor.
 */
export async function runDelegateCase(
  evalCase: EvalCase,
  cwd: string,
  executor: DelegateExecutor,
): Promise<EvalExecutionResult> {
  const task: SubagentTask = {
    id: `eval-${evalCase.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    role: "worker",
    prompt: evalCase.task,
    mode: "write",
    ownedPaths: evalCase.ownedPaths?.length ? evalCase.ownedPaths : ["."],
    contextBundle: `eval:${evalCase.id}`,
  };
  const scenarioJson = evalCase.scenario ? JSON.stringify(evalCase.scenario) : undefined;
  const raw = await executor(task, cwd, scenarioJson);
  return normalizeSubagentResult(raw, cwd);
}
