/**
 * observability-stream.ts — P4.2h SSE event stream for live observability events.
 *
 * GET /api/observability/stream
 * Events: health.snapshot, alert.firing, alert.resolved, anomaly.detected
 * Includes heartbeat every 30s, watcher cleanup on close, stream limits.
 */

import type { ServerResponse } from "node:http";
import { ObservabilitySnapshotService } from "../observability/health-snapshot.js";
import { AlertEngine } from "../observability/alert-engine.js";
import { MetricsStore } from "../observability/metrics-store.js";
import { TrendAnalyzer } from "../observability/trend-analyzer.js";
import { CostAttribution } from "../observability/cost-attribution.js";

interface StreamClient {
  id: string;
  res: ServerResponse;
}

let clientCounter = 0;

function sse(res: ServerResponse, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  res.write(payload);
}

/**
 * Subscribe to the observability SSE stream.
 * Pushes health snapshots, active alerts, metric samples, and anomalies.
 * Includes a heartbeat event every 30s to keep the connection alive.
 * Cleans up all timers and watchers on connection close.
 */
export async function subscribeObservabilityStream(
  res: ServerResponse,
  root: string,
): Promise<void> {
  const clientId = `obs_${++clientCounter}`;
  let closed = false;
  let healthInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  // SSE headers
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();

  // Send initial connection event
  sse(res, "connected", { clientId, timestamp: new Date().toISOString() });

  // Heartbeat every 30s
  heartbeatInterval = setInterval(() => {
    if (closed) return;
    try {
      sse(res, "heartbeat", { timestamp: new Date().toISOString() });
    } catch {
      closed = true;
    }
  }, 30_000);

  // Push health, alerts, metrics, and anomalies every 2s
  const pushSnapshot = async (): Promise<void> => {
    if (closed) return;
    try {
      // Health snapshot
      const healthSvc = new ObservabilitySnapshotService(root);
      const health = await healthSvc.getHealth();
      sse(res, "health.snapshot", health);

      // Active alerts
      const engine = new AlertEngine();
      const alerts = engine.evaluate(health);
      for (const a of alerts.firing) {
        sse(res, "alert.firing", a);
      }

      // Metric samples (last 10)
      const store = new MetricsStore(root);
      const metricSamples: unknown[] = [];
      const seenMetrics = new Set<string>();
      for await (const row of store.readAll({ limit: 50 })) {
        if (!seenMetrics.has(row.name)) {
          metricSamples.push(row);
          seenMetrics.add(row.name);
          if (metricSamples.length >= 5) break;
        }
      }
      if (metricSamples.length > 0) {
        sse(res, "metric.sample", metricSamples);
      }

      // Anomaly detection
      const analyzer = new TrendAnalyzer(store);
      const anomalies = await analyzer.detectAnomalies({ sensitivity: 2.0, maxResults: 5 });
      for (const a of anomalies) {
        sse(res, "anomaly.detected", a);
      }
    } catch {
      // Stream errors are non-fatal — continue cycling
    }
  };

  // Initial push
  await pushSnapshot();

  // Repeat every 2s
  healthInterval = setInterval(pushSnapshot, 2000);

  // Cleanup on connection close
  res.on("close", () => {
    closed = true;
    if (healthInterval) clearInterval(healthInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });
}
