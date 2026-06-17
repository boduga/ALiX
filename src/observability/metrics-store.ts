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
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

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
}

export class MetricsStore {
  private baseDir: string;

  constructor(private cwd: string) {
    this.baseDir = join(cwd, ".alix", "observability", "metrics");
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * Append a metric row to the daily JSONL file.
   * Returns an async iterable that yields write results per row.
   */
  async *append(row: MetricRow): AsyncGenerator<string> {
    this.validate(row);
    const filePath = join(this.baseDir, this.datePath());
    const line = JSON.stringify(row) + "\n";
    const ws = createWriteStream(filePath, { flags: "a" });
    await new Promise<void>((resolve, reject) => {
      ws.write(line, "utf-8", (err) => err ? reject(err) : resolve());
      ws.end();
    });
    yield filePath;
  }

  /**
   * Stream all metric rows from all daily files (optionally filtered).
   */
  async *readAll(query?: MetricsQuery): AsyncGenerator<MetricRow> {
    const files = await this.listFiles();
    let count = 0;
    for (const file of files) {
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        try {
          const row = JSON.parse(line) as MetricRow;
          if (query?.after && row.timestamp < query.after) continue;
          if (query?.before && row.timestamp > query.before) continue;
          yield row;
          count++;
          if (query?.limit && count >= query.limit) return;
        } catch { /* skip malformed lines */ }
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
