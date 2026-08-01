// src/tui/runtime/execution-trace.ts

/** What kind of execution a trace entry represents. */
export type ExecutionTraceKind = 'tool' | 'policy' | 'capability' | 'runtime';

/** Lifecycle state of an execution trace entry. */
export type ExecutionTraceStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Lifecycle status glyphs — shared by all ExecutionTrace consumers. */
export const STATUS_GLYPH: Record<ExecutionTraceStatus, string> = {
  running: '▶',
  completed: '✔',
  failed: '✗',
  cancelled: '○',
};

/**
 * One lifecycle unit of execution telemetry. Immutable, detached DTO: the
 * builder copies fields out of the raw EventLog events; nothing here holds a
 * reference into an AlixEvent payload. `RuntimeView` renders these and never
 * mutates them.
 */
export interface ExecutionTraceEntry {
  /** Runtime-local deterministic id (e.g. `tr-${seq}`). NOT durable across
   *  sessions; if replay/persistence arrives, `sessionId + sequence` becomes
   *  the durable identity. */
  readonly id: string;
  readonly kind: ExecutionTraceKind;
  readonly status: ExecutionTraceStatus;
  /** One-line title — "tool.search", "Policy: Allow", "core.session.list". */
  readonly title: string;
  readonly detail?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly durationMs?: number;
  /** Provenance back to the raw EventLog, without leaking raw events into the UI. */
  readonly sourceEvents: {
    readonly firstSequence: number;
    readonly lastSequence?: number;
  };
}

/**
 * Retention policy over lifecycle entries. No builder logic, no EventLog
 * knowledge, no timestamp interpretation — only retention:
 *   - open (`running`) entries are NEVER evicted;
 *   - terminal entries sort oldest→newest by startedAt, then open entries
 *     appended after;
 *   - at most `maxTerminal` terminal entries are kept (default 50).
 */
export interface ExecutionTraceRetention {
  apply(entries: readonly ExecutionTraceEntry[]): readonly ExecutionTraceEntry[];
}
