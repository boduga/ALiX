/**
 * subagent-worker-executor.ts — Coordination workers as subagent processes.
 *
 * The unification seam: implements CoordinationWorkerExecutor on top of
 * SubagentManager instead of in-process runTask. One worker = one
 * SubagentTask child process, so parallel coordination runs and parallel
 * delegate fan-out share dispatch, ownership, lifecycle, tiers, and
 * session-mode propagation.
 *
 * Role mapping (from declared capabilities):
 * - any write capability (filesystem.write, file.create/delete,
 *   patch.apply, shell.exec/run) → `worker` (write) with ownedPaths taken
 *   from ownership claims/scopes.
 * - web.search/fetch (no write) → `researcher` (read-only).
 * - anything else → `explorer` (read-only).
 *
 * Result mapping: success/partial → success (findings text becomes the
 * summary, partial prefixed — mirrors the delegate boundary);
 * failed/rejected/crash → failure. Cancellation aborts via manager.cancel().
 */

import { randomUUID } from "node:crypto";
import { SubagentManager } from "../agents/subagent-manager.js";
import type { SubagentRole, SubagentTask, AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import type { WorkerAssignment } from "./coordination-types.js";
import type {
  CoordinationWorkerExecutor,
  WorkerExecutionContext,
  WorkerExecutionResult,
} from "./worker-executor.js";

const WRITE_CAPABILITIES = new Set([
  "filesystem.write",
  "file.create",
  "file.delete",
  "patch.apply",
  "shell.exec",
  "shell.run",
]);

const RESEARCH_CAPABILITIES = new Set(["web.search", "web.fetch"]);

export function roleForWorker(worker: Pick<WorkerAssignment, "requiredCapabilities">): SubagentRole {
  const caps = worker.requiredCapabilities ?? [];
  if (caps.some(c => WRITE_CAPABILITIES.has(c))) return "worker";
  if (caps.some(c => RESEARCH_CAPABILITIES.has(c))) return "researcher";
  return "explorer";
}

/** Owned paths for a write worker: exact claim paths first, then scopes. */
export function ownedPathsForWorker(
  worker: Pick<WorkerAssignment, "ownershipScopes"> & {
    ownershipClaims?: Array<{ path: string }>;
  },
): string[] {
  const paths = [
    ...(worker.ownershipClaims ?? []).map(c => c.path),
    ...(worker.ownershipScopes ?? []),
  ].filter(p => typeof p === "string" && p.length > 0);
  return [...new Set(paths)];
}

export function taskForWorker(
  worker: WorkerAssignment,
  sessionId: string,
  cwd: string,
): SubagentTask {
  const role = roleForWorker(worker);
  const mode = role === "worker" ? ("write" as const) : ("read_only" as const);
  const ownedPaths = role === "worker" ? ownedPathsForWorker(worker) : undefined;
  const prompt = ownedPaths?.length
    ? `${worker.goalPrompt}\n\nOwned paths (write only inside these): ${ownedPaths.join(", ")}`
    : worker.goalPrompt;
  return {
    id: worker.id,
    role,
    mode,
    prompt,
    ownedPaths,
    contextBundle: sessionId,
    cwd,
  };
}

export function summaryForResult(result: {
  status: string;
  findings: Array<{ type: string; content: string }>;
  error?: string;
}): string {
  const body = result.findings.map(f => `[${f.type}] ${f.content}`).join("\n") || "(no findings)";
  return result.status === "partial"
    ? `[partial] ${result.error ?? "delegated objective incomplete"}\n\n${body}`
    : body;
}

export type SubagentWorkerExecutorOptions = {
  sessionId?: string;
  config?: AlixConfig;
  eventLog?: EventLog;
  /** Injected manager (tests use spawnOverride; production omits it). */
  manager?: SubagentManager;
};

export class SubagentWorkerExecutor implements CoordinationWorkerExecutor {
  private readonly manager: SubagentManager;

  constructor(private readonly options: SubagentWorkerExecutorOptions = {}) {
    this.manager =
      options.manager ??
      new SubagentManager({
        sessionId: options.sessionId ?? `coord-sub-${Date.now()}`,
        config: options.config,
        eventLog: options.eventLog,
      });
  }

  /** Exposed for shutdown/cancel wiring by hosts. */
  get subagentManager(): SubagentManager {
    return this.manager;
  }

  async execute(
    worker: WorkerAssignment,
    context: WorkerExecutionContext,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult> {
    if (signal.aborted) {
      return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled before start" };
    }
    const task = taskForWorker(worker, context.sessionId, context.cwd);
    const taskId = task.id || randomUUID();
    const onAbort = (): void => {
      this.manager.cancel(taskId);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await this.manager.spawn({ ...task, id: taskId });
      if (signal.aborted) {
        return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
      }
      if (result.status === "success" || result.status === "partial") {
        return { outcome: "success", summary: summaryForResult(result), outputPath: result.id };
      }
      return {
        outcome: "failure",
        failureKind: "execution_error",
        error: result.error ?? `Subagent ${result.status}`,
      };
    } catch (err) {
      if (signal.aborted) {
        return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
      }
      return {
        outcome: "failure",
        failureKind: "execution_error",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
