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
import { CONTEXT_EVENT_TYPES, payloadString } from "../../events/types.js";
import { buildExecutionContext } from "../../runtime/context/context-builder.js";
import type { NormalizedMessage } from "../../providers/types.js";
import type { AgentIntent } from "../intent-classifier.js";
import { RESEARCH_SUPPLEMENT } from "../../agent/system-prompt.js";
import {
  ExecutionStateEmitter,
  isExecutionStateEmitEnabled,
  isExecutionStateSendEnabled,
} from "../../runtime/execution-state/execution-state-emitter.js";

/** Session log identity shared by the emitter helpers (log + sessionId travel together). */
export type SessionLogRef = Readonly<{
  log: EventLog;
  sessionId: string;
}>;

/** Create the session-level emitter, or null when the flag is off. */
export function createExecutionStateEmitter(args: SessionLogRef & {
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
export async function initExecutionStateEmission(args: SessionLogRef & {
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
    const artifactId = payloadString(e.payload, "artifactId");
    const path = payloadString(e.payload, "path");
    if (!artifactId || !path) continue;
    const kind = payloadString(e.payload, "mimeType");
    await emitter.registerArtifact({ artifactId, uri: path, ...(kind ? { kind } : {}) });
  }
}

/**
 * Build the bounded P+Σ+O+E+Tools shadow prompt for one invocation and record
 * the token delta against the live admitted request. The shadow prompt is
 * never sent to the provider. Fail-soft — measurement must never break the
 * loop. No-op when the emitter is null or holds no state yet.
 */export async function emitTurnShadow(args: {
  emitter: ExecutionStateEmitter | null;
  log: EventLog;
  sessionId: string;
  invocationId: string;
  objective: string;
  tools: ReadonlyArray<{ name: string; description?: string }>;
  liveAdmittedTokens: number;
}): Promise<void> {
  const { emitter, log } = args;
  if (!emitter) return;
  try {
    const state = emitter.getState();
    if (!state) return;
    const built = buildExecutionContext(
      { name: "session-shadow", body: args.objective },
      state,
      null,
      null,
      args.tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
      })),
      { model: null },
    );
    await log.append({
      sessionId: args.sessionId,
      actor: "system",
      type: CONTEXT_EVENT_TYPES.SHADOW_ASSEMBLED,
      payload: {
        invocationId: args.invocationId,
        shadowPromptTokens: Math.ceil(built.prompt.length / 4),
        liveAdmittedTokens: args.liveAdmittedTokens,
        bounded: built.metadata.bounded,
      },
    });
  } catch {
    // Shadow measurement must never break the loop.
  }
}

/**
 * Live-send request (opt-in ALIX_EXECUTION_STATE_SEND, research route only).
 *
 * Returns the state-built prompt as the provider system prompt plus a minimal
 * single-message array carrying the current task cue — P+Σ+O+E with no
 * history (prior user turns ride as bounded top-2 evidence). Null unless the send flag is on, the intent is
 * research (read-only first), and the emitter holds a state.
 *
 * Accuracy bar (process gate, not code): parity ±2pp on the proxy eval and no
 * route-test regression, else revert. The skill is the static research
 * supplement (tracer-grade placeholder, not a product prompt).
 */
export function buildLiveSendRequest(args: {
  emitter: ExecutionStateEmitter | null;
  intent: AgentIntent | undefined;
  objective: string;
  tools: ReadonlyArray<{ name: string; description?: string }>;
  messages: readonly NormalizedMessage[];
}): { systemPrompt: string; messages: NormalizedMessage[] } | null {
  if (!isExecutionStateSendEnabled()) return null;
  if (args.intent !== "research") return null;
  const state = args.emitter?.getState() ?? null;
  if (!state) return null;
  let taskCue = args.objective;
  const evidence: Array<{ content: string; kind: string }> = [];
  for (let idx = args.messages.length - 1; idx >= 0; idx--) {
    const m = args.messages[idx]!;
    if (m.role !== "user" || typeof m.content !== "string" || m.content.trim().length === 0) continue;
    if (taskCue === args.objective) {
      taskCue = m.content;
      continue;
    }
    // Prior user turns become bounded supporting evidence (top-2, latest
    // first in collection order, reversed to chronological on render).
    if (evidence.length < 2) evidence.push({ content: m.content, kind: "prior_turn" });
  }
  const built = buildExecutionContext(
    { name: "research", body: RESEARCH_SUPPLEMENT },
    state,
    taskCue,
    evidence.reverse().map((e, i) => ({ id: `prior-${i + 1}`, ...e })),
    args.tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
    })),
    { model: null },
  );
  return {
    systemPrompt: built.prompt,
    messages: [{ role: "user", content: taskCue }],
  };
}
