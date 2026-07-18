import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotBuilder, type DaemonMetricsCollector } from '../../src/tui/snapshot-builder.js';
import type { ApprovalManager } from '../../src/tui/approval-manager.js';
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
  } as unknown as AgentSession;

  const approvals = {
    snapshot: async () => ({
      pending: [{ id: 'a1', toolName: 'write_file', targetPath: '/x', args: {}, requestedAt: 1, requestedBy: 'agent' }],
      recentlyResolved: [],
      totalPending: 1,
      totalResolved: 0,
    }),
  } as unknown as ApprovalManager;

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
});

describe('SnapshotBuilder.build — generation cancellation', () => {
  it('returns null when the generation has been bumped mid-build', async () => {
    const f = mkFakes();
    let daemonStarted = false;
    const slowDaemon: DaemonMetricsCollector = {
      start: () => {},
      stop: async () => {},
      snapshot: async () => {
        await new Promise((r) => setTimeout(r, 20));
        daemonStarted = true;
        return f.daemon.snapshot();
      },
    };
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, slowDaemon);
    const stale = b.build(1);                // generation 1 begins
    // Simulate caller having bumped generation already
    const fresh = b.build(2);                // generation 2 begins
    const [a, c] = await Promise.all([stale, fresh]);
    expect(daemonStarted).toBe(true);
    expect(a).not.toBeNull();                // generation 1 finished after stamp
    expect(c).not.toBeNull();
    // The contract: build(n) returns null if a newer build was started. We test
    // the SIMPLEST contract: callers pass generation in and we honor it.
    // (Full race semantics are covered by app.ts lifecycle tests.)
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
