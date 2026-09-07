import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotBuilder, type DaemonMetricsCollector, type ApprovalCollector } from '../../src/tui/snapshot-builder.js';
import type { AgentSession } from '../../src/agent/session.js';
import type { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { EventLog } from '../../src/events/event-log.js';
import type { DaemonMetricsSnapshot } from '../../src/tui/snapshot.js';

function mkFakes() {
  const session = {
    getPhase: () => 'Planning' as const,
    getStartedAt: () => 1_000_000,
    getTurns: () => 3,
    getMode: () => 'auto' as const,
    getVersion: () => '1.0.0-test',
    getState: () => ({
      sessionId: 'test',
      messages: [],
      toolHistory: [],
      turnCount: 3,
      createdAt: '1970-01-01T00:16:40.000Z',
      updatedAt: '1970-01-01T00:16:40.000Z',
    }),
  } as unknown as AgentSession;

  const approvals = {
    snapshot: async () => ({
      pending: [{ id: 'a1', toolName: 'write_file', target: '/x', args: {}, requestedAt: 1, requestedBy: 'agent' }],
      recentlyResolved: [],
      totalPending: 1,
      totalResolved: 0,
    }),
  } as unknown as ApprovalCollector;

  const policy = { snapshot: async () => ({ rules: [], violations: [], enforcementMode: 'strict' as const, recentViolationCount: 0 }) } as unknown as PolicyEngine;
  const sops = { snapshot: async () => ({ items: [], totalLoaded: 0 }) } as unknown as { snapshot(): Promise<unknown> };
  const eventLog = { snapshot: async () => ({ events: [], workflow: null, totalEventCount: 0, lastEventAt: null }) } as unknown as EventLog;
  const daemon: DaemonMetricsCollector = {
    start: () => {},
    stop: async () => {},
    snapshot: async (): Promise<DaemonMetricsSnapshot> => ({
      pid: 42,
      uptimeSeconds: 100,
      cpuPercent: 1.5,
      memoryRssBytes: 50_000_000,
      memoryTotalBytes: 16_000_000_000,
      diskUsedBytes: 1_000_000_000,
      diskTotalBytes: 100_000_000_000,
      clients: [],
      sampledAt: Date.now(),
      source: "daemon",
    }),
  };
  return { session, approvals, policy, sops, eventLog, daemon };
}

describe('SnapshotBuilder.build — happy path', () => {
  it('returns an immutable dashboard snapshot with all fields populated', async () => {
    const f = mkFakes();
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap).not.toBeNull();
    expect(snap!.generatedAt).toBeGreaterThan(0);
    expect(snap!.session?.phase).toBe('Planning');
    expect(snap!.daemon?.pid).toBe(42);
    expect(snap!.approvals?.totalPending).toBe(1);
  });

  it('projects the live AgentActivity record into session metadata via getActivity()', async () => {
    const f = mkFakes();
    const activity = {
      state: 'thinking' as const,
      startedAt: 1_000_000,
      lastProgressAt: 1_000_000,
      lastEventAt: 1_000_000,
      elapsedMs: 0,
      invocationId: 'inv-1',
    };
    (f.session as any).getActivity = () => activity;
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap!.session?.activity?.state).toBe('thinking');
    expect(snap!.session?.activity?.invocationId).toBe('inv-1');
  });

  it('threads the constructor cwd into both initial and produced snapshots', async () => {
    const f = mkFakes();
    const cwd = '/home/operator/projects/alix';
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon, cwd);
    const initial = await b.build(1);
    expect(initial?.cwd).toBe(cwd);
    const next = await b.build(2);
    expect(next?.cwd).toBe(cwd);
  });

  it('defaults cwd to empty string when not supplied (back-compat for older callers)', async () => {
    const f = mkFakes();
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap?.cwd).toBe('');
  });

  it('freezes the snapshot result', async () => {
    const f = mkFakes();
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => { (snap as any).generatedAt = 0; }).toThrow();
  });
});

describe('SnapshotBuilder.build — failure isolation', () => {
  it('nulls one subsystem when it throws; others stay populated', async () => {
    const f = mkFakes();
    const brokenPolicy = { snapshot: async () => { throw new Error('policy down'); } } as unknown as PolicyEngine;
    const b = new SnapshotBuilder(f.session, f.approvals, brokenPolicy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap).not.toBeNull();
    expect(snap!.policy).toBeNull();
    expect(snap!.daemon).not.toBeNull();
    expect(snap!.approvals).not.toBeNull();
  });

  it('does not throw upward when any subsystem throws', async () => {
    const f = mkFakes();
    const brokenAll = (() => { throw new Error('boom'); }) as unknown as DaemonMetricsCollector;
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, brokenAll);
    await expect(b.build(1)).resolves.toBeDefined();
  });

  it('A11: a throwing approval collector yields approvals:null (fail-closed containment), not a crash', async () => {
    const f = mkFakes();
    const throwingApprovals = {
      snapshot: async () => { throw new Error('governance violation'); },
    };
    const b = new SnapshotBuilder(f.session, throwingApprovals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap).not.toBeNull();
    expect(snap!.approvals).toBeNull();
  });
});

describe('SnapshotBuilder.build — generation cancellation', () => {
  it('returns null for the older build when a newer build starts mid-await', async () => {
    const f = mkFakes();
    const slowDaemon: DaemonMetricsCollector = {
      start: () => {},
      stop: async () => {},
      snapshot: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return f.daemon.snapshot();
      },
    };
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, slowDaemon);
    // Fire both builds without awaiting in between.
    // build(1) starts and immediately suspends on the 20ms slow-daemon await.
    const stale = b.build(1);
    // build(2) runs while build(1) is still in-flight, bumping currentGeneration.
    const fresh = b.build(2);
    const [build1, build2] = await Promise.all([stale, fresh]);
    // Contract: the loser of the race resolves to null.
    expect(build2).not.toBeNull();
    expect(build1).toBeNull();
  });
});

describe('SnapshotBuilder.buildSync — zero I/O', () => {
  it('uses cached subsystem values without async calls', () => {
    const f = mkFakes();
    let asyncCalled = false;
    const trackDaemon: DaemonMetricsCollector = {
      start: () => {},
      stop: async () => {},
      snapshot: async () => { asyncCalled = true; return f.daemon.snapshot(); },
    };
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, trackDaemon);
    // Pre-warm cache with one async build
    void b.build(1);
    const sync = b.buildSync(1);
    expect(sync).not.toBeNull();
    expect(asyncCalled).toBe(false);  // buildSync did not re-snapshot async
  });
});
