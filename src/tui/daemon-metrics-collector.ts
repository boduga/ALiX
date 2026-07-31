import { statfs } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
  /** Where this snapshot came from. `daemon` = real daemon process;
   *  `self` = fallback to this TUI's own process metrics because no
   *  separate daemon is running. */
  readonly source: "daemon" | "self";
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
 *
 * `readPid()` returns null when there is no separate ALiX daemon process
 * (e.g. when running in-process via `alix tui`). In that case the collector
 * falls back to showing this TUI's own resource usage so the DAEMON panel
 * still surfaces real CPU/memory/uptime data instead of zeros.
 */
class LinuxMetricsReader implements PlatformMetricsReader {
  readPid(): number | null {
    // Read the ALiX daemon's PID from ~/.alix/daemon.pid — written by the
    // daemon on startup. Returns null if the file is missing or the
    // stored PID is no longer alive, in which case the collector falls
    // back to self-metrics.
    try {
      const pidPath = join(homedir(), ".alix", "daemon.pid");
      if (!existsSync(pidPath)) return null;
      const raw = readFileSync(pidPath, "utf8").trim();
      const pid = parseInt(raw, 10);
      if (!Number.isFinite(pid) || pid <= 0) return null;
      // Verify the process is still alive (signal 0 = existence check).
      try {
        process.kill(pid, 0);
        return pid;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }
  readMetrics(_pid: number) { return null; }
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
    source: "self",
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
      // No separate ALiX daemon — fall back to this TUI's own process
      // metrics so the DAEMON panel surfaces real CPU/memory/uptime/PID
      // instead of mocked zeros. Mark source so the UI can show
      // "this process" rather than mislabeling it as a daemon.
      const self = readSelfMetrics();
      const sysMem = readSystemMemory();
      const sysDisk = await readSystemDisk();
      this.cache = Object.freeze({
        pid: self.pid,
        uptimeSeconds: self.uptimeSeconds,
        cpuPercent: self.cpuPercent,
        memoryRssBytes: self.memoryRssBytes,
        memoryTotalBytes: sysMem.total,
        diskUsedBytes: sysDisk.used,
        diskTotalBytes: sysDisk.total,
        clients: [],
        sampledAt: Date.now(),
        source: "self",
      });
      return;
    }
    const m = this.#reader.readMetrics(pid);
    if (m === null) {
      // Daemon PID found but per-process metrics reader is not
      // implemented yet — read /proc/<pid>/ directly so the panel shows
      // the daemon's real RSS and uptime.
      const proc = readProcessMetrics(pid);
      const sysMem = readSystemMemory();
      const sysDisk = await readSystemDisk();
      this.cache = Object.freeze({
        pid,
        uptimeSeconds: proc.uptimeSeconds,
        cpuPercent: 0,
        memoryRssBytes: proc.memoryRssBytes,
        memoryTotalBytes: sysMem.total,
        diskUsedBytes: sysDisk.used,
        diskTotalBytes: sysDisk.total,
        clients: [],
        sampledAt: Date.now(),
        source: "daemon",
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
      source: "daemon",
    });
  }
}

// System RAM from /proc/meminfo. MemTotal is reported in kB. Returns 0
// on non-Linux platforms — the UI shows MEM 0% in that case which is
// honest (we genuinely don't know).
function readSystemMemory(): { total: number } {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const m = meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m);
    if (m) return { total: parseInt(m[1]!, 10) * 1024 };
  } catch {
    /* not on Linux */
  }
  return { total: 0 };
}

// Read /proc/<pid>/stat + /proc/<pid>/status for a process other than
// ourselves. Used when a daemon PID is known but the platform reader
// hasn't been extended yet. Returns zeros on any failure.
function readProcessMetrics(pid: number): { uptimeSeconds: number; memoryRssBytes: number } {
  try {
    let rssBytes = 0;
    let starttime = 0;
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
      if (m) rssBytes = parseInt(m[1]!, 10) * 1024;
    } catch { /* /proc/<pid>/status unreadable */ }
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const lastParen = stat.lastIndexOf(")");
      const after = stat.slice(lastParen + 1).trim();
      const fields = after.split(/\s+/);
      // Field 22 (1-based) = starttime in clock ticks since boot.
      starttime = parseInt(fields[19] ?? "0", 10) || 0;
    } catch { /* ignore */ }
    // Compute uptime from /proc/uptime - starttime/USER_HZ.
    let uptimeSeconds = 0;
    if (starttime > 0) {
      try {
        const up = readFileSync("/proc/uptime", "utf8").trim().split(/\s+/);
        const sysUpSec = parseFloat(up[0] ?? "0");
        uptimeSeconds = Math.max(0, Math.floor(sysUpSec - starttime / 100));
      } catch { /* ignore */ }
    }
    return { uptimeSeconds, memoryRssBytes: rssBytes };
  } catch {
    return { uptimeSeconds: 0, memoryRssBytes: 0 };
  }
}

// ---------------------------------------------------------------------------
// Self-metrics fallback — reads /proc/self so the DAEMON panel can show
// this TUI process's own resource usage when no separate daemon exists.
// Linux-only (mirrors the rest of this module).
// ---------------------------------------------------------------------------

interface SelfMetrics {
  pid: number;
  uptimeSeconds: number;
  cpuPercent: number;
  memoryRssBytes: number;
}

// CPU% requires two samples (utime+stime ticks and a timestamp). Cache
// the previous sample on a module-level singleton so successive calls
// produce a meaningful delta. Without this, a single sample is just an
// instantaneous rate which can't be expressed as a percentage.
let prevCpu: { utime: number; stime: number; tsMs: number } | null = null;

function readSelfMetrics(): SelfMetrics {
  const fallback: SelfMetrics = { pid: process.pid, uptimeSeconds: 0, cpuPercent: 0, memoryRssBytes: 0 };
  try {
    // RSS (resident set size) from /proc/self/status — VmRSS line in kB.
    let rssBytes = 0;
    let utime = 0;
    let stime = 0;
    try {
      const status = readFileSync("/proc/self/status", "utf8");
      const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
      if (m) rssBytes = parseInt(m[1]!, 10) * 1024;
      // /proc/self/stat for CPU ticks. Field indices (1-based):
      //   14 = utime (user CPU ticks)
      //   15 = stime (kernel CPU ticks)
      //   22 = starttime (clock ticks since boot)
      const stat = readFileSync("/proc/self/stat", "utf8");
      // Field 2 (comm) may contain spaces/parens — skip past the LAST ")".
      const lastParen = stat.lastIndexOf(")");
      const after = stat.slice(lastParen + 1).trim();
      const fields = after.split(/\s+/);
      // After the ")" the first field is state (3), then we re-count from 4.
      // So utime is fields[11], stime is fields[12].
      utime = parseInt(fields[11] ?? "0", 10) || 0;
      stime = parseInt(fields[12] ?? "0", 10) || 0;
    } catch {
      /* not on Linux — leave zero */
    }
    const nowMs = Date.now();
    const uptimeSeconds = Math.floor(process.uptime());

    let cpuPercent = 0;
    if (prevCpu) {
      const ticksDelta = (utime + stime) - (prevCpu.utime + prevCpu.stime);
      const msDelta = nowMs - prevCpu.tsMs;
      if (msDelta > 0 && ticksDelta >= 0) {
        // ticks are typically 100 Hz (USER_HZ) — but Linux reports in
        // clock ticks per second via sysconf(_SC_CLK_TCK). 100 is the
        // common value; using it gives a reasonable approximation. To
        // be exact we'd read /proc/self/status -> `cpu` field, but
        // USER_HZ=100 covers all common Linux targets.
        const cpuMs = (ticksDelta / 100) * 1000;
        cpuPercent = Math.min(100, Math.max(0, (cpuMs / msDelta) * 100));
      }
    }
    prevCpu = { utime, stime, tsMs: nowMs };

    return { pid: process.pid, uptimeSeconds, cpuPercent, memoryRssBytes: rssBytes };
  } catch {
    return fallback;
  }
}

/**
 * Factory: pick the platform reader based on process.platform. Tests pass
 * `new DaemonMetricsCollectorImpl(reader)` directly.
 */
export function createPlatformMetricsReader(): PlatformMetricsReader {
  return new LinuxMetricsReader();
}