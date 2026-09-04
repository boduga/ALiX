/**
 * observability.ts -- CLI commands for P4.2 observability.
 *
 * Usage:
 *   alix observability health    -- Runtime health snapshot (cached, no side effects)
 *   alix observability metrics   -- Streamed metric summaries
 *   alix observability trends    -- Trend analysis (Task 5)
 *   alix observability alerts    -- Alert evaluation (Task 6)
 *   alix observability export    -- Full report (Task 7)
 */

import { ObservabilitySnapshotService, overallHealth } from "../../observability/health-snapshot.js";
import { MetricsStore } from "../../observability/metrics-store.js";

export async function handleObservability(args: string[], cwd: string): Promise<void> {
  const sub = args[0];
  if (sub === "health" || !sub) { await cmdHealth(cwd); return; }
  if (sub === "metrics") { await cmdMetrics(cwd, args.slice(1)); return; }
  if (sub === "state") { await cmdState(cwd, args.slice(1)); return; }
  if (sub === "trends") { const { cmdTrends } = await import("./observability-trends.js"); await cmdTrends(cwd, args.slice(1)); return; }
  if (sub === "alerts") { const { cmdAlerts } = await import("./observability-alerts.js"); await cmdAlerts(cwd, args.slice(1)); return; }
  if (sub === "export") { const { cmdExport } = await import("./observability-export.js"); await cmdExport(cwd, args.slice(1)); return; }
  if (sub === "diagnostics") { const { cmdDiagnostics } = await import("./observability-diagnostics.js"); await cmdDiagnostics(cwd, args.slice(1)); return; }
  throw new Error("Usage: alix observability {health|metrics|trends|alerts|export|diagnostics|state}");
}

async function cmdHealth(cwd: string): Promise<void> {
  const svc = new ObservabilitySnapshotService(cwd);
  const snap = await svc.getHealth();
  const allStatuses = [snap.daemon.status, ...snap.providers.map(p => p.status)];
  console.log(`ALiX Health: ${overallHealth(allStatuses).toUpperCase()}`);
  console.log(`  Generated: ${snap.generatedAt}`);
  console.log();
  console.log(`Daemon: ${snap.daemon.status}  PID: ${snap.daemon.pid ?? "-"}  Beat: ${snap.daemon.heartbeatAgeMs != null && snap.daemon.heartbeatAgeMs >= 0 ? `${Math.round(snap.daemon.heartbeatAgeMs / 1000)}s` : "unknown"}`);
  console.log();
  console.log(`Providers (${snap.providers.length}):`);
  for (const p of snap.providers) {
    const showLatency = p.latencyMs > 0 ? `${p.latencyMs}ms` : "-";
    const showError = p.errorRate > 0 ? `${(p.errorRate * 100).toFixed(1)}%` : "0%";
    console.log(`  ${p.providerId}: ${p.status}  latency=${showLatency}  err=${showError}`);
  }
  console.log(`\nApprovals: ${snap.approvals.pending} pending / ${snap.approvals.total} total`);
  console.log(`Coordination: ${snap.coordination.activeRuns} active runs`);
  console.log(`Ownership: ${snap.ownership.conflicts} conflicts`);
  console.log(`Recovery: ${snap.recovery.criticalFindings} critical findings`);
  console.log(`Memory: ${snap.resources.memoryRssMb} MB RSS / ${snap.resources.heapUsedMb} MB heap`);
}

async function cmdMetrics(cwd: string, args: string[]): Promise<void> {
  const store = new MetricsStore(cwd);
  const nameIdx = args.indexOf("--name");
  const metricName = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;

  const groups = new Map<string, { count: number; sum: number }>();
  let totalRows = 0;
  for await (const row of store.readAll({ limit })) {
    if (metricName && row.name !== metricName) continue;
    totalRows++;
    const g = groups.get(row.name) ?? { count: 0, sum: 0 };
    g.count++; g.sum += row.value;
    groups.set(row.name, g);
  }

  if (totalRows === 0) { console.log("No metrics found."); return; }
  console.log(`Metrics (${totalRows} rows, ${groups.size} names):`);
  for (const [name, g] of groups) {
    const avg = Math.round(g.sum / g.count);
    console.log(`  ${name}: avg=${avg} count=${g.count}`);
  }

  // State substrate quick summary if any state metrics present
  const stateNames = [...groups.keys()].filter(k => k.startsWith("state_") || k.startsWith("context_tier") || k.startsWith("context_assembly") || k === "history_tokens" || k === "tokens_saved" || k === "patch_rejection_rate" || k === "recovery_count");
  if (stateNames.length > 0 && !metricName) {
    console.log();
    console.log("State substrate (try: alix observability state):");
    for (const n of stateNames) {
      const g = groups.get(n)!;
      console.log(`  ${n}: count=${g.count}`);
    }
  }
  // Context assembly tier hint (#641)
  const tierNames = [...groups.keys()].filter(k => k.startsWith("context_tier") || k.startsWith("context_assembly"));
  if (tierNames.length > 0 && !metricName) {
    console.log();
    console.log("Context assembly tiers (source/selected/evicted/tokens per tier, stateVersion/historyRevision):");
    for (const n of tierNames) {
      const g = groups.get(n)!;
      console.log(`  ${n}: count=${g.count}`);
    }
  }
}

async function cmdState(cwd: string, args: string[]): Promise<void> {
  const { MetricsStore } = await import("../../observability/metrics-store.js");
  const { collectStateMetrics } = await import("../../observability/state-metrics.js");
  const jsonMode = args.includes("--json");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5000;
  const store = new MetricsStore(cwd);
  const summary = await collectStateMetrics(store, { limit });

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (summary.executions.length === 0) {
    console.log("No state metrics found. Emit via StateTelemetry first.");
    console.log("  Metrics: state_projection_accuracy, state_patch_rejection_rate, state_size_tokens, history_tokens, tokens_saved, state_recovery_count");
    console.log("  Context assembly (#641): context_tier_source/selected/evicted/tokens, context_assembly_state_version/history_revision");
    return;
  }

  console.log(`State vs History per execution (${summary.executions.length} executions):`);
  console.log(`  ${"execution".padEnd(22)} ${"state".padStart(7)} ${"history".padStart(7)} ${"saved".padStart(7)} ${"saving%".padStart(8)} ${"accuracy".padStart(9)} ${"recov".padStart(5)} ${"ver".padStart(4)} ${"rev".padStart(4)}`);
  console.log(`  ${"─".repeat(22)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(8)} ${"─".repeat(9)} ${"─".repeat(5)} ${"─".repeat(4)} ${"─".repeat(4)}`);
  for (const e of summary.executions) {
    const savingPct = e.historyTokens && e.historyTokens > 0 && e.tokensSaved != null ? ((e.tokensSaved / e.historyTokens) * 100).toFixed(1) + "%" : "—";
    const acc = e.projectionAccuracy != null ? (e.projectionAccuracy * 100).toFixed(1) + "%" : "—";
    const state = e.stateTokens != null ? String(e.stateTokens) : "—";
    const hist = e.historyTokens != null ? String(e.historyTokens) : "—";
    const saved = e.tokensSaved != null ? String(e.tokensSaved) : "—";
    const ver = (e as any).stateVersion != null ? String((e as any).stateVersion) : "—";
    const rev = (e as any).historyRevision != null ? String((e as any).historyRevision) : "—";
    console.log(`  ${e.executionId.slice(0, 22).padEnd(22)} ${state.padStart(7)} ${hist.padStart(7)} ${saved.padStart(7)} ${String(savingPct).padStart(8)} ${acc.padStart(9)} ${String(e.recoveryCount).padStart(5)} ${ver.padStart(4)} ${rev.padStart(4)}`);
  }
  console.log();
  const t = summary.totals;
  const avgAcc = t.avgAccuracy != null ? (t.avgAccuracy * 100).toFixed(1) + "%" : "—";
  console.log(`Totals: state=${t.totalStateTokens} history=${t.totalHistoryTokens} saved=${t.totalSaved} avgAccuracy=${avgAcc} recoveries=${t.totalRecoveries}`);
  if ((t as any).totalAdmittedTokens != null) {
    console.log(`Context assembly: admitted=${(t as any).totalAdmittedTokens} dropped=${(t as any).totalDroppedTokens ?? 0}`);
  }
  if ((t as any).totalTierTokens) {
    const tt = (t as any).totalTierTokens as Record<string, number>;
    const tierStr = Object.entries(tt).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`Tier tokens: ${tierStr}`);
  }
  // Per-execution tier breakdown (#641) — source/selected/evicted/tokens per tier
  const hasTier = summary.executions.some(e => (e as any).tierTokens || (e as any).tierSources);
  if (hasTier) {
    console.log();
    console.log("Per-tier assembly (source / selected / evicted / tokens):");
    console.log(`  ${"execution".padEnd(22)} ${"tier".padEnd(26)} ${"src".padStart(4)} ${"sel".padStart(4)} ${"ev".padStart(4)} ${"tokens".padStart(7)}`);
    console.log(`  ${"─".repeat(22)} ${"─".repeat(26)} ${"─".repeat(4)} ${"─".repeat(4)} ${"─".repeat(4)} ${"─".repeat(7)}`);
    for (const e of summary.executions) {
      const tt = (e as any).tierTokens as Record<string, number> | null;
      const src = (e as any).tierSources as Record<string, number> | null;
      const sel = (e as any).tierSelected as Record<string, number> | null;
      const ev = (e as any).tierEvicted as Record<string, number> | null;
      if (!tt && !src) continue;
      const tiers = new Set([...Object.keys(tt ?? {}), ...Object.keys(src ?? {}), ...Object.keys(sel ?? {}), ...Object.keys(ev ?? {})]);
      for (const tier of tiers) {
        const s = src?.[tier] != null ? String(src[tier]) : "—";
        const se = sel?.[tier] != null ? String(sel[tier]) : "—";
        const evv = ev?.[tier] != null ? String(ev[tier]) : "—";
        const tok = tt?.[tier] != null ? String(tt[tier]) : "—";
        console.log(`  ${e.executionId.slice(0, 22).padEnd(22)} ${tier.padEnd(26)} ${s.padStart(4)} ${se.padStart(4)} ${evv.padStart(4)} ${tok.padStart(7)}`);
      }
    }
  }
  console.log(`Workflow metric workflow_duration etc. remain queryable via: alix observability metrics --name workflow_duration_ms`);
}
