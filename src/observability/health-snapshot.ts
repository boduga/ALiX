/**
 * health-snapshot.ts -- P4.2b Runtime Health Snapshots.
 *
 * Side-effect-free health projection: reads persisted state, never writes.
 * Supports "unknown" status when data is absent.
 * ObservabilitySnapshotService provides TTL-cached access.
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeObservabilityConfig, type ObservabilityConfig } from "./observability-config.js";

// ─── Types ────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface DaemonHealth {
  status: HealthStatus;
  pid?: number;
  uptimeMs?: number;
  heartbeatAgeMs?: number;
}

export interface ProviderHealth {
  providerId: string;
  status: HealthStatus;
  latencyMs: number;
  errorRate: number;
  lastCheckMs: number;
}

export interface CoordinationHealth {
  activeRuns: number;
  totalWorkers: number;
  failedWorkers: number;
  staleRuns: number;
}

export interface ApprovalHealth {
  pending: number;
  total: number;
  oldestPendingMs: number;
  averageResolutionMs: number;
}

export interface OwnershipHealth {
  activeLeases: number;
  conflicts: number;
  expiredLeases: number;
  deniedRequests: number;
}

export interface RecoveryHealth {
  lastScanMs: number;
  totalFindings: number;
  criticalFindings: number;
  unresolvedFindings: number;
}

export interface ResourceHealth {
  memoryRssMb: number;
  heapUsedMb: number;
  fileDescriptors: number;
  sessionCount: number;
}

export interface RuntimeHealthSnapshot {
  generatedAt: string;
  daemon: DaemonHealth;
  providers: ProviderHealth[];
  coordination: CoordinationHealth;
  approvals: ApprovalHealth;
  ownership: OwnershipHealth;
  recovery: RecoveryHealth;
  resources: ResourceHealth;
}

// ─── Helpers ───────────────────────────────────────────────────────────

export function healthStatusFromAge(
  heartbeatAgeMs: number,
  degradedMs = 5000,
  unhealthyMs = 30000,
): HealthStatus {
  if (heartbeatAgeMs < 0) return "unknown";
  if (heartbeatAgeMs < degradedMs) return "healthy";
  if (heartbeatAgeMs < unhealthyMs) return "degraded";
  return "unhealthy";
}

export function overallHealth(statuses: HealthStatus[]): HealthStatus {
  if (statuses.some(s => s === "unhealthy")) return "unhealthy";
  if (statuses.some(s => s === "degraded")) return "degraded";
  if (statuses.every(s => s === "unknown" || s === "healthy")) {
    if (statuses.every(s => s === "unknown")) return "unknown";
    return "healthy";
  }
  return "unknown";
}

// ─── Side-Effect-Free Collector ────────────────────────────────────────

export class HealthProjectionCollector {
  private config: ObservabilityConfig;

  constructor(
    private cwd: string,
    config?: Partial<ObservabilityConfig>,
  ) {
    this.config = mergeObservabilityConfig(config);
  }

  async collect(): Promise<RuntimeHealthSnapshot> {
    return {
      generatedAt: new Date().toISOString(),
      daemon: await this.collectDaemonHealth(),
      providers: await this.collectProviderHealth(),
      coordination: await this.collectCoordinationHealth(),
      approvals: await this.collectApprovalHealth(),
      ownership: await this.collectOwnershipHealth(),
      recovery: await this.collectRecoveryHealth(),
      resources: this.collectResourceHealth(),
    };
  }

  private async collectDaemonHealth(): Promise<DaemonHealth> {
    const daemonPath = join(this.cwd, ".alix", "daemon.json");
    if (!existsSync(daemonPath)) {
      return { status: "unknown", heartbeatAgeMs: -1 };
    }
    try {
      const raw = await readFile(daemonPath, "utf-8");
      const data = JSON.parse(raw) as { pid?: number; lastHeartbeat?: string };
      if (!data.lastHeartbeat) {
        return { status: "unknown", pid: data.pid, heartbeatAgeMs: -1 };
      }
      const heartbeatAgeMs = Date.now() - new Date(data.lastHeartbeat).getTime();
      return {
        status: healthStatusFromAge(
          heartbeatAgeMs,
          this.config.health?.daemonDegradedMs,
          this.config.health?.daemonUnhealthyMs,
        ),
        pid: data.pid,
        uptimeMs: undefined,
        heartbeatAgeMs,
      };
    } catch {
      return { status: "unknown", heartbeatAgeMs: -1 };
    }
  }

  private async collectProviderHealth(): Promise<ProviderHealth[]> {
    // Provider health comes from telemetry, circuit-breaker state, or explicit probe.
    // Without evidence, return "unknown".
    try {
      const { PROVIDERS } = await import("../providers/catalog.js");
      return PROVIDERS.map(p => ({
        providerId: p.id,
        status: "unknown" as HealthStatus,
        latencyMs: 0,
        errorRate: 0,
        lastCheckMs: 0,
      }));
    } catch {
      return [];
    }
  }

  private async collectCoordinationHealth(): Promise<CoordinationHealth> {
    try {
      const { CoordinationStore } = await import("../kernel/coordination-store.js");
      const store = new CoordinationStore(this.cwd);
      // list() reads from disk directly; no load(runId) needed
      const runs = await store.list();
      const active = runs.filter((r: { status: string }) => r.status === "running" || r.status === "planning");
      const failed = runs.reduce((s: number, r: { workers?: Array<{ status: string }> }) => s + (r.workers ?? []).filter((w: { status: string }) => w.status === "failed").length, 0);
      return {
        activeRuns: active.length,
        totalWorkers: runs.reduce((s: number, r: { workers?: Array<unknown> }) => s + (r.workers?.length ?? 0), 0),
        failedWorkers: failed,
        staleRuns: 0,
      };
    } catch {
      return { activeRuns: 0, totalWorkers: 0, failedWorkers: 0, staleRuns: 0 };
    }
  }

  private async collectApprovalHealth(): Promise<ApprovalHealth> {
    try {
      const { ApprovalStore } = await import("../approvals/approval-store.js");
      const store = new ApprovalStore(this.cwd);
      await store.load();
      const all = store.list();
      const pending = all.filter((a: { status: string }) => a.status === "pending");
      const oldestPending = pending.length > 0
        ? Date.now() - new Date((pending as any[]).reduce((a: any, b: any) => a.createdAt < b.createdAt ? a : b).createdAt).getTime()
        : 0;
      return {
        pending: pending.length,
        total: all.length,
        oldestPendingMs: oldestPending,
        averageResolutionMs: 0,
      };
    } catch {
      return { pending: 0, total: 0, oldestPendingMs: 0, averageResolutionMs: 0 };
    }
  }

  private async collectOwnershipHealth(): Promise<OwnershipHealth> {
    try {
      const { OwnershipRegistry } = await import("../ownership/ownership-registry.js");
      const store = new OwnershipRegistry(this.cwd);
      // OwnershipRegistry uses in-memory cache; list() reflects loaded state
      const all = store.list();
      return {
        activeLeases: all.filter((o: any) => o.status === "active").length,
        conflicts: all.filter((o: any) => o.status === "conflict").length,
        expiredLeases: all.filter((o: any) => o.status === "expired").length,
        deniedRequests: all.filter((o: any) => o.status === "denied").length,
      };
    } catch {
      return { activeLeases: 0, conflicts: 0, expiredLeases: 0, deniedRequests: 0 };
    }
  }

  private async collectRecoveryHealth(): Promise<RecoveryHealth> {
    // Read the latest recovery report -- do NOT run a fresh scan.
    const reportPath = join(this.cwd, ".alix", "recovery", "latest-report.json");
    if (!existsSync(reportPath)) {
      return { lastScanMs: -1, totalFindings: 0, criticalFindings: 0, unresolvedFindings: 0 };
    }
    try {
      const raw = await readFile(reportPath, "utf-8");
      const report = JSON.parse(raw) as {
        completedAt: string; totalFindings: number; bySeverity: { critical: number }; repairedCount: number;
      };
      return {
        lastScanMs: Date.now() - new Date(report.completedAt).getTime(),
        totalFindings: report.totalFindings,
        criticalFindings: report.bySeverity.critical,
        unresolvedFindings: report.totalFindings - report.repairedCount,
      };
    } catch {
      return { lastScanMs: -1, totalFindings: 0, criticalFindings: 0, unresolvedFindings: 0 };
    }
  }

  private collectResourceHealth(): ResourceHealth {
    const mem = process.memoryUsage();
    return {
      memoryRssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      fileDescriptors: 0,
      sessionCount: 0,
    };
  }
}

// ─── TTL-Cached Snapshot Service ────────────────────────────────────────

export class ObservabilitySnapshotService {
  private collector: HealthProjectionCollector;
  private cachedHealth: RuntimeHealthSnapshot | null = null;
  private lastHealthFetch = 0;
  private config: ObservabilityConfig;

  constructor(
    cwd: string,
    config?: Partial<ObservabilityConfig>,
  ) {
    this.collector = new HealthProjectionCollector(cwd, config);
    this.config = mergeObservabilityConfig(config);
  }

  async getHealth(): Promise<RuntimeHealthSnapshot> {
    const ttl = this.config.snapshot?.healthTtlMs ?? 2000;
    const now = Date.now();
    if (!this.cachedHealth || now - this.lastHealthFetch > ttl) {
      this.cachedHealth = await this.collector.collect();
      this.lastHealthFetch = now;
    }
    return this.cachedHealth;
  }

  /** Force a refresh on next getHealth() call. */
  invalidateHealth(): void {
    this.cachedHealth = null;
  }
}
