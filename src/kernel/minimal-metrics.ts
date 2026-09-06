/**
 * minimal-metrics.ts — minimum metrics.
 *
 * Increment counters for workflow/model/tool/policy events.
 * Duration timers for workflow execution.
 * All metrics are stored in-memory and exposed via alix metrics.
 */

export type MetricName =
  | "workflow_runs_total"
  | "model_calls_total"
  | "tool_calls_total"
  | "tool_failures_total"
  | "policy_decisions_total"
  | "policy_denials_total"
  | "workflow_duration_ms"
  // D4: 12 conflict metrics (plan §18). `collaboration_conflicts_by_type`
  // was previously declared here but had no emitter and was removed; it
  // can be re-introduced once a typed label vocabulary is defined.
  | "collaboration_conflict_candidates_total"
  | "collaboration_conflicts_detected_total"
  | "collaboration_conflicts_updated_total"
  | "collaboration_conflicts_resolved_total"
  | "collaboration_conflicts_dismissed_total"
  | "collaboration_conflict_detection_duration_ms"
  | "collaboration_conflict_pairs_omitted_total"
  | "collaboration_conflict_model_compare_total"
  | "collaboration_conflict_model_compare_failed_total"
  | "collaboration_conflict_context_included_total"
  | "collaboration_conflict_context_omitted_total"
  // Live-response agent activity + liveness observability (Phase 9). The
  // `agent_*` gauges are observations emitted at discrete sites (activity
  // transitions, liveness watchdog transitions, terminal outcome); the
  // counters are per-invocation increments. Token accounting stays with
  // `model.usage` — no token metrics are declared here.
  | "agent_activity_state"
  | "agent_activity_duration_ms"
  | "agent_last_progress_age_ms"
  | "agent_stall_warning_total"
  | "agent_invocation_cancelled_total"
  | "agent_invocation_failed_total";

export type GaugeName = Extract<
  MetricName,
  "agent_activity_state" | "agent_last_progress_age_ms"
>;

export type DurationName = Extract<
  MetricName,
  | "workflow_duration_ms"
  | "collaboration_conflict_detection_duration_ms"
  | "agent_activity_duration_ms"
>;

export type CounterName = Exclude<MetricName, DurationName | GaugeName>;

export interface MetricEvent {
  name: MetricName;
  type: "counter" | "timer" | "gauge";
  value: number;
  labels?: Record<string, string>;
  timestamp: string;
}

export class MinimalMetrics {
  private events: MetricEvent[] = [];

  /**
   * Record a counter increment. The `by` argument lets a single call
   * record N occurrences (e.g. omitted-pairs in a detection pass that
   * itself is one call). Defaults to 1 so existing call sites are
   * unaffected.
   */
  increment(name: CounterName, labels?: Record<string, string>, by: number = 1): void {
    if (by <= 0) return;
    this.events.push({ name, type: "counter", value: by, labels, timestamp: new Date().toISOString() });
  }

  duration(name: DurationName, value: number, labels?: Record<string, string>): void {
    this.events.push({ name, type: "timer", value, labels, timestamp: new Date().toISOString() });
  }

  /**
   * Record an absolute gauge reading — the current value of a metric at the
   * observation time (e.g. the live activity state or the ms since the last
   * progress mark). Gauges are observations, not increments: callers refresh
   * the value at discrete observation points, never per-token/per-chunk.
   */
  gauge(name: GaugeName, value: number, labels?: Record<string, string>): void {
    if (!Number.isFinite(value)) return;
    this.events.push({ name, type: "gauge", value, labels, timestamp: new Date().toISOString() });
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
    const gauges = this.events.filter(e => e.type === "gauge");
    const lines: string[] = ["M0.9 Metrics:"];
    for (const c of counters) {
      lines.push(`  ${c.name}: ${c.value}${c.labels ? ` (${JSON.stringify(c.labels)})` : ""}`);
    }
    for (const t of timers) {
      lines.push(`  ${t.name}: ${t.value}ms`);
    }
    for (const g of gauges) {
      lines.push(`  ${g.name}: ${g.value}${g.labels ? ` (${JSON.stringify(g.labels)})` : ""}`);
    }
    return lines.join("\n");
  }
}
