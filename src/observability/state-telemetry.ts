/**
 * state-telemetry.ts — State Substrate Telemetry Adapter (issue #631)
 *
 * Typed wrapper around MetricsStore for the SKILL.state-inspired execution
 * substrate. Mirrors SecurityTelemetry pattern: callers pass typed args,
 * never raw label dictionaries. Extensions live in src/observability/* only;
 * contract/store/projector/governor remain untouched (§28-29).
 *
 * Flow: StateStore/Projector/Governor → StateTelemetry → MetricsStore →
 * MetricsStore/TelemetryEnvelope → dashboard/CLI (via MetricsStore read +
 * normalizeMetricEvent). Also emits TelemetryEnvelope via optional sink.
 *
 * @module
 */

import { createTelemetryEnvelope, type TelemetrySink } from "./telemetry-envelope.js";
import type { MetricRegistry } from "./metric-registry.js";
import type { MetricsStore, MetricRow } from "./metrics-store.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StateTelemetryOptions {
  registry: MetricRegistry;
  metricsStore: MetricsStore;
  /** Optional TelemetrySink for envelope fan-out (SSE/Inspector). */
  telemetrySink?: TelemetrySink;
  /** Correlation sessionId for envelope creation (optional). */
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// StateTelemetry
// ---------------------------------------------------------------------------

export class StateTelemetry {
  protected registry: MetricRegistry;
  protected store: MetricsStore;
  protected sink?: TelemetrySink;
  protected sessionId: string;

  constructor(opts: StateTelemetryOptions) {
    this.registry = opts.registry;
    this.store = opts.metricsStore;
    this.sink = opts.telemetrySink;
    this.sessionId = opts.sessionId ?? "state-substrate";
  }

  // ── Projection adequacy (§29 primary) ────────────────────────────────

  /** Record state projection accuracy (0..1). Primary adequacy metric. */
  projectionAccuracy(executionId: string, accuracy: number, substrateMode?: string): void {
    this.emit("state_projection_accuracy", { executionId, ...(substrateMode ? { substrateMode } : {}) }, accuracy);
  }

  // ── Patch lifecycle ──────────────────────────────────────────────────

  /** Record a patch rejection (increments total + updates rate gauge via helper). */
  patchRejected(executionId: string, reason?: string): void {
    const labels: Record<string, string> = { executionId };
    if (reason) labels.reason = reason;
    this.emit("state_patch_rejection_total", labels, 1);
    this.emit("state_patch_count", { executionId, result: "rejected" }, 1);
  }

  /** Record an accepted patch. */
  patchAccepted(executionId: string): void {
    this.emit("state_patch_count", { executionId, result: "accepted" }, 1);
  }

  /** Record current patch rejection rate (0..1). Computed externally; emitted as gauge. */
  patchRejectionRate(executionId: string, rate: number, reason?: string): void {
    const labels: Record<string, string> = { executionId };
    if (reason) labels.reason = reason;
    this.emit("state_patch_rejection_rate", labels, rate);
    // alias for acceptance-criteria string match
    this.emit("patch_rejection_rate", labels, rate);
  }

  // ── Token accounting (§28) ───────────────────────────────────────────

  /** Record current state size in tokens (and bytes if known). */
  stateSize(executionId: string, tokens: number, bytes?: number, substrateMode?: string): void {
    const labels: Record<string, string> = { executionId };
    if (substrateMode) labels.substrateMode = substrateMode;
    this.emit("state_size_tokens", labels, tokens);
    this.emit("state_tokens", { executionId }, tokens);
    if (typeof bytes === "number") this.emit("state_size_bytes", { executionId }, bytes);
  }

  /** Record history token count for comparison. */
  historyTokens(executionId: string, tokens: number): void {
    this.emit("history_tokens", { executionId }, tokens);
  }

  /** Record tokens saved vs full-history baseline. Positive = savings. */
  tokensSaved(executionId: string, saved: number, substrateMode?: string): void {
    const labels: Record<string, string> = { executionId };
    if (substrateMode) labels.substrateMode = substrateMode;
    this.emit("tokens_saved", labels, saved);
    this.emit("state_tokens_saved", { executionId }, saved);
  }

  /** Record total assembled context tokens (state+O+evidence+history). */
  contextTokens(executionId: string, total: number, substrateMode?: string): void {
    const labels: Record<string, string> = { executionId };
    if (substrateMode) labels.substrateMode = substrateMode;
    this.emit("context_tokens_total", labels, total);
  }

  // ── Recovery & versioning ────────────────────────────────────────────

  /** Record a recovery event (fallback to EventLog / history retrieval). */
  recovery(executionId: string, steps?: number, reason?: string): void {
    const labels: Record<string, string> = { executionId };
    if (reason) labels.reason = reason;
    this.emit("state_recovery_count", labels, 1);
    this.emit("recovery_count", labels, 1);
    if (typeof steps === "number") this.emit("state_recovery_steps", { executionId }, steps);
  }

  /** Record a version conflict (stale base_state_version). */
  versionConflict(executionId: string): void {
    this.emit("state_version_conflicts", { executionId }, 1);
  }

  /** Record projection latency. */
  projectionLatency(executionId: string, ms: number): void {
    this.emit("state_projection_latency_ms", { executionId }, ms);
  }

  /** Record projection failure (fallback to authoritative history). */
  projectionFailure(executionId: string, reason?: string): void {
    const labels: Record<string, string> = { executionId };
    if (reason) labels.reason = reason;
    this.emit("state_projection_failures_total", labels, 1);
  }

  // ── Composite helper ─────────────────────────────────────────────────

  /**
   * Convenience: record full token snapshot for one execution in one call.
   * Computes tokens_saved = history - state (clamped at 0).
   */
  tokenSnapshot(opts: {
    executionId: string;
    stateTokens: number;
    historyTokens: number;
    stateBytes?: number;
    substrateMode?: string;
  }): void {
    this.stateSize(opts.executionId, opts.stateTokens, opts.stateBytes, opts.substrateMode);
    this.historyTokens(opts.executionId, opts.historyTokens);
    const saved = Math.max(0, opts.historyTokens - opts.stateTokens);
    this.tokensSaved(opts.executionId, saved, opts.substrateMode);
    this.contextTokens(opts.executionId, opts.stateTokens, opts.substrateMode);
  }

  // ── Internal emit ────────────────────────────────────────────────────

  private pendingWrites: Array<Promise<void>> = [];

  protected emit(name: string, labels: Record<string, string>, value: number): void {
    const def = this.registry.get(name);
    const row: MetricRow = {
      name,
      type: def?.type ?? "gauge",
      value,
      timestamp: isoNow(),
      labels: Object.keys(labels).length > 0 ? labels : undefined,
    };
    // Fire MetricsStore + optional TelemetrySink (non-blocking, swallowed on error)
    this.safeAppend(row);
    this.emitEnvelope(row);
  }

  protected safeAppend(row: MetricRow): void {
    const p = (async () => {
      try {
        for await (const _ of this.store.append(row)) { /* drain */ }
      } catch (err) {
        console.error(`[StateTelemetry] failed to emit ${row.name}:`, err);
      }
    })();
    this.pendingWrites.push(p);
    p.finally(() => {
      const idx = this.pendingWrites.indexOf(p);
      if (idx >= 0) this.pendingWrites.splice(idx, 1);
    });
  }

  protected emitEnvelope(row: MetricRow): void {
    if (!this.sink) return;
    try {
      const env = createTelemetryEnvelope({
        sessionId: this.sessionId,
        category: "observability",
        eventType: `metric.${row.name}`,
        severity: "info",
        dimensions: { metricType: row.type, ...(row.labels ?? {}) },
        measurements: { value: row.value },
        payload: { metricName: row.name, timestamp: row.timestamp } as unknown as Record<string, unknown>,
      });
      this.sink.append(env).catch(() => { /* non-fatal */ });
    } catch { /* swallow envelope errors */ }
  }

  async flush(): Promise<void> {
    await Promise.all(this.pendingWrites);
  }
}

// ---------------------------------------------------------------------------
// FakeStateTelemetry (for testing)
// ---------------------------------------------------------------------------

export class FakeStateTelemetry extends StateTelemetry {
  events: Array<{ method: string; args: unknown[] }> = [];

  private tracked(method: string, args: unknown[]): void {
    this.events.push({ method, args });
  }

  override projectionAccuracy(executionId: string, accuracy: number, substrateMode?: string): void {
    this.tracked("projectionAccuracy", [executionId, accuracy, substrateMode]);
    super.projectionAccuracy(executionId, accuracy, substrateMode);
  }
  override patchRejected(executionId: string, reason?: string): void {
    this.tracked("patchRejected", [executionId, reason]);
    super.patchRejected(executionId, reason);
  }
  override patchAccepted(executionId: string): void {
    this.tracked("patchAccepted", [executionId]);
    super.patchAccepted(executionId);
  }
  override patchRejectionRate(executionId: string, rate: number, reason?: string): void {
    this.tracked("patchRejectionRate", [executionId, rate, reason]);
    super.patchRejectionRate(executionId, rate, reason);
  }
  override stateSize(executionId: string, tokens: number, bytes?: number, substrateMode?: string): void {
    this.tracked("stateSize", [executionId, tokens, bytes, substrateMode]);
    super.stateSize(executionId, tokens, bytes, substrateMode);
  }
  override historyTokens(executionId: string, tokens: number): void {
    this.tracked("historyTokens", [executionId, tokens]);
    super.historyTokens(executionId, tokens);
  }
  override tokensSaved(executionId: string, saved: number, substrateMode?: string): void {
    this.tracked("tokensSaved", [executionId, saved, substrateMode]);
    super.tokensSaved(executionId, saved, substrateMode);
  }
  override contextTokens(executionId: string, total: number, substrateMode?: string): void {
    this.tracked("contextTokens", [executionId, total, substrateMode]);
    super.contextTokens(executionId, total, substrateMode);
  }
  override recovery(executionId: string, steps?: number, reason?: string): void {
    this.tracked("recovery", [executionId, steps, reason]);
    super.recovery(executionId, steps, reason);
  }
  override versionConflict(executionId: string): void {
    this.tracked("versionConflict", [executionId]);
    super.versionConflict(executionId);
  }
  override projectionLatency(executionId: string, ms: number): void {
    this.tracked("projectionLatency", [executionId, ms]);
    super.projectionLatency(executionId, ms);
  }
  override projectionFailure(executionId: string, reason?: string): void {
    this.tracked("projectionFailure", [executionId, reason]);
    super.projectionFailure(executionId, reason);
  }
  override tokenSnapshot(opts: { executionId: string; stateTokens: number; historyTokens: number; stateBytes?: number; substrateMode?: string }): void {
    this.tracked("tokenSnapshot", [opts]);
    super.tokenSnapshot(opts);
  }
}
