/**
 * minimal-metrics.ts — M0.9 minimum metrics.
 *
 * Increment counters for workflow/model/tool/policy events.
 * Duration timers for workflow execution.
 * All metrics are stored in-memory and exposed via alix metrics.
 */

export type M09MetricName =
  | "workflow_runs_total"
  | "model_calls_total"
  | "tool_calls_total"
  | "tool_failures_total"
  | "policy_decisions_total"
  | "policy_denials_total"
  | "workflow_duration_ms";

export interface MetricEvent {
  name: M09MetricName;
  type: "counter" | "timer";
  value: number;
  labels?: Record<string, string>;
  timestamp: string;
}

export class MinimalMetrics {
  private events: MetricEvent[] = [];

  increment(name: Exclude<M09MetricName, "workflow_duration_ms">, labels?: Record<string, string>): void {
    this.events.push({ name, type: "counter", value: 1, labels, timestamp: new Date().toISOString() });
  }

  duration(name: "workflow_duration_ms", value: number, labels?: Record<string, string>): void {
    this.events.push({ name, type: "timer", value, labels, timestamp: new Date().toISOString() });
  }

  /** Return a snapshot and clear. */
  flush(): MetricEvent[] {
    const snapshot = [...this.events];
    this.events = [];
    return snapshot;
  }

  /** Return snapshot without clearing. */
  snapshot(): MetricEvent[] {
    return [...this.events];
  }

  /** Generate a short report string for CLI display. */
  report(): string {
    const counters = this.events.filter(e => e.type === "counter");
    const timers = this.events.filter(e => e.type === "timer");
    const lines: string[] = ["M0.9 Metrics:"];
    for (const c of counters) {
      lines.push(`  ${c.name}: ${c.value}${c.labels ? ` (${JSON.stringify(c.labels)})` : ""}`);
    }
    for (const t of timers) {
      lines.push(`  ${t.name}: ${t.value}ms`);
    }
    return lines.join("\n");
  }
}
