import type { AlixEvent } from '../../events/types.js';
import { TOOL_EVENT_TYPES } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState } from './projection-state.js';

/**
 * ContextProjectionBuilder — "context as another EventLog projection" (spec #456
 * Implementation Decision F).
 *
 * Consumes EventLog batches incrementally with its OWN sequence cursor and
 * produces an immutable candidate-context snapshot that the budget-aware
 * assembler (T5) consumes. This is candidate context, NOT the serialized
 * provider request: projection answers "what context exists / is current
 * state?"; assembly answers "what safely fits this invocation?".
 *
 * Budget-agnostic by construction:
 *   - it NEVER evicts based on an invocation budget (eviction belongs to the
 *     budget-aware assembly);
 *   - assembling from a snapshot never mutates it — a small-budget invocation
 *     cannot destroy context a later larger-budget invocation could use.
 *
 * "Never evicts" is about INVOCATION BUDGET, not storage. Projection retention
 * is an independent, bounded-storage policy: the MAX_*_LIMIT caps below bound
 * how much historical candidate state ALiX keeps (a fixed retention limit,
 * unrelated to any model's context window). A projection MAY evict its own
 * oldest entries when it exceeds its own retention limit, but it must NEVER
 * evict merely because a particular model invocation has insufficient context
 * budget — that decision belongs to the T5 budget-aware assembly. The two
 * policies are orthogonal: retention bounds the candidate, budget bounds the
 * request.
 *
 * Deltas derive from the event itself, never by re-reading state:
 *   - `tool.completed` → appends a tool result AND folds file-mutation/errors
 *     into the running `[Session Digest]` directly from that event's payload.
 *   - `user.message` / `assistant.text` / agent.* → append a recent turn.
 *   - task/workflow/phase transitions → append a `[Progress Ledger]` line.
 *   - approval/policy/governance → append a governance turn.
 *
 * Whitelist: only context-relevant event families mutate the candidate (tool
 * lifecycle/output, approval/governance, file/mutation, task/execution-state
 * transitions). `model.usage` stays with MetricsProjection (observability, not
 * candidate context). Heartbeats / phase ticks / internal hooks / unknown event
 * types are ignored by default — the whitelist is an explicit, extensible
 * promotion point (spec F).
 *
 * "Phase ticks" = INTERNAL heartbeat / phase-tick / telemetry noise (e.g.
 * `hook.*`, `embedder.*`, `queue.position`, daemon heartbeats) — these never
 * mutate the candidate. This is distinct from `runtime.phase.started` /
 * `runtime.phase.completed` (and `agent.session.phase_changed`), which ARE
 * context-relevant execution-state transitions and map to ledger lines.
 *
 * Durability: DURABLE (exportState/importState). Unlike MetricsProjection's
 * O(1) session telemetry counters, this candidate must survive a checkpoint
 * restore — a resumed session's model-facing context (conversation, digest,
 * ledger) must be complete, so the builder round-trips its bounded state
 * through the durable checkpoint envelope (see the report for the full
 * decision).
 */

// ─── Retention policy (budget-independent) ─────────────────────────────
const MAX_RECENT_TURNS = 200;
const MAX_TOOL_RESULTS = 200;
const MAX_LEDGER_LINES = 50;
const MAX_ERRORS = 20;

// ─── Context-relevant event whitelist (spec F) ─────────────────────────
const CONVERSATION_TYPES = new Set<string>([
  'user.message', 'assistant.text',
  'agent.message', 'agent.response', 'agent.reasoning', 'agent.decision',
]);

const TOOL_RESULT_TYPES = new Set<string>([
  TOOL_EVENT_TYPES.OUTPUT, TOOL_EVENT_TYPES.COMPLETED, TOOL_EVENT_TYPES.FAILED, 'tool.event',
]);

/** Tool lifecycle types that are whitelisted (candidate-relevant) but produce
 *  no result entry — a request/start is not a result. */
const TOOL_LIFECYCLE_TYPES = new Set<string>([TOOL_EVENT_TYPES.REQUESTED, TOOL_EVENT_TYPES.STARTED]);

const FILE_DIGEST_TYPES = new Set<string>([
  'file.created', 'file.deleted',
  'patch.changed_files', 'patch.created_path', 'patch.deleted_path', 'patch.applied',
]);

const LEDGER_TYPES = new Set<string>([
  'task.created', 'task.ready', 'task.accepted', 'task.started', 'task.progress',
  'task.completed', 'task.failed', 'task.done', 'task.cancelled',
  'workflow.created', 'workflow.completed', 'workflow.failed',
  'runtime.phase.started', 'runtime.phase.completed',
  'agent.session.phase_changed', 'agent.session.turn.started', 'agent.session.turn.completed',
]);

const GOVERNANCE_TYPES = new Set<string>([
  'approval.created', 'approval.requested', 'approval.reused', 'approval.resolved', 'approval.resumed',
  'approval.resume.failed', 'approval.consumed', 'approval.expired', 'approval.revoked',
  'approval.invalidated', 'approval.group.resolved',
  'continuation.created', 'continuation.consumed', 'policy.decision',
  'patch.proposed', 'patch.rejected', 'patch.rolled_back',
]);

/** The explicit promotion point — an event belongs in the projection only if it
 *  changes the candidate context presented to the model. Anything NOT here is
 *  ignored by default (model.usage, internal heartbeat/phase-tick/telemetry
 *  noise, internal hooks, unknown types). NOTE: `runtime.phase.started` /
 *  `runtime.phase.completed` ARE here (LEDGER_TYPES) — execution-state phase
 *  transitions are context-relevant; only INTERNAL tick noise is excluded. */
const CONTEXT_TYPES = new Set<string>([
  ...CONVERSATION_TYPES, ...TOOL_RESULT_TYPES, ...TOOL_LIFECYCLE_TYPES,
  ...FILE_DIGEST_TYPES, ...LEDGER_TYPES, ...GOVERNANCE_TYPES,
]);

// ─── Snapshot shape ────────────────────────────────────────────────────

/** A single model-facing conversational turn (or governance/approval turn). */
export interface ContextTurn {
  readonly role: 'user' | 'assistant';
  /** The source event type that produced this turn (e.g. 'user.message',
   *  'approval.requested'). */
  readonly kind: string;
  readonly text: string;
  readonly at: number;
  readonly seq: number;
}

/** A tool result/output candidate for the model. */
export interface ContextToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: 'success' | 'cancelled' | 'error' | 'output';
  readonly outputPreview?: string;
  readonly error?: string;
  readonly durationMs?: number;
  readonly at: number;
  readonly seq: number;
}

/** Tier-3 protected execution-state composite: `[Session Digest]` (what
 *  historical execution info is worth remembering) + `[Progress Ledger]`
 *  (where execution currently stands). Both token-accounted strings. */
export interface ContextExecutionState {
  readonly digest: string | null;
  readonly ledger: string | null;
}

export interface ContextConversation {
  readonly recentTurns: readonly ContextTurn[];
  readonly toolResults: readonly ContextToolResult[];
}

export interface ContextProvenance {
  /** Highest event seq applied — the idempotency cursor (advances over EVERY
   *  event, whitelisted or not, so replays are skipped). */
  readonly lastSeq: number;
  /** Count of context-relevant events that mutated the candidate. */
  readonly contextEventCount: number;
  /** Strict timestamp of the last context-relevant event applied, or null. */
  readonly updatedAt: number | null;
}

export interface ContextProjectionSnapshot {
  readonly executionState: ContextExecutionState;
  readonly conversation: ContextConversation;
  readonly provenance: ContextProvenance;
}

/** Mutable internal turn/result shape — public shapes are readonly; the
 *  builder mutates internal arrays and hands out copies at snapshot(). */
type MutableTurn = { -readonly [K in keyof ContextTurn]: ContextTurn[K] };
type MutableToolResult = { -readonly [K in keyof ContextToolResult]: ContextToolResult[K] };

/** Durable state (Phase 6.5/7): the bounded candidate arrays + digest sets.
 *  Declared as a type alias so it is assignable to
 *  ProjectionState = Record<string, unknown>. */
export type ContextProjectionState = {
  readonly version: 1;
  readonly lastSeq: number;
  readonly contextEventCount: number;
  readonly updatedAt: number | null;
  readonly turns: MutableTurn[];
  readonly toolResults: MutableToolResult[];
  readonly ledgerLines: string[];
  readonly createdFiles: string[];
  readonly changedFiles: string[];
  readonly deletedFiles: string[];
  readonly errors: string[];
  readonly toolNames: ReadonlyArray<readonly [string, string]>;
};

export class ContextProjectionBuilder implements DurableProjectionBuilder<ContextProjectionSnapshot> {
  private lastSeq = 0;
  private contextEventCount = 0;
  private updatedAt: number | null = null;
  private turns: MutableTurn[] = [];
  private toolResults: MutableToolResult[] = [];
  private ledgerLines: string[] = [];
  private createdFiles = new Set<string>();
  private changedFiles = new Set<string>();
  private deletedFiles = new Set<string>();
  private errors: string[] = [];
  /** toolCallId → toolName correlation. tool.output/event payloads carry
   *  toolCallId but NOT toolName, so the name is correlated from the lifecycle
   *  events (requested/started/completed) that carry both — same toolCallId
   *  correlation the execution-trace-builder uses. */
  private toolNames = new Map<string, string>();

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      // Idempotent-by-seq (D5): skip already-applied, never throw. The cursor
      // advances over EVERY event — a non-whitelisted event must still move the
      // watermark or an at-least-once replay would re-apply later whitelisted
      // events that follow it.
      if (e.seq <= this.lastSeq) continue;
      if (!CONTEXT_TYPES.has(e.type)) {
        // Noise advances the idempotency cursor (so an at-least-once replay of
        // the same batch skips it) but never mutates the candidate.
        this.lastSeq = e.seq;
        continue;
      }

      // Strict timestamp FIRST — a malformed timestamp throws before ANY
      // mutation (including the cursor), so a failed batch leaves the
      // candidate exactly unchanged (full snapshot equality, like the metrics
      // projection's observable atomicity).
      const at = this.parseAt(e);

      // Context-relevant: counts toward the candidate + stamps updatedAt.
      this.lastSeq = e.seq;
      this.contextEventCount++;
      this.updatedAt = at;

      // Record toolCallId → toolName for later tool.output/event correlation.
      if (TOOL_RESULT_TYPES.has(e.type) || TOOL_LIFECYCLE_TYPES.has(e.type)) {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        if (typeof p.toolCallId === 'string' && typeof p.toolName === 'string') {
          this.toolNames.set(p.toolCallId, p.toolName);
        }
      }

      if (CONVERSATION_TYPES.has(e.type)) {
        this.pushTurn(e, e.type === 'user.message' ? 'user' : 'assistant');
      }
      if (TOOL_RESULT_TYPES.has(e.type)) {
        this.pushToolResult(e);
      }
      if (FILE_DIGEST_TYPES.has(e.type)) {
        this.applyFileDigest(e);
      }
      if (LEDGER_TYPES.has(e.type)) {
        this.pushLedgerLine(e);
      }
      if (GOVERNANCE_TYPES.has(e.type)) {
        this.pushTurn(e, 'assistant');
      }
    }
  }

  snapshot(): ContextProjectionSnapshot {
    // Fresh immutable DTO — never exposes references into internal fields.
    return {
      executionState: {
        digest: this.digestString(),
        ledger: this.ledgerString(),
      },
      conversation: {
        recentTurns: this.turns.map((t) => ({ ...t })),
        toolResults: this.toolResults.map((r) => ({ ...r })),
      },
      provenance: {
        lastSeq: this.lastSeq,
        contextEventCount: this.contextEventCount,
        updatedAt: this.updatedAt,
      },
    };
  }

  reset(): void {
    this.lastSeq = 0;
    this.contextEventCount = 0;
    this.updatedAt = null;
    this.turns = [];
    this.toolResults = [];
    this.ledgerLines = [];
    this.createdFiles = new Set();
    this.changedFiles = new Set();
    this.deletedFiles = new Set();
    this.errors = [];
    this.toolNames = new Map();
  }

  exportState(): ProjectionState {
    const state: ContextProjectionState = {
      version: 1,
      lastSeq: this.lastSeq,
      contextEventCount: this.contextEventCount,
      updatedAt: this.updatedAt,
      turns: this.turns.map((t) => ({ ...t })),
      toolResults: this.toolResults.map((r) => ({ ...r })),
      ledgerLines: [...this.ledgerLines],
      createdFiles: [...this.createdFiles],
      changedFiles: [...this.changedFiles],
      deletedFiles: [...this.deletedFiles],
      errors: [...this.errors],
      toolNames: [...this.toolNames],
    };
    return state;
  }

  importState(state: ProjectionState): void {
    const s = state as Partial<ContextProjectionState>;
    if (
      s?.version !== 1 ||
      typeof s.lastSeq !== 'number' ||
      typeof s.contextEventCount !== 'number' ||
      (s.updatedAt !== null && typeof s.updatedAt !== 'number') ||
      !Array.isArray(s.turns) || !Array.isArray(s.toolResults) ||
      !Array.isArray(s.ledgerLines) || !Array.isArray(s.createdFiles) ||
      !Array.isArray(s.changedFiles) || !Array.isArray(s.deletedFiles) ||
      !Array.isArray(s.errors) || !Array.isArray(s.toolNames)
    ) {
      throw new Error('context projection state: invalid or unsupported version');
    }
    // Untrusted persisted data — validate EVERYTHING before mutating so a
    // corrupt checkpoint can never half-corrupt the runtime candidate. The
    // shape checks below all run to completion BEFORE any field is assigned;
    // a throw from any one of them leaves the builder byte-for-byte unchanged
    // (snapshot() before === snapshot() after).
    for (const t of s.turns) {
      if (
        t == null || typeof t !== 'object' ||
        typeof (t as MutableTurn).role !== 'string' ||
        typeof (t as MutableTurn).kind !== 'string' ||
        typeof (t as MutableTurn).text !== 'string' ||
        typeof (t as MutableTurn).at !== 'number' ||
        typeof (t as MutableTurn).seq !== 'number'
      ) {
        throw new Error('context projection state: malformed turn');
      }
    }
    for (const r of s.toolResults) {
      if (
        r == null || typeof r !== 'object' ||
        typeof (r as MutableToolResult).toolCallId !== 'string' ||
        typeof (r as MutableToolResult).toolName !== 'string' ||
        typeof (r as MutableToolResult).status !== 'string' ||
        typeof (r as MutableToolResult).at !== 'number' ||
        typeof (r as MutableToolResult).seq !== 'number'
      ) {
        throw new Error('context projection state: malformed tool result');
      }
    }
    // String-array fields (ledgerLines, createdFiles, changedFiles,
    // deletedFiles, errors) — every element must be a string. A Set/array
    // built from mixed or non-string elements would corrupt digest/ledger
    // assembly downstream, so reject before constructing anything.
    const stringArrays: readonly unknown[][] = [
      s.ledgerLines, s.createdFiles, s.changedFiles, s.deletedFiles, s.errors,
    ];
    for (const arr of stringArrays) {
      for (const el of arr) {
        if (typeof el !== 'string') {
          throw new Error('context projection state: malformed string-array entry');
        }
      }
    }
    // toolNames — every element must be a [string, string] tuple. `new Map`
    // would throw on an odd-shaped pair AFTER mutation, so validate the tuple
    // structure here, before anything is assigned.
    for (const pair of s.toolNames as readonly unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
        throw new Error('context projection state: malformed toolNames entry');
      }
    }
    // ALL validation passed — now mutate. Construct Maps/Sets from the
    // already-validated arrays; none of these can throw.
    this.lastSeq = s.lastSeq;
    this.contextEventCount = s.contextEventCount;
    this.updatedAt = s.updatedAt ?? null;
    this.turns = s.turns.map((t) => ({ ...(t as MutableTurn) }));
    this.toolResults = s.toolResults.map((r) => ({ ...(r as MutableToolResult) }));
    this.ledgerLines = [...s.ledgerLines];
    this.createdFiles = new Set(s.createdFiles);
    this.changedFiles = new Set(s.changedFiles);
    this.deletedFiles = new Set(s.deletedFiles);
    this.errors = [...s.errors];
    this.toolNames = new Map(s.toolNames as ReadonlyArray<readonly [string, string]>);
  }

  // ─── Conversation / governance turns ─────────────────────────────────

  private pushTurn(e: AlixEvent, role: 'user' | 'assistant'): void {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const text = GOVERNANCE_TYPES.has(e.type) ? this.governanceTurnText(e) : this.stringField(p, ['text', 'message']) ?? e.type;
    this.turns.push({ role, kind: e.type, text, at: this.parseAt(e), seq: e.seq });
    if (this.turns.length > MAX_RECENT_TURNS) this.turns.shift();
  }

  /** Human-readable text for approval/policy/governance turns. */
  private governanceTurnText(e: AlixEvent): string {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === 'approval.requested') {
      return this.stringField(p, ['prompt']) ?? `approval requested (${this.stringField(p, ['toolName', 'capability']) ?? 'unknown'})`;
    }
    if (e.type === 'approval.resolved' || e.type === 'approval.resumed' || e.type === 'approval.resume.failed') {
      const d = this.stringField(p, ['decision', 'status']) ?? 'resolved';
      const r = this.stringField(p, ['reason']);
      return `approval ${d}${r ? ` (${r})` : ''}`;
    }
    if (e.type === 'policy.decision') {
      const cap = this.stringField(p, ['capability']) ?? '';
      const d = this.stringField(p, ['decision']) ?? '';
      const r = this.stringField(p, ['reason']);
      return `${cap}: ${d}${r ? ` (${r})` : ''}`.trim();
    }
    if (e.type === 'patch.rejected' || e.type === 'patch.rolled_back') {
      return `${e.type}: ${this.stringField(p, ['reason']) ?? ''}`.trim();
    }
    if (e.type === 'patch.proposed') {
      const files = Array.isArray(p.files) ? p.files.length : 0;
      return `patch proposed: ${files} file(s)`;
    }
    return this.stringField(p, ['text', 'prompt', 'message', 'reason']) ?? e.type;
  }

  // ─── Tool results + tool-driven digest deltas ────────────────────────

  private pushToolResult(e: AlixEvent): void {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : `tc-${e.seq}`;
    const result: MutableToolResult = {
      toolCallId,
      toolName: typeof p.toolName === 'string' ? p.toolName : (this.toolNames.get(toolCallId) ?? 'tool'),
      status: this.toolStatus(e),
      at: this.parseAt(e),
      seq: e.seq,
    };
    if (typeof p.outputPreview === 'string') result.outputPreview = p.outputPreview;
    if (typeof p.error === 'string') result.error = p.error;
    if (typeof p.durationMs === 'number' && Number.isFinite(p.durationMs)) result.durationMs = p.durationMs;
    this.toolResults.push(result);
    if (this.toolResults.length > MAX_TOOL_RESULTS) this.toolResults.shift();
    this.applyToolDigest(e);
  }

  private toolStatus(e: AlixEvent): ContextToolResult['status'] {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === TOOL_EVENT_TYPES.FAILED) return 'error';
    if (e.type === TOOL_EVENT_TYPES.COMPLETED) return p.status === 'cancelled' ? 'cancelled' : 'success';
    // tool.output / tool.event
    return p.status === 'error' ? 'error' : 'output';
  }

  /** Fold a tool.completed/failed event's file-mutation + error into the
   *  running `[Session Digest]` — mirrors buildSessionDigest's inputs, but
   *  incrementally from the event itself, never by scanning the log. */
  private applyToolDigest(e: AlixEvent): void {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const toolName = typeof p.toolName === 'string' ? p.toolName : '';
    const path = this.stringField(p, ['path']);
    const createdPath = this.stringField(p, ['createdPath']);
    const deletedPath = this.stringField(p, ['deletedPath']);

    if (toolName === 'file.create') {
      const f = createdPath ?? path;
      if (f) this.createdFiles.add(f);
    } else if (toolName === 'file.delete') {
      const f = deletedPath ?? path;
      if (f) this.deletedFiles.add(f);
    } else if ((toolName === 'file.write' || toolName === 'patch.apply') && path) {
      this.changedFiles.add(path);
    }
    if (Array.isArray(p.changedFiles)) {
      for (const f of p.changedFiles) if (typeof f === 'string') this.changedFiles.add(f);
    }
    if (e.type === TOOL_EVENT_TYPES.FAILED && typeof p.error === 'string' && p.error.length > 0) {
      const short = p.error.length > 80 ? `${p.error.slice(0, 80)}...` : p.error;
      this.errors.push(`${toolName || 'tool'}: ${short}`);
      if (this.errors.length > MAX_ERRORS) this.errors.shift();
    }
  }

  // ─── File / mutation digest deltas ───────────────────────────────────

  private applyFileDigest(e: AlixEvent): void {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const path = this.stringField(p, ['path']);
    switch (e.type) {
      case 'file.created':
      case 'patch.created_path':
        if (path) this.createdFiles.add(path);
        break;
      case 'file.deleted':
      case 'patch.deleted_path':
        if (path) this.deletedFiles.add(path);
        break;
      case 'patch.changed_files':
      case 'patch.applied':
        if (Array.isArray(p.changedFiles)) {
          for (const f of p.changedFiles) if (typeof f === 'string') this.changedFiles.add(f);
        }
        if (path) this.changedFiles.add(path);
        break;
      default:
        break;
    }
  }

  // ─── Progress ledger ─────────────────────────────────────────────────

  private pushLedgerLine(e: AlixEvent): void {
    this.ledgerLines.push(this.ledgerLine(e));
    if (this.ledgerLines.length > MAX_LEDGER_LINES) this.ledgerLines.shift();
  }

  /** Format a task/execution-state transition into a `[Progress Ledger]` line. */
  private ledgerLine(e: AlixEvent): string {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case 'task.started': return `task started: ${this.stringField(p, ['task', 'nodeId', 'text']) ?? ''}`.trim();
      case 'task.ready': return 'task ready';
      case 'task.accepted': return `task accepted: ${this.stringField(p, ['task', 'taskId']) ?? ''}`.trim();
      case 'task.progress': return this.stringField(p, ['message', 'text']) ?? 'progress';
      case 'task.completed': return 'task completed';
      case 'task.failed': return `task failed: ${this.stringField(p, ['reason', 'error', 'message']) ?? ''}`.trim();
      case 'task.done': return 'task done';
      case 'task.cancelled': return 'task cancelled';
      case 'task.created': return `task created: ${this.stringField(p, ['task', 'taskId']) ?? ''}`.trim();
      case 'workflow.created': return `workflow created: ${this.stringField(p, ['goal', 'name']) ?? ''}`.trim();
      case 'workflow.completed': return 'workflow completed';
      case 'workflow.failed': return 'workflow failed';
      case 'runtime.phase.started': return `phase started: ${this.stringField(p, ['phase']) ?? ''}`.trim();
      case 'runtime.phase.completed': return `phase completed: ${this.stringField(p, ['phase']) ?? ''}`.trim();
      case 'agent.session.phase_changed': return `phase: ${this.stringField(p, ['phase', 'to']) ?? ''}`.trim();
      case 'agent.session.turn.started': return 'turn started';
      case 'agent.session.turn.completed': return `turn ${typeof p.turn === 'number' ? p.turn : ''} completed`.trim();
      default: return e.type;
    }
  }

  // ─── Snapshot stringifiers (formatting current state, never re-scanning) ─

  private digestString(): string | null {
    const parts: string[] = [];
    if (this.createdFiles.size) parts.push(`Files created: ${[...this.createdFiles].join(', ')}`);
    if (this.changedFiles.size) parts.push(`Files changed: ${[...this.changedFiles].join(', ')}`);
    if (this.deletedFiles.size) parts.push(`Files deleted: ${[...this.deletedFiles].join(', ')}`);
    if (this.errors.length) parts.push(`Errors: ${this.errors.join('; ')}`);
    return parts.length ? `[Session Digest] ${parts.join('. ')}` : null;
  }

  private ledgerString(): string | null {
    return this.ledgerLines.length ? `[Progress Ledger] ${this.ledgerLines.join('\n')}` : null;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /** Strict timestamp parse — malformed timestamps break deterministic replay.
   *  Reads payload `at` (number) falling back to `e.timestamp` (Date.parse),
   *  same rigor as MetricsProjection.parseTimestamp. Only invoked for
   *  whitelisted (content-producing) events — ignored events never parse. */
  private parseAt(e: AlixEvent): number {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const raw = typeof p.at === 'number' ? p.at : e.timestamp;
    const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!Number.isFinite(t)) throw new Error(`context projection: invalid timestamp on seq ${e.seq}`);
    return t;
  }

  private stringField(p: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  }
}
