import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextProjectionBuilder } from '../../../src/tui/runtime/context-projection.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import { EventLogCursorError } from '../../../src/events/event-log.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import type { AlixEvent } from '../../../src/events/types.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import type { ContextTurn } from '../../../src/tui/runtime/context-projection.js';

/** Mirror the metrics-projection `evt()` helper: every event carries its
 *  timestamp at the event level (ContextProjectionBuilder falls back to
 *  `e.timestamp` when no numeric payload `at` is present, exactly like
 *  MetricsProjection.parseTimestamp). Realistic seq + millisecond values. */
function evt(type: string, payload: Record<string, unknown>, seq: number, at = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's1', timestamp: new Date(at).toISOString(), type, actor: 'system', payload };
}

/** In-memory EventLog double + append helper (mirrors runtime-collector.vitest). */
const SESSION_ID = 's';
function makeEventLog(): { log: EventLog; append: (type: string, payload?: Record<string, unknown>, sessionId?: string) => Promise<void> } {
  let seq = 0;
  const events: AlixEvent[] = [];
  const owner = Symbol('test-owner');
  const makeCursor = (s: number) => ({ seq: s, owner }) as unknown as EventLogCursor;
  const beginning = makeCursor(0);
  const log = {
    beginningCursor: () => beginning,
    getCursor: () => makeCursor(seq),
    readSince: async (c: EventLogCursor) => {
      const internal = c as unknown as { seq: number; owner: symbol };
      if (internal.owner !== owner) throw new Error('foreign');
      if (internal.seq > seq) throw new EventLogCursorError('Cursor position beyond current EventLog head');
      const newer = events.filter(e => e.seq > internal.seq);
      const last = newer.length ? newer[newer.length - 1]!.seq : internal.seq;
      return { events: newer, cursor: makeCursor(last) };
    },
    cursorsEqual: (a: EventLogCursor, b: EventLogCursor) =>
      (a as unknown as { seq: number }).seq === (b as unknown as { seq: number }).seq,
    serializeCursor: (c: EventLogCursor) => JSON.stringify({ version: 1, seq: (c as unknown as { seq: number }).seq }),
    deserializeCursor: (s: string) => {
      const p = JSON.parse(s) as { version: number; seq: number };
      if (p.version !== 1) throw new Error('unknown version');
      if (p.seq > seq) throw new EventLogCursorError('Serialized cursor position is beyond the current EventLog head');
      return makeCursor(p.seq);
    },
  } as unknown as EventLog;
  return {
    log,
    append: async (type, payload = {}, sessionId = SESSION_ID) => {
      seq++;
      events.push({ id: `e${seq}`, seq, version: 1, sessionId, timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload });
    },
  };
}

/** In-memory ProjectionCheckpointStore (mirrors runtime-collector.vitest). */
function makeCheckpointStore(): ProjectionCheckpointStore {
  let stored: PersistedProjectionCheckpoint | null = null;
  return {
    async load() { return stored; },
    async save(cp) { stored = cp; },
  };
}

describe('ContextProjectionBuilder', () => {
  it('starts empty — digest/ledger null, no turns/toolResults, zero provenance', () => {
    expect(new ContextProjectionBuilder().snapshot()).toEqual({
      executionState: { digest: null, ledger: null },
      conversation: { recentTurns: [], toolResults: [] },
      provenance: { lastSeq: 0, contextEventCount: 0, updatedAt: null },
    });
  });

  it('whitelist — model.usage, internal hooks, and unknown event types are ignored', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('model.usage', { inputTokens: 100, outputTokens: 50 }, 1),
      evt('hook.executed', { name: 'pre' }, 2),
      evt('embedder.initialized', {}, 3),
      evt('unknown.namespace', { x: 1 }, 4),
    ]);
    const s = p.snapshot();
    // Noise never mutates the candidate.
    expect(s.executionState).toEqual({ digest: null, ledger: null });
    expect(s.conversation).toEqual({ recentTurns: [], toolResults: [] });
    expect(s.provenance.contextEventCount).toBe(0);
    expect(s.provenance.updatedAt).toBeNull();
    // ...but it still advances the idempotency cursor so a replay is skipped.
    expect(s.provenance.lastSeq).toBe(4);
  });

  it('whitelist — only context-relevant families mutate the candidate; noise interleaved is skipped', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 1),
      evt('model.usage', { inputTokens: 100 }, 2),
      evt('user.message', { text: 'hi' }, 3),
    ]);
    const s = p.snapshot();
    expect(s.conversation.toolResults).toHaveLength(1);
    expect(s.conversation.recentTurns).toHaveLength(1);
    // model.usage is ignored: it counts toward the cursor but not the candidate.
    expect(s.provenance.contextEventCount).toBe(2);
    expect(s.provenance.lastSeq).toBe(3);
  });

  it('conversation — user/assistant/agent events become recentTurns in seq order', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('user.message', { text: 'hello' }, 1, 1000),
      evt('assistant.text', { text: 'hi there' }, 2, 2000),
      evt('agent.reasoning', { text: 'thinking...' }, 3, 3000),
      evt('agent.response', { text: 'done' }, 4, 4000),
    ]);
    expect(p.snapshot().conversation.recentTurns).toEqual([
      { role: 'user', kind: 'user.message', text: 'hello', at: 1000, seq: 1 },
      { role: 'assistant', kind: 'assistant.text', text: 'hi there', at: 2000, seq: 2 },
      { role: 'assistant', kind: 'agent.reasoning', text: 'thinking...', at: 3000, seq: 3 },
      { role: 'assistant', kind: 'agent.response', text: 'done', at: 4000, seq: 4 },
    ]);
  });

  it('tool lifecycle — completed/failed/output become toolResults; requested/started are whitelisted but produce no result', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('tool.requested', { toolCallId: 't1', toolName: 'read' }, 1),
      evt('tool.started', { toolCallId: 't1', toolName: 'read' }, 2),
      evt('tool.output', { toolCallId: 't1', outputPreview: 'partial', outputSize: 10 }, 3, 3000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 4, 4000),
      evt('tool.failed', { toolCallId: 't2', toolName: 'write', error: 'boom', durationMs: 5 }, 5, 5000),
    ]);
    const s = p.snapshot();
    expect(s.conversation.toolResults).toEqual([
      { toolCallId: 't1', toolName: 'read', status: 'output', outputPreview: 'partial', at: 3000, seq: 3 },
      { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10, at: 4000, seq: 4 },
      { toolCallId: 't2', toolName: 'write', status: 'error', error: 'boom', durationMs: 5, at: 5000, seq: 5 },
    ]);
    // All five tool.* types are whitelisted (requested/started are lifecycle).
    expect(s.provenance.contextEventCount).toBe(5);
  });

  it('execution state — digest built incrementally from file/mutation + tool lifecycle; ledger from task/phase transitions', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('file.created', { path: 'a.ts' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'file.write', status: 'success', path: 'b.ts', durationMs: 10 }, 2, 2000),
      evt('file.deleted', { path: 'c.ts' }, 3, 3000),
      evt('tool.failed', { toolCallId: 't2', toolName: 'patch.apply', error: 'conflict', durationMs: 5 }, 4, 4000),
      evt('patch.changed_files', { changedFiles: ['d.ts'] }, 5, 5000),
      evt('task.started', { task: 'implement T4' }, 6, 6000),
      evt('task.progress', { message: 'built projection' }, 7, 7000),
      evt('task.completed', {}, 8, 8000),
    ]);
    const s = p.snapshot();
    expect(s.executionState.digest).toContain('Files created: a.ts');
    expect(s.executionState.digest).toContain('Files changed: b.ts, d.ts');
    expect(s.executionState.digest).toContain('Files deleted: c.ts');
    expect(s.executionState.digest).toContain('Errors: patch.apply: conflict');
    expect(s.executionState.ledger).toContain('implement T4');
    expect(s.executionState.ledger).toContain('built projection');
  });

  it('approval/governance — approval.* and policy.decision become governance turns in recentTurns', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('approval.requested', { approvalId: 'a1', prompt: 'Approve write_file on guard.ts?' }, 1, 1000),
      evt('approval.resolved', { approvalId: 'a1', decision: 'approved' }, 2, 2000),
      evt('policy.decision', { toolCallId: 't1', capability: 'file.write', decision: 'allow', reason: 'rule 1' }, 3, 3000),
    ]);
    const turns = p.snapshot().conversation.recentTurns;
    expect(turns.map(t => t.kind)).toEqual(['approval.requested', 'approval.resolved', 'policy.decision']);
    expect(turns[0]!.role).toBe('assistant');
    expect(turns[0]!.text).toBe('Approve write_file on guard.ts?');
    expect(turns[2]!.text).toContain('allow');
  });

  it('incremental deltas — a tool.completed updates the candidate directly; a later noise batch never re-scans or duplicates', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('user.message', { text: 'first' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 2, 2000),
    ]);
    expect(p.snapshot().conversation.toolResults).toHaveLength(1);
    // A LATER batch of only ignored events must not re-scan history: the
    // toolResult is appended directly from seq 2's event, never re-derived.
    p.update([
      evt('model.usage', { inputTokens: 5 }, 3, 3000),
      evt('unknown.type', {}, 4, 4000),
    ]);
    const after = p.snapshot();
    expect(after.conversation.toolResults).toHaveLength(1);
    expect(after.conversation.recentTurns).toHaveLength(1);
    expect(after.provenance.contextEventCount).toBe(2);
    expect(after.provenance.lastSeq).toBe(4);
  });

  it('is idempotent on an at-least-once replay of already-seen seqs (D5)', () => {
    const p = new ContextProjectionBuilder();
    const batch = [
      evt('user.message', { text: 'hi' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 2, 2000),
      evt('task.progress', { message: 'working' }, 3, 3000),
    ];
    p.update(batch);
    const first = p.snapshot();
    // The collector's save-failure path re-reads the SAME events on the next
    // sample — re-feeding them must not throw nor double-apply any entry.
    p.update(batch);
    expect(p.snapshot()).toEqual(first);
    expect(p.snapshot().conversation.toolResults).toHaveLength(1);
    expect(p.snapshot().conversation.recentTurns).toHaveLength(1);
    expect(p.snapshot().provenance.contextEventCount).toBe(3);
  });

  it('strict timestamp parse — a malformed timestamp on a whitelisted event throws and leaves the candidate unchanged', () => {
    const p = new ContextProjectionBuilder();
    p.update([evt('user.message', { text: 'hi' }, 1, 1000)]);
    const before = p.snapshot();
    const bad = { ...evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 1 }, 2, 2000), timestamp: 'not-a-date' };
    expect(() => p.update([bad])).toThrow(/timestamp/);
    // The throw pre-empted every candidate mutation — the projection is unchanged.
    expect(p.snapshot()).toEqual(before);
  });

  it('immutable snapshot — assembling from a snapshot never mutates it; mutating a returned snapshot is isolated', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('user.message', { text: 'hi' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 2, 2000),
    ]);
    const s1 = p.snapshot();
    // Attempt to corrupt the returned snapshot through its nested arrays/objects.
    (s1.conversation.recentTurns as unknown as ContextTurn[]).push({ role: 'user', kind: 'injected', text: 'x', at: 0, seq: 99 });
    (s1.executionState as { digest: string | null }).digest = 'corrupted';
    const s2 = p.snapshot();
    expect(s2.conversation.recentTurns).toHaveLength(1);
    expect(s2.executionState.digest).not.toBe('corrupted');
    expect(s2).not.toBe(s1); // fresh object per assembly
    // A small-budget invocation cannot destroy context: the internal candidate
    // is unchanged after assembly.
    expect(s1).not.toBe(s2);
    expect(p.snapshot().conversation.recentTurns[0]!.text).toBe('hi');
  });

  it('reset() wipes the candidate and clears the idempotency guard', () => {
    const p = new ContextProjectionBuilder();
    p.update([evt('user.message', { text: 'hi' }, 1, 1000)]);
    expect(p.snapshot().conversation.recentTurns).toHaveLength(1);
    p.reset();
    expect(p.snapshot()).toEqual(new ContextProjectionBuilder().snapshot());
    // The lastSeq guard is reset too — an old seq re-applies after a reset
    // (a replay after reset must not be swallowed by a stale watermark).
    p.update([evt('user.message', { text: 'hi' }, 1, 1000)]);
    expect(p.snapshot().conversation.recentTurns).toHaveLength(1);
    expect(p.snapshot().provenance.lastSeq).toBe(1);
  });

  it('durable — exportState/importState round-trips exactly; malformed persisted state throws', () => {
    const p = new ContextProjectionBuilder();
    p.update([
      evt('user.message', { text: 'hi' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10, outputPreview: 'x' }, 2, 2000),
      evt('task.started', { task: 'T4' }, 3, 3000),
      evt('file.created', { path: 'a.ts' }, 4, 4000),
    ]);
    const state = p.exportState();
    const q = new ContextProjectionBuilder();
    q.importState(state);
    expect(q.snapshot()).toEqual(p.snapshot());
    // Forward replay continues from the restored cursor.
    q.update([evt('user.message', { text: 'next' }, 5, 5000)]);
    expect(q.snapshot().conversation.recentTurns).toHaveLength(2);
    expect(q.snapshot().provenance.lastSeq).toBe(5);

    // Malformed persisted state must throw, never silently corrupt.
    expect(() => new ContextProjectionBuilder().importState({ version: 99 } as never)).toThrow();
    expect(() => new ContextProjectionBuilder().importState({ version: 1 } as never)).toThrow();
  });

  it('importState validates ALL fields BEFORE mutating — malformed toolNames/string-array throws with snapshot unchanged', () => {
    // Build a valid, populated state, then corrupt a copy. Every corrupt
    // variant must throw DURING validation, before ANY field is assigned —
    // the builder must be byte-for-byte unchanged (snapshot equality).
    const p = new ContextProjectionBuilder();
    p.update([
      evt('user.message', { text: 'hi' }, 1, 1000),
      evt('task.started', { task: 'T4' }, 2, 2000),
      evt('file.created', { path: 'a.ts' }, 3, 3000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 4, 4000),
    ]);
    const base = p.exportState() as Record<string, unknown>;

    const attempt = (mutate: (s: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutate(copy);
      const q = new ContextProjectionBuilder();
      const before = q.snapshot();
      expect(() => q.importState(copy)).toThrow(/context projection state/);
      // The throw happened during validation, before ANY field was assigned.
      expect(q.snapshot()).toEqual(before);
    };

    // Malformed toolNames tuple structures.
    attempt((s) => { (s.toolNames as unknown[]).push(['only-one-string']); });
    attempt((s) => { s.toolNames = [[123, 'x']]; });
    attempt((s) => { s.toolNames = [['a', 'b'], ['c']]; });
    // Malformed string-array elements.
    attempt((s) => { (s.createdFiles as unknown[]).push(42); });
    attempt((s) => { s.ledgerLines = ['ok', { bad: true }]; });
    attempt((s) => { s.errors = ['ok', null]; });
    attempt((s) => { s.changedFiles = ['ok', undefined]; });
    attempt((s) => { s.deletedFiles = ['ok', 0]; });
  });

  it('is registered under ProjectionIds.context and snapshotOf returns it via the runtime', () => {
    expect(ProjectionIds.context).toBe('context');
    const runtime = createProjectionRuntime([[ProjectionIds.context, new ContextProjectionBuilder()]]);
    runtime.updateAll([
      evt('user.message', { text: 'hi' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 2, 2000),
    ]);
    const snap = runtime.snapshotOf<ReturnType<ContextProjectionBuilder['snapshot']>>(ProjectionIds.context);
    expect(snap).not.toBeUndefined();
    expect(snap!.conversation.recentTurns).toHaveLength(1);
    expect(snap!.conversation.toolResults).toHaveLength(1);
  });

  it("imports only AlixEvent/payload types — never another projection's DTO (D4)", () => {
    const src = readFileSync(join(process.cwd(), 'src/tui/runtime/context-projection.ts'), 'utf-8');
    // NOTE: the metrics D4 test filters `startsWith('import')` — safe there
    // because MetricsProjection has no importState method. This builder is
    // DURABLE, so `importState(...)` would be caught; filter for a real
    // import statement (`import ` with a space) instead.
    const importLines = src.split('\n').filter((l) => l.trim().startsWith('import '));
    expect(importLines.length).toBeGreaterThan(0);
    const specifiers = importLines.map((l) => l.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? l.trim());
    const allowed = ['../../events/types.js', './projection-builder.js', './durable-projection-builder.js', './projection-state.js'];
    for (const spec of specifiers) {
      expect(allowed, `context-projection.ts imports disallowed module: ${spec}`).toContain(spec);
    }
  });
});

describe('RuntimeCollectorImpl context projection (Task 4)', () => {
  it('snapshot.context is populated from a registered ContextProjectionBuilder', async () => {
    const { log, append } = makeEventLog();
    await append('user.message', { text: 'hi' });
    await append('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 });
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID,
      projectionRuntime: createProjectionRuntime([[ProjectionIds.context, new ContextProjectionBuilder()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.context).not.toBeNull();
    expect(snap!.context!.conversation.recentTurns).toHaveLength(1);
    expect(snap!.context!.conversation.recentTurns[0]!.kind).toBe('user.message');
    expect(snap!.context!.conversation.toolResults).toHaveLength(1);
    expect(snap!.context!.provenance.lastSeq).toBe(2);
    collector.stop();
  });

  it('snapshot.context is null when the projection is not registered', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 't1', toolName: 'x' });
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID,
      projectionRuntime: createProjectionRuntime([['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.context).toBeNull();
    collector.stop();
  });
});
