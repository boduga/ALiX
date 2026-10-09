// src/contracts/metrics-sink.ts
//
// R1 boundary freeze — MetricsSink.
// Canonical metric observation boundary. Tracing, TUI, kernel,
// and daemon collectors adapt to one vocabulary through this port.

/** Metric kind carried by an observation (mirrors the MetricsStore vocabulary). */
export type MetricObservationType =
  | "counter_delta"
  | "counter_total"
  | "gauge"
  | "histogram_sample";

export interface MetricObservation {
  name: string;
  value: number;
  /**
   * Metric kind. Optional for port compatibility, but a GAUGE must be labelled
   * `gauge` — it is a point-in-time value and must not be rolled up as a
   * counter (default `counter_delta`).
   */
  type?: MetricObservationType;
  labels?: Record<string, string>;
  at?: string;
}

export interface MetricsSink {
  observe(observation: MetricObservation): void;
}
