/**
 * R5.4 — canonical MetricsSink adapter over MetricsStore.
 */
import { describe, expect, it } from "vitest";
import type { MetricRow } from "../../src/operations/observability/metrics-store.js";
import type { MetricsStore } from "../../src/operations/observability/metrics-store.js";
import { createMetricsStoreSink } from "../../src/operations/observability/metrics-sink.js";

describe("createMetricsStoreSink (R5.4)", () => {
  it("persists an observation as a MetricRow", async () => {
    const rows: MetricRow[] = [];
    const fakeStore = {
      async *append(row: MetricRow) {
        rows.push(row);
      },
    } as unknown as MetricsStore;

    const sink = createMetricsStoreSink(fakeStore);
    sink.observe({ name: "tool_calls_total", value: 3, labels: { agent: "a1" }, at: "2026-01-01T00:00:00Z" });
    await sink.flush();

    expect(rows).toEqual([
      { name: "tool_calls_total", type: "counter_delta", value: 3, timestamp: "2026-01-01T00:00:00Z", labels: { agent: "a1" } },
    ]);
  });

  it("defaults the timestamp when the observation carries none", async () => {
    const rows: MetricRow[] = [];
    const fakeStore = {
      async *append(row: MetricRow) {
        rows.push(row);
      },
    } as unknown as MetricsStore;

    const sink = createMetricsStoreSink(fakeStore);
    sink.observe({ name: "workflow_runs_total", value: 1 });
    await sink.flush();

    expect(rows[0]!.name).toBe("workflow_runs_total");
    expect(typeof rows[0]!.timestamp).toBe("string");
    expect(rows[0]!.labels).toBeUndefined();
  });

  it("swallows store failures (metrics never fail the caller)", async () => {
    const fakeStore = {
      async *append() {
        throw new Error("disk full");
      },
    } as unknown as MetricsStore;

    const sink = createMetricsStoreSink(fakeStore);
    expect(() => sink.observe({ name: "x_total", value: 1 })).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});
