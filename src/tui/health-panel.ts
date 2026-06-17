/**
 * health-panel.ts — P4.2h TUI panel for system health display.
 *
 * Renders a RuntimeHealthSnapshot as a formatted TUI panel with
 * color-coded status indicators.
 */

import type { RuntimeHealthSnapshot, HealthStatus } from "../observability/health-snapshot.js";

function statusColor(s: HealthStatus): string {
  if (s === "healthy") return "\x1b[32m";   // green
  if (s === "degraded") return "\x1b[33m";  // yellow
  if (s === "unhealthy") return "\x1b[31m"; // red
  return "\x1b[2m";                          // dim for unknown
}

function statusDot(s: HealthStatus): string {
  return `${statusColor(s)}●\x1b[0m`;
}

/**
 * Format a RuntimeHealthSnapshot into TUI panel lines.
 */
export function formatHealthPanel(snap: RuntimeHealthSnapshot, _width?: number): string[] {
  const lines: string[] = [];
  lines.push(`── Health ────────────────────────────────`);
  lines.push(` Generated: ${snap.generatedAt.slice(0, 19)}`);

  // Daemon
  const daemonIcon = statusDot(snap.daemon.status);
  lines.push(` ${daemonIcon} Daemon: ${snap.daemon.status} PID: ${snap.daemon.pid ?? "-"}`);
  if (snap.daemon.heartbeatAgeMs != null && snap.daemon.heartbeatAgeMs >= 0) {
    const age = Math.round(snap.daemon.heartbeatAgeMs / 1000);
    lines.push(`   Heartbeat: ${age}s ago`);
  } else {
    lines.push(`   Heartbeat: none`);
  }
  lines.push("");

  // Providers
  if (snap.providers.length > 0) {
    lines.push(` Providers (${snap.providers.length}):`);
    for (const p of snap.providers) {
      const pDot = statusDot(p.status);
      lines.push(`   ${pDot} ${p.providerId} latency:${p.latencyMs}ms err:${(p.errorRate * 100).toFixed(1)}%`);
    }
    lines.push("");
  }

  // Coordination
  const coord = snap.coordination;
  const coordColor = coord.failedWorkers > 0 ? "\x1b[31m" : coord.activeRuns > 0 ? "\x1b[33m" : "\x1b[32m";
  lines.push(` Coordination: ${coordColor}${coord.activeRuns} active\x1b[0m runs / ${coord.totalWorkers} workers (${coord.failedWorkers} failed)`);

  // Approvals
  const appr = snap.approvals;
  const apprColor = appr.pending > 10 ? "\x1b[33m" : "\x1b[32m";
  lines.push(` Approvals:   ${apprColor}${appr.pending} pending\x1b[0m / ${appr.total} total`);
  if (appr.oldestPendingMs > 0) {
    lines.push(`   Oldest pending: ${Math.round(appr.oldestPendingMs / 1000)}s`);
  }

  // Ownership
  const own = snap.ownership;
  lines.push(` Ownership:   ${own.activeLeases} leases / ${own.conflicts} conflicts / ${own.expiredLeases} expired`);

  // Recovery
  const rec = snap.recovery;
  const recColor = rec.criticalFindings > 0 ? "\x1b[31m" : rec.totalFindings > 0 ? "\x1b[33m" : "\x1b[32m";
  lines.push(` Recovery:    ${recColor}${rec.criticalFindings} critical\x1b[0m / ${rec.totalFindings} total (${rec.unresolvedFindings} unresolved)`);

  // Resources
  const res = snap.resources;
  const memColor = res.memoryRssMb > 1000 ? "\x1b[31m" : res.memoryRssMb > 500 ? "\x1b[33m" : "\x1b[32m";
  lines.push(` Resources:   RSS ${memColor}${res.memoryRssMb} MB\x1b[0m / heap ${res.heapUsedMb} MB`);

  return lines;
}
