/**
 * observability-export.ts -- P4.2h Comprehensive Observability Export CLI.
 *
 * Usage: alix observability export [--session <id>] [--json]
 *
 * Outputs a full observability report including health, metrics, alerts,
 * trends (anomalies), and cost attribution data.
 */

import { ObservabilitySnapshotService, overallHealth } from "../../observability/health-snapshot.js";
import { AlertEngine } from "../../observability/alert-engine.js";
import { MetricsStore } from "../../observability/metrics-store.js";
import { TrendAnalyzer } from "../../observability/trend-analyzer.js";
import { CostAttribution } from "../../observability/cost-attribution.js";

export async function cmdExport(cwd: string, args: string[]): Promise<void> {
  const format = args.includes("--json") ? "json" : "markdown";
  const sessionIdx = args.indexOf("--session");
  const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : undefined;

  // Collect health data
  const svc = new ObservabilitySnapshotService(cwd);
  const health = await svc.getHealth();

  // Evaluate alerts
  const engine = new AlertEngine();
  const alerts = engine.evaluate(health);
  const alertState = engine.getState();

  // Collect metrics summary
  const store = new MetricsStore(cwd);
  const metricGroups = new Map<string, { count: number; sum: number }>();
  let totalMetricRows = 0;
  for await (const row of store.readAll({ limit: 500 })) {
    totalMetricRows++;
    const g = metricGroups.get(row.name) ?? { count: 0, sum: 0 };
    g.count++; g.sum += row.value;
    metricGroups.set(row.name, g);
  }

  // Trend / anomaly detection
  const analyzer = new TrendAnalyzer(store);
  const anomalies = await analyzer.detectAnomalies({ sensitivity: 2.0, maxResults: 10 });

  // Cost attribution
  const attribution = new CostAttribution(cwd);
  const costSummary = await attribution.summary(sessionId);

  const overall = overallHealth([health.daemon.status, ...health.providers.map(p => p.status)]);

  if (format === "json") {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      overallHealth: overall,
      health,
      alerts: {
        firing: alerts.firing,
        resolved: alertState.resolved,
      },
      metrics: {
        totalRows: totalMetricRows,
        groups: Object.fromEntries(metricGroups),
      },
      anomalies,
      cost: costSummary,
    }, null, 2));
    return;
  }

  // Markdown format
  console.log(`# ALiX Observability Report`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log();
  console.log(`## Overall Health: ${overall.toUpperCase()}`);
  console.log();

  console.log(`### Health Snapshot`);
  console.log(`- Daemon: ${health.daemon.status}${health.daemon.pid ? ` (PID: ${health.daemon.pid})` : ""}`);
  if (health.daemon.heartbeatAgeMs != null && health.daemon.heartbeatAgeMs >= 0) {
    console.log(`- Heartbeat: ${Math.round(health.daemon.heartbeatAgeMs / 1000)}s ago`);
  }
  console.log(`- Approvals: ${health.approvals.pending} pending, ${health.approvals.total} total`);
  console.log(`- Coordination: ${health.coordination.activeRuns} active runs, ${health.coordination.failedWorkers} failed workers`);
  console.log(`- Ownership: ${health.ownership.conflicts} conflicts, ${health.ownership.expiredLeases} expired leases`);
  console.log(`- Recovery: ${health.recovery.criticalFindings} critical, ${health.recovery.unresolvedFindings} unresolved`);
  console.log(`- Memory: ${health.resources.memoryRssMb} MB RSS, ${health.resources.heapUsedMb} MB heap`);
  console.log();

  console.log(`### Active Alerts (${alerts.firing.length})`);
  if (alerts.firing.length === 0) {
    console.log("No firing alerts.");
  } else {
    for (const a of alerts.firing) {
      console.log(`- [${a.severity.toUpperCase()}] ${a.ruleName}: ${a.message}`);
      console.log(`  (triggered ${a.occurrences}x, first: ${a.firstTriggeredAt})`);
    }
  }
  console.log();

  if (alertState.resolved.length > 0) {
    console.log(`### Resolved Alerts (${alertState.resolved.length})`);
    for (const a of alertState.resolved.slice(-5)) {
      console.log(`- [${a.severity.toUpperCase()}] ${a.ruleName}: resolved ${a.resolvedAt ?? "?"}`);
    }
    console.log();
  }

  console.log(`### Metrics Summary (${totalMetricRows} rows, ${metricGroups.size} metrics)`);
  if (metricGroups.size === 0) {
    console.log("No metrics collected.");
  } else {
    for (const [name, g] of metricGroups) {
      const avg = Math.round(g.sum / g.count);
      console.log(`- ${name}: avg=${avg} count=${g.count}`);
    }
  }
  console.log();

  if (anomalies.length > 0) {
    console.log(`### Anomalies Detected (${anomalies.length})`);
    for (const a of anomalies) {
      console.log(`- ${a.metricName}: value=${a.value} zScore=${a.zScore} (${a.direction})`);
    }
    console.log();
  }

  console.log(`### Cost Attribution`);
  console.log(`- Period: ${costSummary.periodStart || "N/A"} -- ${costSummary.periodEnd}`);
  console.log(`- Total tokens: ${costSummary.totalTokens.toLocaleString()}`);
  console.log(`- Total cost: ${costSummary.totalCost >= 0 ? `$${costSummary.totalCost.toFixed(6)}` : "unknown"}`);
  console.log();
  if (Object.keys(costSummary.byProvider).length > 0) {
    console.log("By Provider:");
    for (const [provider, detail] of Object.entries(costSummary.byProvider)) {
      const costStr = detail.cost < 0 ? "unknown" : `$${detail.cost.toFixed(6)}`;
      console.log(`- ${provider}: ${detail.tokens.toLocaleString()} tokens, ${costStr}, ${detail.calls} calls, ${detail.latencyMs}ms`);
    }
  }
  if (costSummary.unknownPricingModels.length > 0) {
    console.log();
    console.log("Models without pricing:");
    for (const m of costSummary.unknownPricingModels) {
      console.log(`- ${m} (cost unknown)`);
    }
  }
}
