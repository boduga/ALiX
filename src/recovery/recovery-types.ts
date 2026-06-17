/**
 * recovery-types.ts — Core types for crash-point injection and recovery.
 *
 * Every durable store maps one or more CrashPoints to its file-write lifecycle.
 * A CrashInjector is passed in during testing; production uses NoopCrashInjector.
 *
 * The RecoveryScanner produces findings with severity, repairability, and
 * proposed actions. Repair is always audited and idempotent.
 */

// =========================================================================
// Crash injection
// =========================================================================

/** Points in a store's write lifecycle where a crash can be injected. */
export type CrashPoint =
  | "before_write"
  | "after_temp_write"
  | "before_rename"
  | "after_rename"
  | "before_metadata_attach"
  | "after_metadata_attach"
  | "before_event_emit"
  | "after_event_emit"
  | "before_acknowledgement"
  | "during_lock_acquire"
  | "during_lock_release"
  | "during_approval_consume"
  | "during_lease_renew"
  | "during_worker_execution"
  | "during_aggregate_finalize"
  | "during_daemon_shutdown";

/**
 * CrashInjector — injected into stores during testing.
 * Production stores receive NoopCrashInjector (no-op).
 */
export interface CrashInjector {
  /** Called at a crash point. Throws to simulate a crash mid-write. */
  hit(point: CrashPoint): void;
  /** Reset all breakpoints for the next test. */
  reset(): void;
  /** Arm a specific crash point to throw on the given call count (1-based). */
  arm(point: CrashPoint, callCount?: number): void;
}

/** Production default — never throws. */
export class NoopCrashInjector implements CrashInjector {
  hit(_point: CrashPoint): void { /* no-op */ }
  reset(): void { /* no-op */ }
  arm(_point: CrashPoint, _callCount?: number): void { /* no-op */ }
}

/** Test injector — arms specific points to throw. */
export class ThrowingCrashInjector implements CrashInjector {
  private breakpoints = new Map<CrashPoint, Map<number, true>>();
  private callCounters = new Map<CrashPoint, number>();

  hit(point: CrashPoint): void {
    const counters = this.callCounters;
    const count = (counters.get(point) ?? 0) + 1;
    counters.set(point, count);

    const bps = this.breakpoints.get(point);
    if (bps && bps.has(count)) {
      throw new CrashInjectedError(point, count);
    }
  }

  reset(): void {
    this.breakpoints.clear();
    this.callCounters.clear();
  }

  arm(point: CrashPoint, callCount: number = 1): void {
    let bps = this.breakpoints.get(point);
    if (!bps) {
      bps = new Map();
      this.breakpoints.set(point, bps);
    }
    bps.set(callCount, true);
  }
}

export class CrashInjectedError extends Error {
  constructor(
    public readonly point: CrashPoint,
    public readonly callCount: number,
  ) {
    super(`Crash injected at ${point} (call #${callCount})`);
    this.name = "CrashInjectedError";
  }
}

// =========================================================================
// Recovery findings
// =========================================================================

export type RecoverySeverity = "info" | "warning" | "critical";

export type RecoveryFindingKind =
  | "stale_temp_file"
  | "stale_lock"
  | "stale_pid_file"
  | "corrupt_data_file"
  | "orphaned_worker"
  | "orphaned_ownership_lease"
  | "orphaned_event_log"
  | "unconsumed_approval"
  | "consumed_before_dispatch"
  | "completed_worker_missing_result"
  | "aggregate_missing_run"
  | "run_missing_aggregate"
  | "partial_event_log_line"
  | "orphaned_daemon_task"
  | "missing_schema_version"
  | "inconsistent_cross_reference";

export type RecoverySubsystem =
  | "coordination_store"
  | "approval_store"
  | "ownership_registry"
  | "coordination_result_store"
  | "coordination_aggregate_store"
  | "replan_proposal_store"
  | "collaboration_store"
  | "chronicle_store"
  | "event_log"
  | "audit_store"
  | "daemon_manager"
  | "task_registry"
  | "workspace_registry"
  | "repo_index_store"
  | "user_preference_store"
  | "lock_manager";

export interface RecoveryFinding {
  /** Stable identifier for deduplication. */
  id: string;
  /** Which subsystem produced this finding. */
  subsystem: RecoverySubsystem;
  /** Severity — info, warning, or critical. */
  severity: RecoverySeverity;
  /** Categorical kind of finding. */
  kind: RecoveryFindingKind;
  /** The specific resource ID (run ID, worker ID, file path, etc.). */
  resourceId?: string;
  /** Human-readable description. */
  message: string;
  /** Whether automated repair is available. */
  repairable: boolean;
  /** What repair would do, in plain language. */
  proposedAction?: string;
  /** File path on disk (relative to workspace root). */
  filePath?: string;
}

// =========================================================================
// Recovery report
// =========================================================================

export interface RecoveryReport {
  /** When the scan/repair started. */
  startedAt: string;
  /** When it finished. */
  completedAt: string;
  /** Total findings across all severities. */
  totalFindings: number;
  /** Counts by severity. */
  bySeverity: Record<RecoverySeverity, number>;
  /** All findings (potentially filtered). */
  findings: RecoveryFinding[];
  /** Whether repair was attempted. */
  repairAttempted: boolean;
  /** Count of successfully repaired findings. */
  repairedCount: number;
  /** IDs of findings that were repaired. */
  repairedIds: string[];
  /** IDs of findings that could not be repaired. */
  failedRepairIds: string[];
  /** Human-readable summary. */
  summary: string;
}

// =========================================================================
// Repair options
// =========================================================================

export interface RepairOptions {
  /** Execute repair (false = dry-run). */
  execute: boolean;
  /** Bypass confirmation prompts. */
  yes: boolean;
  /** Output JSON instead of human-readable text. */
  json: boolean;
}

export const DEFAULT_REPAIR_OPTIONS: RepairOptions = {
  execute: false,
  yes: false,
  json: false,
};
