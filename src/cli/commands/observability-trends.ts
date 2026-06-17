/**
 * observability-trends.ts -- P4.2e Trend Analysis CLI.
 *
 * Usage:
 *   alix observability trends                    — show windowed trends + anomalies
 *   alix observability trends --name <metric>    — filter to one metric
 *   alix observability trends --sensitivity 3.0  — anomaly threshold (default 2.0)
 *   alix observability trends --window 60000     — window size in ms (default 60000)
 *   alix observability trends --max 20           — max anomaly results (default 10)
 */

import { MetricsStore } from "../../observability/metrics-store.js";
import { TrendAnalyzer } from "../../observability/trend-analyzer.js";

export async function cmdTrends(cwd: string, _args: string[]): Promise<void> {
  const store = new MetricsStore(cwd);
  const analyzer = new TrendAnalyzer(store);

  const nameIdx = _args.indexOf("--name");
  const metricName = nameIdx >= 0 ? _args[nameIdx + 1] : undefined;
  const sensitivityIdx = _args.indexOf("--sensitivity");
  const sensitivity = sensitivityIdx >= 0 ? parseFloat(_args[sensitivityIdx + 1]) : 2.0;
  const windowIdx = _args.indexOf("--window");
  const windowSizeMs = windowIdx >= 0 ? parseInt(_args[windowIdx + 1], 10) : 60_000;
  const maxIdx = _args.indexOf("--max");
  const maxResults = maxIdx >= 0 ? parseInt(_args[maxIdx + 1], 10) : 10;

  // Windowed trends
  if (metricName) {
    console.log(`Trends for "${metricName}" (window: ${windowSizeMs}ms):`);
    const windows = await analyzer.computeWindowed(metricName, { windowSizeMs });
    if (windows.length === 0) {
      console.log("  No data found.");
    } else {
      for (const w of windows) {
        const start = new Date(w.windowStart).toISOString().slice(11, 19);
        console.log(`  ${start} | count=${w.count} avg=${w.avg.toFixed(1)} p50=${w.p50} p95=${w.p95} p99=${w.p99} min=${w.min} max=${w.max}`);
      }
    }
  } else {
    // Summary: pull all metric names and show windowed trends for each
    const names = new Set<string>();
    for await (const row of store.readAll({ limit: 500 })) {
      names.add(row.name);
    }
    if (names.size === 0) {
      console.log("No metrics found.");
      return;
    }
    console.log(`Trending ${names.size} metric(s) (window: ${windowSizeMs}ms, sensitivity: ${sensitivity}):`);
    for (const name of names) {
      const windows = await analyzer.computeWindowed(name, { windowSizeMs });
      if (windows.length === 0) continue;
      const latest = windows[windows.length - 1];
      console.log(`  ${name}: ${windows.length} windows, latest avg=${latest.avg.toFixed(1)} p50=${latest.p50}`);
    }
  }

  // Anomaly detection
  console.log();
  console.log("Anomalies:");
  const anomalies = await analyzer.detectAnomalies({ sensitivity, maxResults });
  if (anomalies.length === 0) {
    console.log("  No anomalies detected.");
  } else {
    for (const a of anomalies) {
      const dir = a.direction === "high" ? "↑" : "↓";
      console.log(`  [${a.metricName}] ${dir} z=${a.zScore.toFixed(2)} value=${a.value}`);
    }
  }
}
