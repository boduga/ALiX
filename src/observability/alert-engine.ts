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
  enabled: boolean;
  condition: (snapshot: RuntimeHealthSnapshot) => boolean;
  message: (snapshot: RuntimeHealthSnapshot, instanceDimensions?: Record<string, string>) => string;
  cooldownMs?: number;
  /**
   * Optional: when present, the rule fires one alert per dimension set returned.
   * Each alert gets its own fingerprint with the dimension keys appended.
   * Example: providers_unhealthy returns [{ providerId: "openai" }, { providerId: "ollama" }]
   */
  instanceDimensions?: (snapshot: RuntimeHealthSnapshot) => Record<string, string>[];
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  fingerprint: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  timestamp: string;
  firstTriggeredAt: string;
  lastTriggeredAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  occurrences: number;
  metadata?: Record<string, unknown>;
}

export interface EvaluateResult {
  firing: AlertEvent[];
  recent: number;
}

// ─── Fingerprint ───────────────────────────────────────────────────────────

/**
 * Deterministic identity for deduplication: ruleId + severity.
 * Two AlertEvents with the same rule firing at the same severity
 * are the same alert, even if the message drifts slightly.
 */
export function fingerprintAlert(ruleId: string, severity: AlertSeverity, dimensions?: Record<string, string>): string {
  const base = `${ruleId}::${severity}`;
  if (!dimensions || Object.keys(dimensions).length === 0) return base;
  const parts = Object.entries(dimensions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return `${base}::${parts.join("|")}`;
}

// ─── Built-in Rules ────────────────────────────────────────────────────────

export const HEALTH_RULES: AlertRule[] = [
  {
    id: "daemon_not_running",
    name: "Daemon Not Running",
    description: "Daemon status is not healthy",
    severity: "critical",
    enabled: true,
    condition: (h) => h.daemon.status === "unhealthy",
    message: (h) => `Daemon is unhealthy (status: ${h.daemon.status})`,
  },
  {
    id: "daemon_heartbeat_old",
    name: "Daemon Heartbeat Stale",
    description: "Daemon heartbeat is degraded",
    severity: "warning",
    enabled: true,
    condition: (h) => h.daemon.status === "degraded",
    message: (h) => `Heartbeat ${Math.round((h.daemon.heartbeatAgeMs ?? -1) / 1000)}s old`,
  },
  {
    id: "approvals_backlog",
    name: "Approvals Backlog",
    description: "Pending approvals exceed threshold or oldest is too old",
    severity: "warning",
    enabled: true,
    condition: (h) => h.approvals.pending > 10 || h.approvals.oldestPendingMs > 300_000,
    message: (h) => `${h.approvals.pending} pending, oldest ${Math.round(h.approvals.oldestPendingMs / 1000)}s`,
  },
  {
    id: "recovery_critical_findings",
    name: "Recovery Critical Findings",
    description: "Critical recovery findings unresolved",
    severity: "critical",
    enabled: true,
    condition: (h) => h.recovery.criticalFindings > 0,
    message: (h) => `${h.recovery.criticalFindings} critical findings`,
  },
  {
    id: "ownership_conflicts",
    name: "Ownership Conflicts",
    description: "Ownership conflicts detected",
    severity: "warning",
    enabled: true,
    condition: (h) => h.ownership.conflicts > 0,
    message: (h) => `${h.ownership.conflicts} conflicts`,
  },
  {
    id: "memory_high",
    name: "High Memory Usage",
    description: "RSS exceeds warning threshold",
    severity: "warning",
    enabled: true,
    condition: (h) => h.resources.memoryRssMb > 500,
    message: (h) => `RSS ${h.resources.memoryRssMb} MB (threshold: 500)`,
  },
  {
    id: "memory_critical",
    name: "Critical Memory Usage",
    description: "RSS exceeds critical threshold",
    severity: "critical",
    enabled: true,
    condition: (h) => h.resources.memoryRssMb > 1000,
    message: (h) => `RSS ${h.resources.memoryRssMb} MB (threshold: 1000)`,
  },
  {
    id: "providers_unhealthy",
    name: "Unhealthy Providers",
    description: "One or more providers are unhealthy",
    severity: "warning",
    enabled: true,
    condition: (h: RuntimeHealthSnapshot) => h.providers.some(p => p.status === "unhealthy"),
    instanceDimensions: (h: RuntimeHealthSnapshot) =>
      h.providers.filter(p => p.status === "unhealthy").map(p => ({ providerId: p.providerId })),
    message: (h: RuntimeHealthSnapshot, d?: Record<string, string>) =>
      d ? `Provider ${d.providerId} is unhealthy` : "One or more providers are unhealthy",
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
    this.rules = [...HEALTH_RULES.map(r => ({ ...r, enabled: r.enabled ?? true, cooldownMs: r.cooldownMs ?? this.cooldownMs }))];
  }

  addRule(rule: AlertRule): void {
    this.rules.push({ ...rule, enabled: rule.enabled ?? true, cooldownMs: rule.cooldownMs ?? this.cooldownMs });
  }

  /**
   * Evaluate all rules against a health snapshot.
   * Returns a fresh snapshot of firing alerts and the recent count.
   * Never mutates previously-returned AlertEvent objects.
   */
  evaluate(snapshot: RuntimeHealthSnapshot): EvaluateResult {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const firing: AlertEvent[] = [];

    // Track which fingerprints are still active this round
    const activeFingerprints = new Set<string>();

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      // Determine whether this rule fires per-instance or once
      const instances = rule.instanceDimensions ? rule.instanceDimensions(snapshot) : [undefined];

      for (const dims of instances) {
        let triggered = false;
        try { triggered = rule.condition(snapshot); } catch { /* skip rule on error */ }
        const fp = fingerprintAlert(rule.id, rule.severity, dims ?? undefined);

        if (triggered) {
          activeFingerprints.add(fp);
          const existing = this.firing.get(fp);

          if (existing) {
            existing.occurrences++;
            existing.lastTriggeredAt = now;
            firing.push({ ...existing });
          } else {
            this.alertCounter++;
            const alert: AlertEvent = {
              id: `alert_${nowMs}_${this.alertCounter}`,
              ruleId: rule.id,
              fingerprint: fp,
              ruleName: rule.name,
              severity: rule.severity,
              status: "firing",
              message: rule.message(snapshot, dims ?? undefined),
              timestamp: now,
              firstTriggeredAt: now,
              lastTriggeredAt: now,
              occurrences: 1,
            };
            this.firing.set(fp, alert);
            firing.push({ ...alert });
          }
        }
      }
    }

    // Resolve alerts that are no longer firing, after cooldown
    let recent = 0;
    for (const [fp, alert] of this.firing) {
      if (!activeFingerprints.has(fp)) {
        if (nowMs - new Date(alert.lastTriggeredAt).getTime() >= this.cooldownMs) {
          alert.status = "resolved";
          alert.resolvedAt = now;
          this.resolved.push(alert);
          this.firing.delete(fp);
        } else {
          recent++;
        }
      } else {
        recent++;
      }
    }

    return { firing, recent };
  }

  /**
   * Acknowledge a firing alert by fingerprint.
   * Sets status to "acknowledged" and records the timestamp.
   */
  acknowledge(fingerprint: string, acknowledgedBy?: string): boolean {
    const alert = this.firing.get(fingerprint);
    if (alert) {
      alert.acknowledgedAt = new Date().toISOString();
      alert.acknowledgedBy = acknowledgedBy;
      return true;
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
