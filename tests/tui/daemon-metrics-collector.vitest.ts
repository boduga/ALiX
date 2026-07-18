import { describe, it, expect } from 'vitest';
import { DaemonMetricsCollectorImpl } from '../../src/tui/daemon-metrics-collector.js';

describe('DaemonMetricsCollector — initial state', () => {
  it('returns a valid offline snapshot when no PID is given', async () => {
    const c = new DaemonMetricsCollectorImpl({ readPid: () => null, readMetrics: () => null, readClients: () => [] });
    c.start();
    // Allow one sample tick
    await new Promise((r) => setTimeout(r, 10));
    c.stop();
    const snap = await c.snapshot();
    expect(snap.pid).toBeNull();
    expect(snap.cpuPercent).toBe(0);
    expect(snap.memoryRssBytes).toBe(0);
    expect(snap.diskUsedBytes).toBeGreaterThanOrEqual(0);
    expect(snap.diskTotalBytes).toBeGreaterThan(0);
    expect(snap.clients).toEqual([]);
  });
});

describe('DaemonMetricsCollector — dead daemon', () => {
  it('reports pid:null when readPid() returns null mid-stream', async () => {
    let alive = true;
    const c = new DaemonMetricsCollectorImpl({
      readPid: () => (alive ? 1234 : null),
      readMetrics: () => (alive ? { uptimeSeconds: 10, cpuPercent: 5, memoryRssBytes: 1024, memoryTotalBytes: 1024, diskUsedBytes: 1, diskTotalBytes: 10 } : null),
      readClients: () => [],
    });
    c.start();
    // Snapshot while alive
    let snap = await c.snapshot();
    expect(snap.pid).toBe(1234);
    // Process exits
    alive = false;
    await new Promise((r) => setTimeout(r, 1100));  // wait for one tick (1s cadence)
    snap = await c.snapshot();
    expect(snap.pid).toBeNull();
    expect(snap.cpuPercent).toBe(0);
    c.stop();
  });

  it('zeroes process metrics when readMetrics returns null even if readPid succeeded', async () => {
    // First phase: pid + metrics both available (live daemon).
    // Second phase: pid still available but metrics go null (degraded daemon).
    let metricsAvailable = true;
    const c = new DaemonMetricsCollectorImpl({
      readPid: () => 4242,
      readMetrics: () =>
        metricsAvailable
          ? { uptimeSeconds: 10, cpuPercent: 7.5, memoryRssBytes: 9999, memoryTotalBytes: 16384, diskUsedBytes: 1, diskTotalBytes: 10 }
          : null,
      readClients: () => [],
    });
    c.start();
    // Drive at least one sample so the cache holds non-zero process metrics.
    await new Promise((r) => setTimeout(r, 1100));
    let snap = await c.snapshot();
    expect(snap.pid).toBe(4242);
    expect(snap.cpuPercent).toBe(7.5);
    expect(snap.memoryRssBytes).toBe(9999);

    // Daemon degrades: readPid still succeeds but readMetrics goes null.
    metricsAvailable = false;
    await new Promise((r) => setTimeout(r, 1100)); // wait for one tick
    snap = await c.snapshot();
    // Invariant: dead-metrics path must produce the same shape as dead-pid path.
    expect(snap.pid).toBeNull();
    expect(snap.cpuPercent).toBe(0);
    expect(snap.memoryRssBytes).toBe(0);
    expect(snap.memoryTotalBytes).toBe(0);
    expect(snap.uptimeSeconds).toBe(0);
    expect(snap.clients).toEqual([]);
    c.stop();
  });

  it('falls back to system disk even when daemon metrics are unavailable', async () => {
    const c = new DaemonMetricsCollectorImpl({ readPid: () => null, readMetrics: () => null, readClients: () => [] });
    c.start();
    await new Promise((r) => setTimeout(r, 10));
    c.stop();
    const snap = await c.snapshot();
    expect(snap.diskUsedBytes).toBeGreaterThan(0);
    expect(snap.diskTotalBytes).toBeGreaterThanOrEqual(snap.diskUsedBytes);
  });
});

describe('DaemonMetricsCollector — cache', () => {
  it('serves snapshot() from cache without re-reading', async () => {
    let readCount = 0;
    const c = new DaemonMetricsCollectorImpl({
      readPid: () => 1,
      readMetrics: () => { readCount++; return null; },
      readClients: () => [],
    });
    c.start();
    await new Promise((r) => setTimeout(r, 1100));
    const a = await c.snapshot();
    const b = await c.snapshot();
    expect(a).toBe(b);  // same reference (cached)
    expect(readCount).toBeLessThanOrEqual(2);  // bounded by tick count
    c.stop();
  });
});

describe('DaemonMetricsCollector — test seam safety', () => {
  it('does not expose internal readers after construction', () => {
    const c = new DaemonMetricsCollectorImpl({ readPid: () => null, readMetrics: () => null, readClients: () => [] });
    expect((c as any).readers).toBeUndefined();
    expect((c as any).reader).toBeUndefined();
  });
});