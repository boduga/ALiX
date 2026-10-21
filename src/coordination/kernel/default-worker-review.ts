import type { EventLog } from "../../runtime-state/events/event-log.js";
import type { AlixEvent, NewEvent } from "../../runtime-state/events/types.js";
import type { WorkerAssignment } from "./coordination-types.js";
import type { WorkerExecutionContext, WorkerExecutionResult } from "./worker-executor.js";
import type { RunResult } from "../../run.js";
import { deriveCoordinationChangedFiles } from "./coordination-evidence.js";
import { reviewCoordinationResult, type ObjectiveArtifact } from "../../agents/coordination-objective-review.js";
import { createModelResolver } from "../../operations/config/model-resolver.js";
import { createProvider } from "../../models/providers/registry.js";
import { getApiKey } from "../../governance/security/credentials/api-keys.js";
import { createToolExecutor } from "../../capabilities/tools/tool-executor-factory.js";
import { loadApprovalStore } from "../../governance/approvals/approval-store.js";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
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
  const fromEvents = deriveCoordinationChangedFiles({ events: mutationEvents }, { cwd: context.cwd });

  // Scope the review to THIS worker's owned paths.
  //
  // Workers share one session event log, so the capture also sees a SIBLING's
  // `file.created`. Unscoped, worker 1's review was told "Changed: docs/b.md,
  // docs/c.md" and then rejected it for "Missing docs/a.md" — its own file,
  // which it had written. Under concurrency the capture can also be empty for a
  // later worker, producing `mutatedPaths: []` and a bare "not verified".
  //
  // Filtering by owned scope fixes both. But the fallback must NOT be the scope
  // itself: `ownershipScopes: ['reports/']` is a permission boundary, not a
  // deliverable, and a research worker with no writes would then be rejected for
  // "Cannot verify persisted output reports/". So the fallback admits only owned
  // entries that resolve to an actual FILE on disk.
  const ownedScope = [...new Set([...worker.ownershipClaims.map(c => c.path), ...worker.ownershipScopes])];
  const coveredBy = (path: string): boolean => ownedScope.length === 0 || ownedScope.some(owned => {
    const oc = resolve(context.cwd, owned);
    const pc = resolve(context.cwd, path);
    return pc === oc || pc.startsWith(oc.endsWith("/") ? oc : `${oc}/`) || oc === resolve(context.cwd, ".");
  });
  const scopedEvents = fromEvents.filter(coveredBy);
  let mutatedPaths = scopedEvents;
  if (mutatedPaths.length === 0 && ownedScope.length > 0) {
    // Only owned entries that are real files can be a persisted deliverable.
    const existing: string[] = [];
    for (const owned of ownedScope) {
      if (owned.endsWith("/")) continue;
      try {
        const info = await stat(resolve(context.cwd, owned));
        if (info.isFile()) existing.push(owned);
      } catch { /* not present: not a deliverable */ }
    }
    mutatedPaths = existing;
  }
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
