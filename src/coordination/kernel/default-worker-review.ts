import type { EventLog } from "../../runtime-state/events/event-log.js";
import type { AlixEvent, NewEvent } from "../../runtime-state/events/types.js";
import type { WorkerAssignment } from "./coordination-types.js";
import type { WorkerExecutionContext, WorkerExecutionResult } from "./worker-executor.js";
import type { RunResult } from "../../run.js";
import { deriveCoordinationChangedFiles } from "./coordination-evidence.js";
import { renderWorkerExecutionPrompt } from "./coordination-worker-context.js";
import { reviewCoordinationResult, type ObjectiveArtifact } from "../../agents/coordination-objective-review.js";
import { createModelResolver } from "../../operations/config/model-resolver.js";
import { createProvider } from "../../models/providers/registry.js";
import { getApiKey } from "../../governance/security/credentials/api-keys.js";
import { createToolExecutor } from "../../capabilities/tools/tool-executor-factory.js";
import { loadApprovalStore } from "../../governance/approvals/approval-store.js";
import { toolResultText } from "../../capabilities/tools/result-text.js";
import { randomUUID } from "node:crypto";

/** Capture only appends made through this invocation, while sharing durable storage. */
export function captureWorkerEventLog(log: EventLog): { log: EventLog; events: AlixEvent[] } {
  const events: AlixEvent[] = [];
  const captured = new Proxy(log, {
    get(target, property) {
      if (property === "append") return async (event: NewEvent): Promise<AlixEvent> => {
        const appended = await target.append(event);
        events.push(appended);
        return appended;
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { log: captured, events };
}

export async function reviewDefaultWorkerResult(
  worker: WorkerAssignment, context: WorkerExecutionContext, result: RunResult,
  events: readonly AlixEvent[], log: EventLog, signal: AbortSignal,
  evidence: readonly string[] = [],
): Promise<WorkerExecutionResult> {
  if (signal.aborted) return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
  const mutationEvents = events.map(event => ({
    type: event.type,
    payload: event.type === "patch.changed_files"
      ? { paths: (event.payload as { changedFiles?: unknown }).changedFiles }
      : event.payload as { path?: unknown; paths?: unknown; files?: unknown },
  }));
  const mutatedPaths = deriveCoordinationChangedFiles({ events: mutationEvents }, { cwd: context.cwd });
  let provider;
  try {
    const model = createModelResolver(context.config).require("critic");
    provider = await createProvider(model, await getApiKey(model.provider));
  } catch (error) {
    return {
      outcome: "failure", failureKind: "execution_error", summary: result.summary, outputPath: result.sessionId,
      error: `Objective review unavailable: ${error instanceof Error ? error.message : String(error)}${mutatedPaths.length ? `\nChanged: ${mutatedPaths.join(", ")}` : ""}`,
    };
  }
  // R1.5: wire the project approval store (fail-open) so this executor is
  // governed like the other three construction sites.
  const approvalStore = await loadApprovalStore(context.cwd);
  const executor = createToolExecutor({ config: context.config, log, root: context.cwd, approvalStore });
  const artifacts = async (): Promise<ObjectiveArtifact[]> => Promise.all(mutatedPaths.map(async path => {
    if (signal.aborted) return { path, error: "Execution cancelled" };
    const read = await executor.execute({ toolCallId: randomUUID(), name: "file.read", args: { path }, signal });
    if (read.kind === "success") return { path, content: toolResultText(read) };
    const deleted = events.some(event => event.type === "file.deleted" && (event.payload as { path?: string }).path === path);
    if (deleted) {
      const exists = await executor.execute({ toolCallId: randomUUID(), name: "file.exists", args: { path }, signal });
      if (exists.kind === "success" && exists.exists === false) return { path, exists: false };
    }
    return { path, error: read.kind === "denied" ? read.reason : read.kind === "error" ? read.message : "Output unavailable" };
  }));
  const reviewed = await reviewCoordinationResult({
    result: { id: worker.id, role: "worker", status: "success", findings: [{ type: "summary", content: result.summary, confidence: "medium" }], events: [] },
    objective: renderWorkerExecutionPrompt(worker, context), mutatedPaths, evidence, provider, readArtifacts: artifacts, signal,
  });
  if (signal.aborted) return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
  const summary = reviewed.findings.map(finding => `[${finding.type}] ${finding.content}`).join("\n");
  return reviewed.status === "success"
    ? { outcome: "success", summary, outputPath: result.sessionId }
    : { outcome: "failure", failureKind: "execution_error", summary, outputPath: result.sessionId, error: reviewed.error };
}
