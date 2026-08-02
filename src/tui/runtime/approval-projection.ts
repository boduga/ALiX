import type { AlixEvent } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState } from './projection-state.js';

/** A single approval's projection entry. Immutable DTO. */
export interface ApprovalProjectionEntry {
  readonly approvalId: string;
  readonly prompt?: string;
  readonly toolName?: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'edited'
    | 'expired' | 'revoked' | 'consumed' | 'resumed';
  readonly requestedAt: number;
  readonly completedAt?: number;
}

/** The projection's explicit snapshot shape — an object, NOT an array. */
export interface ApprovalProjectionSnapshot {
  readonly pending: readonly ApprovalProjectionEntry[];
  readonly completed: readonly ApprovalProjectionEntry[];
}

/** Deterministic cap on completed history — NOT a time window (clock/replay-safe). */
export const MAX_COMPLETED = 50;

/** Exact set of valid statuses — used to validate persisted state on import
 *  (checkpoints live forever; a corrupt/old file must throw, not silently
 *  accept an unknown status). NOT exported: a consumer must not be able to
 *  mutate it (VALID_STATUSES.add('banana')). */
const VALID_STATUSES = new Set([
  'pending', 'approved', 'denied', 'edited',
  'expired', 'revoked', 'consumed', 'resumed',
] as const);

/** Type guard over the exact status union. */
function isValidStatus(value: unknown): value is ApprovalProjectionEntry['status'] {
  return typeof value === 'string' && VALID_STATUSES.has(value as ApprovalProjectionEntry['status']);
}

/** Events that close a pending approval (move it to completed). */
const TERMINAL_TYPES = new Set([
  'approval.resolved', 'approval.expired', 'approval.consumed', 'approval.revoked',
]);

/** Strict timestamp parse — a malformed event timestamp breaks determinism. */
function parseTimestamp(e: AlixEvent): number {
  const t = Date.parse(e.timestamp);
  if (!Number.isFinite(t)) throw new Error(`approval projection: invalid event timestamp on seq ${e.seq}`);
  return t;
}

function entryFrom(e: AlixEvent): { approvalId?: string; prompt?: string; toolName?: string } {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  return {
    approvalId: typeof p.approvalId === 'string' ? p.approvalId : undefined,
    prompt: typeof p.prompt === 'string' ? p.prompt : undefined,
    toolName: typeof p.toolName === 'string' ? p.toolName : undefined,
  };
}

/**
 * State-machine / active-state projection — a third distinct style alongside
 * append-only (timeline) and lifecycle-reconciliation (trace). Tracks pending
 * approvals and a bounded completed history. Hosted on the outer (runtime)
 * collector because approval.* events carry the outer sessionId.
 *
 * Identity/reconciliation (deterministic, spec): identity = approvalId.
 * - requested(id): new pending entry unless one is already pending (a
 *   completed entry with the same id does NOT block a new lifecycle).
 * - terminal event (resolved/expired/consumed/revoked): acts ONLY on a pending
 *   entry; marks it + completedAt and moves to completed (newest→oldest,
 *   bounded by MAX_COMPLETED). Unknown id → no-op.
 * - resumed (Option A): a pending entry's status is set to 'resumed'; it STAYS
 *   pending. resume.failed is NOT terminal (a failed resume is transient).
 * - update() is a pure function of its input events, and expects them ordered
 *   by EventLog sequence (deterministic replay). A non-monotonic seq sequence
 *   would make requested→resolved and resolved→requested indistinguishable;
 *   the collector always passes readSince batches, which are seq-ordered.
 * - Pending ordering is LOCKED: `pending` preserves first-request sequence
 *   order (Map insertion order, since requests arrive seq-ordered). A
 *   snapshot consumer must not assume any other ordering.
 */
export class ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionSnapshot> {
  private pending = new Map<string, ApprovalProjectionEntry>();
  private completed: ApprovalProjectionEntry[] = [];
  private lastSeq = 0;   // monotonic-event guard; part of durable state

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      // Deterministic replay: (1) events must arrive in EventLog sequence
      // order (monotonicity is part of the durable contract); (2) parse the
      // timestamp for EVERY approval event before the approvalId check so a
      // malformed timestamp on an approval-typed event throws.
      if (e.seq < this.lastSeq) {
        throw new Error(`approval projection: non-monotonic event sequence (${e.seq} < ${this.lastSeq})`);
      }
      if (e.type !== 'approval.requested' && e.type !== 'approval.resumed'
          && e.type !== 'approval.resume.failed' && !TERMINAL_TYPES.has(e.type)) {
        continue;   // not an approval event — ignore (seq already monotonic)
      }
      this.lastSeq = e.seq;
      const timestamp = parseTimestamp(e);
      const { approvalId, prompt, toolName } = entryFrom(e);
      if (!approvalId) continue;
      if (e.type === 'approval.requested') {
        if (!this.pending.has(approvalId)) {
          this.pending.set(approvalId, {
            approvalId, prompt, toolName,
            status: 'pending',
            requestedAt: timestamp,
          });
        }
        // id already pending → idempotent replay of the same request, no-op
      } else if (e.type === 'approval.resumed') {
        const existing = this.pending.get(approvalId);
        if (existing) this.pending.set(approvalId, { ...existing, status: 'resumed' });
        // resume.failed is ignored — not a terminal event
      } else if (TERMINAL_TYPES.has(e.type)) {
        const existing = this.pending.get(approvalId);
        if (!existing) continue;                    // unknown id → no-op
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const decision = typeof p.decision === 'string' ? p.decision : '';
        const status: ApprovalProjectionEntry['status'] = e.type === 'approval.resolved'
          ? (['approved', 'denied', 'edited'].includes(decision) ? decision as ApprovalProjectionEntry['status'] : (() => { throw new Error(`approval projection: invalid resolution decision on seq ${e.seq}`); })())
          : e.type === 'approval.expired' ? 'expired'
          : e.type === 'approval.consumed' ? 'consumed'
          : 'revoked';
        const done: ApprovalProjectionEntry = { ...existing, status, completedAt: timestamp };
        this.pending.delete(approvalId);
        this.completed = [done, ...this.completed].slice(0, MAX_COMPLETED);
      }
    }
  }

  /** Object snapshot shape: pending (request order), completed (newest→oldest). */
  snapshot(): ApprovalProjectionSnapshot {
    return {
      pending: [...this.pending.values()],
      completed: [...this.completed],
    };
  }

  reset(): void {
    this.pending.clear();
    this.completed = [];
    this.lastSeq = 0;
  }

  exportState(): ProjectionState {
    // lastSeq is part of the durable state — exportState MUST capture ALL
    // mutable state (the runtime's rollback contract).
    return {
      pending: [...this.pending.values()],
      completed: [...this.completed],
      lastSeq: this.lastSeq,
    };
  }

  importState(state: ProjectionState): void {
    // Validate before mutating (mirrors TimelineBuilder/TraceBuilder). The
    // object/null check runs BEFORE the cast so a null entry is caught; the
    // enum check rejects an unknown persisted status. lastSeq is durable
    // state, not part of the snapshot shape — carried via the intersection.
    const s = state as Partial<ApprovalProjectionSnapshot> & { lastSeq?: unknown };
    if (!Array.isArray(s.pending) || !Array.isArray(s.completed)) throw new Error('approval projection state: malformed pending/completed');
    if (typeof s.lastSeq !== 'number' || !Number.isFinite(s.lastSeq)) throw new Error('approval projection state: malformed lastSeq');
    for (const list of [s.pending, s.completed]) {
      for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) throw new Error('approval projection state: malformed entry');
        const e = entry as Partial<ApprovalProjectionEntry>;
        if (typeof e.approvalId !== 'string' || !isValidStatus(e.status) || !Number.isFinite(e.requestedAt)) {
          throw new Error('approval projection state: malformed entry');
        }
        if (e.completedAt !== undefined && !Number.isFinite(e.completedAt)) {
          throw new Error('approval projection state: malformed entry');
        }
      }
    }
    // CLONE entries so external mutation of the checkpoint object can never
    // alias the projection's internal state (no shared references).
    this.pending = new Map(s.pending.map((e) => [e.approvalId, { ...e as ApprovalProjectionEntry }]));
    this.completed = s.completed.map((e) => ({ ...e as ApprovalProjectionEntry })).slice(0, MAX_COMPLETED);
    this.lastSeq = s.lastSeq;
  }
}
