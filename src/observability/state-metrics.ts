/**
 * state-metrics.ts — Per-execution state vs history aggregation (§28-29)
 *
 * Reads MetricsStore rows and projects per-execution comparison for
 * dashboard/CLI. Pure read projection — no mutation.
 */

import type { MetricsStore } from "./metrics-store.js";

export interface ExecutionTokenComparison {
  executionId: string;
  stateTokens: number | null;
  historyTokens: number | null;
  tokensSaved: number | null;
  contextTokens: number | null;
  projectionAccuracy: number | null;
  patchRejectionRate: number | null;
  recoveryCount: number;
  substrateMode?: string;
  lastTimestamp: string | null;
  // Context assembly observability (§28, #641) — latest snapshot per execution
  stateVersion?: number | null;
  historyRevision?: number | null;
  admittedTokens?: number | null;
  droppedTokens?: number | null;
  tierTokens?: Record<string, number> | null;
  tierSources?: Record<string, number> | null;
  tierSelected?: Record<string, number> | null;
  tierEvicted?: Record<string, number> | null;
}

export interface StateMetricsSummary {
  executions: ExecutionTokenComparison[];
  totals: {
    executions: number;
    totalStateTokens: number;
    totalHistoryTokens: number;
    totalSaved: number;
    avgAccuracy: number | null;
    totalRecoveries: number;
    // Extended totals for context assembly tiers (#641)
    totalAdmittedTokens?: number;
    totalDroppedTokens?: number;
    totalTierTokens?: Record<string, number>;
  };
}

/**
 * Scan MetricsStore for state substrate metrics and group by executionId label.
 * Latest gauge value wins per execution; counters are summed.
 */
export async function collectStateMetrics(store: MetricsStore, opts?: { limit?: number; after?: string; before?: string }): Promise<StateMetricsSummary> {
  const rows: Array<{ name: string; value: number; timestamp: string; labels?: Record<string, string> }> = [];
  for await (const r of store.readAll({ limit: opts?.limit ?? 10000, after: opts?.after, before: opts?.before })) {
    if (
      r.name === "state_size_tokens" || r.name === "state_tokens" ||
      r.name === "history_tokens" ||
      r.name === "tokens_saved" || r.name === "state_tokens_saved" ||
      r.name === "context_tokens_total" ||
      r.name === "state_projection_accuracy" ||
      r.name === "state_patch_rejection_rate" || r.name === "patch_rejection_rate" ||
      r.name === "state_recovery_count" || r.name === "recovery_count" ||
      r.name === "context_tier_source" || r.name === "context_tier_selected" ||
      r.name === "context_tier_evicted" || r.name === "context_tier_tokens" ||
      r.name === "context_assembly_state_version" || r.name === "context_assembly_history_revision" ||
      r.name === "context_assembly_admitted_tokens" || r.name === "context_assembly_dropped_tokens"
    ) {
      rows.push(r);
    }
  }

  const byExec = new Map<string, ExecutionTokenComparison>();

  function get(execId: string): ExecutionTokenComparison {
    let e = byExec.get(execId);
    if (!e) {
      e = {
        executionId: execId, stateTokens: null, historyTokens: null, tokensSaved: null, contextTokens: null, projectionAccuracy: null, patchRejectionRate: null, recoveryCount: 0, lastTimestamp: null,
        stateVersion: null, historyRevision: null, admittedTokens: null, droppedTokens: null,
        tierTokens: null, tierSources: null, tierSelected: null, tierEvicted: null,
      };
      byExec.set(execId, e);
    }
    return e;
  }

  // For gauges: keep latest by timestamp per execution. For counters: sum.
  const latestGaugeTs = new Map<string, string>(); // key `${execId}:${metric}`

  for (const r of rows) {
    const execId = r.labels?.executionId;
    if (!execId) continue;
    const entry = get(execId);
    if (r.timestamp > (entry.lastTimestamp ?? "")) entry.lastTimestamp = r.timestamp;
    if (r.labels?.substrateMode && !entry.substrateMode) entry.substrateMode = r.labels.substrateMode;

    switch (r.name) {
      case "state_size_tokens":
      case "state_tokens": {
        const key = `${execId}:state`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.stateTokens = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "history_tokens": {
        const key = `${execId}:history`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.historyTokens = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "tokens_saved":
      case "state_tokens_saved": {
        const key = `${execId}:saved`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.tokensSaved = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_tokens_total": {
        const key = `${execId}:ctx`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.contextTokens = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "state_projection_accuracy": {
        const key = `${execId}:acc`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.projectionAccuracy = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "state_patch_rejection_rate":
      case "patch_rejection_rate": {
        const key = `${execId}:rejRate`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.patchRejectionRate = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "state_recovery_count": {
        entry.recoveryCount += r.value;
        break;
      }
      case "recovery_count": {
        // alias — counted via primary to avoid double when both emitted; include only if primary absent?
        // Keep for queryability but dedup: ignore if primary already covers same timestamp would double.
        // We count alias only when no primary row for this exec exists in this batch (fallback).
        // Simple: do not double-count; alias rows are queryable via MetricsStore but dashboard uses canonical.
        break;
      }
      case "context_tier_source": {
        const tier = r.labels?.tier ?? "unknown";
        const key = `${execId}:src:${tier}`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          if (!entry.tierSources) entry.tierSources = {};
          entry.tierSources[tier] = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_tier_selected": {
        const tier = r.labels?.tier ?? "unknown";
        const key = `${execId}:sel:${tier}`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          if (!entry.tierSelected) entry.tierSelected = {};
          entry.tierSelected[tier] = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_tier_evicted": {
        const tier = r.labels?.tier ?? "unknown";
        const key = `${execId}:ev:${tier}`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          if (!entry.tierEvicted) entry.tierEvicted = {};
          entry.tierEvicted[tier] = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_tier_tokens": {
        const tier = r.labels?.tier ?? "unknown";
        const key = `${execId}:tok:${tier}`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          if (!entry.tierTokens) entry.tierTokens = {};
          entry.tierTokens[tier] = r.value;
          // Backfill state/history from tier when direct gauges absent — preferred source is tier breakdown
          if (tier === "current_execution_state") entry.stateTokens = r.value;
          else if (tier === "older_context") entry.historyTokens = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_assembly_state_version": {
        const key = `${execId}:stv`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.stateVersion = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_assembly_history_revision": {
        const key = `${execId}:hrv`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.historyRevision = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_assembly_admitted_tokens": {
        const key = `${execId}:admTok`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.admittedTokens = r.value;
          if (entry.contextTokens == null) entry.contextTokens = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
      case "context_assembly_dropped_tokens": {
        const key = `${execId}:dropTok`;
        if (!latestGaugeTs.has(key) || r.timestamp >= latestGaugeTs.get(key)!) {
          entry.droppedTokens = r.value;
          latestGaugeTs.set(key, r.timestamp);
        }
        break;
      }
    }
  }

  // Backfill tokensSaved if missing but state/history present
  for (const e of byExec.values()) {
    if (e.tokensSaved == null && e.stateTokens != null && e.historyTokens != null) {
      e.tokensSaved = Math.max(0, e.historyTokens - e.stateTokens);
    }
    // Backfill state/history from tierTokens when legacy gauges absent
    if (e.stateTokens == null && e.tierTokens?.["current_execution_state"] != null) {
      e.stateTokens = e.tierTokens["current_execution_state"]!;
    }
    if (e.historyTokens == null && e.tierTokens?.["older_context"] != null) {
      e.historyTokens = e.tierTokens["older_context"]!;
    }
  }

  const executions = [...byExec.values()].sort((a, b) => (a.executionId < b.executionId ? -1 : 1));

  const totalStateTokens = executions.reduce((s, e) => s + (e.stateTokens ?? 0), 0);
  const totalHistoryTokens = executions.reduce((s, e) => s + (e.historyTokens ?? 0), 0);
  const totalSaved = executions.reduce((s, e) => s + (e.tokensSaved ?? 0), 0);
  const totalRecoveries = executions.reduce((s, e) => s + e.recoveryCount, 0);
  const accs = executions.filter(e => e.projectionAccuracy != null).map(e => e.projectionAccuracy!);
  const avgAccuracy = accs.length > 0 ? accs.reduce((a, b) => a + b, 0) / accs.length : null;

  // Extended totals for context assembly (#641)
  const totalAdmittedTokens = executions.reduce((s, e) => s + (e.admittedTokens ?? e.contextTokens ?? 0), 0);
  const totalDroppedTokens = executions.reduce((s, e) => s + (e.droppedTokens ?? 0), 0);
  const totalTierTokens: Record<string, number> = {};
  for (const e of executions) {
    if (!e.tierTokens) continue;
    for (const [tier, tok] of Object.entries(e.tierTokens)) {
      totalTierTokens[tier] = (totalTierTokens[tier] ?? 0) + tok;
    }
  }

  return {
    executions,
    totals: {
      executions: executions.length,
      totalStateTokens,
      totalHistoryTokens,
      totalSaved,
      avgAccuracy,
      totalRecoveries,
      totalAdmittedTokens,
      totalDroppedTokens,
      totalTierTokens: Object.keys(totalTierTokens).length > 0 ? totalTierTokens : undefined,
    },
  };
}
