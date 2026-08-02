import { describe, it, expect } from 'vitest';
import { ProjectionRuntime, ProjectionRegistrationError, ProjectionRollbackError, createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import type { DurableProjectionBuilder } from '../../../src/tui/runtime/durable-projection-builder.js';
import type { ProjectionState } from '../../../src/tui/runtime/projection-state.js';
import type { ProjectionStateSnapshot } from '../../../src/tui/runtime/projection-state.js';
import type { AlixEvent } from '../../../src/events/types.js';

/** Minimal durable builder: appends seqs to an array. */
function makeBuilder(initial: number[] = []): DurableProjectionBuilder<readonly number[]> {
  const entries: number[] = [...initial];
  return {
    update(events) { for (const e of events) entries.push(e.seq); },
    snapshot() { return [...entries]; },
    reset() { entries.length = 0; },
    exportState(): ProjectionState { return { entries: [...entries] }; },
    importState(state) { const s = state as { entries?: unknown }; if (Array.isArray(s.entries)) entries.splice(0, entries.length, ...s.entries as number[]); },
  };
}

/** Minimal OBJECT-shape builder: proves snapshot is not required to be an array. */
function makeObjectBuilder(initial = 0): DurableProjectionBuilder<{ count: number }> {
  let count = initial;
  return {
    update(events) { count += events.length; },
    snapshot() { return { count }; },
    reset() { count = 0; },
    exportState(): ProjectionState { return { count }; },
    importState(state) { const s = state as { count?: unknown }; if (typeof s.count === 'number') count = s.count; },
  };
}

function evt(seq: number): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(), type: 'chat.message', actor: 'system', payload: {} };
}

describe('ProjectionRuntime', () => {
  it('dispatches updateAll to every registered builder in registration order', () => {
    const a = makeBuilder(); const b = makeBuilder();
    const r = new ProjectionRuntime();
    r.register('a', a); r.register('b', b);
    r.updateAll([evt(1), evt(2)]);
    expect(a.snapshot()).toEqual([1, 2]);
    expect(b.snapshot()).toEqual([1, 2]);
  });

  it('snapshot returns undefined for an unregistered id', () => {
    const r = new ProjectionRuntime();
    expect(r.snapshotOf<readonly number[]>('nope')).toBeUndefined();
  });

  it('supports non-array snapshot shapes (object projections)', () => {
    const obj = makeObjectBuilder();
    const r = new ProjectionRuntime();
    r.register('obj', obj);
    r.updateAll([evt(1), evt(2)]);
    expect(r.snapshotOf<{ count: number }>('obj')).toEqual({ count: 2 });
  });

  it('registering a duplicate id throws ProjectionRegistrationError', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder());
    expect(() => r.register('a', makeBuilder())).toThrow(ProjectionRegistrationError);
  });

  it('dispatches builders in registration order (D11 — order is preserved)', () => {
    const calls: string[] = [];
    const builder = (id: string): DurableProjectionBuilder<unknown> => ({
      update() { calls.push(id); },
      snapshot: () => undefined as never, reset() {}, exportState: () => ({}), importState() {},
    });
    const r = new ProjectionRuntime();
    r.register('a', builder('a'));
    r.register('b', builder('b'));
    r.updateAll([]);
    expect(calls).toEqual(['a', 'b']);
  });

  it('exportState/importState round-trip per-builder durable state keyed by id', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder([1, 2])); r.register('b', makeBuilder([9]));
    const state = r.exportState();
    expect(state).toEqual({ a: { entries: [1, 2] }, b: { entries: [9] } });
    const r2 = new ProjectionRuntime();
    r2.register('b', makeBuilder()); r2.register('a', makeBuilder());
    r2.importState(state);
    expect(r2.snapshotOf<readonly number[]>('b')).toEqual([9]);
    expect(r2.snapshotOf<readonly number[]>('a')).toEqual([1, 2]);
  });

  it('importState ignores state for ids not registered (rolling-upgrade safety)', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder());
    r.importState({ a: { entries: [1] }, futureProjection: { whatever: true } } as ProjectionStateSnapshot);
    expect(r.snapshotOf<readonly number[]>('a')).toEqual([1]);
    expect(r.snapshotOf<readonly unknown[]>('futureProjection')).toBeUndefined();
  });

  it('updateAll is transactional — a builder throw rolls back every projection and propagates', () => {
    const bad: DurableProjectionBuilder<unknown> = {
      update() { throw new Error('boom'); },
      snapshot: () => undefined as never, reset() {}, exportState: () => ({}), importState() {},
    };
    const ok = makeBuilder();
    const r = new ProjectionRuntime();
    r.register('ok', ok); r.register('bad', bad);
    expect(() => r.updateAll([evt(1)])).toThrow('boom');
    // NO partial mutation survives — ok was advanced, then rolled back
    expect(ok.snapshot()).toEqual([]);
  });

  it('surfaces a rollback failure as a typed ProjectionRollbackError preserving both errors', () => {
    const unrecoverable: DurableProjectionBuilder<unknown> = {
      update() { throw new Error('update boom'); },
      snapshot: () => undefined as never, reset() {},
      exportState: () => ({ bad: true }),
      importState() { throw new Error('restore failed'); },
    };
    const r = new ProjectionRuntime();
    r.register('u', unrecoverable);
    expect(() => r.updateAll([evt(1)])).toThrow(ProjectionRollbackError);
  });

  it('register rejects empty/whitespace ids with the empty-id reason', () => {
    const r = new ProjectionRuntime();
    expect(() => r.register('', makeBuilder())).toThrow(/id must not be empty/);
    expect(() => r.register('   ', makeBuilder())).toThrow(/id must not be empty/);
  });

  it('register normalizes whitespace — "trace" and " trace " are the same id', () => {
    const r = new ProjectionRuntime();
    r.register('trace', makeBuilder());
    expect(() => r.register(' trace ', makeBuilder())).toThrow(/duplicate id/);
    expect(r.all().map((p) => p.id)).toEqual(['trace']);
  });

  it('exportState produces a null-prototype object (no prototype pollution via id)', () => {
    const r = new ProjectionRuntime();
    r.register('__proto__', makeBuilder([1]));
    const state = r.exportState();
    expect(Object.getPrototypeOf(state)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(state, '__proto__')).toBe(true);
    expect((state as Record<string, { entries: number[] }>).__proto__.entries).toEqual([1]);
  });

  it('resetAll resets every registered builder', () => {
    const a = makeBuilder([1]); const b = makeBuilder([2]);
    const r = new ProjectionRuntime();
    r.register('a', a); r.register('b', b);
    r.resetAll();
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
  });

  it('createProjectionRuntime is a pure tuple factory', () => {
    const r = createProjectionRuntime([
      ['trace', makeBuilder()],
      ['timeline', makeBuilder()],
    ]);
    expect(r.all().map((p) => p.id).sort()).toEqual(['timeline', 'trace']);
  });

  it('snapshotOf normalizes whitespace like register (" trace " → trace)', () => {
    const r = new ProjectionRuntime();
    r.register('trace', makeBuilder([1, 2]));
    expect(r.snapshotOf<readonly number[]>(' trace ')).toEqual([1, 2]);
  });

  it('importState rejects a non-plain-object envelope (malicious checkpoint)', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder());
    expect(() => r.importState([] as unknown as ProjectionStateSnapshot)).toThrow(/plain object/);
    expect(() => r.importState(null as unknown as ProjectionStateSnapshot)).toThrow(/plain object/);
    // A class instance would JSON.stringify to an ISO string / {} — reject it too.
    expect(() => r.importState(new Date() as unknown as ProjectionStateSnapshot)).toThrow(/plain object/);
    expect(() => r.importState(new Map() as unknown as ProjectionStateSnapshot)).toThrow(/plain object/);
  });

  it('supports an empty runtime (no projections) — platform abstraction works empty', () => {
    const r = new ProjectionRuntime();
    expect(r.all()).toEqual([]);
    expect(() => r.updateAll([evt(1)])).not.toThrow();
    expect(r.exportState()).toEqual(Object.create(null));
    r.resetAll();
  });

  it('exportState throws when a builder returns non-plain-object state (array, Map, Date)', () => {
    // Each of these would silently serialize to `{}` / ISO at JSON.stringify —
    // the guard must reject them, not just an array.
    const badStates: unknown[] = [[1, 2, 3], new Map(), new Date()];
    for (const state of badStates) {
      const bad: DurableProjectionBuilder<unknown> = {
        update() {}, snapshot: () => undefined as never, reset() {},
        exportState: () => state as unknown as ProjectionState,
        importState() {},
      };
      const r = new ProjectionRuntime();
      r.register('bad', bad);
      expect(() => r.exportState()).toThrow(/plain object/);
    }
  });

  it('a future object-shaped projection registers + round-trips with no infrastructure change', () => {
    // A hypothetical future projection — proves the platform is genuinely open.
    class FutureProjection implements DurableProjectionBuilder<{ hello: string }> {
      private hello = 'world';
      update() {}                       // no-op for the proof
      snapshot() { return { hello: this.hello }; }
      reset() { this.hello = 'world'; }
      exportState(): ProjectionState { return { hello: this.hello }; }
      importState(state: ProjectionState) { const s = state as { hello?: unknown }; if (typeof s.hello === 'string') this.hello = s.hello; }
    }
    const r = new ProjectionRuntime();
    r.register('future', new FutureProjection());
    r.updateAll([]);
    expect(r.snapshotOf<{ hello: string }>('future')).toEqual({ hello: 'world' });
    const state = r.exportState();
    expect(state).toEqual({ future: { hello: 'world' } });
    const r2 = new ProjectionRuntime();
    r2.register('future', new FutureProjection());
    r2.importState(state);
    expect(r2.snapshotOf<{ hello: string }>('future')).toEqual({ hello: 'world' });
  });
});
