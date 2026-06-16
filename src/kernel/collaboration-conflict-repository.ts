/**
 * collaboration-conflict-repository.ts — Conflict lifecycle operations over CollaborationStore.
 *
 * Uses fingerprint deduplication. Exposes explicit lifecycle methods with
 * resolver authorization. Thin domain wrapper — no second state file.
 */

import { randomUUID } from "node:crypto";
import { CollaborationStore } from "./collaboration-store.js";
import { CONFLICT_EVENT_TYPES } from "../events/types.js";
import type {
  FindingConflict,
  ConflictStatus,
  ConflictResolverAuthority,
  ConflictResolution,
  ConflictHistoryEntry,
  DetectionMethod,
  EvidenceComparison,
} from "./collaboration-conflict-types.js";

export type UpsertConflictInput = {
  conflictFingerprint: string;
  topicKey: string;
  type: string;
  findingIds: string[];
  claimComparisons: any[];
  evidenceComparison: EvidenceComparison;
  detectedBy: DetectionMethod[];
  criticality: "info" | "warning" | "critical";
  blocksDownstreamByPolicy: boolean;
};

type EventLogLike = {
  append: (e: {
    type: string;
    payload?: unknown;
    actor?: { kind: string; id: string };
  }) => Promise<unknown>;
};

type AuditStoreLike = {
  append: (e: {
    action: string;
    details?: Record<string, unknown>;
  }) => Promise<unknown>;
};

type MetricsLike = {
  increment: (name: string, labels?: Record<string, string>, by?: number) => void;
  duration: (name: string, valueMs: number, labels?: Record<string, string>) => void;
};

export class ConflictRepository {
  constructor(
    private collabStore: CollaborationStore,
    private eventLog?: EventLogLike,
    private auditStore?: AuditStoreLike,
    private metrics?: MetricsLike,
  ) {}

  /**
   * Best-effort event emission. Never gates on observability: a failed
   * append is swallowed so a write/decision that already succeeded
   * cannot be rolled back by an event-log failure.
   */
  private async emit(
    type: string,
    payload: Record<string, unknown>,
    actor: { kind: string; id: string },
  ): Promise<void> {
    if (!this.eventLog) return;
    try {
      await this.eventLog.append({ type, payload, actor });
    } catch {
      // best-effort; never gate on observability
    }
  }

  /**
   * Best-effort audit recording. Like event emission, never gates a
   * decision. The audit record carries run id, conflict id, actor id,
   * and the free-text reason for the transition.
   */
  private async audit(
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditStore) return;
    try {
      await this.auditStore.append({ action, details });
    } catch {
      // best-effort
    }
  }

  private actorFromAuthority(
    authority: ConflictResolverAuthority,
  ): { kind: string; id: string } {
    return {
      kind: authority.kind,
      id:
        (authority as any).actorId ??
        (authority as any).workerId ??
        (authority as any).plannerId ??
        "unknown",
    };
  }

  async upsertConflict(
    runId: string,
    input: UpsertConflictInput,
  ): Promise<{ conflict: FindingConflict; created: boolean }> {
    let created = false;
    const conflict = await this.collabStore.mutate((state: any) => {
      state.conflicts = state.conflicts ?? [];
      // Deduplicate by fingerprint
      const existing = state.conflicts.find(
        (c: FindingConflict) =>
          c.conflictFingerprint === input.conflictFingerprint &&
          c.status !== "superseded" &&
          c.status !== "resolved",
      );
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        if (
          !existing.detectedBy.includes(input.detectedBy[0])
        )
          existing.detectedBy.push(...input.detectedBy);
        existing.evidenceComparison = input.evidenceComparison;
        this.addHistory(existing, "updated");
        return existing;
      }
      created = true;
      const now = new Date().toISOString();
      const conflict: FindingConflict = {
        id: `conflict_${randomUUID()}`,
        schemaVersion: "1.0",
        runId,
        conflictFingerprint: input.conflictFingerprint,
        topicKey: input.topicKey,
        type: input.type as any,
        status: "detected",
        findingIds: input.findingIds,
        claimComparisons: input.claimComparisons,
        evidenceComparison: input.evidenceComparison,
        detectedBy: input.detectedBy,
        criticality: input.criticality,
        blocksDownstreamByPolicy: input.blocksDownstreamByPolicy,
        history: [{ action: "created", at: now }],
        createdAt: now,
        updatedAt: now,
      };
      state.conflicts.push(conflict);
      return conflict;
    });
    // D1 emission: lifecycle event is emitted AFTER the mutate returns.
    if (created) {
      await this.emit(
        CONFLICT_EVENT_TYPES.DETECTED,
        {
          runId,
          conflictId: conflict.id,
          fingerprint: conflict.conflictFingerprint,
          type: conflict.type,
          findingIds: conflict.findingIds,
          criticality: conflict.criticality,
        },
        { kind: "detector", id: "ConflictDetector" },
      );
      await this.audit("conflict.detected", {
        runId,
        conflictId: conflict.id,
        actorId: "ConflictDetector",
      });
    } else {
      await this.emit(
        CONFLICT_EVENT_TYPES.UPDATED,
        {
          runId,
          conflictId: conflict.id,
          fingerprint: conflict.conflictFingerprint,
        },
        { kind: "detector", id: "ConflictDetector" },
      );
      await this.audit("conflict.reported", {
        runId,
        conflictId: conflict.id,
        actorId: "ConflictDetector",
      });
    }
    return { conflict, created };
  }

  async getConflicts(runId: string): Promise<FindingConflict[]> {
    return this.collabStore.read((state: any) => {
      state.conflicts = state.conflicts ?? [];
      return state.conflicts.filter(
        (c: FindingConflict) => c.runId === runId,
      );
    });
  }

  async getConflict(id: string): Promise<FindingConflict | null> {
    return this.collabStore.read((state: any) => {
      state.conflicts = state.conflicts ?? [];
      return state.conflicts.find((c: FindingConflict) => c.id === id) ?? null;
    });
  }

  private authorize(
    authority: ConflictResolverAuthority,
    conflict: FindingConflict,
  ): boolean {
    if (authority.kind === "operator") return true;
    if (authority.kind === "planner") return true;
    if (authority.kind === "worker") {
      return (
        Array.isArray(authority.allowedConflictIds) &&
        authority.allowedConflictIds.includes(conflict.id)
      );
    }
    return false;
  }

  private addHistory(
    conflict: FindingConflict,
    action: ConflictHistoryEntry["action"],
    actor?: { kind: string; id: string },
    reason?: string,
  ): void {
    const entry: ConflictHistoryEntry = {
      action,
      at: new Date().toISOString(),
      reason,
    };
    if (actor) entry.actor = actor;
    conflict.history.push(entry);
  }

  async updateConflictStatus(
    id: string,
    status: ConflictStatus,
    authority: ConflictResolverAuthority,
  ): Promise<FindingConflict | null> {
    const result = await this.collabStore.mutate((state: any) => {
      state.conflicts = state.conflicts ?? [];
      const conflict = state.conflicts.find(
        (c: FindingConflict) => c.id === id,
      );
      if (!conflict || !this.authorize(authority, conflict)) return null;
      if (
        conflict.status === "resolved" ||
        conflict.status === "superseded"
      )
        return null;
      conflict.status = status;
      conflict.updatedAt = new Date().toISOString();
      this.addHistory(
        conflict,
        status as any,
        this.actorFromAuthority(authority),
      );
      return conflict;
    });
    // D1 emission: status-transition events are emitted AFTER the mutate returns.
    if (result) {
      const actor = this.actorFromAuthority(authority);
      if (status === "under_review") {
        await this.emit(
          CONFLICT_EVENT_TYPES.UNDER_REVIEW,
          { runId: result.runId, conflictId: result.id },
          actor,
        );
        await this.audit("conflict.under_review", {
          runId: result.runId,
          conflictId: result.id,
          actorId: actor.id,
        });
      } else if (status === "dismissed") {
        await this.emit(
          CONFLICT_EVENT_TYPES.DISMISSED,
          { runId: result.runId, conflictId: result.id },
          actor,
        );
        await this.audit("conflict.dismissed", {
          runId: result.runId,
          conflictId: result.id,
          actorId: actor.id,
        });
        if (this.metrics) {
          try {
            this.metrics.increment("collaboration_conflicts_dismissed_total", { result: "ok" });
          } catch { /* best-effort */ }
        }
      } else if (status === "superseded") {
        await this.emit(
          CONFLICT_EVENT_TYPES.SUPERSEDED,
          { runId: result.runId, conflictId: result.id },
          actor,
        );
      }
    }
    return result;
  }

  async resolveConflict(
    id: string,
    resolution: ConflictResolution,
    authority: ConflictResolverAuthority,
  ): Promise<FindingConflict | null> {
    const result = await this.collabStore.mutate((state: any) => {
      state.conflicts = state.conflicts ?? [];
      const conflict = state.conflicts.find(
        (c: FindingConflict) => c.id === id,
      );
      if (!conflict || !this.authorize(authority, conflict)) return null;
      conflict.status = "resolved";
      conflict.resolution = resolution;
      conflict.updatedAt = new Date().toISOString();
      this.addHistory(
        conflict,
        "resolved",
        this.actorFromAuthority(authority),
        resolution.decision,
      );
      return conflict;
    });
    if (result) {
      const actor = this.actorFromAuthority(authority);
      await this.emit(
        CONFLICT_EVENT_TYPES.RESOLVED,
        {
          runId: result.runId,
          conflictId: result.id,
          decision: resolution.decision,
        },
        actor,
      );
      await this.audit("conflict.resolved", {
        runId: result.runId,
        conflictId: result.id,
        actorId: actor.id,
        reason: resolution.decision,
      });
      if (this.metrics) {
        try {
          this.metrics.increment("collaboration_conflicts_resolved_total", { result: "ok" });
        } catch { /* best-effort */ }
      }
    }
    return result;
  }

  async acceptConflictDivergence(
    id: string,
    reason: string,
    authority: ConflictResolverAuthority,
  ): Promise<FindingConflict | null> {
    const result = await this.collabStore.mutate((state: any) => {
      state.conflicts = state.conflicts ?? [];
      const conflict = state.conflicts.find(
        (c: FindingConflict) => c.id === id,
      );
      if (!conflict || !this.authorize(authority, conflict)) return null;
      if (
        conflict.status === "resolved" ||
        conflict.status === "superseded"
      )
        return null;
      conflict.status = "accepted_divergence";
      conflict.updatedAt = new Date().toISOString();
      this.addHistory(
        conflict,
        "accepted_divergence",
        this.actorFromAuthority(authority),
        reason,
      );
      return conflict;
    });
    if (result) {
      const actor = this.actorFromAuthority(authority);
      await this.emit(
        CONFLICT_EVENT_TYPES.ACCEPTED_DIVERGENCE,
        { runId: result.runId, conflictId: result.id, reason },
        actor,
      );
      await this.audit("conflict.accepted_divergence", {
        runId: result.runId,
        conflictId: result.id,
        actorId: actor.id,
        reason,
      });
    }
    return result;
  }
}
