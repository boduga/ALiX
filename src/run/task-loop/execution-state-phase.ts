/**
 * Opt-in governed execution-state emission phase (issue #616 follow-up).
 *
 * Seeds the session's `ExecutionState` (genesis + objective) through the
 * `ExecutionStateEmitter` when `ALIX_EXECUTION_STATE_EMIT=1`. Inert otherwise;
 * fail-soft — the emitter never throws into `runTaskLoop`.
 */

import type { EventLog } from "../../events/event-log.js";
import {
  ExecutionStateEmitter,
  isExecutionStateEmitEnabled,
} from "../../runtime/execution-state/execution-state-emitter.js";

/**
 * Bootstrap + set the objective for the current run. Returns the emitter for
 * later artifact/status wiring, or null when the flag is off.
 */
export async function initExecutionStateEmission(args: {
  log: EventLog;
  sessionId: string;
  objective: string;
}): Promise<ExecutionStateEmitter | null> {
  if (!isExecutionStateEmitEnabled()) return null;
  const emitter = new ExecutionStateEmitter({
    log: args.log,
    sessionId: args.sessionId,
    executionId: args.sessionId,
  });
  await emitter.bootstrap(args.objective);
  await emitter.setObjective(args.objective);
  return emitter;
}
