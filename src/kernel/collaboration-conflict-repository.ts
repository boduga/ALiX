/**
 * collaboration-conflict-repository.ts — Conflict lifecycle operations over CollaborationStore.
 *
 * Uses fingerprint deduplication. Exposes explicit lifecycle methods with
 * resolver authorization. Thin domain wrapper — no second state file.
 */

import { randomUUID } from "node:crypto";
import { CollaborationStore } from "./collaboration-store.js";
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

export class ConflictRepository {
  constructor(private collabStore: CollaborationStore) {}

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
    return { conflict, created };
  }

  async getConflicts(runId: string): Promise<FindingConflict[]> {
    return this.collabStore.mutate((state: any) => {
      state.conflicts = state.conflicts ?? [];
      return state.conflicts.filter(
        (c: FindingConflict) => c.runId === runId,
      );
    });
  }

  async getConflict(id: string): Promise<FindingConflict | null> {
    return this.collabStore.mutate((state: any) => {
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
      if (
        authority.allowedConflictIds &&
        !authority.allowedConflictIds.includes(conflict.id)
      )
        return false;
      return true;
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
    return this.collabStore.mutate((state: any) => {
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
        {
          kind: authority.kind,
          id:
            (authority as any).actorId ??
            (authority as any).workerId ??
            (authority as any).plannerId ??
            "unknown",
        },
      );
      return conflict;
    });
  }

  async resolveConflict(
    id: string,
    resolution: ConflictResolution,
    authority: ConflictResolverAuthority,
  ): Promise<FindingConflict | null> {
    return this.collabStore.mutate((state: any) => {
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
        {
          kind: authority.kind,
          id:
            (authority as any).actorId ??
            (authority as any).workerId ??
            (authority as any).plannerId ??
            "unknown",
        },
        resolution.decision,
      );
      return conflict;
    });
  }
}
