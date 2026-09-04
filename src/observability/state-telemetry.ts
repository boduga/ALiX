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

  // ── Context assembly observability (§28, #641) ───────────────────────

  /**
   * Record per-tier source/selected/evicted/tokens for one assembly.
   *
   * Wires the real ContextAssembler (src/config/context-assembly.ts) to
   * MetricsStore/TelemetryEnvelope. Each tier gets 4 gauge snapshots plus
   * aggregate admitted/dropped tokens and optional stateVersion/historyRevision.
   *
   * @param opts.executionId - correlation key (sessionId when no ExecutionState)
   * @param opts.invocationId - per-assembly correlation (optional)
   * @param opts.stateVersion - ExecutionState.version at assembly time
   * @param opts.historyRevision - EventLog checkpoint revision at assembly time
   * @param opts.tierSources - candidate count per tier before assembly
   * @param opts.tierSelected - admitted count per tier
   * @param opts.tierEvicted - evicted count per tier (budget_exhausted+protected)
   * @param opts.tierTokens - admitted tokens per tier
   * @param opts.admittedTokens - total admitted tokens
   * @param opts.droppedTokens - total dropped tokens
   */
  recordContextAssembly(opts: {
    executionId: string;
    invocationId?: string;
    stateVersion?: number;
    historyRevision?: number;
    tierSources: Record<string, number>;
    tierSelected: Record<string, number>;
    tierEvicted: Record<string, number>;
    tierTokens: Record<string, number>;
    admittedTokens: number;
    droppedTokens: number;
    substrateMode?: string;
  }): void {
    const inv = opts.invocationId;
    const baseLabels = (tier: string) => ({
      executionId: opts.executionId,
      tier,
      ...(inv ? { invocationId: inv } : {}),
    });

    // Per-tier source / selected / evicted / tokens (gauge snapshots)
    for (const tier of Object.keys(opts.tierTokens)) {
      const src = opts.tierSources[tier] ?? 0;
      const sel = opts.tierSelected[tier] ?? 0;
      const ev = opts.tierEvicted[tier] ?? 0;
      const tok = opts.tierTokens[tier] ?? 0;
      this.emit("context_tier_source", baseLabels(tier), src);
      this.emit("context_tier_selected", baseLabels(tier), sel);
      this.emit("context_tier_evicted", baseLabels(tier), ev);
      this.emit("context_tier_tokens", baseLabels(tier), tok);
      // Also emit evicted breakdown by reason as single count (reason aggregated)
      // No extra emit needed — tier_evicted already covers total; callers needing
      // per-reason splits should call contextAssemblyEvictedByReason separately.
    }

    // Ensure every tier that appeared in sources but not tokens still emitted
    for (const tier of Object.keys(opts.tierSources)) {
      if (tier in opts.tierTokens) continue;
      const src = opts.tierSources[tier] ?? 0;
      const sel = opts.tierSelected[tier] ?? 0;
      const ev = opts.tierEvicted[tier] ?? 0;
      this.emit("context_tier_source", baseLabels(tier), src);
      this.emit("context_tier_selected", baseLabels(tier), sel);
      this.emit("context_tier_evicted", baseLabels(tier), ev);
      this.emit("context_tier_tokens", baseLabels(tier), 0);
    }

    const metaLabels: Record<string, string> = { executionId: opts.executionId, ...(inv ? { invocationId: inv } : {}) };
    if (typeof opts.stateVersion === "number") {
      this.emit("context_assembly_state_version", metaLabels, opts.stateVersion);
    }
    if (typeof opts.historyRevision === "number") {
      this.emit("context_assembly_history_revision", metaLabels, opts.historyRevision);
    }
    this.emit("context_assembly_admitted_tokens", metaLabels, opts.admittedTokens);
    this.emit("context_assembly_dropped_tokens", metaLabels, opts.droppedTokens);

    // Also keep the §28 token comparison up to date via the existing gauges:
    // state tokens = tier current_execution_state, history tokens = tier older_context (if present)
    const stateTok = opts.tierTokens["current_execution_state"];
    const histTok = opts.tierTokens["older_context"];
    if (typeof stateTok === "number") this.stateSize(opts.executionId, stateTok, undefined, opts.substrateMode);
    if (typeof histTok === "number") this.historyTokens(opts.executionId, histTok);
    if (typeof stateTok === "number" && typeof histTok === "number") {
      this.tokensSaved(opts.executionId, Math.max(0, histTok - stateTok), opts.substrateMode);
      this.contextTokens(opts.executionId, opts.admittedTokens, opts.substrateMode);
    }
  }

  /**
   * Convenience: derive per-tier breakdown directly from an AssembledContext.
   * Computes source = admitted+evicted per tier, selected = admitted per tier,
   * evicted = dropped per tier, tokens = admitted tokens per tier.
   */
  recordAssembledContext(
    executionId: string,
    assembled: {
      admitted: readonly { category: string; tokens: number }[];
      dropped: readonly { item: { category: string } }[];
      admittedTokens: number;
      droppedTokens: number;
    },
    meta?: { invocationId?: string; stateVersion?: number; historyRevision?: number; substrateMode?: string },
  ): void {
    const tierSources: Record<string, number> = {};
    const tierSelected: Record<string, number> = {};
    const tierEvicted: Record<string, number> = {};
    const tierTokens: Record<string, number> = {};

    for (const a of assembled.admitted) {
      tierSelected[a.category] = (tierSelected[a.category] ?? 0) + 1;
      tierTokens[a.category] = (tierTokens[a.category] ?? 0) + a.tokens;
    }
    for (const d of assembled.dropped) {
      tierEvicted[d.item.category] = (tierEvicted[d.item.category] ?? 0) + 1;
    }
    for (const cat of new Set([...Object.keys(tierSelected), ...Object.keys(tierEvicted)])) {
      tierSources[cat] = (tierSelected[cat] ?? 0) + (tierEvicted[cat] ?? 0);
      // Ensure tokens entry exists for every tier that has counts
      if (!(cat in tierTokens)) tierTokens[cat] = 0;
    }

    this.recordContextAssembly({
      executionId,
      invocationId: meta?.invocationId,
      stateVersion: meta?.stateVersion,
      historyRevision: meta?.historyRevision,
      tierSources,
      tierSelected,
      tierEvicted,
      tierTokens,
      admittedTokens: assembled.admittedTokens,
      droppedTokens: assembled.droppedTokens,
      substrateMode: meta?.substrateMode,
    });
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
  override recordContextAssembly(opts: {
    executionId: string;
    invocationId?: string;
    stateVersion?: number;
    historyRevision?: number;
    tierSources: Record<string, number>;
    tierSelected: Record<string, number>;
    tierEvicted: Record<string, number>;
    tierTokens: Record<string, number>;
    admittedTokens: number;
    droppedTokens: number;
    substrateMode?: string;
  }): void {
    this.tracked("recordContextAssembly", [opts]);
    super.recordContextAssembly(opts);
  }
  override recordAssembledContext(
    executionId: string,
    assembled: { admitted: readonly { category: string; tokens: number }[]; dropped: readonly { item: { category: string } }[]; admittedTokens: number; droppedTokens: number },
    meta?: { invocationId?: string; stateVersion?: number; historyRevision?: number; substrateMode?: string },
  ): void {
    this.tracked("recordAssembledContext", [executionId, assembled, meta]);
    super.recordAssembledContext(executionId, assembled, meta);
  }
}
