/**
 * Opt-in governed execution-state emission phase (issue #616 follow-up).
 *
 * Seeds the session's `ExecutionState` (genesis + objective) through the
 * `ExecutionStateEmitter` when `ALIX_EXECUTION_STATE_EMIT=1`, and reconciles
 * turn-created artifacts into it afterwards. Inert otherwise; fail-soft —
 * the emitter never throws into `runTaskLoop` or the session turn.
 */

import type { EventLog } from "../../events/event-log.js";
import type { EventLogCursor } from "../../events/event-log.js";
import {
  ExecutionStateEmitter,
  isExecutionStateEmitEnabled,
} from "../../runtime/execution-state/execution-state-emitter.js";

/** Create the session-level emitter, or null when the flag is off. */
export function createExecutionStateEmitter(args: {
  log: EventLog;
  sessionId: string;
  /** Snapshot store dir override (tests). Defaults to ALIX_EXECUTION_STATE_DIR / .alix/executions. */
  storeDir?: string;
}): ExecutionStateEmitter | null {
  if (!isExecutionStateEmitEnabled()) return null;
  return new ExecutionStateEmitter({
    log: args.log,
    sessionId: args.sessionId,
    executionId: args.sessionId,
    ...(args.storeDir ? { storeDir: args.storeDir } : {}),
  });
}

/**
 * Bootstrap + set the objective for the current run. Uses the caller-provided
 * session emitter when present so post-loop reconciliation shares the
 * instance; otherwise creates one (or stays inert when the flag is off).
 */
export async function initExecutionStateEmission(args: {
  log: EventLog;
  sessionId: string;
  objective: string;
  existing?: ExecutionStateEmitter | null;
  storeDir?: string;
}): Promise<ExecutionStateEmitter | null> {
  const emitter = args.existing ?? createExecutionStateEmitter(args);
  if (!emitter) return null;
  await emitter.bootstrap(args.objective);
  await emitter.setObjective(args.objective);
  return emitter;
}

/**
 * Register every `artifact.created` event appended since `cursor` as an
 * artifact in the governed state. Called once per turn in the session
 * `finally` so all exit paths (success / failure / cancel) converge. No-op
 * when the emitter is null; individual registration failures stay inside the
 * emitter (fail-soft) and cursor errors are swallowed.
 */
export async function reconcileTurnArtifacts(args: {
  emitter: ExecutionStateEmitter | null;
  log: EventLog;
  cursor: EventLogCursor | null;
}): Promise<void> {
  const { emitter, log, cursor } = args;
  if (!emitter || !cursor) return;
  let events: readonly { type: string; payload: unknown }[];
  try {
    events = (await log.readSince(cursor)).events;
  } catch {
    return;
  }
  for (const e of events) {
    if (e.type !== "artifact.created") continue;
    const p = (typeof e.payload === "object" && e.payload !== null
      ? (e.payload as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const artifactId = typeof p.artifactId === "string" ? p.artifactId : undefined;
    const path = typeof p.path === "string" ? p.path : undefined;
    if (!artifactId || !path) continue;
    const kind = typeof p.mimeType === "string" ? p.mimeType : undefined;
    await emitter.registerArtifact({ artifactId, uri: path, ...(kind ? { kind } : {}) });
  }
}
