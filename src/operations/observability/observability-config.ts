/**
 * observability-config.ts -- P4.2 Configuration for observability thresholds, TTLs, retention.
 */

export interface ObservabilityConfig {
  health?: {
    daemonDegradedMs?: number;
    daemonUnhealthyMs?: number;
  };
  alerts?: {
    approvalBacklogCount?: number;
    approvalBacklogAgeMs?: number;
    memoryWarningMb?: number;
    memoryCriticalMb?: number;
  };
  retention?: {
    rawDays?: number;
    hourlyDays?: number;
    dailyDays?: number;
  };
  snapshot?: {
    healthTtlMs?: number;
    costTtlMs?: number;
    trendTtlMs?: number;
  };
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  health: {
    daemonDegradedMs: 5000,
    daemonUnhealthyMs: 30000,
  },
  alerts: {
    approvalBacklogCount: 10,
    approvalBacklogAgeMs: 300_000,
    memoryWarningMb: 500,
    memoryCriticalMb: 1000,
  },
  retention: {
    rawDays: 7,
    hourlyDays: 30,
    dailyDays: 365,
  },
  snapshot: {
    healthTtlMs: 2000,
    costTtlMs: 30000,
    trendTtlMs: 60000,
  },
};

export function mergeObservabilityConfig(
  overrides?: Partial<ObservabilityConfig>,
): ObservabilityConfig {
  if (!overrides) return { ...DEFAULT_OBSERVABILITY_CONFIG };
  return {
    health: { ...DEFAULT_OBSERVABILITY_CONFIG.health, ...overrides.health },
    alerts: { ...DEFAULT_OBSERVABILITY_CONFIG.alerts, ...overrides.alerts },
    retention: { ...DEFAULT_OBSERVABILITY_CONFIG.retention, ...overrides.retention },
    snapshot: { ...DEFAULT_OBSERVABILITY_CONFIG.snapshot, ...overrides.snapshot },
  };
}
