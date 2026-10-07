// src/contracts/metrics-sink.ts
//
// R1 boundary freeze — MetricsSink.
// Canonical metric observation boundary. Tracing, TUI, kernel,
// and daemon collectors adapt to one vocabulary through this port.

export interface MetricObservation {
  name: string;
  value: number;
  labels?: Record<string, string>;
  at?: string;
}

export interface MetricsSink {
  observe(observation: MetricObservation): void;
}
