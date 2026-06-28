export type M09MetricName =
  | 'workflow_runs_total'
  | 'workflow_duration_ms'
  | 'model_calls_total'
  | 'tool_calls_total'
  | 'tool_failures_total'
  | 'policy_decisions_total'
  | 'policy_denials_total'
  | 'task_events_total'
  | 'run_errors_total';

export interface MetricEvent {
  name: M09MetricName;
  type: 'counter' | 'timer';
  value: number;
  labels?: Record<string, string>;
  timestamp: string;
}

export class MinimalMetrics {
  private readonly events: MetricEvent[] = [];

  increment(name: Exclude<M09MetricName, 'workflow_duration_ms'>, labels?: Record<string, string>): void {
    this.events.push({ name, type: 'counter', value: 1, labels, timestamp: new Date().toISOString() });
  }

  duration(name: 'workflow_duration_ms', value: number, labels?: Record<string, string>): void {
    this.events.push({ name, type: 'timer', value, labels, timestamp: new Date().toISOString() });
  }

  snapshot(): MetricEvent[] {
    return [...this.events];
  }
}
