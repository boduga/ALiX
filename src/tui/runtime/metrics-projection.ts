import type { AlixEvent } from '../../events/types.js';
import { TOOL_EVENT_TYPES, type ToolCompletedPayload, type ToolFailedPayload } from '../../events/types.js';
import type { ProjectionBuilder } from './projection-builder.js';

export interface MetricsProjectionSnapshot {
  readonly eventsProcessed: number;
  readonly toolCalls: number;
  readonly toolFailures: number;
  readonly toolDuration: {
    readonly count: number;
    readonly totalMs: number;
    readonly minMs: number | null;
    readonly maxMs: number | null;
    readonly averageMs: number | null;
  };
  readonly capabilityInvocations: number;
  readonly startedAt: number | null;
  readonly lastEventAt: number | null;
}

/**
 * Session-level metrics projection (NON-durable — replay-derived, per the
 * Increment B design). Aggregates a flat, O(1) counter set over the session's
 * EventLog batch:
 *   - eventsProcessed: every applied event (idempotency by seq).
 *   - toolCalls: every tool.requested (a request is the one true "call"
 *     — started/output/completed are its lifecycle, not separate calls).
 *   - toolFailures: every tool.failed.
 *   - toolDuration: running count/total/min/max over tool.completed/failed
 *     payload durationMs (finite-validated on write; non-finite durations are
 *     skipped, never trusted).
 *   - capabilityInvocations: every capability.InvocationStarted.
 *   - startedAt / lastEventAt: FIRST / LAST applied event's strict timestamp.
 * No arrays, no maps — every counter is O(1) and derived purely from the batch
 * (D11). Deliberately NOT durable: it exposes no exportState/importState, so
 * ProjectionRuntime treats it as a non-durable builder — omitted from the
 * durable checkpoint envelope and reconstructed from the EventLog on restore.
 */
export class MetricsProjection implements ProjectionBuilder<MetricsProjectionSnapshot> {
  private eventsProcessed = 0;
  private toolCalls = 0;
  private toolFailures = 0;
  private durationCount = 0;
  private durationTotalMs = 0;
  private durationMinMs: number | null = null;
  private durationMaxMs: number | null = null;
  private capabilityInvocations = 0;
  private startedAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastSeq = 0;   // in-memory idempotency guard (not durable)

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      if (e.seq <= this.lastSeq) continue;   // D5: skip already-applied, never throw
      this.lastSeq = e.seq;
      const ts = this.parseTimestamp(e);
      this.eventsProcessed++;
      if (this.startedAt === null) this.startedAt = ts;
      this.lastEventAt = ts;
      if (e.type === TOOL_EVENT_TYPES.REQUESTED) { this.toolCalls++; continue; }
      if (e.type === TOOL_EVENT_TYPES.COMPLETED || e.type === TOOL_EVENT_TYPES.FAILED) {
        const p = (e.payload ?? {}) as Partial<ToolCompletedPayload & ToolFailedPayload>;
        if (e.type === TOOL_EVENT_TYPES.FAILED) this.toolFailures++;
        if (typeof p.durationMs === 'number' && Number.isFinite(p.durationMs)) this.recordDuration(p.durationMs);
        continue;
      }
      if (e.type === 'capability.InvocationStarted') { this.capabilityInvocations++; continue; }
    }
  }

  snapshot(): MetricsProjectionSnapshot {
    // Fresh immutable DTO — never exposes references into internal fields.
    return {
      eventsProcessed: this.eventsProcessed,
      toolCalls: this.toolCalls,
      toolFailures: this.toolFailures,
      toolDuration: {
        count: this.durationCount,
        totalMs: this.durationTotalMs,
        minMs: this.durationMinMs,
        maxMs: this.durationMaxMs,
        averageMs: this.durationCount ? this.durationTotalMs / this.durationCount : null,
      },
      capabilityInvocations: this.capabilityInvocations,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
    };
  }

  reset(): void {
    this.eventsProcessed = 0;
    this.toolCalls = 0;
    this.toolFailures = 0;
    this.durationCount = 0;
    this.durationTotalMs = 0;
    this.durationMinMs = null;
    this.durationMaxMs = null;
    this.capabilityInvocations = 0;
    this.startedAt = null;
    this.lastEventAt = null;
    this.lastSeq = 0;
  }

  /** Strict timestamp parse — malformed timestamps break deterministic replay.
   *  Reads payload `at` (number) falling back to `e.timestamp` (Date.parse),
   *  same rigor as CapabilityProjection.parseAt. */
  private parseTimestamp(e: AlixEvent): number {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const raw = typeof p.at === 'number' ? p.at : e.timestamp;
    const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!Number.isFinite(t)) throw new Error(`metrics projection: invalid timestamp on seq ${e.seq}`);
    return t;
  }

  private recordDuration(ms: number): void {
    this.durationCount++;
    this.durationTotalMs += ms;
    this.durationMinMs = this.durationMinMs === null ? ms : Math.min(this.durationMinMs, ms);
    this.durationMaxMs = this.durationMaxMs === null ? ms : Math.max(this.durationMaxMs, ms);
  }
}
