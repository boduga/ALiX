/**
 * P4.5c — WorkflowCoordinator: state machine kernel for issue execution.
 *
 * Owns:
 *   - State machine transitions (validates against ALLOWED_TRANSITIONS)
 *   - Agent dispatch (assign/release agents to issues)
 *   - Block management (block/unblock with evidence)
 *   - Stale detection and recovery
 *   - Evidence recording (optional EvidenceStore hook, lazy-loaded)
 *
 * The WorkflowCoordinator is the **only** component that writes to the
 * workflow state file. Agents report results; the Coordinator moves state.
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import { StateFile } from "./state-file.js";
import { ALLOWED_TRANSITIONS, WORKFLOW_STATES } from "./types.js";
import type {
  WorkflowState,
  WorkflowStateEntry,
  AgentName,
  WorkflowHistoryEvent,
  WorkflowCoordinatorConfig,
} from "./types.js";
import type { EvidenceType } from "../security/evidence/evidence-types.js";
import type { EvidenceEventWriter } from "./evidence-writer.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_STALE_THRESHOLD_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// WorkflowCoordinator
// ---------------------------------------------------------------------------

export class WorkflowCoordinator {
  private readonly stateFile: StateFile;
  private readonly evidenceStorePath: string | null;
  private readonly staleThresholdMs: number;
  private evidenceStore: import("../security/evidence/evidence-store.js").EvidenceStore | null = null;
  private evidenceStoreInitPromise: Promise<void> | null = null;
  private evidenceWriterEvidenceStore: import("../security/evidence/evidence-store.js").EvidenceStore | null = null;
  private evidenceWriter: EvidenceEventWriter | null = null;

  constructor(config: WorkflowCoordinatorConfig) {
    this.stateFile = new StateFile(config.workflowDir, config.lockTimeoutMs);
    this.evidenceStorePath = config.evidenceDir ?? null;
    this.staleThresholdMs = config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

    // Ensure workflow directory exists
    if (!existsSync(config.workflowDir)) {
      mkdirSync(config.workflowDir, { recursive: true });
    }
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  /**
   * Transition an issue to a new state.
   *
   * The **first** transition for any issue must be to "NEW". Subsequent
   * transitions are validated against ALLOWED_TRANSITIONS.
   *
   * @param issueNumber - GitHub issue number
   * @param to - Target workflow state
   * @param opts - Transition options (actor, reason, evidenceType, evidencePayload)
   * @returns The updated workflow state entry
   * @throws If the transition is not allowed per the state machine
   */
  async transition(
    issueNumber: number,
    to: WorkflowState,
    opts?: {
      actor?: AgentName | "human" | "system";
      reason?: string;
      evidenceType?: EvidenceType;
      evidencePayload?: Record<string, unknown>;
    },
  ): Promise<WorkflowStateEntry> {
    const lock = await this.stateFile.acquireLock();
    try {
      const entries = await this.stateFile.readState();
      const current = entries.get(issueNumber);
      const from = current?.state ?? null;

      // First transition for an issue must be to NEW
      if (!current && to !== "NEW") {
        throw new Error(
          `Issue ${issueNumber} has no workflow entry. First transition must be to "NEW".`,
        );
      }

      // Validate transition (skip for first-time NEW)
      if (from && !ALLOWED_TRANSITIONS[from]?.includes(to)) {
        throw new Error(
          `Invalid transition: ${from} → ${to}. Allowed: ${(ALLOWED_TRANSITIONS[from] ?? []).join(", ") || "(none)"}`,
        );
      }

      // Validate target state is a known state
      if (!WORKFLOW_STATES.has(to)) {
        throw new Error(`Unknown target state: "${to}"`);
      }

      const now = new Date().toISOString();

      // Build the updated entry
      const updated: WorkflowStateEntry = {
        ...(current ?? {
          issueNumber,
          evidenceFingerprints: [],
          startedAt: now,
        }),
        state: to,
        updatedAt: now,
        assignedAgent: current?.assignedAgent ?? null,
        humanGateRequired: current?.humanGateRequired ?? false,
      };

      // Clear block fields on transition away from BLOCKED
      if (from === "BLOCKED" && to !== "BLOCKED") {
        delete updated.blockReason;
        delete updated.blockingItem;
        delete updated.blockedAt;
      }

      // Record evidence if configured (best-effort, never blocks)
      if (opts?.evidenceType) {
        await this.recordEvidence(updated, opts.evidenceType, {
          issueNumber,
          fromState: from,
          toState: to,
          actor: opts.actor ?? "system",
          ...(opts.evidencePayload ?? {}),
        });
      }

      // Persist state
      entries.set(issueNumber, updated);
      await this.stateFile.writeState(entries);

      // Append history event
      const event: WorkflowHistoryEvent = {
        timestamp: now,
        issueNumber,
        from,
        to,
        actor: opts?.actor ?? "system",
        reason: opts?.reason,
      };
      if (updated.evidenceFingerprints.length > 0) {
        event.evidenceFingerprint =
          updated.evidenceFingerprints[updated.evidenceFingerprints.length - 1];
      }
      await this.stateFile.appendHistory(event);

      return updated;
    } finally {
      lock.release();
    }
  }

  /**
   * Get the current workflow state for an issue.
   * Returns null if the issue has no workflow entry.
   */
  async currentState(issueNumber: number): Promise<WorkflowStateEntry | null> {
    const entries = await this.stateFile.readState();
    return entries.get(issueNumber) ?? null;
  }

  /**
   * List all active (non-terminal) workflow entries.
   * Terminal states: COMPLETE, MERGED.
   */
  async listActive(): Promise<WorkflowStateEntry[]> {
    const entries = await this.stateFile.readState();
    return Array.from(entries.values()).filter(
      (e) => e.state !== "COMPLETE" && e.state !== "MERGED",
    );
  }

  // -----------------------------------------------------------------------
  // Block management
  // -----------------------------------------------------------------------

  /**
   * Block an issue (transition to BLOCKED state).
   *
   * Only valid from EXECUTING state per the transition map.
   *
   * @param issueNumber - The issue to block
   * @param reason - Human-readable reason for blocking
   * @param blockingItem - Optional reference to what's blocking (CI URL, issue #, etc.)
   */
  async block(
    issueNumber: number,
    reason: string,
    blockingItem?: string,
  ): Promise<WorkflowStateEntry> {
    const entry = await this.transition(issueNumber, "BLOCKED", {
      actor: "system",
      reason,
      evidenceType: "workflow_blocked",
      evidencePayload: { reason, blockingItem },
    });
    entry.blockReason = reason;
    entry.blockingItem = blockingItem;
    entry.blockedAt = new Date().toISOString();

    // Persist the block metadata
    const lock = await this.stateFile.acquireLock();
    try {
      const entries = await this.stateFile.readState();
      entries.set(issueNumber, entry);
      await this.stateFile.writeState(entries);
    } finally {
      lock.release();
    }

    return entry;
  }

  /**
   * Unblock an issue (transition from BLOCKED back to EXECUTING).
   *
   * @throws If the issue is not in BLOCKED state
   */
  async unblock(issueNumber: number): Promise<WorkflowStateEntry> {
    const current = await this.currentState(issueNumber);
    if (!current) throw new Error(`Issue ${issueNumber} not found`);
    if (current.state !== "BLOCKED") {
      throw new Error(
        `Issue ${issueNumber} is not BLOCKED (state=${current.state})`,
      );
    }

    const blockedAt = current.blockedAt
      ? new Date(current.blockedAt).getTime()
      : null;
    const blockedDurationMs = blockedAt ? Date.now() - blockedAt : undefined;

    return this.transition(issueNumber, "EXECUTING", {
      actor: "system",
      reason: "Unblocked",
      evidenceType: "workflow_unblocked",
      evidencePayload: { blockedDurationMs },
    });
  }

  // -----------------------------------------------------------------------
  // Agent dispatch
  // -----------------------------------------------------------------------

  /**
   * Assign an agent to an issue.
   */
  async assignAgent(issueNumber: number, agent: AgentName): Promise<void> {
    const lock = await this.stateFile.acquireLock();
    try {
      const entries = await this.stateFile.readState();
      const current = entries.get(issueNumber);
      if (!current) throw new Error(`Issue ${issueNumber} not found`);
      current.assignedAgent = agent;
      current.updatedAt = new Date().toISOString();
      entries.set(issueNumber, current);
      await this.stateFile.writeState(entries);
    } finally {
      lock.release();
    }
  }

  /**
   * Release the assigned agent from an issue.
   */
  async releaseAgent(issueNumber: number): Promise<void> {
    const lock = await this.stateFile.acquireLock();
    try {
      const entries = await this.stateFile.readState();
      const current = entries.get(issueNumber);
      if (!current) throw new Error(`Issue ${issueNumber} not found`);
      current.assignedAgent = null;
      current.updatedAt = new Date().toISOString();
      entries.set(issueNumber, current);
      await this.stateFile.writeState(entries);
    } finally {
      lock.release();
    }
  }

  // -----------------------------------------------------------------------
  // Recovery
  // -----------------------------------------------------------------------

  /**
   * Detect workflow entries that have been in a non-terminal state
   * longer than the stale threshold.
   *
   * @param thresholdMs - Override the stale threshold (default: config value or 5 min)
   */
  async detectStale(thresholdMs?: number): Promise<WorkflowStateEntry[]> {
    const entries = await this.stateFile.readState();
    const threshold = thresholdMs ?? this.staleThresholdMs;
    const now = Date.now();
    return Array.from(entries.values()).filter((e) => {
      if (e.state === "COMPLETE" || e.state === "MERGED") return false;
      const age = now - new Date(e.updatedAt).getTime();
      return age > threshold;
    });
  }

  /**
   * Force-recover an issue to a target state.
   *
   * Has its own locked write path — skips transition validation so it
   * can force any valid WorkflowState regardless of the current state's
   * allowed transitions. Use for manual recovery after crashes, stale
   * workflows, or failed agents.
   *
   * Records `workflow_aborted` evidence when the store is available.
   *
   * @param issueNumber - The issue to recover
   * @param forceState - Target state (must be a valid WorkflowState)
   * @param reason - Human-readable reason for recovery
   * @throws If forceState is not a valid WorkflowState
   */
  async recover(
    issueNumber: number,
    forceState: WorkflowState,
    reason: string,
  ): Promise<WorkflowStateEntry> {
    if (!WORKFLOW_STATES.has(forceState)) {
      throw new Error(
        `Invalid target state for recovery: "${forceState}"`,
      );
    }

    // recover() uses its own locked write path — skips transition validation
    const lock = await this.stateFile.acquireLock();
    try {
      const entries = await this.stateFile.readState();
      const current = entries.get(issueNumber);
      const from = current?.state ?? null;

      const now = new Date().toISOString();
      const updated: WorkflowStateEntry = {
        ...(current ?? {
          issueNumber,
          evidenceFingerprints: [],
          startedAt: now,
        }),
        state: forceState,
        updatedAt: now,
        assignedAgent: current?.assignedAgent ?? null,
        humanGateRequired: current?.humanGateRequired ?? false,
      };

      // Record workflow_aborted evidence
      await this.recordEvidence(updated, "workflow_aborted", {
        issueNumber,
        fromState: from,
        toState: forceState,
        reason,
        forcedState: forceState,
      });

      // Persist state
      entries.set(issueNumber, updated);
      await this.stateFile.writeState(entries);

      // Append history event
      await this.stateFile.appendHistory({
        timestamp: now,
        issueNumber,
        from,
        to: forceState,
        actor: "system",
        reason: `Recovery: ${reason}`,
      });

      return updated;
    } finally {
      lock.release();
    }
  }

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  /** Expose the underlying StateFile for advanced diagnostics. */
  getStateFile(): StateFile {
    return this.stateFile;
  }

  /**
   * Get the evidence event writer for recording typed workflow events.
   * Returns null if the evidence store is not available.
   * Lazily initialised on first access.
   */
  async getEvidenceWriter(): Promise<EvidenceEventWriter | null> {
    if (this.evidenceWriter) return this.evidenceWriter;
    await this.ensureEvidenceStore();
    if (!this.evidenceStore) return null;
    if (this.evidenceWriterEvidenceStore === this.evidenceStore && this.evidenceWriter) {
      return this.evidenceWriter;
    }
    const { EvidenceEventWriter } = await import(
      "./evidence-writer.js"
    );
    this.evidenceWriter = new EvidenceEventWriter(
      (type, payload) => this.evidenceStore!.append(type, payload),
    );
    this.evidenceWriterEvidenceStore = this.evidenceStore;
    return this.evidenceWriter;
  }

  // -----------------------------------------------------------------------
  // Private: evidence recording (lazy, best-effort)
  // -----------------------------------------------------------------------

  /**
   * Lazily initialize the evidence store on first call.
   */
  private async ensureEvidenceStore(): Promise<void> {
    if (this.evidenceStoreInitPromise) return this.evidenceStoreInitPromise;
    this.evidenceStoreInitPromise = this.initEvidenceStore();
    return this.evidenceStoreInitPromise;
  }

  private async initEvidenceStore(): Promise<void> {
    if (!this.evidenceStorePath || !existsSync(this.evidenceStorePath)) return;
    try {
      const { EvidenceStore } = await import(
        "../security/evidence/evidence-store.js"
      );
      this.evidenceStore = new EvidenceStore({
        storeDir: this.evidenceStorePath,
      });
    } catch {
      // Evidence store is optional — best-effort
    }
  }

  /**
   * Record an evidence event. Best-effort — never throws.
   */
  private async recordEvidence(
    entry: WorkflowStateEntry,
    type: EvidenceType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureEvidenceStore();
    if (!this.evidenceStore) return;
    try {
      const record = await this.evidenceStore.append(type, payload);
      entry.evidenceFingerprints.push(record.fingerprint);
    } catch {
      // Evidence recording is best-effort — never blocks the transition
    }
  }
}
