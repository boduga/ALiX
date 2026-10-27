/**
 * worker-executor.ts — Injectable worker executor contract for CoordinationScheduler.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { CoordinationRun, WorkerAssignment, WorkerFailureKind } from "./coordination-types.js";
import type { AlixConfig } from "../../operations/config/schema.js";
import type { EventLog } from "../../runtime-state/events/event-log.js";
import type { WorkerCollaborationAPI } from "./worker-collaboration-api.js";
import type { WorkerContextManifest, WorkerContextSnapshot } from "./collaboration-types.js";
import { createCollaborationTools } from "../../capabilities/tools/collaboration-tools.js";
import type { BoundTool } from "../../capabilities/tools/collaboration-tools.js";
import { renderWorkerExecutionPrompt, type WorkerDependencyResult } from "./coordination-worker-context.js";
import { captureWorkerEventLog, reviewDefaultWorkerResult } from "./default-worker-review.js";
import { isWriteWorker, ownedPathsForWorker } from "./worker-role.js";
import { createToolExecutor } from "../../capabilities/tools/tool-executor-factory.js";
import type { ApprovalStore } from "../../governance/approvals/approval-store.js";

export type WorkerExecutionContext = {
  run: CoordinationRun;
  sessionId: string;
  cwd: string;
  config: AlixConfig;
  dependencyResults?: WorkerDependencyResult[];
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
  approvalId?: string;
};

export interface CoordinationWorkerExecutor {
  execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult>;
}

/**
 * Lazily initialize a real EventLog for the shared worker session.
 * Previously `null` was passed and every worker crashed on the first
 * `eventLog.append` ("Cannot read properties of null"). The log lives
 * under the shared session dir so worker turns stay inspectable.
 * Initializations are cached per session dir: parallel workers sharing
 * one session would otherwise race mkdir/init on the same files.
 */
const sharedEventLogs = new Map<string, Promise<EventLog>>();

async function initSharedEventLog(cwd: string, sessionId: string): Promise<EventLog> {
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  let pending = sharedEventLogs.get(sessionDir);
  if (!pending) {
    pending = (async (): Promise<EventLog> => {
      const { EventLog } = await import("../../runtime-state/events/event-log.js");
      await mkdir(sessionDir, { recursive: true });
      const log = new EventLog(sessionDir);
      await log.init();
      return log as EventLog;
    })();
    sharedEventLogs.set(sessionDir, pending);
    pending.catch(() => {
      if (sharedEventLogs.get(sessionDir) === pending) sharedEventLogs.delete(sessionDir);
    });
  }
  return pending;
}

/**
 * DefaultWorkerExecutor — concrete implementation that delegates to runTask()
 * for each worker execution. Passes through the AbortSignal for cancellation.
 *
 * Used by the CLI foreground mode and as the default executor when no
 * custom executor is injected into CoordinationScheduler.
 */
export class DefaultWorkerExecutor implements CoordinationWorkerExecutor {
  /**
   * The AUTHORITATIVE approval store, injected from the coordination host.
   *
   * Two authorization boundaries share it and neither bypasses the other:
   * the scheduler authorizes worker DISPATCH and its required capabilities,
   * while the worker's own ToolExecutor re-evaluates each actual tool call and
   * mints a durable tool-level approval when policy asks. A dispatch approval
   * for `filesystem.write` therefore never authorizes writing an arbitrary path
   * with arbitrary content.
   *
   * One store instance serves both boundaries — no second approval authority.
   * Omitted only when the host has none, in which case gated tool calls fail
   * closed exactly as before.
   */
  constructor(private readonly approvalStore?: ApprovalStore) {}

  async execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult> {
    const ownedPaths = isWriteWorker(worker) ? ownedPathsForWorker(worker) : undefined;
    if (isWriteWorker(worker) && !ownedPaths?.length) {
      return {
        outcome: "failure",
        failureKind: "authorization_denied",
        error: "Write worker has no valid owned paths",
      };
    }
    try {
      const { runTask } = await import("../../run.js");

      // Build bound tools if collaboration is available
      let boundTools: BoundTool[] | undefined;
      if (context.collaboration) {
        boundTools = createCollaborationTools(context.collaboration.api);
      }

      const captured = captureWorkerEventLog(await initSharedEventLog(context.cwd, context.sessionId));
      const toolEvidence: string[] = [];
      const { scriptedScenarioFromEnv, withScriptedScenario, traceScriptedEval } = await import("../../operations/evals/providers/scripted-mock-carrier.js");
      const runWorker = () => runTask(context.cwd, renderWorkerExecutionPrompt(worker, context), {
        signal,
        onToolResult: (name, content) => { toolEvidence.push(`Tool ${name}:\n${content}`); },
        sessionMode: context.config.permissions.sessionMode ?? "ask",
        sharedSession: {
          sessionId: context.sessionId,
          sessionDir: join(context.cwd, ".alix", "sessions", context.sessionId),
          eventLog: captured.log,
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
        ...(ownedPaths ? { ownedPaths } : {}),
        // Tool-level authorization boundary: the worker's own PolicyGate mints
        // durable approvals against the SAME store the scheduler uses, so a
        // gated tool call can pause the worker and resume it exactly once after
        // an operator decision. Omitted when the host has no store, preserving
        // the previous fail-closed behaviour.
        ...(this.approvalStore ? { approvalStore: this.approvalStore } : {}),
      });
      const scenario = context.config.models?.default?.provider === "scripted-mock"
        ? scriptedScenarioFromEnv() : null;
      traceScriptedEval({ event: "worker", workerId: worker.id, provider: context.config.models?.default?.provider ?? "unset", scenarioLoaded: !!scenario });
      if (process.env.ALIX_EVAL_TRACE === "1") {
        process.stderr.write(`[scripted-eval] worker=${worker.id} pid=${process.pid} provider=${context.config.models?.default?.provider ?? "unset"} scenario=${scenario ? "loaded" : "absent"}\n`);
      }
      const result = scenario ? await withScriptedScenario(scenario, runWorker) : await runWorker();

      if (signal.aborted) {
        return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
      }

      // A paused tool is not a failed worker, and cannot lose its scope on resume.
      const { bindWorkerToolContinuation } = await import("./worker-tool-continuation.js");
      const approvalId = await bindWorkerToolContinuation(context.sessionId, worker, captured.events, () =>
        createToolExecutor({ config: context.config, log: captured.log, root: context.cwd, approvalStore: this.approvalStore }));
      if (approvalId) {
        return { outcome: "failure", failureKind: "approval_required", approvalId,
          error: `Tool approval required: ${approvalId}` };
      }

      if (result.reason !== "completed") {
        return {
          outcome: "failure", failureKind: "execution_error",
          summary: result.summary, outputPath: result.sessionId,
          error: `Worker execution did not complete (${result.reason ?? "missing completion reason"}): ${result.summary}`,
        };
      }

      return await reviewDefaultWorkerResult(worker, context, result, captured.events, captured.log, signal, toolEvidence);
    } catch (error) {
      if (signal.aborted) {
        return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
      }
      return {
        outcome: "failure",
        failureKind: "execution_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
