import type { AlixEvent } from '../../events/types.js';
import type { ExecutionTraceEntry, ExecutionTraceKind, ExecutionTraceRetention } from './execution-trace.js';

// Trace entry ids are derived from the source event's firstSequence — no hidden
// module-global mutable state, deterministic and replay-safe within a runtime.
function traceIdFor(firstSequence: number): string { return `tr-${firstSequence}`; }

const TOOL_TYPES = new Set(['tool.requested', 'tool.started', 'tool.output', 'tool.completed', 'tool.failed']);
const POLICY_TYPES = new Set(['policy.decision', 'approval.requested', 'approval.resolved', 'patch.checkpoint_created', 'patch.rollback_started', 'patch.rollback_completed', 'patch.rollback_failed']);
const CAPABILITY_TYPES = new Set(['capability.InvocationStarted', 'capability.InvocationProgress', 'capability.InvocationOutput', 'capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled']);
const RUNTIME_TYPES = new Set(['runtime.phase.started', 'runtime.phase.completed', 'agent.session.phase_changed', 'workflow.created', 'workflow.completed']);

// Terminal event types terminate an open lifecycle. NOTE: capability bridge
// events are PascalCase after the dot (capability.InvocationCompleted), so
// string-suffix matching must not assume lowercase.
const TERMINAL_TYPES = new Set([
  'tool.completed', 'tool.failed',
  'policy.decision', 'approval.resolved', 'patch.rollback_completed', 'patch.rollback_failed',
  'capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled',
  'runtime.phase.completed', 'workflow.completed',
]);

const STATUS_BY_TYPE: Record<string, ExecutionTraceEntry['status']> = {
  'tool.failed': 'failed',
  'capability.InvocationFailed': 'failed',
  'capability.InvocationCancelled': 'cancelled',
  'policy.decision': 'completed',
  'approval.resolved': 'completed',
  'patch.rollback_completed': 'completed',
  'patch.rollback_failed': 'failed',
  'tool.completed': 'completed',
  'capability.InvocationCompleted': 'completed',
  'runtime.phase.completed': 'completed',
  'workflow.completed': 'completed',
};

interface OpenLifecycle {
  kind: ExecutionTraceKind;
  key: string;              // toolCallId / invocationId / phase / workflowId
  title: string;
  startedAt: number;
  firstSequence: number;
  lastSequence: number;
}

function kindOf(type: string): ExecutionTraceKind | null {
  if (TOOL_TYPES.has(type)) return 'tool';
  if (POLICY_TYPES.has(type)) return 'policy';
  if (CAPABILITY_TYPES.has(type)) return 'capability';
  if (RUNTIME_TYPES.has(type)) return 'runtime';
  return null;
}

/** Extract a stable grouping key for an event of a given kind. Falls back to
 *  `type:seq` so independent lifecycle starts with missing IDs never collapse
 *  onto one key. NOTE: `capabilityId` is deliberately NOT a grouping key — it
 *  names the capability (e.g. 'core.session.list'), not a specific invocation,
 *  so grouping by it would collapse two distinct invocations of the same
 *  capability. Only `invocationId` correlates a capability lifecycle. */
function keyOf(type: string, payload: Record<string, unknown>, seq: number): string {
  if (type.startsWith('capability.')) return String(payload.invocationId ?? `${type}:${seq}`);
  if (type.startsWith('tool.')) return String(payload.toolCallId ?? `${type}:${seq}`);
  if (type.startsWith('runtime.phase')) return String(payload.phase ?? `${type}:${seq}`);
  if (type === 'agent.session.phase_changed') return 'phase';
  if (type === 'workflow.created' || type === 'workflow.completed') return 'workflow';
  // policy.decision is a standalone terminal event — each decision is its own
  // lifecycle unit unless an explicit correlation ID ties it to an open approval.
  if (type === 'policy.decision') return `policy:${seq}`;
  return String(payload.proposalId ?? payload.rule ?? `${type}:${seq}`);
}

/** Build a one-line title for a lifecycle unit from its first (open) event. */
function titleOf(kind: ExecutionTraceKind, type: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'tool': return `tool.${payload.toolName ?? payload.toolCallId ?? '?'}`;
    case 'capability': return String(payload.capabilityId ?? payload.invocationId ?? '?');
    case 'policy': return type === 'policy.decision' ? 'Policy decision' : 'Approval';
    case 'runtime': return String(payload.phase ?? payload.workflowId ?? 'phase');
  }
}

/**
 * Pure: group AlixEvents into lifecycle units. Groups over the complete
 * known history (the collector passes readAll()). Does NOT mutate AlixEvents
 * and does NOT return references into their payloads — fields are copied.
 * Entries are assembled oldest→newest by first event; open lifecycles get
 * status 'running' when no terminal event is present.
 */
export function buildExecutionTrace(events: readonly AlixEvent[]): ExecutionTraceEntry[] {
  const open = new Map<string, OpenLifecycle>();
  const done: ExecutionTraceEntry[] = [];

  for (const e of events) {
    const kind = kindOf(e.type);
    if (!kind) continue;
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const seqNum = e.seq ?? 0;
    const key = keyOf(e.type, payload, seqNum);
    const ts = Date.parse(e.timestamp) || 0;

    const isTerminal = TERMINAL_TYPES.has(e.type);

    if (!isTerminal) {
      // Open the lifecycle (or keep the earliest open on repeat start events).
      if (!open.has(`${kind}:${key}`)) {
        open.set(`${kind}:${key}`, {
          kind, key, title: titleOf(kind, e.type, payload),
          startedAt: ts, firstSequence: seqNum, lastSequence: seqNum,
        });
      } else {
        const o = open.get(`${kind}:${key}`)!;
        o.lastSequence = Math.max(o.lastSequence, seqNum);
      }
      continue;
    }

    const o = open.get(`${kind}:${key}`);
    const status: ExecutionTraceEntry['status'] = STATUS_BY_TYPE[e.type] ?? 'completed';
    if (o) {
      const detail = typeof payload.outputPreview === 'string' ? payload.outputPreview
        : typeof payload.error === 'string' ? payload.error
          : typeof payload.phase === 'string' ? payload.phase : undefined;
      done.push({
        id: traceIdFor(o.firstSequence), kind, status, title: o.title, detail,
        startedAt: o.startedAt, completedAt: ts,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : Math.max(0, ts - o.startedAt),
        sourceEvents: { firstSequence: o.firstSequence, lastSequence: Math.max(o.lastSequence, seqNum) },
      });
      open.delete(`${kind}:${key}`);
    } else {
      // A terminal event without a recorded open — synthesize a completed entry.
      done.push({
        id: traceIdFor(seqNum), kind, status, title: titleOf(kind, e.type, payload),
        startedAt: ts, completedAt: ts, durationMs: 0,
        sourceEvents: { firstSequence: seqNum, lastSequence: seqNum },
      });
    }
  }

  // Any remaining open lifecycles become 'running' entries, oldest first.
  // Running entries carry NO lastSequence — an open lifecycle boundary has no
  // terminal event, so consumers can distinguish "last observed event" from a
  // completed lifecycle boundary.
  for (const o of [...open.values()].sort((a, b) => a.firstSequence - b.firstSequence)) {
    done.push({
      id: traceIdFor(o.firstSequence), kind: o.kind, status: 'running', title: o.title,
      startedAt: o.startedAt,
      sourceEvents: { firstSequence: o.firstSequence },
    });
  }

  return done;
}

/** Retention policy: running never evicted; terminal sorted oldest→newest by
 *  startedAt then running appended; maxTerminal bound. */
export function createExecutionTraceRetention(maxTerminal = 50): ExecutionTraceRetention {
  return {
    apply(entries) {
      const terminal = entries.filter((e) => e.status !== 'running');
      const running = entries.filter((e) => e.status === 'running');
      const keptTerminal = [...terminal]
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-Math.max(0, maxTerminal));
      return [...keptTerminal, ...running];
    },
  };
}

/** Compose builder + retention — the collector's entry point. */
export function computeExecutionTrace(
  events: readonly AlixEvent[],
  retention: ExecutionTraceRetention = createExecutionTraceRetention(),
): readonly ExecutionTraceEntry[] {
  return retention.apply(buildExecutionTrace(events));
}
