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
];

// ---------------------------------------------------------------------------
// Combined convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-populated MetricRegistry with all production and security
 * metric definitions registered.
 */
export function createMetricRegistry(
  opts?: { mode?: "strict" | "compat" },
): MetricRegistry {
  const registry = new MetricRegistry(opts);
  registry.registerAll(PRODUCTION_METRIC_DEFINITIONS);
  registry.registerAll(SECURITY_METRIC_DEFINITIONS);
  return registry;
}
