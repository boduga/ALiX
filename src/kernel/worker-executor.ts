/**
 * worker-executor.ts — Injectable worker executor contract for CoordinationScheduler.
 */

import type { CoordinationRun, WorkerAssignment, WorkerFailureKind } from "./coordination-types.js";
import type { AlixConfig } from "../config/schema.js";

export type WorkerExecutionContext = {
  run: CoordinationRun;
  sessionId: string;
  cwd: string;
  config: AlixConfig;
};

export type WorkerExecutionResult = {
  outcome: "success" | "failure";
  summary?: string;
  outputPath?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
};

export interface CoordinationWorkerExecutor {
  execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult>;
}

/**
 * DefaultWorkerExecutor — concrete implementation that delegates to runTask()
 * for each worker execution. Passes through the AbortSignal for cancellation.
 *
 * Used by the CLI foreground mode and as the default executor when no
 * custom executor is injected into CoordinationScheduler.
 */
export class DefaultWorkerExecutor implements CoordinationWorkerExecutor {
  async execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult> {
    try {
      const { runTask } = await import("../run.js");
      const result = await runTask(context.cwd, worker.goalPrompt, {
        sessionMode: "auto",
        streaming: false,
      });

      if (signal.aborted) {
        return { outcome: "failure", failureKind: "timeout", error: "Execution cancelled" };
      }

      return {
        outcome: "success",
        summary: result.summary,
        outputPath: result.sessionId,
      };
    } catch (error) {
      if (signal.aborted) {
        return { outcome: "failure", failureKind: "timeout", error: "Execution cancelled" };
      }
      return {
        outcome: "failure",
        failureKind: "execution_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
