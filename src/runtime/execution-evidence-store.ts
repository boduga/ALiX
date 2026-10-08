/**
 * X3b — Append-only ExecutionEvidenceStore backed by JSONL.
 *
 * Mirrors the existing OutcomeStore pattern. One JSON object per line.
 * No update-in-place. No delete. No compaction. Corrupt or
 * checksum-mismatched lines are skipped with a warning — the store
 * does not crash on bad data.
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ExecutionEvidence } from "./contracts/execution-intent-contract.js";
import { canonicalStringify } from "../security/audit/canonical-json.js";
import { JsonlStore } from "../storage/jsonl-store.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

/** Ledger event vocabulary for the evidence domain (R2.11). */
export const EVIDENCE_LEDGER_EVENT_TYPES = [
  "evidence.recorded",
] as const;

// ─── R2.11 dual-write status (per workspace root) ────────────────────
type EvidenceLedgerStatus = { appends: number; failures: number; lastError?: string };
const statusByCwd = new Map<string, EvidenceLedgerStatus>();

function statusFor(cwd: string): EvidenceLedgerStatus {
  let s = statusByCwd.get(cwd);
  if (!s) {
    s = { appends: 0, failures: 0 };
    statusByCwd.set(cwd, s);
  }
  return s;
}

/** Observable dual-write health (R2: failures must never be silent). */
export function evidenceLedgerStatus(cwd: string): EvidenceLedgerStatus {
  const s = statusFor(cwd);
  return { ...s, ...(s.lastError !== undefined ? { lastError: s.lastError } : {}) };
}

/** Reset counters (tests). */
export function resetEvidenceLedgerStatus(cwd: string): void {
  statusByCwd.delete(cwd);
}

/** Workspace root for the shared ledger: strip a trailing `.alix/<x>` segment. */
function ledgerCwdFor(storeDir: string): string {
  const parts = storeDir.split(/[\\/]/);
  if (parts[parts.length - 2] === ".alix") return parts.slice(0, -2).join("/") || ".";
  return storeDir;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTFILE = "execution-evidence.jsonl";

/** Domain/version prefix for evidence checksums. */
const CHECKSUM_DOMAIN = "alix-execution-evidence-v1:";

// ---------------------------------------------------------------------------
// ExecutionEvidenceStore
// ---------------------------------------------------------------------------

export class ExecutionEvidenceStore {
  private readonly store: JsonlStore;

  constructor(private readonly storeDir: string) {
    this.store = new JsonlStore(join(storeDir, OUTFILE), 0o755);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Append one immutable evidence record.
   *
   * Append-only — never overwrites existing records.
   * Preserves insertion order. Callers own deduplication.
   */
  async append(evidence: ExecutionEvidence): Promise<void> {
    this.ensureStoreDir();
    await this.store.appendRecord(evidence);
    // R2.11 dual-write: mirror after the durable JSONL append (JSONL stays
    // authoritative this phase); evidence is immutable, so an existing
    // entity means the record was already mirrored (idempotent skip).
    const cwd = ledgerCwdFor(this.storeDir);
    const s = statusFor(cwd);
    try {
      const ledger = getSharedLedger(cwd);
      const expected = ledger.entityVersion(evidence.evidenceId);
      if (expected > 0) return;
      const res = ledger.append({
        event: {
          eventId: randomUUID(),
          eventType: "evidence.recorded",
          schemaVersion: 1,
          entityType: "executionEvidence",
          entityId: evidence.evidenceId,
          entityVersion: 1,
          correlationId: evidence.intentId,
          actor: { type: "system", id: "execution-evidence-store" },
          occurredAt: (evidence as { verifiedAt?: string }).verifiedAt ?? new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          payload: { evidence },
        },
        expectedVersion: 0,
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

  // ---------------------------------------------------------------------------
  // Read — single
  // ---------------------------------------------------------------------------

  /**
   * Return the first record with the given `evidenceId`, or `undefined`.
   */
  async getByEvidenceId(
    evidenceId: string,
  ): Promise<ExecutionEvidence | undefined> {
    const records = await this.list();
    return records.find((r) => r.evidenceId === evidenceId);
  }

  // ---------------------------------------------------------------------------
  // Read — by intent
  // ---------------------------------------------------------------------------

  /**
   * Return all evidence records that share the given `intentId`.
   *
   * One intent may produce multiple evidence records.
   */
  async getByIntentId(intentId: string): Promise<ExecutionEvidence[]> {
    const records = await this.list();
    return records.filter((r) => r.intentId === intentId);
  }

  // ---------------------------------------------------------------------------
  // Read — bulk
  // ---------------------------------------------------------------------------

  /**
   * Return every evidence record in the store in append order.
   *
   * Missing file is treated as an empty store. Records whose stored
   * checksum does not match the calculated checksum are skipped.
   * Malformed JSON lines are also skipped with a warning.
   */
  async list(): Promise<ExecutionEvidence[]> {
    if (!existsSync(this.filePath())) {
      return [];
    }
    return this.readAll();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private filePath(): string {
    return join(this.storeDir, OUTFILE);
  }

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o755 });
    }
  }

  private async readAll(): Promise<ExecutionEvidence[]> {
    const { records, malformed } = await this.store.readRecords<ExecutionEvidence>();
    if (malformed > 0) {
      console.warn(`ExecutionEvidenceStore: skipping ${malformed} malformed line(s)`);
    }
    return records.filter((parsed) => {
      // Validate persisted checksum
      if (!isValidChecksum(parsed)) {
        console.warn(
          `ExecutionEvidenceStore: skipping record with invalid checksum: ${parsed.evidenceId ?? "unknown"}`,
        );
        return false;
      }
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// Checksum helpers
// ---------------------------------------------------------------------------

/**
 * Compute the canonical SHA-256 checksum for an ExecutionEvidence record.
 *
 * Covers ALL evidence fields (except evidenceHash, which would be a
 * self-reference). Uses deterministic canonical JSON serialization with
 * sorted object keys, so the same data always produces the same hash
 * regardless of property declaration order.
 *
 * Includes a domain/version prefix to prevent hash type confusion across
 * different ALiX subsystems (execution evidence vs audit vs intents).
 */
export function computeEvidenceChecksum(
  evidence: ExecutionEvidence,
): string {
  // Strip self-referential evidenceHash before canonicalizing
  const { evidenceHash: _, ...fields } = evidence;
  const canonical = canonicalStringify(fields);
  const hash = createHash("sha256");
  hash.update(CHECKSUM_DOMAIN, "utf8");
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

/**
 * Check whether an ExecutionEvidence record has a valid stored checksum.
 *
 * Returns `true` when `evidenceHash` matches the computed checksum
 * for the record's identity + outcome fields. Records without a
 * loaded evidenceHash are considered valid (backward compatibility).
 */
export function isValidChecksum(
  evidence: ExecutionEvidence,
): boolean {
  if (!evidence.evidenceHash) {
    return true;
  }
  return evidence.evidenceHash === computeEvidenceChecksum(evidence);
}
