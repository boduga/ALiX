import type { AlixEvent } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState } from './projection-state.js';

/** A single approval's projection entry. Immutable DTO. */
export interface ApprovalProjectionEntry {
  readonly approvalId: string;
  readonly prompt?: string;
  readonly toolName?: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'edited'
    | 'expired' | 'revoked' | 'consumed' | 'invalidated' | 'resumed';
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
  'expired', 'revoked', 'consumed', 'invalidated', 'resumed',
] as const);

/** Type guard over the exact status union. */
function isValidStatus(value: unknown): value is ApprovalProjectionEntry['status'] {
  return typeof value === 'string' && VALID_STATUSES.has(value as ApprovalProjectionEntry['status']);
}

/** Status each non-resolved terminal event type resolves to. Single source for
 *  both the accepted-event set and the status mapping — a new terminal event
 *  type is added in exactly one place. */
const TERMINAL_STATUS: Record<string, ApprovalProjectionEntry['status']> = {
  'approval.expired': 'expired',
  'approval.revoked': 'revoked',
  'approval.consumed': 'consumed',
  'approval.invalidated': 'invalidated',
};

/** Events that close a pending approval (move it to completed). approval.resolved
 *  reads its status from the payload's decision|status, so it's not in the map. */
const TERMINAL_TYPES = new Set(['approval.resolved', ...Object.keys(TERMINAL_STATUS)]);

/** Strict timestamp parse — a malformed event timestamp breaks determinism.
 *  Prefers the store's authoritative payload.timestamp (record.createdAt /
 *  record.decidedAt) over the EventLog append timestamp, which is stamped at
 *  append time and can differ by microseconds. The CLI vocab
 *  (approval.requested) carries no payload timestamp → falls back to
 *  e.timestamp. */
function parseTimestamp(e: AlixEvent): number {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const raw = typeof payload.timestamp === 'string' ? payload.timestamp : e.timestamp;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error(`approval projection: invalid event timestamp on seq ${e.seq}`);
  return t;
}

function entryFrom(e: AlixEvent): { approvalId?: string; prompt?: string; toolName?: string } {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const capabilities = Array.isArray(p.capabilities) ? p.capabilities.filter((c): c is string => typeof c === 'string') : [];
  return {
    approvalId: typeof p.approvalId === 'string' ? p.approvalId : undefined,
    prompt: typeof p.prompt === 'string' ? p.prompt : (typeof p.reason === 'string' ? p.reason : undefined),
    toolName: typeof p.toolName === 'string' ? p.toolName
      : (capabilities.length > 0 ? capabilities[0]
      : (typeof p.toolId === 'string' ? p.toolId : undefined)),
  };
}

/**
 * State-machine / active-state projection — a third distinct style alongside
 * append-only (timeline) and lifecycle-reconciliation (trace). Tracks pending
 * approvals and a bounded completed history. Hosted on the outer (runtime)
 * collector because approval.* events carry the outer sessionId.
 *
 * Identity/reconciliation (deterministic, spec): identity = approvalId.
 * - Union reader over BOTH approval vocabularies: the CLI vocab
 *   (approval.requested / approval.resolved with `decision`) and the store
 *   vocab (approval.created / approval.resolved with `status`, plus
 *   expired/revoked/consumed/invalidated/reused). approval.created and
 *   approval.requested both create a pending entry unless one is already
 *   pending (a completed entry with the same id does NOT block a new
 *   lifecycle); a later create merge-enriches missing prompt/toolName only,
 *   never overwrites populated fields. approval.reused is a no-op.
 * - terminal event (resolved/expired/consumed/revoked/invalidated): resolves
 *   the approvalId in pending first, then completed (the store emits
 *   post-approval transitions — consumed/expired/revoked/invalidated on an
 *   approved entry — which target an already-completed entry); marks it +
 *   completedAt and moves it to completed (newest→oldest, bounded by
 *   MAX_COMPLETED). Post-approval transitions correct the completed entry in
 *   place; revoke is permitted from any status. Terminal states are otherwise
 *   immutable (contradictory transitions throw). Unknown id → no-op.
 * - resumed (Option A): a pending entry's status is set to 'resumed'; it STAYS
 *   pending. resume.failed is NOT terminal (a failed resume is transient). A
 *   resume targeting a completed entry throws (resurrection guard).
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
      if (e.type !== 'approval.requested' && e.type !== 'approval.created'
          && e.type !== 'approval.resumed' && e.type !== 'approval.resume.failed'
          && e.type !== 'approval.reused' && !TERMINAL_TYPES.has(e.type)) {
        continue;   // not an approval event — ignore (seq already monotonic)
      }
      this.lastSeq = e.seq;
      const timestamp = parseTimestamp(e);
      const { approvalId, prompt, toolName } = entryFrom(e);
      if (!approvalId) continue;

      const isCreate = e.type === 'approval.requested' || e.type === 'approval.created';
      if (isCreate) {
        if (!this.pending.has(approvalId)) {
          this.pending.set(approvalId, { approvalId, prompt, toolName, status: 'pending', requestedAt: timestamp });
        } else {
          // merge-enrich: fill missing fields ONLY, never overwrite
          const existing = this.pending.get(approvalId)!;
          const next = { ...existing };
          if (next.prompt == null && prompt != null) next.prompt = prompt;
          if (next.toolName == null && toolName != null) next.toolName = toolName;
          this.pending.set(approvalId, next);
        }
      } else if (e.type === 'approval.resumed') {
        const existing = this.pending.get(approvalId);
        if (existing) {
          this.pending.set(approvalId, { ...existing, status: 'resumed' });
        } else if (this.completed.some((c) => c.approvalId === approvalId)) {
          // resurrection guard: a completed approval cannot be resumed
          throw new Error(`approval projection: cannot resume completed approval ${approvalId} on seq ${e.seq}`);
        }
        // resume.failed is ignored — not a terminal event
      } else if (TERMINAL_TYPES.has(e.type)) {
        // Look up in pending FIRST, then completed — the store emits post-approval
        // transitions (consumed/expired/revoked/invalidated) that target an entry
        // already moved to completed. Missing this → store says consumed, projection
        // says approved (divergence).
        let existing = this.pending.get(approvalId);
        const completedIndex = existing ? -1 : this.completed.findIndex((c) => c.approvalId === approvalId);
        if (!existing && completedIndex >= 0) existing = this.completed[completedIndex];
        if (!existing) continue;                    // unknown id → no-op

        if (e.type === 'approval.resolved') {
          const p = (e.payload ?? {}) as Record<string, unknown>;
          const decision = typeof p.decision === 'string' ? p.decision : '';
          const statusField = typeof p.status === 'string' ? p.status : '';
          if (decision && statusField && decision !== statusField) {
            throw new Error(`approval projection: contradictory resolution (decision=${decision}, status=${statusField}) on seq ${e.seq}`);
          }
          const value = decision || statusField;
          if (!['approved', 'denied', 'edited'].includes(value)) {
            throw new Error(`approval projection: invalid resolution decision on seq ${e.seq}`);
          }
          if (completedIndex < 0) {
            this.moveToCompleted(existing, value as ApprovalProjectionEntry['status'], timestamp);
            continue;
          }
          // completed entry: idempotent or contradictory
          if (existing.status === value) continue;  // idempotent (e.g. approved + resolved(approved))
          throw new Error(`approval projection: terminal ${existing.status} cannot transition to ${value} on seq ${e.seq}`);
        }

        // terminal types: expired / revoked / consumed / invalidated
        const terminalStatus = TERMINAL_STATUS[e.type];

        if (completedIndex < 0) {
          this.moveToCompleted(existing, terminalStatus, timestamp);
          continue;
        }

        // completed entry — post-approval transitions are legal; otherwise immutable.
        if (existing.status === terminalStatus) continue;   // idempotent
        if (existing.status === 'approved' || terminalStatus === 'revoked') {
          // Store performs approved → consumed/expired/revoked/invalidated, and its
          // revoke also permits revoking denied/edited/invalidated. Update in place
          // (completed keeps newest-first insertion order; status corrected).
          this.completed = this.completed.map((c) =>
            c.approvalId === approvalId ? { ...c, status: terminalStatus, completedAt: timestamp } : c,
          );
          continue;
        }
        throw new Error(`approval projection: terminal ${existing.status} cannot transition to ${terminalStatus} on seq ${e.seq}`);
      }
      // approval.reused / approval.resume.failed → no-op (fall through)
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

  /** Move a pending entry to completed (newest-first, bounded). Shared by the
   *  resolved and terminal transition paths. */
  private moveToCompleted(existing: ApprovalProjectionEntry, status: ApprovalProjectionEntry['status'], completedAt: number): void {
    this.completed = [{ ...existing, status, completedAt }, ...this.completed].slice(0, MAX_COMPLETED);
    this.pending.delete(existing.approvalId);
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
