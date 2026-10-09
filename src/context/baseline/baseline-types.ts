/**
 * P10.10 — Baseline Intelligence types.
 *
 * Domain model for subsystem health baselines.
 * No dependencies on Executive or Adaptation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Subsystem identifier
// ---------------------------------------------------------------------------

/**
 * Canonical subsystem names. Prevents registry typos
 * ("Workflow", "workflows", "wf") and enables static analysis.
 * Widen for third-party plugins by extending the union.
 */
export type BaselineSubsystem =
  | "memory"
  | "workflow"
  | "skills"
  | "agents"
  | "tools"
  | "security"
  | "governance"
  | "adaptation"
  | "demo";

// ---------------------------------------------------------------------------
// Provider state
// ---------------------------------------------------------------------------

/** Lifecycle state of a baseline provider. */
export type ProviderState = "registered" | "ready" | "unavailable";

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

/**
 * A snapshot of subsystem health data at a point in time.
 * Generic so each subsystem owns its schema.
 */
export interface BaselineArtifact<T = Record<string, number>> {
  /** The subsystem that produced this artifact. */
  subsystem: BaselineSubsystem;
  /** ISO-8601 capture timestamp. */
  capturedAt: string;
  /** Subsystem-specific health data. */
  data: T;
  /** Optional metadata (e.g. environment, version, tags). */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

/** Categories of subsystem drift. */
export type DriftCategory =
  | "configuration"
  | "performance"
  | "behavior"
  | "structural"
  | "capability"
  | "policy";

/** Severity of a single drift item. */
export type DriftSeverity = "low" | "medium" | "high" | "critical";

/** A single measurable drift between baseline and current state. */
export interface DriftItem {
  /** Stable identifier (e.g. "memory.fragmentation"). */
  id: string;
  /** Drift category for taxonomy and filtering. */
  category: DriftCategory;
  /** Metric name (e.g. "fragmentation", "latency"). */
  metric: string;
  /** Value at baseline capture time. */
  baselineValue: number;
  /** Value at current capture time. */
  currentValue: number;
  /** Absolute difference (current - baseline). */
  delta: number;
  /** Interpreted severity of this drift. */
  severity: DriftSeverity;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Normalized health status. */
export type HealthStatus = "excellent" | "healthy" | "warning" | "critical";

/**
 * Result of comparing a baseline artifact against current state.
 * Recommendations are intentionally absent — they belong closer to
 * Executive integration (P10.10.4).
 */
export interface BaselineComparison {
  subsystem: BaselineSubsystem;
  /** Normalized health score 0–100. */
  score: number;
  /** Status derived from score band. */
  status: HealthStatus;
  /** Ordered list of drift items (highest severity first). */
  drift: DriftItem[];
}

// ---------------------------------------------------------------------------
// Provider metadata (for CLI / registry display)
// ---------------------------------------------------------------------------

/** Public metadata about a registered provider. */
export interface ProviderInfo {
  subsystem: BaselineSubsystem;
  version: string;
  description: string;
  capabilities: string[];
  state: ProviderState;
}
