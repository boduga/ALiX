import type { EventLog } from '../events/event-log.js';
import type { EventActor, TimelinePayload } from '../events/types.js';

/** Entry shape accepted by `appendLogEntry` — a timeline-surface log entry
 *  (sessionId + actor + kind + typed narrative payload). */
export interface LogEntryInput {
  readonly sessionId: string;
  readonly actor: EventActor;
  readonly type: string;
  readonly payload: TimelinePayload;
}

/**
 * Fire-and-forget `EventLog.append` with rejection swallowing. A log-write
 * failure (ENOSPC / EACCES) must never crash the TUI via an unhandled promise
 * rejection (Node >= 15); the rejection is caught and surfaced to stderr so
 * the operator sees it in `node alix tui` logs. Single shared emit path for
 * every fire-and-forget timeline append (app.ts, state.ts, invocation-presenter).
 */
export function appendLogEntry(eventLog: EventLog, entry: LogEntryInput): void {
  void eventLog.append(entry).catch((err) => {
    process.stderr.write(`[alix-tui] event log append failed: ${err instanceof Error ? err.message : String(err)}\n`);
  });
}
