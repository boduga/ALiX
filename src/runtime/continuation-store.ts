/**
 * continuation-store.ts — File-backed persistence for pending continuation records.
 *
 * When PolicyGate returns "ask", ToolExecutor persists a PendingContinuation
 * so that approved tool calls can be resumed with argsHash integrity verification.
 *
 * File location: .alix/approvals/continuations.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getSharedLedger } from "../storage/runtime-ledger.js";

/** Ledger event vocabulary for the continuations domain (R2.8). */
export const CONTINUATION_LEDGER_EVENT_TYPES = [
  "continuation.created",
  "continuation.updated",
  "continuation.removed",
] as const;

// ─── R2.8 dual-write status (per workspace, like graph-ledger) ───────
type ContinuationLedgerStatus = { appends: number; failures: number; lastError?: string };
const statusByCwd = new Map<string, ContinuationLedgerStatus>();

function statusFor(cwd: string): ContinuationLedgerStatus {
  let s = statusByCwd.get(cwd);
  if (!s) {
    s = { appends: 0, failures: 0 };
    statusByCwd.set(cwd, s);
  }
  return s;
}

export function continuationLedgerStatus(cwd: string): ContinuationLedgerStatus {
  const s = statusFor(cwd);
  return { ...s, ...(s.lastError !== undefined ? { lastError: s.lastError } : {}) };
}

export function resetContinuationLedgerStatus(cwd: string): void {
  statusByCwd.delete(cwd);
}

function mirrorContinuation(cwd: string, approvalId: string, kind: "created" | "removed", payload: Record<string, unknown>): void {
  const s = statusFor(cwd);
  try {
    const ledger = getSharedLedger(cwd);
    const expected = ledger.entityVersion(approvalId);
    const eventType =
      kind === "removed"
        ? "continuation.removed"
        : expected === 0
          ? "continuation.created"
          : "continuation.updated";
    const res = ledger.append({
      event: {
        eventId: randomUUID(),
        eventType,
        schemaVersion: 1,
        entityType: "continuation",
        entityId: approvalId,
        entityVersion: expected + 1,
        correlationId: approvalId,
        actor: { type: "system", id: "continuation-store" },
        occurredAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        payload,
      },
      expectedVersion: expected,
    });
    if (res.ok) s.appends += 1;
    else {
      s.failures += 1;
      s.lastError = `${res.reason}: ${res.detail}`;
    }
  } catch (err) {
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
  }
}

// ─── Types ───────────────────────────────────────────────────────────

export type PendingContinuation = {
  approvalId: string;
  kind: "tool" | "capability";
  sessionId: string;
  cwd: string;
  toolCall?: {
    toolCallId: string;
    name: string;
    capability: string;
    args: Record<string, unknown>;
    argsHash: string;
    /** agentId was added in M0.75. Legacy continuations may lack this. */
    agentId?: string;
  };
  createdAt: string;
  /**
   * Set when a continuation was loaded from persistent storage but has
   * a migration issue (e.g. missing agentId). Such continuations cannot
   * be resumed under ownership enforcement but are not deleted.
   */
  migrationIssue?: "missing-agent-identity";
};

// ─── ContinuationStore ───────────────────────────────────────────────

export class ContinuationStore {
  private continuations: PendingContinuation[] = [];
  private dirty = false;
  private filePath: string;
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.filePath = join(cwd, ".alix", "approvals", "continuations.json");
  }

  /** Load continuations from disk. */
  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.continuations = [];
      this.dirty = false;
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.continuations = (JSON.parse(raw) as PendingContinuation[]).map(c => {
        // Mark legacy continuations missing agentId
        if (c.toolCall && !c.toolCall.agentId) {
          return { ...c, migrationIssue: "missing-agent-identity" as const };
        }
        return c;
      });
      this.dirty = false;
    } catch {
      this.continuations = [];
      this.dirty = false;
    }
  }

  /** Persist to disk if dirty. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.filePath, JSON.stringify(this.continuations, null, 2), "utf-8");
    this.dirty = false;
  }

  /** Add a new continuation record. */
  async persist(cont: PendingContinuation): Promise<void> {
    this.continuations.push(cont);
    this.dirty = true;
    await this.save();
    // R2.8 dual-write: mirror after the file write (JSON authoritative now);
    // failures counted, never thrown into the resume path.
    mirrorContinuation(this.cwd, cont.approvalId, "created", { continuation: cont });
  }

  /** Find a continuation by approval ID. */
  findByApprovalId(approvalId: string): PendingContinuation | undefined {
    return this.continuations.find(c => c.approvalId === approvalId);
  }

  /** Remove a continuation (one-shot — called after resume or denial). */
  async remove(approvalId: string): Promise<void> {
    this.continuations = this.continuations.filter(c => c.approvalId !== approvalId);
    this.dirty = true;
    await this.save();
    // R2.8: terminal tombstone so reconciliation knows removal was deliberate.
    mirrorContinuation(this.cwd, approvalId, "removed", { removed: true });
  }

  /** List all continuations. */
  list(): PendingContinuation[] {
    return [...this.continuations];
  }
}
