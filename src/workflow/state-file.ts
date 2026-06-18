/**
 * P4.5c — State file with cross-process lock.
 *
 * Manages the workflow state.json file under an exclusive AuditLock.
 * State is small (<1 KB per issue) so reads and writes are sync operations
 * inside the locked scope. History is appended to an append-only JSONL file.
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { acquire } from "../security/audit/audit-lock.js";
import type { LockHandle } from "../security/audit/audit-lock.js";
import type { WorkflowStateEntry, WorkflowHistoryEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_FILENAME = "state.json";
const LOCK_FILENAME = "state.json.lock";
const HISTORY_FILENAME = "history.jsonl";
const DEFAULT_LOCK_TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// StateFile
// ---------------------------------------------------------------------------

export class StateFile {
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly historyPath: string;
  private readonly lockTimeoutMs: number;

  constructor(workflowDir: string, lockTimeoutMs?: number) {
    this.statePath = join(workflowDir, STATE_FILENAME);
    this.lockPath = join(workflowDir, LOCK_FILENAME);
    this.historyPath = join(workflowDir, HISTORY_FILENAME);
    this.lockTimeoutMs = lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT;
  }

  // -----------------------------------------------------------------------
  // State read/write
  // -----------------------------------------------------------------------

  /**
   * Read all workflow state entries from state.json.
   * Returns an empty map if the file does not exist or is corrupted.
   */
  async readState(): Promise<Map<number, WorkflowStateEntry>> {
    if (!existsSync(this.statePath)) return new Map();
    try {
      const raw = readFileSync(this.statePath, "utf-8");
      const entries = JSON.parse(raw) as WorkflowStateEntry[];
      return new Map(entries.map((e) => [e.issueNumber, e]));
    } catch {
      // Corrupted file — return empty. Caller can recover.
      return new Map();
    }
  }

  /**
   * Write all workflow state entries to state.json (atomically overwrites).
   */
  async writeState(entries: Map<number, WorkflowStateEntry>): Promise<void> {
    const arr = Array.from(entries.values());
    writeFileSync(this.statePath, JSON.stringify(arr, null, 2) + "\n", "utf-8");
  }

  // -----------------------------------------------------------------------
  // Lock
  // -----------------------------------------------------------------------

  /**
   * Acquire an exclusive cross-process lock on the state file.
   * Uses AuditLock with auto stale recovery.
   *
   * @returns A LockHandle — call `.release()` when done.
   * @throws If the lock cannot be acquired within the timeout.
   */
  async acquireLock(): Promise<LockHandle> {
    const result = await acquire(this.lockPath, {
      timeoutMs: this.lockTimeoutMs,
      staleRecovery: "auto",
    });
    if (!result.ok) {
      throw new Error(`State lock acquisition failed: ${result.error}`);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // History
  // -----------------------------------------------------------------------

  /**
   * Append a history event to the append-only history.jsonl file.
   */
  async appendHistory(event: WorkflowHistoryEvent): Promise<void> {
    appendFileSync(this.historyPath, JSON.stringify(event) + "\n", "utf-8");
  }

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  /** Return the file paths for diagnostics. */
  getPaths(): { statePath: string; lockPath: string; historyPath: string } {
    return {
      statePath: this.statePath,
      lockPath: this.lockPath,
      historyPath: this.historyPath,
    };
  }
}
