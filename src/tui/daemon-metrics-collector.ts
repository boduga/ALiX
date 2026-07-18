import { statfs } from 'node:fs/promises';

export interface ClientSnapshot {
  readonly id: string;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
}

export interface DaemonMetricsSnapshot {
  readonly pid: number | null;
  readonly uptimeSeconds: number;
  readonly cpuPercent: number;
  readonly memoryRssBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number;
  readonly diskTotalBytes: number;
  readonly clients: readonly ClientSnapshot[];
  readonly sampledAt: number;
}

export interface PlatformMetricsReader {
  readPid(): number | null;
  readMetrics(pid: number): {
    uptimeSeconds: number;
    cpuPercent: number;
    memoryRssBytes: number;
    memoryTotalBytes: number;
    diskUsedBytes: number;
    diskTotalBytes: number;
  } | null;
  readClients(pid: number): readonly ClientSnapshot[];
}

export interface DaemonMetricsCollector {
  start(): void;
  stop(): Promise<void>;
  snapshot(): Promise<DaemonMetricsSnapshot>;
}

/**
 * Read system-wide disk usage for the root filesystem.
 * Returns { used: 0, total: 0 } on any failure so the dashboard still renders.
 */
async function readSystemDisk(): Promise<{ used: number; total: number }> {
  try {
    const stats = await statfs('/');
    const total = Number(stats.bsize) * Number(stats.blocks);
    const free = Number(stats.bsize) * Number(stats.bfree);
    return { used: total - free, total };
  } catch {
    return { used: 0, total: 0 };
  }
}

/**
 * Default platform reader. Linux-only initial implementation.
 * macOS / Windows: out of scope for this iteration.
 */
class LinuxMetricsReader implements PlatformMetricsReader {
  readPid(): number | null { return null; }       // TODO Linux /proc lookup
  readMetrics(_pid: number) { return null; }      // TODO
  readClients(_pid: number): readonly ClientSnapshot[] { return []; }
}

export class DaemonMetricsCollectorImpl implements DaemonMetricsCollector {
  /** Last sample is cached so renderer never blocks on I/O. */
  private cache: DaemonMetricsSnapshot = {
    pid: null,
    uptimeSeconds: 0,
    cpuPercent: 0,
    memoryRssBytes: 0,
    memoryTotalBytes: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    clients: [],
    sampledAt: 0,
  };

  private timer: NodeJS.Timeout | undefined;

  // True private field (not a TypeScript `private` modifier) so the test-seam
  // assertion `(c as any).reader === undefined` holds.
  readonly #reader: PlatformMetricsReader;

  constructor(reader: PlatformMetricsReader) {
    this.#reader = reader;
  }

  start(): void {
    if (this.timer) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), 1_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async snapshot(): Promise<DaemonMetricsSnapshot> {
    return this.cache;
  }

  /** Test-only — explicitly protected. */
  protected setReaderForTesting(reader: PlatformMetricsReader): void {
    (this as any).#reader = reader;
  }

  private async sample(): Promise<void> {
    const pid = this.#reader.readPid();
    if (pid === null) {
      const sysDisk = await readSystemDisk();
      this.cache = Object.freeze({
        pid: null,
        uptimeSeconds: 0,
        cpuPercent: 0,
        memoryRssBytes: 0,
        memoryTotalBytes: 0,
        diskUsedBytes: sysDisk.used,
        diskTotalBytes: sysDisk.total,
        clients: [],
        sampledAt: Date.now(),
      });
      return;
    }
    const m = this.#reader.readMetrics(pid);
    if (m === null) {
      const sysDisk = await readSystemDisk();
      this.cache = Object.freeze({
        ...this.cache,
        pid: null,
        diskUsedBytes: sysDisk.used,
        diskTotalBytes: sysDisk.total,
        sampledAt: Date.now(),
      });
      return;
    }
    this.cache = Object.freeze({
      pid,
      uptimeSeconds: m.uptimeSeconds,
      cpuPercent: m.cpuPercent,
      memoryRssBytes: m.memoryRssBytes,
      memoryTotalBytes: m.memoryTotalBytes,
      diskUsedBytes: m.diskUsedBytes,
      diskTotalBytes: m.diskTotalBytes,
      clients: this.#reader.readClients(pid),
      sampledAt: Date.now(),
    });
  }
}

/**
 * Factory: pick the platform reader based on process.platform. Tests pass
 * `new DaemonMetricsCollectorImpl(reader)` directly.
 */
export function createPlatformMetricsReader(): PlatformMetricsReader {
  return new LinuxMetricsReader();
}