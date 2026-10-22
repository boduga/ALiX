import type { EventLog } from "../../runtime-state/events/event-log.js";
import type { AlixEvent, NewEvent } from "../../runtime-state/events/types.js";
import type { WorkerAssignment } from "./coordination-types.js";
import type { WorkerExecutionContext, WorkerExecutionResult } from "./worker-executor.js";
import type { RunResult } from "../../run.js";
import { deriveCoordinationChangedFiles, toCoordinationEvidenceEvents } from "./coordination-evidence.js";
import { reviewCoordinationResult, type ObjectiveArtifact } from "../../agents/coordination-objective-review.js";
import { createModelResolver } from "../../operations/config/model-resolver.js";
import { createProvider } from "../../models/providers/registry.js";
import { getApiKey } from "../../governance/security/credentials/api-keys.js";
import { createToolExecutor } from "../../capabilities/tools/tool-executor-factory.js";
import { loadApprovalStore } from "../../governance/approvals/approval-store.js";
import { toolResultText } from "../../capabilities/tools/result-text.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isWithinOwnedScope } from "../ownership/path-scope.js";
import { ownedPathsForWorker } from "./worker-role.js";

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
  // Durable evidence: the run's shared session log outlives ONE attempt, so a
  // retry whose deliverable was already written keeps its proof. Re-creating
  // identical content emits NO mutation event (the router returns
  // `changed: false` before it writes), so without the durable set a correct
  // retry is reviewed with an empty evidence set and fails. Scope stays the
  // worker's OWNED paths, so a sibling's artifact is never its evidence.
  const allEvents = [...await readDurableEvents(log), ...events];
  const mutationEvents = toCoordinationEvidenceEvents(allEvents);
  const ownedPaths = ownedPathsForWorker(worker);
  const mutatedPaths = deriveCoordinationChangedFiles({ events: mutationEvents }, { cwd: context.cwd })
    .filter(path => isWithinOwnedScope(resolve(context.cwd, path), ownedPaths, context.cwd));

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
  const approvalStore = await loadApprovalStore(context.cwd);
  // Internal verification reads only the owned mutation set above. Keep hard
  // read denials and all path checks; an ask policy must not mint an orphaned
  // approval and turn a correct worker into a retry.
  const permissions = context.config.permissions;
  const config = { ...context.config, permissions: { ...permissions, tools: {
    ...permissions.tools,
    "file.read": (permissions.tools["file.read"] ?? permissions.default) === "deny" ? "deny" as const : "allow" as const,
  } } };
  const executor = createToolExecutor({ config, log, root: context.cwd, approvalStore });
  const readForReview = async (path: string): Promise<Awaited<ReturnType<typeof executor.execute>>> =>
    executor.execute({
      toolCallId: randomUUID(),
      name: "file.read",
      args: { path },
      signal,
      source: "tool",
    } as never);
  const artifacts = async (): Promise<ObjectiveArtifact[]> => Promise.all(mutatedPaths.map(async path => {
    if (signal.aborted) return { path, error: "Execution cancelled" };
    const read = await readForReview(path);
    if (read.kind === "success") return { path, content: toolResultText(read) };
    const deleted = allEvents.some(event => event.type === "file.deleted" && (event.payload as { path?: string }).path === path);
    if (deleted) {
      const exists = await executor.execute({ toolCallId: randomUUID(), name: "file.exists", args: { path }, signal });
      if (exists.kind === "success" && exists.exists === false) return { path, exists: false };
    }
    return { path, error: read.kind === "denied" ? read.reason : read.kind === "error" ? read.message : "Output unavailable" };
  }));
  const reviewed = await reviewCoordinationResult({
    result: { id: worker.id, role: "worker", status: "success", findings: [{ type: "summary", content: result.summary, confidence: "medium" }], events: [] },
    // Judge against the worker's ASSIGNED objective, not the rendered prompt.
    // The rendered prompt embeds "## Original coordination objective" — the root
    // goal across ALL workers — so a worker owning docs/b.md was rejected for not
    // also creating docs/a.md and docs/c.md. Verified on real gpt-4o runs: the
    // reviewer saw the composite goal and correctly failed a correct worker.
    objective: worker.goalPrompt, mutatedPaths, evidence, provider, readArtifacts: artifacts, signal,
  });
  if (signal.aborted) return { outcome: "failure", failureKind: "cancelled", error: "Execution cancelled" };
  const summary = reviewed.findings.map(finding => `[${finding.type}] ${finding.content}`).join("\n");
  return reviewed.status === "success"
    ? { outcome: "success", summary, outputPath: result.sessionId }
    : { outcome: "failure", failureKind: "execution_error", summary, outputPath: result.sessionId, error: reviewed.error };
}

/** Durable session events. An unreadable log yields none, never a failed review. */
async function readDurableEvents(log: EventLog): Promise<readonly AlixEvent[]> {
  try { return await log.readAll(); } catch { return []; }
}
