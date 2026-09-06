/**
 * P4.3-Sa2 — Closed Metrics Registry
 *
 * Defines the closed-set metric registry for ALiX.  All metric names,
 * their types, units, descriptions, and allowed label vocabularies are
 * registered in one place.  The registry rejects unknown metric names
 * in strict mode and validates label cardinality and value vocabulary.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricType = "counter_delta" | "counter_total" | "gauge" | "histogram_sample";

export interface MetricDefinition {
  name: string;
  type: MetricType;
  unit: string;
  description: string;
  allowedLabelKeys: readonly string[];
  allowedLabelValues?: Record<string, readonly string[]>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class MetricRegistry {
  private definitions = new Map<string, MetricDefinition>();
  private mode: "strict" | "compat";

  constructor(opts?: { mode?: "strict" | "compat" }) {
    this.mode = opts?.mode ?? "strict";
  }

  register(def: MetricDefinition): void {
    this.definitions.set(def.name, def);
  }

  registerAll(defs: MetricDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  get(name: string): MetricDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  validate(row: {
    name: string;
    type: string;
    value: number;
    labels?: Record<string, string>;
  }): ValidationResult {
    const errors: string[] = [];

    // ---- Reject non-finite values ----
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
      errors.push(`value must be a finite number, got ${String(row.value)}`);
      return { valid: false, errors };
    }

    // ---- Known name? ----
    const def = this.definitions.get(row.name);
    if (!def) {
      if (this.mode === "strict") {
        errors.push(`unknown metric name "${row.name}"`);
        return { valid: false, errors };
      }
      // Compat mode: warn but accept unknown names
      return { valid: true, errors };
    }

    // ---- Type check ----
    if (row.type !== def.type) {
      errors.push(
        `metric "${row.name}" expects type "${def.type}", got "${row.type}"`,
      );
    }

    // ---- Label validation ----
    if (row.labels) {
      const labelKeys = Object.keys(row.labels);

      // Reject labels above the key limit
      if (labelKeys.length > 8) {
        errors.push(
          `metric "${row.name}" has ${labelKeys.length} label keys, max 8`,
        );
      }

      // Validate label keys against allowedLabelKeys
      for (const key of labelKeys) {
        if (!def.allowedLabelKeys.includes(key)) {
          errors.push(
            `metric "${row.name}" has disallowed label key "${key}"`,
          );
          continue;
        }

        // Validate label values against allowedLabelValues if defined
        const value = row.labels[key];
        if (value !== undefined && def.allowedLabelValues?.[key]) {
          const allowedValues = def.allowedLabelValues[key];
          if (!allowedValues.includes(value)) {
            errors.push(
              `metric "${row.name}" label "${key}" has disallowed value "${value}"`,
            );
          }
        }

        // Reject overlong label values
        if (value && value.length > 128) {
          errors.push(
            `metric "${row.name}" label "${key}" value exceeds 128 chars`,
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  getAllDefinitions(): MetricDefinition[] {
    return Array.from(this.definitions.values());
  }

  getNames(): string[] {
    return Array.from(this.definitions.keys());
  }
}

// ---------------------------------------------------------------------------
// Security metric definitions
// ---------------------------------------------------------------------------

export const SECURITY_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    name: "security_auth_attempt",
    type: "counter_delta",
    unit: "count",
    description: "Authentication attempts (success or failure)",
    allowedLabelKeys: ["result", "method"],
    allowedLabelValues: {
      result: ["success", "failure"],
      method: ["bearer", "cookie", "none"],
    },
  },
  {
    name: "security_auth_denied",
    type: "counter_delta",
    unit: "count",
    description: "Authorization denied events",
    allowedLabelKeys: ["permission", "routeClass"],
  },
  {
    name: "security_rate_limited",
    type: "counter_delta",
    unit: "count",
    description: "Rate-limited requests rejected",
    allowedLabelKeys: ["routeClass", "scope"],
    allowedLabelValues: {
      scope: ["pre_auth", "post_auth"],
    },
  },
  {
    name: "security_redaction",
    type: "counter_delta",
    unit: "count",
    description: "Redaction events (payloads redacted)",
    allowedLabelKeys: ["classification", "sink"],
    allowedLabelValues: {
      sink: ["response", "sse", "audit", "log"],
    },
  },
  {
    name: "security_sse_active",
    type: "gauge",
    unit: "count",
    description: "Active SSE stream connections",
    allowedLabelKeys: ["stream"],
    allowedLabelValues: {
      stream: ["observability", "session", "audit"],
    },
  },
  {
    name: "security_audit_append",
    type: "counter_delta",
    unit: "count",
    description: "Audit log append operations",
    allowedLabelKeys: ["result"],
    allowedLabelValues: {
      result: ["success", "failure"],
    },
  },
  {
    name: "security_config_verified",
    type: "counter_delta",
    unit: "count",
    description: "Security configuration verification outcomes",
    allowedLabelKeys: ["state"],
    allowedLabelValues: {
      state: ["valid", "invalid", "expired", "unsigned"],
    },
  },
  {
    name: "security_gate_result",
    type: "counter_delta",
    unit: "count",
    description: "Security gate evaluation results",
    allowedLabelKeys: ["result"],
    allowedLabelValues: {
      result: ["pass", "fail", "warn"],
    },
  },
  // security_gate_duration is a histogram for the same operation
  {
    name: "security_gate_duration",
    type: "histogram_sample",
    unit: "ms",
    description: "Security gate evaluation duration (milliseconds)",
    allowedLabelKeys: ["result"],
    allowedLabelValues: {
      result: ["pass", "fail", "warn"],
    },
  },
];

// ---------------------------------------------------------------------------
// Existing M09 production metric definitions
// ---------------------------------------------------------------------------

export const PRODUCTION_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    name: "workflow_runs_total",
    type: "counter_delta",
    unit: "count",
    description: "Total workflow runs executed",
    allowedLabelKeys: [],
  },
  {
    name: "model_calls_total",
    type: "counter_delta",
    unit: "count",
    description: "Total model/LLM API calls",
    allowedLabelKeys: [],
  },
  {
    name: "tool_calls_total",
    type: "counter_delta",
    unit: "count",
    description: "Total tool invocations",
    allowedLabelKeys: [],
  },
  {
    name: "tool_failures_total",
    type: "counter_delta",
    unit: "count",
    description: "Total tool invocation failures",
    allowedLabelKeys: [],
  },
  {
    name: "policy_decisions_total",
    type: "counter_delta",
    unit: "count",
    description: "Total policy decisions evaluated",
    allowedLabelKeys: [],
  },
  {
    name: "policy_denials_total",
    type: "counter_delta",
    unit: "count",
    description: "Total policy denials",
    allowedLabelKeys: [],
  },
  {
    name: "workflow_duration_ms",
    type: "histogram_sample",
    unit: "ms",
    description: "Workflow execution duration in milliseconds",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_candidates_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflict candidates found",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflicts_detected_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflicts detected",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflicts_updated_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflicts updated",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflicts_resolved_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflicts resolved",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflicts_dismissed_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflicts dismissed",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_detection_duration_ms",
    type: "histogram_sample",
    unit: "ms",
    description: "Collaboration conflict detection duration in milliseconds",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_pairs_omitted_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflict pairs omitted",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_model_compare_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflict model comparisons",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_model_compare_failed_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflict model comparisons failed",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_context_included_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflict context included",
    allowedLabelKeys: [],
  },
  {
    name: "collaboration_conflict_context_omitted_total",
    type: "counter_delta",
    unit: "count",
    description: "Collaboration conflict context omitted",
    allowedLabelKeys: [],
  },
  // Live-response agent activity + liveness observability (Phase 9).
  // Vocabulary is intentionally inline (mirrors SECURITY_METRIC_DEFINITIONS,
  // which never imports domain modules); a registry test asserts the
  // agent_activity_state label vocabulary stays in sync with
  // AgentActivityState / AGENT_ACTIVITY_STATES.
  {
    name: "agent_activity_state",
    type: "gauge",
    unit: "count",
    description: "Agent invocation activity state sample (1 while the labelled state is the live activity state)",
    allowedLabelKeys: ["state", "invocationId"],
    allowedLabelValues: {
      state: [
        "thinking",
        "streaming",
        "tool_running",
        "waiting_for_provider",
        "verifying",
        "summarizing",
        "possibly_stalled",
        "cancelling",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
  {
    name: "agent_activity_duration_ms",
    type: "histogram_sample",
    unit: "ms",
    description: "Agent invocation duration to a terminal activity state (completed/failed/cancelled), in milliseconds",
    allowedLabelKeys: ["state", "invocationId"],
    allowedLabelValues: {
      state: ["completed", "failed", "cancelled"],
    },
  },
  {
    name: "agent_last_progress_age_ms",
    type: "gauge",
    unit: "ms",
    description: "Milliseconds since the agent invocation's last progress mark (sampled by the liveness watchdog on state transitions)",
    allowedLabelKeys: ["invocationId"],
  },
  {
    name: "agent_stall_warning_total",
    type: "counter_delta",
    unit: "count",
    description: "Agent invocation stall warnings emitted by the liveness watchdog (a warning/stalled transition; a stall warning is not a failure)",
    allowedLabelKeys: ["state"],
    allowedLabelValues: {
      state: ["warning", "stalled"],
    },
  },
  {
    name: "agent_invocation_cancelled_total",
    type: "counter_delta",
    unit: "count",
    description: "Agent invocations cancelled by the operator",
    allowedLabelKeys: [],
  },
  {
    name: "agent_invocation_failed_total",
    type: "counter_delta",
    unit: "count",
    description: "Agent invocations that reached a failed terminal state (thrown loop error or failure reason)",
    allowedLabelKeys: [],
  },
];

// ---------------------------------------------------------------------------
// State substrate metric definitions (§28-29, issue #631)
// ---------------------------------------------------------------------------

/**
 * State substrate metrics — adequacy over token reduction.
 * Wires EventLog → StateProjector → ExecutionState → ContextBuilder →
 * MetricsStore/TelemetryEnvelope. Extend here, do not create new architecture.
 */
export const STATE_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    name: "state_projection_accuracy",
    type: "gauge",
    unit: "ratio",
    description: "State projection adequacy: fraction of decisions correct without historical recovery (0-1, §29 primary)",
    allowedLabelKeys: ["executionId", "substrateMode"],
  },
  {
    name: "state_patch_rejection_rate",
    type: "gauge",
    unit: "ratio",
    description: "Fraction of state patches rejected by validator/governor",
    allowedLabelKeys: ["executionId", "reason"],
  },
  {
    name: "patch_rejection_rate",
    type: "gauge",
    unit: "ratio",
    description: "Alias for state_patch_rejection_rate (acceptance-criteria compatibility)",
    allowedLabelKeys: ["executionId", "reason"],
  },
  {
    name: "state_patch_rejection_total",
    type: "counter_delta",
    unit: "count",
    description: "Count of rejected state patches",
    allowedLabelKeys: ["executionId", "reason"],
  },
  {
    name: "state_patch_count",
    type: "counter_delta",
    unit: "count",
    description: "Total state patches proposed",
    allowedLabelKeys: ["executionId", "result"],
    allowedLabelValues: { result: ["accepted", "rejected"] },
  },
  {
    name: "state_size_tokens",
    type: "gauge",
    unit: "tokens",
    description: "Current ExecutionState size in tokens (bounded decision view)",
    allowedLabelKeys: ["executionId", "substrateMode"],
  },
  {
    name: "state_size_bytes",
    type: "gauge",
    unit: "bytes",
    description: "Current ExecutionState size in bytes",
    allowedLabelKeys: ["executionId"],
  },
  {
    name: "state_tokens",
    type: "gauge",
    unit: "tokens",
    description: "Alias for state_size_tokens per arch doc §28",
    allowedLabelKeys: ["executionId"],
  },
  {
    name: "history_tokens",
    type: "gauge",
    unit: "tokens",
    description: "Historical transcript token count for comparison (§28)",
    allowedLabelKeys: ["executionId"],
  },
  {
    name: "tokens_saved",
    type: "gauge",
    unit: "tokens",
    description: "Tokens saved vs full-history baseline (history_tokens - state_tokens)",
    allowedLabelKeys: ["executionId", "substrateMode"],
  },
  {
    name: "state_tokens_saved",
    type: "gauge",
    unit: "tokens",
    description: "Alias for tokens_saved",
    allowedLabelKeys: ["executionId"],
  },
  {
    name: "context_tokens_total",
    type: "gauge",
    unit: "tokens",
    description: "Total context tokens assembled (state + observation + evidence + history)",
    allowedLabelKeys: ["executionId", "substrateMode"],
  },
  {
    name: "state_recovery_count",
    type: "counter_delta",
    unit: "count",
    description: "Times execution fell back to EventLog/history recovery",
    allowedLabelKeys: ["executionId", "reason"],
  },
  {
    name: "recovery_count",
    type: "counter_delta",
    unit: "count",
    description: "Alias for state_recovery_count",
    allowedLabelKeys: ["executionId", "reason"],
  },
  {
    name: "state_recovery_steps",
    type: "histogram_sample",
    unit: "count",
    description: "Recovery event: number of steps/history events replayed",
    allowedLabelKeys: ["executionId"],
  },
  {
    name: "state_projection_latency_ms",
    type: "histogram_sample",
    unit: "ms",
    description: "State projection duration",
    allowedLabelKeys: ["executionId"],
  },
  {
    name: "state_projection_failures_total",
    type: "counter_delta",
    unit: "count",
    description: "State projection failures (fallback to authoritative history)",
    allowedLabelKeys: ["executionId", "reason"],
  },
  {
    name: "state_version_conflicts",
    type: "counter_delta",
    unit: "count",
    description: "Optimistic concurrency version conflicts (stale base_state_version)",
    allowedLabelKeys: ["executionId"],
  },
];

// ---------------------------------------------------------------------------
// Context assembly observability — per-tier source/selected/evicted/tokens (§28, #641)
// ---------------------------------------------------------------------------

/**
 * Context assembly metrics — tracer bullet #641.
 * Retains source/selected/evicted/token counts per tier from the real
 * ContextAssembler (src/config/context-assembly.ts) via MetricsStore/
 * TelemetryEnvelope. Extends STATE_METRIC_DEFINITIONS; no new architecture.
 *
 * Metadata:
 *  - stateVersion / historyRevision ride alongside tier breakdown so the
 *    dashboard can correlate token counts with the ExecutionState checkpoint.
 */
export const CONTEXT_ASSEMBLY_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    name: "context_tier_source",
    type: "gauge",
    unit: "count",
    description: "Candidate items per tier before assembly (source)",
    allowedLabelKeys: ["executionId", "tier", "invocationId"],
  },
  {
    name: "context_tier_selected",
    type: "gauge",
    unit: "count",
    description: "Admitted (selected) items per tier after assembly",
    allowedLabelKeys: ["executionId", "tier", "invocationId"],
  },
  {
    name: "context_tier_evicted",
    type: "gauge",
    unit: "count",
    description: "Evicted/dropped items per tier (budget_exhausted or protected_unit_exceeded)",
    allowedLabelKeys: ["executionId", "tier", "invocationId", "reason"],
  },
  {
    name: "context_tier_tokens",
    type: "gauge",
    unit: "tokens",
    description: "Admitted tokens per tier",
    allowedLabelKeys: ["executionId", "tier", "invocationId"],
  },
  {
    name: "context_assembly_state_version",
    type: "gauge",
    unit: "count",
    description: "ExecutionState version at assembly time (stateVersion)",
    allowedLabelKeys: ["executionId", "invocationId"],
  },
  {
    name: "context_assembly_history_revision",
    type: "gauge",
    unit: "count",
    description: "History revision (EventLog checkpoint) at assembly time",
    allowedLabelKeys: ["executionId", "invocationId"],
  },
  {
    name: "context_assembly_admitted_tokens",
    type: "gauge",
    unit: "tokens",
    description: "Total admitted tokens for assembled context",
    allowedLabelKeys: ["executionId", "invocationId"],
  },
  {
    name: "context_assembly_dropped_tokens",
    type: "gauge",
    unit: "tokens",
    description: "Total dropped tokens for assembled context",
    allowedLabelKeys: ["executionId", "invocationId"],
  },
];

// ---------------------------------------------------------------------------
// Combined convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-populated MetricRegistry with all production, security,
 * and state-substrate metric definitions registered.
 */
export function createMetricRegistry(
  opts?: { mode?: "strict" | "compat" },
): MetricRegistry {
  const registry = new MetricRegistry(opts);
  registry.registerAll(PRODUCTION_METRIC_DEFINITIONS);
  registry.registerAll(SECURITY_METRIC_DEFINITIONS);
  registry.registerAll(STATE_METRIC_DEFINITIONS);
  registry.registerAll(CONTEXT_ASSEMBLY_METRIC_DEFINITIONS);
  return registry;
}
