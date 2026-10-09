/**
 * metrics-sink.ts — R5.4 canonical `MetricsSink` implementation.
 *
 * The R1 `MetricsSink` port is the one metric-observation boundary that the
 * kernel, observability, tracing, and TUI/daemon vocabularies adapt to. This
 * adapter persists port observations to the append-only `MetricsStore`
 * (`.alix/observability/metrics/YYYY-MM-DD.jsonl`), the same durable path
 * `SecurityTelemetry`/`StateTelemetry` write through.
 *
 * `observe` is synchronous per the port; the underlying `MetricsStore.append`
 * is an async generator, so it is drained fire-and-forget and failures are
 * swallowed — metrics never affect the caller. `flush()` awaits in-flight
 * appends (used by tests and orderly shutdown).
 */

import type { MetricObservation, MetricsSink } from "../../runtime-state/contracts/metrics-sink.js";
import type { MetricRow, MetricsStore } from "./metrics-store.js";

/** A `MetricsSink` backed by a `MetricsStore`, with an awaitable flush. */
export interface MetricsStoreSink extends MetricsSink {
  flush(): Promise<void>;
}

export interface MetricsStoreSinkOptions {
  /**
   * Observe a store failure without changing the port's fail-open contract.
   * The default remains silent; adapters that previously logged failures can
   * preserve that behavior here.
   */
  onError?: (error: unknown, observation: MetricObservation) => void;
}

/** Adapt a `MetricsStore` to the canonical `MetricsSink` port. */
export function createMetricsStoreSink(store: MetricsStore, options: MetricsStoreSinkOptions = {}): MetricsStoreSink {
  const pending = new Set<Promise<void>>();

  return {
    observe(observation: MetricObservation): void {
      const row: MetricRow = {
        name: observation.name,
        // Default to a counter delta for port callers that carry no type, but
        // preserve an explicit kind so gauges are not summed on rollup.
        type: observation.type ?? "counter_delta",
        value: observation.value,
        timestamp: observation.at ?? new Date().toISOString(),
        ...(observation.labels ? { labels: observation.labels } : {}),
      };
      const task = (async () => {
        try {
          for await (const _ of store.append(row)) {
            // drain
          }
        } catch (error) {
          // non-fatal: metrics must never fail the caller
          options.onError?.(error, observation);
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },

    async flush(): Promise<void> {
      await Promise.all([...pending]);
    },
  };
}
