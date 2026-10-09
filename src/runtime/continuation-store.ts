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
import { appendFact, currentEntityVersion } from "../storage/runtime-ledger.js";

/** Ledger event vocabulary for the continuations domain (R2.8). */
export const CONTINUATION_LEDGER_EVENT_TYPES = [
  "continuation.created",
  "continuation.updated",
  "continuation.removed",
] as const;

// ─── R2.8 dual-write status (per workspace, like graph-ledger) ───────
type ContinuationLedgerStatus = { appends: number; failures: number; projectionFailures: number; lastError?: string; lastProjectionError?: string };
const statusByCwd = new Map<string, ContinuationLedgerStatus>();

function statusFor(cwd: string): ContinuationLedgerStatus {
  let s = statusByCwd.get(cwd);
  if (!s) {
    s = { appends: 0, failures: 0, projectionFailures: 0 };
    statusByCwd.set(cwd, s);
  }
  return s;
}

export function continuationLedgerStatus(cwd: string): ContinuationLedgerStatus {
  const s = statusFor(cwd);
  return {
    ...s,
    ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
    ...(s.lastProjectionError !== undefined ? { lastProjectionError: s.lastProjectionError } : {}),
  };
}

export function resetContinuationLedgerStatus(cwd: string): void {
  statusByCwd.delete(cwd);
}

/**
 * R2.14 append a continuation fact — THE COMMIT (ledger is authoritative).
 * Must run BEFORE the in-memory mutation + file write. Failure is counted,
 * then THROWN so no JSON-only state can exist.
 */
function appendContinuation(cwd: string, approvalId: string, kind: "created" | "removed", payload: Record<string, unknown>): void {
  const s = statusFor(cwd);
  const expected = currentEntityVersion(cwd, s, approvalId);
  const eventType =
    kind === "removed"
      ? "continuation.removed"
      : expected === 0
        ? "continuation.created"
        : "continuation.updated";
  appendFact(cwd, s, {
    eventType,
    entityType: "continuation",
    entityId: approvalId,
    payload,
    correlationId: approvalId,
    actor: { type: "system", id: "continuation-store" },
    occurredAt: new Date().toISOString(),
    expectedVersion: expected,
    errorLabel: "continuation ledger",
  });
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

  /**
   * Load continuations — LEDGER first (R2.14 authority). The file projection
   * is consulted only for legacy records with zero ledger facts; tombstones
   * suppress stale file copies. Ledger db errors THROW (counted, never
   * masked by a file fallback).
   */
  async load(): Promise<void> {
    const { getSharedLedger } = await import("../storage/runtime-ledger.js");
    let latest: Array<{ eventType: string; entityId: string; payload: unknown }>;
    try {
      latest = getSharedLedger(this.cwd).readLatestByEntityType("continuation");
    } catch (err) {
      const s = statusFor(this.cwd);
      s.failures += 1;
      s.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }

    const fromLedger = new Map<string, PendingContinuation>();
    const removedIds = new Set<string>();
    for (const event of latest) {
      if (event.eventType === "continuation.removed") {
        removedIds.add(event.entityId);
        continue;
      }
      const payload = event.payload as { continuation?: PendingContinuation } | null;
      if (!payload?.continuation) {
        throw new Error(`continuation ledger event for ${event.entityId} missing continuation payload`);
      }
      fromLedger.set(event.entityId, payload.continuation);
    }

    // Projection (file) for legacy records + new records not yet in ledger.
    const fromFile: PendingContinuation[] = [];
    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, "utf-8");
        for (const c of JSON.parse(raw) as PendingContinuation[]) {
          fromFile.push(c.toolCall && !c.toolCall.agentId
            ? { ...c, migrationIssue: "missing-agent-identity" as const }
            : c);
        }
      } catch {
        // corrupt file — ledger view still applies
      }
    }

    const merged = new Map<string, PendingContinuation>();
    for (const c of fromFile) {
      if (removedIds.has(c.approvalId) || fromLedger.has(c.approvalId)) continue;
      merged.set(c.approvalId, c);
    }
    for (const [id, c] of fromLedger) {
      if (!removedIds.has(id)) merged.set(id, c);
    }
    this.continuations = [...merged.values()];
    this.dirty = false;
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
    // R2.14 authority: the ledger append IS the commit — it runs BEFORE the
    // in-memory mutation and file write and throws on failure.
    appendContinuation(this.cwd, cont.approvalId, "created", { continuation: cont });
    this.continuations.push(cont);
    this.dirty = true;
    try {
      await this.save();
    } catch (err) {
      const s = statusFor(this.cwd);
      s.projectionFailures += 1;
      s.lastProjectionError = err instanceof Error ? err.message : String(err);
    }
  }

  /** Find a continuation by approval ID. */
  findByApprovalId(approvalId: string): PendingContinuation | undefined {
    return this.continuations.find(c => c.approvalId === approvalId);
  }

  /** Remove a continuation (one-shot — called after resume or denial). */
  async remove(approvalId: string): Promise<void> {
    // R2.14 authority: tombstone first (throws on failure), then memory+file.
    appendContinuation(this.cwd, approvalId, "removed", { removed: true });
    this.continuations = this.continuations.filter(c => c.approvalId !== approvalId);
    this.dirty = true;
    try {
      await this.save();
    } catch (err) {
      const s = statusFor(this.cwd);
      s.projectionFailures += 1;
      s.lastProjectionError = err instanceof Error ? err.message : String(err);
    }
  }

  /** List all continuations. */
  list(): PendingContinuation[] {
    return [...this.continuations];
  }
}
