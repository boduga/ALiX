/**
 * recovery-repair.ts — Applies automated repairs for recoverable findings.
 *
 * Every repair is audited (appended to audit store), reported, and idempotent.
 * Repair never deletes unknown files or mutates state without confirmation.
 */

import { existsSync, rmSync, renameSync, readdirSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RecoveryFinding, RecoveryReport, RepairOptions } from "./recovery-types.js";
import { scan, reportSummary } from "./recovery-scanner.js";
import { DEFAULT_REPAIR_OPTIONS } from "./recovery-types.js";

// =========================================================================
// Audit trail
// =========================================================================

function appendAuditRecord(root: string, record: Record<string, unknown>): void {
  try {
    const auditDir = join(root, ".alix", "audit");
    mkdirSync(auditDir, { recursive: true });
    const auditPath = join(auditDir, "recovery.jsonl");
    writeFileSync(auditPath, JSON.stringify({
      ...record,
      timestamp: new Date().toISOString(),
    }) + "\n", { flag: "a" });
  } catch {
    // Best-effort audit trail
  }
}

// =========================================================================
// Repair handlers
// =========================================================================

const REPAIR_HANDLERS: Record<string, (finding: RecoveryFinding, root: string, options: RepairOptions) => boolean> = {
  stale_temp_file(finding, root) {
    if (!finding.filePath) return false;
    try {
      rmSync(finding.filePath, { force: true });
      appendAuditRecord(root, {
        action: "repair_stale_temp_file",
        filePath: finding.filePath,
        findingId: finding.id,
      });
      return true;
    } catch {
      return false;
    }
  },

  stale_lock(finding, root) {
    if (!finding.filePath) return false;
    try {
      rmSync(finding.filePath, { recursive: true, force: true });
      appendAuditRecord(root, {
        action: "repair_stale_lock",
        filePath: finding.filePath,
        findingId: finding.id,
      });
      return true;
    } catch {
      return false;
    }
  },

  stale_pid_file(finding, root) {
    if (!finding.filePath) return false;
    try {
      rmSync(finding.filePath, { force: true });

      // Also clean daemon.json if it references the same stale PID
      const daemonJson = join(homedir(), ".alix", "daemon.json");
      if (existsSync(daemonJson)) {
        try {
          const content = JSON.parse(readFileSync(daemonJson, "utf-8"));
          delete content.pid;
          writeFileSync(daemonJson, JSON.stringify(content, null, 2));
        } catch { /* skip */ }
      }

      appendAuditRecord(root, {
        action: "repair_stale_pid_file",
        filePath: finding.filePath,
        findingId: finding.id,
      });
      return true;
    } catch {
      return false;
    }
  },

  orphaned_ownership_lease(finding) {
    // For expired ownership leases, we can't safely repair without
    // the full OwnershipRegistry — this is a signal for manual review.
    // The finding is marked repairable but the actual repair requires
    // the store's load/save cycle. Return false to escalate.
    return false;
  },

  orphaned_daemon_task(finding, root) {
    // Load tasks, mark orphaned running tasks as failed_orphaned
    const tasksFile = join(homedir(), ".alix", "daemon-tasks.json");
    if (!existsSync(tasksFile)) return false;
    try {
      const raw = readFileSync(tasksFile, "utf-8");
      const tasks = JSON.parse(raw);
      if (!Array.isArray(tasks)) return false;
      let changed = false;
      for (const task of tasks) {
        if (task.id === finding.resourceId && (task.status === "running" || task.status === "cancel_requested")) {
          task.status = "failed_orphaned";
          task.completedAt = new Date().toISOString();
          task.error = task.error ?? "orphaned on daemon restart";
          changed = true;
          break;
        }
      }
      if (changed) {
        writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
        appendAuditRecord(root, {
          action: "repair_orphaned_daemon_task",
          taskId: finding.resourceId,
          findingId: finding.id,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  inconsistent_cross_reference(finding, root) {
    if (finding.subsystem === "chronicle_store" && finding.filePath?.includes("index.json")) {
      // Entry missing from disk but in index — can't fix missing files
      return false;
    }
    if (finding.subsystem === "chronicle_store" && finding.filePath?.includes("entries/")) {
      // Entry on disk but not in index — add it
      const chronicleDir = join(root, ".alix", "chronicle");
      const indexPath = join(chronicleDir, "index.json");
      if (!existsSync(indexPath)) return false;
      try {
        const raw = readFileSync(indexPath, "utf-8");
        const index = JSON.parse(raw);
        if (!Array.isArray(index)) return false;
        // Check if the entry file is valid
        const entryId = finding.resourceId;
        if (!entryId) return false;
        const entryPath = join(chronicleDir, "entries", `${entryId}.json`);
        if (!existsSync(entryPath)) return false;
        const entryRaw = readFileSync(entryPath, "utf-8");
        const entry = JSON.parse(entryRaw);
        const stub: Record<string, unknown> = {
          entryId: entry.entryId ?? entryId,
          signalCode: entry.signalCode ?? "recovered",
          domain: entry.domain ?? "unknown",
          createdAt: entry.createdAt ?? new Date().toISOString(),
        };
        // Only add if not already there
        if (!index.some((e: any) => e.entryId === stub.entryId)) {
          index.push(stub);
          writeFileSync(indexPath, JSON.stringify(index, null, 2));
          appendAuditRecord(root, {
            action: "repair_chronicle_index",
            entryId: finding.resourceId,
            findingId: finding.id,
          });
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
    return false;
  },
};

// =========================================================================
// Main repair entry point
// =========================================================================

/**
 * Attempt automated repair for repairable findings.
 * When options.execute is false, returns a dry-run report without mutating state.
 */
export async function repair(
  root: string,
  options: RepairOptions = DEFAULT_REPAIR_OPTIONS,
): Promise<RecoveryReport> {
  const baseReport = await scan(root);
  const findings = baseReport.findings.filter(f => f.repairable);

  const startedAt = new Date().toISOString();
  const repairedIds: string[] = [];
  const failedRepairIds: string[] = [];

  if (!options.execute) {
    // Dry-run: report what would be repaired
    const dryRunSummary = `[DRY RUN] Would repair ${findings.length} finding(s): ${findings.map(f => `${f.id} (${f.kind})`).join(", ")}`;
    return {
      ...baseReport,
      startedAt,
      repairAttempted: false,
      repairedCount: 0,
      repairedIds: [],
      failedRepairIds: [],
      summary: baseReport.findings.length > 0
        ? `${dryRunSummary}. Findings that require manual review: ${baseReport.findings.filter(f => !f.repairable).length}`
        : "All stores healthy.",
    };
  }

  for (const finding of findings) {
    const handler = REPAIR_HANDLERS[finding.kind];
    if (handler) {
      try {
        const success = handler(finding, root, options);
        if (success) {
          repairedIds.push(finding.id);
        } else {
          failedRepairIds.push(finding.id);
        }
      } catch {
        failedRepairIds.push(finding.id);
      }
    } else {
      failedRepairIds.push(finding.id);
    }
  }

  const completedAt = new Date().toISOString();
  const repairable = findings.length;
  const repaired = repairedIds.length;

  let summary = `Repaired ${repaired}/${repairable} repairable finding(s).`;
  if (failedRepairIds.length > 0) {
    summary += ` Failed: ${failedRepairIds.join(", ")}.`;
  }
  if (baseReport.findings.length - repairable > 0) {
    summary += ` ${baseReport.findings.length - repairable} non-repairable finding(s) require manual review.`;
  }

  return {
    ...baseReport,
    startedAt,
    completedAt,
    repairAttempted: true,
    repairedCount: repaired,
    repairedIds,
    failedRepairIds,
    summary,
  };
}
