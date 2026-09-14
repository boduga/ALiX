/**
 * metrics-store.ts — P4.2c Portable Metrics Persistence and Retention.
 *
 * Durable, append-only JSONL metric store under:
 *   .alix/observability/metrics/YYYY-MM-DD.jsonl    (raw)
 *   .alix/observability/rollups/hourly.jsonl          (hourly aggregates)
 *
 * Uses Node.js streams (createReadStream + readline) for all reads.
 * No new native dependencies — pure Node.js I/O.
 *
 * Metric types:
 *   counter_delta  — per-sample increment amount
 *   counter_total  — monotonic cumulative counter value
 *   gauge          — point-in-time value (snapshot)
 *   histogram_sample — individual observation (for p50/p95/p99 computation)
 */

import { existsSync, mkdirSync, createWriteStream, createReadStream } from "node:fs";
import { readdir, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Narrow a caught value to a NodeJS.ErrnoException with a code property. */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export type MetricType = "counter_delta" | "counter_total" | "gauge" | "histogram_sample";

export interface MetricRow {
  name: string;
  type: MetricType;
  value: number;
  timestamp: string;
  labels?: Record<string, string>;
}

export interface MetricsQuery {
  after?: string;
  before?: string;
  limit?: number;
  nameFilter?: string | string[];
  order?: "asc" | "desc";
}

const DEFAULT_MAX_LIMIT = 10000;
const ABSOLUTE_MAX_LIMIT = 100000;
/** Close the reused append stream after this much idle time (#706). */
const APPEND_STREAM_IDLE_MS = 250;

export class MetricsStore {
  private baseDir: string;
  /** Reused append stream + the day it targets (#706). */
  private writeStream?: ReturnType<typeof createWriteStream>;
  private streamDay?: string;
  private dirReady = false;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(cwd: string) {
    // No filesystem work here — the directory is created lazily on first
    // write so constructing the store is free (#706).
    this.baseDir = join(cwd, ".alix", "observability", "metrics");
  }

  /** Create the metrics directory once, on first write. */
  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
    this.dirReady = true;
  }

  /** Get (or open) the append stream for the given day, closing a stale one. */
  private async streamFor(day: string, filePath: string): Promise<ReturnType<typeof createWriteStream>> {
    if (this.writeStream && this.streamDay === day && !this.writeStream.destroyed) {
      return this.writeStream;
    }
    if (this.writeStream) {
      const old = this.writeStream;
      this.writeStream = undefined;
      await new Promise<void>((resolve) => old.end(resolve));
    }
    const ws = createWriteStream(filePath, { flags: "a" });
    this.writeStream = ws;
    this.streamDay = day;
    return ws;
  }

  /** Schedule closing the idle append stream so it does not hold the loop open. */
  private scheduleIdleClose(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.close();
    }, APPEND_STREAM_IDLE_MS);
    this.idleTimer.unref?.();
  }

  /** Flush and close the reused append stream. */
  async close(): Promise<void> {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const ws = this.writeStream;
    this.writeStream = undefined;
    this.streamDay = undefined;
    if (ws && !ws.destroyed) {
      await new Promise<void>((resolve) => ws.end(resolve));
    }
  }

  /**
   * Append a metric row to the daily JSONL file.
   * Returns an async iterable that yields write results per row.
   */
  async *append(row: MetricRow): AsyncGenerator<string> {
    this.validate(row);
    await this.ensureDir();
    const day = this.datePath();
    const filePath = join(this.baseDir, day);
    const ws = await this.streamFor(day, filePath);
    await new Promise<void>((resolve, reject) => {
      ws.write(JSON.stringify(row) + "\n", "utf-8", (err) => err ? reject(err) : resolve());
    });
    this.scheduleIdleClose();
    yield filePath;
  }

  /**
   * Stream all metric rows from all daily files (optionally filtered).
   *
   * Filtering order:
   * 1. metric name filter (nameFilter)
   * 2. time-range filters (after, before)
   * 3. limit after all filters
   *
   * Default order is "desc" (newest first).  When order is "desc" files
   * are read newest-first so the most recent data surfaces first.
   */
  async *readAll(query?: MetricsQuery): AsyncGenerator<MetricRow> {
    const resolvedLimit = query?.limit ?? DEFAULT_MAX_LIMIT;
    const cappedLimit = Math.min(resolvedLimit, ABSOLUTE_MAX_LIMIT);
    const order = query?.order ?? "desc";
    const nameFilter = query?.nameFilter
      ? Array.isArray(query.nameFilter) ? query.nameFilter : [query.nameFilter]
      : undefined;

    let files = await this.listFiles();
    if (order === "desc") files = files.reverse();

    let count = 0;
    for (const file of files) {
      let rl: ReturnType<typeof createInterface>;
      try {
        rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") continue; // raced by retention
        throw err;
      }
      const descendingRows: MetricRow[] = [];
      try {
        for await (const line of rl) {
          try {
            const row = JSON.parse(line) as MetricRow;

            // Filter by name first (cheapest filter)
            if (nameFilter && !nameFilter.includes(row.name)) continue;

            // Then time-range filters
            if (query?.after && row.timestamp < query.after) continue;
            if (query?.before && row.timestamp > query.before) continue;

            if (order === "desc") {
              descendingRows.push(row);
              if (descendingRows.length > cappedLimit - count) descendingRows.shift();
            } else {
              yield row;
              count++;
              if (count >= cappedLimit) return;
            }
          } catch { /* skip malformed lines */ }
        }
      } catch (err: unknown) {
        // createReadStream may throw ENOENT asynchronously if file deleted mid-read
        if (isNodeError(err) && err.code === "ENOENT") continue;
        throw err;
      } finally {
        rl.close();
      }
      if (order === "desc") {
        for (let i = descendingRows.length - 1; i >= 0; i--) {
          yield descendingRows[i];
          count++;
          if (count >= cappedLimit) return;
        }
      }
    }
  }

  /**
   * Read a time-windowed view via streaming.
   */
  readWindow(query: MetricsQuery): AsyncGenerator<MetricRow> {
    return this.readAll(query);
  }

  private validate(row: MetricRow): void {
    if (!row.name) throw new Error("metric name must be non-empty");
    const validTypes: MetricType[] = ["counter_delta", "counter_total", "gauge", "histogram_sample"];
    if (!validTypes.includes(row.type)) {
      throw new Error(`invalid metric type "${row.type}"`);
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
      throw new Error(`metric value must be a finite number, got ${row.value}`);
    }
    if (row.labels && Object.keys(row.labels).length > 16) {
      throw new Error("max 16 label keys per metric");
    }
  }

  private datePath(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}.jsonl`;
  }

  private async listFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.baseDir);
      return entries
        .filter(f => f.endsWith(".jsonl"))
        .sort()
        .map(f => join(this.baseDir, f));
    } catch {
      return [];
    }
  }
}

// ─── Rollup Store ──────────────────────────────────────────────────────

export class RollupStore {
  private rollupDir: string;

  constructor(private cwd: string) {
    this.rollupDir = join(cwd, ".alix", "observability", "rollups");
    if (!existsSync(this.rollupDir)) mkdirSync(this.rollupDir, { recursive: true });
  }

  /**
   * Compute hourly rollups from raw metrics and append a summary row.
   * Returns count of metrics rolled up.
   */
  async rollUp(): Promise<number> {
    const rawStore = new MetricsStore(this.cwd);
    const grouped = new Map<string, number[]>();
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600000).toISOString();

    for await (const row of rawStore.readWindow({ after: hourAgo })) {
      const arr = grouped.get(row.name) ?? [];
      arr.push(row.value);
      grouped.set(row.name, arr);
    }

    let count = 0;
    if (grouped.size === 0) return 0;

    const ws = createWriteStream(join(this.rollupDir, "hourly.jsonl"), { flags: "a" });
    for (const [name, values] of grouped) {
      const sum = values.reduce((a, b) => a + b, 0);
      const sorted = [...values].sort((a, b) => a - b);
      const row = JSON.stringify({
        name,
        type: "histogram_sample",
        value: sum / values.length,
        timestamp: now.toISOString(),
        labels: {
          count: String(values.length),
          sum: String(sum),
          min: String(sorted[0]),
          max: String(sorted[sorted.length - 1]),
          p50: String(sorted[Math.floor(values.length * 0.5)]),
          p95: String(sorted[Math.floor(values.length * 0.95)]),
          p99: String(sorted[Math.floor(values.length * 0.99)]),
        },
      }) + "\n";
      ws.write(row, "utf-8");
      count++;
    }
    await new Promise<void>(r => ws.end(r));
    return count;
  }

  /**
   * Enforce retention: remove raw files older than N days.
   */
  async enforceRetention(rawDays = 7): Promise<number> {
    const cutoff = Date.now() - rawDays * 86400000;
    const files = await readdir(join(this.cwd, ".alix", "observability", "metrics"));
    let removed = 0;
    for (const f of files) {
      // Filename is YYYY-MM-DD.jsonl
      const datePart = f.replace(".jsonl", "");
      const ts = new Date(datePart).getTime();
      if (!isNaN(ts) && ts < cutoff) {
        try {
          await unlink(join(this.cwd, ".alix", "observability", "metrics", f));
          removed++;
        } catch { /* skip */ }
      }
    }
    return removed;
  }
}
