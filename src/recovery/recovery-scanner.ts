/**
 * recovery-scanner.ts — Filesystem artifact scanner and cross-file consistency checker.
 *
 * Reads every durable store and reports findings. Always read-only — never mutates
 * state. All store paths are under `{root}/.alix/` except daemon-level stores
 * under `~/.alix/`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { homedir } from "node:os";
import type {
  RecoveryFinding,
  RecoveryReport,
  RecoverySubsystem,
  RecoverySeverity,
  RecoveryFindingKind,
} from "./recovery-types.js";

// =========================================================================
// Helpers
// =========================================================================

function now(): string {
  return new Date().toISOString();
}

function readJsonSafe(filePath: string): { ok: true; data: any } | { ok: false; error: string; missing: boolean } {
  try {
    if (!existsSync(filePath)) return { ok: false, error: "not found", missing: true };
    const raw = readFileSync(filePath, "utf-8");
    if (raw.trim().length === 0) return { ok: false, error: "empty file", missing: false };
    return { ok: true, data: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, error: e.message, missing: false };
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function relativePath(root: string, absPath: string): string {
  const rel = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
  return rel.startsWith("/") ? rel.slice(1) : rel;
}

// Lock meta files contain { pid, token, acquiredAt }
function readLockMeta(lockDir: string): { pid?: number; acquiredAt?: number } | null {
  const metaPath = join(lockDir, "meta.json");
  const result = readJsonSafe(metaPath);
  if (result.ok) return { pid: result.data.pid, acquiredAt: result.data.acquiredAt };
  return null;
}

function isPidAlive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch (e: any) {
    // EPERM means the process exists but is owned by another user — treat as alive
    if (e && typeof e === "object" && e.code === "EPERM") return true;
    return false;
  }
}

// =========================================================================
// Scanner helpers
// =========================================================================

let _findingCounter = 0;
function nextId(subsystem: RecoverySubsystem, kind: string): string {
  _findingCounter++;
  return `${subsystem}_${kind}_${_findingCounter}`;
}

function addFinding(
  findings: RecoveryFinding[],
  subsystem: RecoverySubsystem,
  severity: RecoverySeverity,
  kind: RecoveryFindingKind,
  message: string,
  repairable: boolean,
  proposedAction?: string,
  resourceId?: string,
  filePath?: string,
): void {
  findings.push({
    id: nextId(subsystem, kind),
    subsystem,
    severity,
    kind,
    resourceId,
    message,
    repairable,
    proposedAction,
    filePath,
  });
}

// =========================================================================
// Store-specific checks
// =========================================================================

function scanTempFiles(
  findings: RecoveryFinding[],
  root: string,
  dir: string,
  subsystem: RecoverySubsystem,
): void {
  const files = listDir(dir);
  for (const f of files) {
    if (f.endsWith(".tmp") || f.includes(".tmp.")) {
      const fullPath = join(dir, f);
      addFinding(
        findings,
        subsystem,
        "warning",
        "stale_temp_file",
        `Stale temp file: ${f}`,
        true,
        `Remove stale temp file ${f}`,
        undefined,
        fullPath,
      );
    }
  }
}

// -- CoordinationStore ---------------------------------------------------

function scanCoordinationStore(findings: RecoveryFinding[], root: string): void {
  const coordDir = join(root, ".alix", "coordination");
  if (!isDir(coordDir)) return;

  // Scan runs
  const runsDir = join(coordDir);
  const entries = listDir(runsDir).filter(e => e.endsWith(".json") && !e.endsWith(".runs.json") && !e.includes(".tmp"));
  for (const entry of entries) {
    const runId = entry.replace(/\.json$/, "");
    const path = join(runsDir, entry);
    const result = readJsonSafe(path);
    if (!result.ok) {
      addFinding(findings, "coordination_store", "critical", "corrupt_data_file",
        `Coordination run ${runId}: ${result.error}`, false,
        "Manual review required — data file corrupt", runId, path);
    }
  }

  // Check lock files
  const locksDir = join(coordDir, "locks");
  if (isDir(locksDir)) {
    const lockDirs = listDir(locksDir);
    for (const ld of lockDirs) {
      const lockPath = join(locksDir, ld);
      if (!isDir(lockPath)) continue;
      const meta = readLockMeta(lockPath);
      if (meta && meta.pid && !isPidAlive(meta.pid)) {
        const age = meta.acquiredAt ? Date.now() - meta.acquiredAt : 0;
        addFinding(findings, "coordination_store", "warning", "stale_lock",
          `Stale coordination lock for ${ld}: PID ${meta.pid} dead, age ${Math.round(age / 1000)}s`,
          true,
          `Remove stale lock directory ${ld}`, ld, lockPath);
      }
    }
  }

  // Temp files
  scanTempFiles(findings, root, runsDir, "coordination_store");
  if (isDir(join(coordDir, "results"))) {
    scanTempFiles(findings, root, join(coordDir, "results"), "coordination_result_store");
    scanTempFiles(findings, root, join(coordDir, "results", "runs"), "coordination_aggregate_store");
  }
  if (isDir(join(coordDir, "replans"))) {
    scanTempFiles(findings, root, join(coordDir, "replans"), "replan_proposal_store");
  }
  if (isDir(join(coordDir, "shared"))) {
    scanTempFiles(findings, root, join(coordDir, "shared"), "collaboration_store");

    // Check shared lock files
    const sharedLocksDir = join(coordDir, "shared", "locks");
    if (isDir(sharedLocksDir)) {
      for (const ld of listDir(sharedLocksDir)) {
        const lockPath = join(sharedLocksDir, ld);
        if (!isDir(lockPath)) continue;
        const meta = readLockMeta(lockPath);
        if (meta && meta.pid && !isPidAlive(meta.pid)) {
          addFinding(findings, "collaboration_store", "warning", "stale_lock",
            `Stale collaboration lock for ${ld}: PID ${meta.pid} dead`,
            true,
            `Remove stale collaboration lock ${ld}`, ld, lockPath);
        }
      }
    }
  }
}

// -- ApprovalStore --------------------------------------------------------

function scanApprovalStore(findings: RecoveryFinding[], root: string): void {
  const approvalsDir = join(root, ".alix", "approvals");
  if (!isDir(approvalsDir)) return;

  // Main store
  const storePath = join(approvalsDir, "approvals.json");
  const result = readJsonSafe(storePath);
  if (!result.ok && !result.missing) {
    addFinding(findings, "approval_store", "critical", "corrupt_data_file",
      `Approval store: ${result.error}`, false,
      "Manual review required", undefined, storePath);
  }

  // Lock
  const lockDir = join(approvalsDir, "approvals.lock");
  if (isDir(lockDir)) {
    const meta = readLockMeta(lockDir);
    if (meta && meta.pid && !isPidAlive(meta.pid)) {
      addFinding(findings, "approval_store", "warning", "stale_lock",
        `Stale approval store lock: PID ${meta.pid} dead`,
        true, "Remove stale approval lock", undefined, lockDir);
    }
  }

  // Temp files
  scanTempFiles(findings, root, approvalsDir, "approval_store");
}

// -- OwnershipRegistry ----------------------------------------------------

function scanOwnershipRegistry(findings: RecoveryFinding[], root: string): void {
  const ownershipDir = join(root, ".alix", "ownership");
  if (!isDir(ownershipDir)) return;

  const storePath = join(ownershipDir, "ownership.json");
  const result = readJsonSafe(storePath);
  if (!result.ok && !result.missing) {
    addFinding(findings, "ownership_registry", "critical", "corrupt_data_file",
      `Ownership registry: ${result.error}`, false,
      "Manual review required", undefined, storePath);
  } else if (result.ok && Array.isArray(result.data?.records)) {
    // Check for expired ownership leases
    for (const rec of result.data.records) {
      if (rec.status === "active" && rec.expiresAt) {
        const expires = new Date(rec.expiresAt).getTime();
        if (expires < Date.now()) {
          addFinding(findings, "ownership_registry", "warning", "orphaned_ownership_lease",
            `Expired ownership lease: ${rec.id} for ${rec.scope} (agent: ${rec.agentId})`,
            true,
            `Mark lease ${rec.id} as expired`, rec.id, storePath);
        }
      }
    }
  }

  // Lock
  const lockFile = join(ownershipDir, "ownership.lock");
  if (existsSync(lockFile)) {
    try {
      const content = readFileSync(lockFile, "utf-8").trim();
      // Format: <uuid>:<pid>:<timestamp>:<hostname>
      const parts = content.split(":");
      const pid = parseInt(parts[1], 10);
      if (pid && !isPidAlive(pid)) {
        addFinding(findings, "ownership_registry", "warning", "stale_lock",
          `Stale ownership lock: PID ${pid} dead`,
          true, "Remove stale ownership lock file", undefined, lockFile);
      }
    } catch {
      addFinding(findings, "ownership_registry", "warning", "stale_lock",
        "Ownership lock file unreadable",
        true, "Remove unreadable lock file", undefined, lockFile);
    }
  }

  scanTempFiles(findings, root, ownershipDir, "ownership_registry");
}

// -- ChronicleStore -------------------------------------------------------

function scanChronicleStore(findings: RecoveryFinding[], root: string): void {
  const chronicleDir = join(root, ".alix", "chronicle");
  if (!isDir(chronicleDir)) return;

  // Index vs entries consistency
  const indexResult = readJsonSafe(join(chronicleDir, "index.json"));
  const entriesDir = join(chronicleDir, "entries");

  if (indexResult.ok && Array.isArray(indexResult.data)) {
    const indexedIds = new Set(indexResult.data.map((e: any) => e.entryId).filter(Boolean));
    const entryFiles = listDir(entriesDir).filter(f => f.endsWith(".json"));
    const onDiskIds = new Set(entryFiles.map(f => f.replace(/\.json$/, "")));

    for (const id of indexedIds) {
      if (!onDiskIds.has(id)) {
        addFinding(findings, "chronicle_store", "warning", "inconsistent_cross_reference",
          `Chronicle entry ${id} indexed but missing from disk`,
          false, "Index references entry that does not exist on disk",
          id, join(chronicleDir, "index.json"));
      }
    }
    for (const id of onDiskIds) {
      if (!indexedIds.has(id)) {
        addFinding(findings, "chronicle_store", "warning", "inconsistent_cross_reference",
          `Chronicle entry ${id} on disk but not in index`,
          true, "Re-index this entry or add to index",
          id, join(entriesDir, `${id}.json`));
      }
    }
  }

  scanTempFiles(findings, root, chronicleDir, "chronicle_store");
  scanTempFiles(findings, root, entriesDir, "chronicle_store");
}

// -- Cross-file consistency checks ---------------------------------------

function scanCrossFileConsistency(findings: RecoveryFinding[], root: string): void {
  const coordDir = join(root, ".alix", "coordination");
  if (!isDir(coordDir)) return;

  const runFiles = listDir(coordDir).filter(f => f.endsWith(".json") && !f.endsWith(".runs.json") && f !== "results" && f !== "locks" && f !== "shared" && f !== "replans" && !f.includes(".tmp"));
  const resultsDir = join(coordDir, "results");
  const aggregatesDir = join(resultsDir, "runs");
  const replansDir = join(coordDir, "replans");

  for (const f of runFiles) {
    const runId = f.replace(/\.json$/, "");

    // Check for aggregate
    const aggregatePath = join(aggregatesDir, `${runId}.json`);
    const hasAggregate = existsSync(aggregatePath);

    // Check for proposals per run
    const replanRunDir = join(replansDir, runId);
    const hasReplanDir = isDir(replanRunDir);

    // Load the run to check worker consistency
    const runPath = join(coordDir, f);
    const runResult = readJsonSafe(runPath);
    if (!runResult.ok) continue;

    const run = runResult.data;
    const workers: any[] = run.workers ?? [];

    for (const worker of workers) {
      const workerId = worker.id;
      if (!workerId) continue;

      // Check completed workers have result files
      if (worker.status === "completed" || worker.status === "failed") {
        const resultPath = join(resultsDir, `${workerId}.json`);
        if (!existsSync(resultPath)) {
          addFinding(findings, "coordination_result_store", "warning", "completed_worker_missing_result",
            `Worker ${workerId} (${worker.status}) in run ${runId} has no result file`,
            true,
            `Create stub result for worker ${workerId} or re-mark as pending`,
            workerId, resultPath);
        }
      }
    }

    // Check aggregate ←→ run link
    if (hasAggregate) {
      const aggResult = readJsonSafe(aggregatePath);
      if (aggResult.ok && aggResult.data?.runId !== runId) {
        addFinding(findings, "coordination_aggregate_store", "critical", "inconsistent_cross_reference",
          `Aggregate runId (${aggResult.data.runId}) does not match filename (${runId})`,
          true,
          `Correct runId in aggregate to ${runId}`,
          runId, aggregatePath);
      }
    }
  }

  // Check aggregates pointing to missing runs
  if (isDir(aggregatesDir)) {
    for (const aggFile of listDir(aggregatesDir).filter(f => f.endsWith(".json"))) {
      const runId = aggFile.replace(/\.json$/, "");
      const runPath = join(coordDir, `${runId}.json`);
      if (!existsSync(runPath)) {
        addFinding(findings, "coordination_aggregate_store", "warning", "aggregate_missing_run",
          `Aggregate ${runId} exists but run file does not`,
          false,
          "Run may have been deleted — verify aggregate validity",
          runId, join(aggregatesDir, aggFile));
      }
    }
  }
}

// -- Daemon stores --------------------------------------------------------

function scanDaemonStores(findings: RecoveryFinding[], root: string): void {
  const daemonDir = join(root, ".alix");
  const homeDaemon = join(homedir(), ".alix");

  // PID file
  const pidFile = join(homeDaemon, "daemon.pid");
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      if (pid && !isPidAlive(pid)) {
        addFinding(findings, "daemon_manager", "warning", "stale_pid_file",
          `Stale daemon PID file: PID ${pid} dead`,
          true, "Remove stale daemon.pid and daemon.json",
          undefined, pidFile);
      }
    } catch {
      addFinding(findings, "daemon_manager", "warning", "stale_pid_file",
        "Daemon PID file unreadable",
        true, "Remove unreadable daemon.pid",
        undefined, pidFile);
    }
  }

  // Task registry
  const tasksFile = join(homeDaemon, "daemon-tasks.json");
  const tasksResult = readJsonSafe(tasksFile);
  if (tasksResult.ok && Array.isArray(tasksResult.data)) {
    for (const task of tasksResult.data) {
      if (task.status === "running" || task.status === "cancel_requested") {
        // PID won't match current daemon — orphaned
        addFinding(findings, "task_registry", "warning", "orphaned_daemon_task",
          `Orphaned daemon task ${task.id}: status "${task.status}" on restart`,
          true, "Mark task as failed_orphaned or cancelled",
          task.id, tasksFile);
      }
    }
  } else if (existsSync(tasksFile) && !tasksResult.ok) {
    addFinding(findings, "task_registry", "critical", "corrupt_data_file",
      `Task registry: ${tasksResult.error}`,
      false, "Manual review required",
      undefined, tasksFile);
  }

  // Daemon status
  const statusFile = join(homeDaemon, "daemon.json");
  const statusResult = readJsonSafe(statusFile);
  if (statusResult.ok && statusResult.data?.pid) {
    if (!isPidAlive(statusResult.data.pid)) {
      addFinding(findings, "daemon_manager", "warning", "stale_pid_file",
        `Daemon status references dead PID ${statusResult.data.pid}`,
        true, "Clean stale daemon status",
        undefined, statusFile);
    }
  }
}

// -- EventLog & AuditStore ------------------------------------------------

function scanEventLogs(findings: RecoveryFinding[], root: string): void {
  const sessionsDir = join(root, ".alix", "sessions");
  if (!isDir(sessionsDir)) return;

  for (const sessionId of listDir(sessionsDir)) {
    const eventsFile = join(sessionsDir, sessionId, "events.jsonl");
    if (!existsSync(eventsFile)) continue;

    try {
      const raw = readFileSync(eventsFile, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          JSON.parse(lines[i]);
        } catch {
          addFinding(findings, "event_log", "info", "partial_event_log_line",
            `Session ${sessionId}: line ${i + 1} is not valid JSON (partial write)`,
            false, "Truncated line — data loss is limited to that line",
            sessionId, eventsFile);
        }
      }
    } catch {
      addFinding(findings, "event_log", "warning", "corrupt_data_file",
        `Session ${sessionId}: event log unreadable`,
        false, "Manual review required",
        sessionId, eventsFile);
    }
  }

  // Audit store
  const auditFile = join(root, ".alix", "audit", "audit.jsonl");
  if (existsSync(auditFile)) {
    try {
      const raw = readFileSync(auditFile, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          JSON.parse(lines[i]);
        } catch {
          addFinding(findings, "audit_store", "info", "partial_event_log_line",
            `Audit log: line ${i + 1} is not valid JSON (partial write)`,
            false, "Truncated line — prior records intact",
            undefined, auditFile);
        }
      }
    } catch {
      addFinding(findings, "audit_store", "warning", "corrupt_data_file",
        "Audit log unreadable",
        false, "Manual review required",
        undefined, auditFile);
    }
  }
}

// =========================================================================
// Reading stores for orphaned worker / approval consistency
// =========================================================================

function scanOrphanedWorkers(findings: RecoveryFinding[], root: string): void {
  const coordDir = join(root, ".alix", "coordination");
  if (!isDir(coordDir)) return;

  for (const f of listDir(coordDir).filter(e => e.endsWith(".json") && !e.endsWith(".runs.json") && !e.includes(".tmp") && e !== "results" && e !== "locks" && e !== "shared" && e !== "replans")) {
    const result = readJsonSafe(join(coordDir, f));
    if (!result.ok) continue;
    const run = result.data;
    if (!run.workers) continue;
    for (const w of run.workers) {
      if (w.status === "running") {
        addFinding(findings, "coordination_store", "warning", "orphaned_worker",
          `Worker ${w.id} in run ${run.id ?? f} is "running" — may be orphaned`,
          true,
          `Mark worker ${w.id} as failed with error "recovered"`,
          w.id, join(coordDir, f));
      }
    }
  }
}

function scanUnconsumedApprovals(findings: RecoveryFinding[], root: string): void {
  const approvalsFile = join(root, ".alix", "approvals", "approvals.json");
  const result = readJsonSafe(approvalsFile);
  if (!result.ok) return;
  const data = result.data;
  const approvals: any[] = data.approvals ?? (Array.isArray(data) ? data : []);
  for (const a of approvals) {
    if (a.status === "approved" || a.status === "pending") {
      addFinding(findings, "approval_store", "info", "unconsumed_approval",
        `Approval ${a.id}: status "${a.status}" — may be unconsumed`,
        false,
        "Verify whether this approval was dispatched",
        a.id, approvalsFile);
    }
  }
}

// =========================================================================
// Main scanner entry point
// =========================================================================

export interface ScanOptions {
  /** Limit findings to this severity or higher. */
  minSeverity?: RecoverySeverity;
  /** Only scan these subsystems. */
  subsystems?: RecoverySubsystem[];
}

function severityRank(s: RecoverySeverity): number {
  if (s === "critical") return 3;
  if (s === "warning") return 2;
  return 1;
}

/**
 * Scan all durable stores for integrity issues.
 * Always read-only — never mutates state.
 */
export async function scan(root: string, options?: ScanOptions): Promise<RecoveryReport> {
  _findingCounter = 0;
  const startedAt = now();
  const raw: RecoveryFinding[] = [];

  const minRank = options?.minSeverity ? severityRank(options.minSeverity) : 0;
  const subsystems = options?.subsystems;

  const shouldInclude = (subsystem: RecoverySubsystem): boolean => {
    if (!subsystems) return true;
    return subsystems.includes(subsystem);
  };

  // Run all checks
  if (shouldInclude("coordination_store") || shouldInclude("coordination_result_store") || shouldInclude("coordination_aggregate_store") || shouldInclude("replan_proposal_store") || shouldInclude("collaboration_store")) {
    scanCoordinationStore(raw, root);
  }
  if (shouldInclude("approval_store")) scanApprovalStore(raw, root);
  if (shouldInclude("ownership_registry")) scanOwnershipRegistry(raw, root);
  if (shouldInclude("chronicle_store")) scanChronicleStore(raw, root);
  if (shouldInclude("event_log") || shouldInclude("audit_store")) scanEventLogs(raw, root);
  if (shouldInclude("daemon_manager") || shouldInclude("task_registry")) scanDaemonStores(raw, root);

  // Cross-file checks
  if (shouldInclude("coordination_store") || shouldInclude("coordination_result_store") || shouldInclude("coordination_aggregate_store")) {
    scanCrossFileConsistency(raw, root);
    scanOrphanedWorkers(raw, root);
  }
  if (shouldInclude("approval_store")) scanUnconsumedApprovals(raw, root);

  // Filter by severity
  const findings = raw.filter(f => severityRank(f.severity) >= minRank);

  // Compute report
  const bySeverity = { info: 0, warning: 0, critical: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const completedAt = now();
  const criticals = findings.filter(f => f.severity === "critical");
  const warnings = findings.filter(f => f.severity === "warning");
  const repairable = findings.filter(f => f.repairable);

  let summary = `${findings.length} finding(s): ${bySeverity.critical} critical, ${bySeverity.warning} warning, ${bySeverity.info} info. `;
  if (criticals.length > 0) summary += `${criticals.length} require(s) manual review. `;
  if (repairable.length > 0) summary += `${repairable.length} repairable. `;
  if (findings.length === 0) summary += "All stores healthy.";

  return {
    startedAt,
    completedAt,
    totalFindings: findings.length,
    bySeverity,
    findings,
    repairAttempted: false,
    repairedCount: 0,
    repairedIds: [],
    failedRepairIds: [],
    summary,
  };
}

/**
 * Build an inline summary string from a report for CLI display.
 */
export function reportSummary(report: RecoveryReport): string {
  return report.summary;
}
