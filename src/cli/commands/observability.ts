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
  if (sub === "trends") { const { cmdTrends } = await import("./observability-trends.js"); await cmdTrends(cwd, args.slice(1)); return; }
  if (sub === "alerts") { const { cmdAlerts } = await import("./observability-alerts.js"); await cmdAlerts(cwd, args.slice(1)); return; }
  if (sub === "export") { const { cmdExport } = await import("./observability-export.js"); await cmdExport(cwd, args.slice(1)); return; }
  console.error("Usage: alix observability {health|metrics|trends|alerts|export}");
  process.exit(1);
}

async function cmdHealth(cwd: string): Promise<void> {
  const svc = new ObservabilitySnapshotService(cwd);
  const snap = await svc.getHealth();
  const allStatuses = [snap.daemon.status, ...snap.providers.map(p => p.status)];
  console.log(`ALiX Health: ${(await overallHealth(allStatuses)).toUpperCase()}`);
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

  if (totalRows === 0) { console.log("No metrics found."); process.exit(0); }
  console.log(`Metrics (${totalRows} rows, ${groups.size} names):`);
  for (const [name, g] of groups) {
    const avg = Math.round(g.sum / g.count);
    console.log(`  ${name}: avg=${avg} count=${g.count}`);
  }
}
