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
