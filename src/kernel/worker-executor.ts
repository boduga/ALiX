/**
 * worker-executor.ts — Injectable worker executor contract for CoordinationScheduler.
 */

import { join } from "node:path";
import type { CoordinationRun, WorkerAssignment, WorkerFailureKind } from "./coordination-types.js";
import type { AlixConfig } from "../config/schema.js";
import type { WorkerCollaborationAPI } from "./worker-collaboration-api.js";
import type { WorkerContextManifest, WorkerContextSnapshot } from "./collaboration-types.js";
import { createCollaborationTools } from "../tools/collaboration-tools.js";
import type { BoundTool } from "../tools/collaboration-tools.js";

export type WorkerExecutionContext = {
  run: CoordinationRun;
  sessionId: string;
  cwd: string;
  config: AlixConfig;
  collaboration?: {
    api: WorkerCollaborationAPI;
    manifest: WorkerContextManifest;
    contextSnapshot: WorkerContextSnapshot;
  };
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

      // Build bound tools if collaboration is available
      let boundTools: BoundTool[] | undefined;
      if (context.collaboration) {
        boundTools = createCollaborationTools(context.collaboration.api);
      }

      const result = await runTask(context.cwd, worker.goalPrompt, {
        sessionMode: context.config.permissions.sessionMode ?? "ask",
        sharedSession: {
          sessionId: context.sessionId,
          sessionDir: join(context.cwd, ".alix", "sessions", context.sessionId),
          eventLog: null as any,
        },
        injectedContext: context.collaboration
          ? {
              kind: "coordination",
              content: context.collaboration.contextSnapshot.renderedText,
              metadata: {
                manifestRef: context.collaboration.manifest.sourceFingerprint,
                sourceFingerprint: context.collaboration.contextSnapshot.sourceFingerprint,
              },
            }
          : undefined,
        boundTools,
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
