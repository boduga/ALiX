/**
 * alert-engine.ts -- P4.2f Stateful Alert Lifecycle.
 *
 * Alert lifecycle:
 *   condition true  -> status="firing"  (firstTriggeredAt set)
 *   condition false -> status="resolved" (resolvedAt set, after cooldown)
 *   same condition  -> deduplicated (occurrences incremented)
 *
 * Fingerprint: determined by ruleId + severity, so the same rule firing
 * repeatedly is tracked as one alert with occurrences.
 *
 * GET endpoints evaluate but do not persist state -- use evaluate() which
 * returns computed firing/resolved lists without persisting state.
 */

import { mergeObservabilityConfig, type ObservabilityConfig } from "./observability-config.js";
import type { RuntimeHealthSnapshot } from "./health-snapshot.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertStatus = "firing" | "resolved";

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: (snapshot: RuntimeHealthSnapshot) => boolean;
  message: (snapshot: RuntimeHealthSnapshot) => string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  timestamp: string;
  firstTriggeredAt: string;
  lastTriggeredAt: string;
  resolvedAt?: string;
  occurrences: number;
  acknowledged: boolean;
}

export interface EvaluateResult {
  firing: AlertEvent[];
  resolved: AlertEvent[];
}

// ─── Fingerprint ───────────────────────────────────────────────────────────

/**
 * Deterministic identity for deduplication: ruleId + severity.
 * Two AlertEvents with the same rule firing at the same severity
 * are the same alert, even if the message drifts slightly.
 */
export function fingerprintAlert(a: AlertEvent): string {
  return `${a.ruleId}::${a.severity}`;
}

// ─── Built-in Rules ────────────────────────────────────────────────────────

export const HEALTH_RULES: AlertRule[] = [
  {
    id: "daemon_not_running",
    name: "Daemon Not Running",
    description: "Daemon status is not healthy",
    severity: "critical",
    condition: (h) => h.daemon.status === "unhealthy",
    message: (h) => `Daemon is unhealthy (status: ${h.daemon.status})`,
  },
  {
    id: "daemon_heartbeat_old",
    name: "Daemon Heartbeat Stale",
    description: "Daemon heartbeat is degraded",
    severity: "warning",
    condition: (h) => h.daemon.status === "degraded",
    message: (h) => `Heartbeat ${Math.round((h.daemon.heartbeatAgeMs ?? -1) / 1000)}s old`,
  },
  {
    id: "approvals_backlog",
    name: "Approvals Backlog",
    description: "Pending approvals exceed threshold or oldest is too old",
    severity: "warning",
    condition: (h) => h.approvals.pending > 10 || h.approvals.oldestPendingMs > 300_000,
    message: (h) => `${h.approvals.pending} pending, oldest ${Math.round(h.approvals.oldestPendingMs / 1000)}s`,
  },
  {
    id: "recovery_critical_findings",
    name: "Recovery Critical Findings",
    description: "Critical recovery findings unresolved",
    severity: "critical",
    condition: (h) => h.recovery.criticalFindings > 0,
    message: (h) => `${h.recovery.criticalFindings} critical findings`,
  },
  {
    id: "ownership_conflicts",
    name: "Ownership Conflicts",
    description: "Ownership conflicts detected",
    severity: "warning",
    condition: (h) => h.ownership.conflicts > 0,
    message: (h) => `${h.ownership.conflicts} conflicts`,
  },
  {
    id: "memory_high",
    name: "High Memory Usage",
    description: "RSS exceeds warning threshold",
    severity: "warning",
    condition: (h) => h.resources.memoryRssMb > 500,
    message: (h) => `RSS ${h.resources.memoryRssMb} MB (threshold: 500)`,
  },
  {
    id: "memory_critical",
    name: "Critical Memory Usage",
    description: "RSS exceeds critical threshold",
    severity: "critical",
    condition: (h) => h.resources.memoryRssMb > 1000,
    message: (h) => `RSS ${h.resources.memoryRssMb} MB (threshold: 1000)`,
  },
  {
    id: "providers_unhealthy",
    name: "Unhealthy Providers",
    description: "One or more providers are unhealthy",
    severity: "warning",
    condition: (h) => h.providers.some(p => p.status === "unhealthy"),
    message: (h) => `Unhealthy: ${h.providers.filter(p => p.status === "unhealthy").map(p => p.providerId).join(", ")}`,
  },
];

// ─── Engine ────────────────────────────────────────────────────────────────

export interface AlertEngineOptions {
  cooldownMs?: number;
}

export class AlertEngine {
  private rules: AlertRule[];
  private firing: Map<string, AlertEvent> = new Map();
  private resolved: AlertEvent[] = [];
  private alertCounter = 0;
  private cooldownMs: number;
  private config: ObservabilityConfig;

  constructor(config?: Partial<ObservabilityConfig> & AlertEngineOptions) {
    this.config = mergeObservabilityConfig(config);
    this.cooldownMs = config?.cooldownMs ?? 30_000; // 30s default cooldown
    this.rules = [...HEALTH_RULES];
  }

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  /**
   * Evaluate all rules against a health snapshot.
   * Mutates engine state on first call; subsequent calls with same condition
   * increment occurrences instead of creating new alerts.
   */
  evaluate(snapshot: RuntimeHealthSnapshot): EvaluateResult {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const firing: AlertEvent[] = [];
    const resolved: AlertEvent[] = [];

    // Track which fingerprints are still active this round
    const activeFingerprints = new Set<string>();

    for (const rule of this.rules) {
      let triggered = false;
      try { triggered = rule.condition(snapshot); } catch { /* skip rule on error */ }
      const fp = `${rule.id}::${rule.severity}`;

      if (triggered) {
        activeFingerprints.add(fp);
        const existing = this.firing.get(fp);

        if (existing) {
          // Update occurrences and timestamp
          existing.occurrences++;
          existing.lastTriggeredAt = now;
          firing.push(existing);
        } else {
          this.alertCounter++;
          const alert: AlertEvent = {
            id: `alert_${Date.now()}_${this.alertCounter}`,
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            status: "firing",
            message: rule.message(snapshot),
            timestamp: now,
            firstTriggeredAt: now,
            lastTriggeredAt: now,
            occurrences: 1,
            acknowledged: false,
          };
          this.firing.set(fp, alert);
          firing.push(alert);
        }
      }
    }

    // Resolve alerts that are no longer firing, after cooldown
    for (const [fp, alert] of this.firing) {
      if (!activeFingerprints.has(fp)) {
        if (nowMs - new Date(alert.lastTriggeredAt).getTime() >= this.cooldownMs) {
          alert.status = "resolved";
          alert.resolvedAt = now;
          this.resolved.push(alert);
          this.firing.delete(fp);
          resolved.push(alert);
        }
      }
    }

    return { firing, resolved };
  }

  acknowledge(alertId: string): boolean {
    for (const [, alert] of this.firing) {
      if (alert.id === alertId) {
        alert.acknowledged = true;
        return true;
      }
    }
    return false;
  }

  getState(): { firing: AlertEvent[]; resolved: AlertEvent[] } {
    return {
      firing: [...this.firing.values()],
      resolved: [...this.resolved],
    };
  }

  reset(): void {
    this.firing.clear();
    this.resolved = [];
    this.alertCounter = 0;
  }
}
