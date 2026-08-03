import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MetricsProjection } from '../../../src/tui/runtime/metrics-projection.js';
import type { AlixEvent } from '../../../src/events/types.js';

/** Mirror the capability-projection `evt()` helper: capability.* events carry
 *  `at` (ms) in the payload; tool events carry their timestamp at the event
 *  level (`timestamp` — MetricsProjection.parseTimestamp falls back to it when
 *  no numeric payload `at` is present). Realistic seq + millisecond values. */
function evt(type: string, payload: Record<string, unknown>, seq: number, at = seq * 1000): AlixEvent {
  const p = type.startsWith('capability.') ? { ...payload, at } : payload;
  return { id: `e${seq}`, seq, version: 1, sessionId: 'outer', timestamp: new Date(at).toISOString(), type, actor: 'system', payload: p };
}

describe('MetricsProjection', () => {
  it('aggregates tool volume and duration from requested/completed/failed', () => {
    const p = new MetricsProjection();
    p.update([
      evt('tool.requested', { toolCallId: 't1', toolName: 'read', capability: 'file.read' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 500 }, 2, 2000),
      evt('tool.requested', { toolCallId: 't2', toolName: 'grep' }, 3, 3000),
      evt('tool.completed', { toolCallId: 't2', toolName: 'grep', status: 'success', durationMs: 400 }, 4, 4000),
      evt('tool.failed', { toolCallId: 't3', toolName: 'write', error: 'boom', durationMs: 300 }, 5, 5000),
    ]);
    const s = p.snapshot();
    expect(s.eventsProcessed).toBe(5);
    expect(s.toolCalls).toBe(2);          // only tool.requested counts as a "call"
    expect(s.toolFailures).toBe(1);
    expect(s.toolDuration).toEqual({ count: 3, totalMs: 1200, minMs: 300, maxMs: 500, averageMs: 400 });
  });

  it('starts empty — toolDuration null/zero, startedAt/lastEventAt null', () => {
    expect(new MetricsProjection().snapshot()).toEqual({
      eventsProcessed: 0,
      toolCalls: 0,
      toolFailures: 0,
      toolDuration: { count: 0, totalMs: 0, minMs: null, maxMs: null, averageMs: null },
      capabilityInvocations: 0,
      startedAt: null,
      lastEventAt: null,
    });
  });

  it('is idempotent on an at-least-once replay of already-seen seqs (D5)', () => {
    const p = new MetricsProjection();
    const batch = [
      evt('tool.requested', { toolCallId: 't1', toolName: 'read' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 100 }, 2, 2000),
      evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 3, 3000),
    ];
    p.update(batch);
    const first = p.snapshot();
    // The collector's save-failure path re-reads the SAME events on the next
    // sample ("idempotent builders by seq") — re-feeding them must not throw
    // nor double-count any counter.
    p.update(batch);
    expect(p.snapshot()).toEqual(first);
    expect(p.snapshot().eventsProcessed).toBe(3);
    expect(p.snapshot().toolCalls).toBe(1);
    expect(p.snapshot().toolDuration.count).toBe(1);
    expect(p.snapshot().capabilityInvocations).toBe(1);
  });

  it('counts InvocationStarted only — terminal events do not increment capabilityInvocations', () => {
    const p = new MetricsProjection();
    p.update([
      evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000),
      evt('capability.InvocationCompleted', { invocationId: 'i1' }, 2, 2000),
      evt('capability.InvocationFailed', { invocationId: 'i2', error: 'boom' }, 3, 3000),
      evt('capability.InvocationStarted', { invocationId: 'i3', capabilityId: 'c.d' }, 4, 4000),
    ]);
    expect(p.snapshot().capabilityInvocations).toBe(2);
  });

  it('bounds startedAt/lastEventAt to the first/last applied event; malformed timestamp throws', () => {
    const p = new MetricsProjection();
    p.update([
      evt('tool.requested', { toolCallId: 't1', toolName: 'read' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 10 }, 2, 5000),
    ]);
    const s = p.snapshot();
    expect(s.startedAt).toBe(1000);
    expect(s.lastEventAt).toBe(5000);

    // A malformed timestamp must throw — never fall back to Date.now().
    // Tool events carry their timestamp at the event level, so corrupt that.
    const before = p.snapshot();
    const bad = { ...evt('tool.completed', { toolCallId: 't9', toolName: 'x', status: 'success', durationMs: 1 }, 3, 6000), timestamp: 'not-a-date' };
    expect(() => p.update([bad])).toThrow(/timestamp/);
    // The throw pre-empted every counter mutation — the projection is unchanged.
    expect(p.snapshot()).toEqual(before);
  });

  it('reset() returns the projection to its empty state and clears the idempotency guard', () => {
    const p = new MetricsProjection();
    p.update([
      evt('tool.requested', { toolCallId: 't1', toolName: 'read' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 50 }, 2, 2000),
    ]);
    expect(p.snapshot().eventsProcessed).toBe(2);
    p.reset();
    expect(p.snapshot()).toEqual(new MetricsProjection().snapshot());
    // The lastSeq guard is reset too — an old seq re-applies (a replay after
    // reset must not be swallowed by a stale watermark).
    p.update([evt('tool.requested', { toolCallId: 't1', toolName: 'read' }, 1, 1000)]);
    expect(p.snapshot().toolCalls).toBe(1);
  });

  it('imports only AlixEvent/payload types — never another projection\'s DTO (D4)', () => {
    const src = readFileSync(join(process.cwd(), 'src/tui/runtime/metrics-projection.ts'), 'utf-8');
    const importLines = src.split('\n').filter((l) => l.trim().startsWith('import'));
    expect(importLines.length).toBeGreaterThan(0);
    const specifiers = importLines.map((l) => l.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? l.trim());
    const allowed = ['../../events/types.js', './projection-builder.js'];
    for (const spec of specifiers) {
      expect(allowed, `metrics-projection.ts imports disallowed module: ${spec}`).toContain(spec);
    }
  });
});
