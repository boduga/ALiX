import type { AlixEvent, TimelinePayload } from '../../events/types.js';
import type { ProjectionBuilder } from './projection-builder.js';

export type TimelineKind =
  | 'chat.message' | 'chat.response'
  | 'agent.message' | 'agent.reasoning' | 'agent.decision' | 'agent.response'
  | 'tool.invocation' | 'approval.requested';

/** The timeline projection's supported vocabulary. A builder must own the
 *  kinds it projects — unrelated event types must not pollute the timeline. */
export const TIMELINE_TYPES = new Set<TimelineKind>([
  'chat.message', 'chat.response',
  'agent.message', 'agent.reasoning', 'agent.decision', 'agent.response',
  'tool.invocation', 'approval.requested',
]);

/** Timeline projection entry (D8). Mirrors ExecutionTraceEntry's readonly
 *  detached shape. */
export interface TimelineEntry {
  readonly id: string;                  // `tl-${firstSequence}` — runtime-local deterministic
  readonly kind: TimelineKind;
  readonly actor?: string;              // 'user' = operator input, 'agent' = agent narration (D7); lets the agent view render direction
  readonly sessionId: string;           // stamped origin (D1/D3)
  readonly startedAt: number;
  readonly text?: string;
  readonly detail?: string;
  readonly sourceEvents: { readonly firstSequence: number; readonly lastSequence?: number };
}

function cloneEntry(e: TimelineEntry): TimelineEntry {
  return {
    id: e.id, kind: e.kind, sessionId: e.sessionId, startedAt: e.startedAt,
    ...(e.actor !== undefined ? { actor: e.actor } : {}),
    ...(e.text !== undefined ? { text: e.text } : {}),
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    sourceEvents: {
      firstSequence: e.sourceEvents.firstSequence,
      ...(e.sourceEvents.lastSequence !== undefined ? { lastSequence: e.sourceEvents.lastSequence } : {}),
    },
  };
}

/** Append-only timeline projection (D4). No lifecycle matching, no terminal
 *  promotion. Events become entries; entries are never mutated. Filtered by
 *  the collector's sessionId at the collector boundary; the builder also
 *  defensively filters here. */
export class TimelineBuilder implements ProjectionBuilder<TimelineEntry> {
  private readonly entries = new Map<string, TimelineEntry>(); // by id; append-only
  private readonly seen = new Set<string>();                   // `${sessionId}:${seq}` — compound identity

  constructor(private readonly sessionId: string) {}

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      if (e.sessionId !== this.sessionId) continue;       // (defensive — collector already filters)
      // The builder owns its supported vocabulary — unrelated event types
      // (workflow.*, memory.*, policy.*, runtime.tick, ...) must not pollute
      // the timeline projection. Whitelist instead of casting blindly.
      if (!TIMELINE_TYPES.has(e.type as TimelineKind)) continue;
      // Compound key `${sessionId}:${seq}` for replay detection. NOTE: NOT
      // `e.id` — EventLog stamps `id: randomUUID()` at append, so a fresh
      // collector replaying the same events gets DIFFERENT ids. `seq` is
      // reconstructed deterministically from the log, so it is the stable
      // replay identity. The sessionId prefix keeps two sessions that both
      // have seq=1 distinct (D1/D3 — sessionId is the routing dimension).
      const eventKey = `${e.sessionId}:${e.seq ?? 0}`;
      if (this.seen.has(eventKey)) continue;
      this.seen.add(eventKey);
      const entry = this.build(e);
      this.entries.set(entry.id, entry);
    }
  }

  snapshot(): readonly TimelineEntry[] {
    // Deterministic ordering by firstSequence (NOT by timestamp — timestamps
    // can collide or be adjusted; firstSequence is the stable log position).
    return [...this.entries.values()]
      .sort((a, b) => a.sourceEvents.firstSequence - b.sourceEvents.firstSequence)
      .map(cloneEntry);
  }

  reset(): void {
    this.entries.clear();
    this.seen.clear();
  }

  private build(e: AlixEvent): TimelineEntry {
    // Guarded upstream by TIMELINE_TYPES; the cast is safe here. Never cast
    // an unverified e.type directly — the whitelist is the vocabulary gate.
    const kind = e.type as TimelineKind;
    const p = (e.payload ?? {}) as TimelinePayload;
    const text = typeof p.text === 'string' ? p.text : undefined;
    const detail = typeof p.detail === 'string' ? p.detail : undefined;
    const ts = Date.parse(e.timestamp) || 0;
    return {
      id: `tl-${e.seq ?? 0}`,
      kind, sessionId: e.sessionId, startedAt: ts,
      ...(e.actor !== undefined ? { actor: e.actor } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(detail !== undefined ? { detail } : {}),
      sourceEvents: { firstSequence: e.seq ?? 0 },
    };
  }
}
