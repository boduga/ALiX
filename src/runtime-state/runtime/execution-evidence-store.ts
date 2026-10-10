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
import { createHash } from "node:crypto";
import type { ExecutionEvidence } from "./contracts/execution-intent-contract.js";
import { canonicalStringify } from "../../operations/utils/canonical-json.js";
import { JsonlStore } from "../storage/jsonl-store.js";
import { appendFact, drainLedgerEvents } from "../storage/runtime-ledger.js";

/** Ledger event vocabulary for the evidence domain (R2.11). */
export const EVIDENCE_LEDGER_EVENT_TYPES = [
  "evidence.recorded",
] as const;

// ─── R2.11 dual-write status (per workspace root) ────────────────────
type EvidenceLedgerStatus = { appends: number; failures: number; projectionFailures: number; lastError?: string; lastProjectionError?: string };
const statusByCwd = new Map<string, EvidenceLedgerStatus>();

function statusFor(cwd: string): EvidenceLedgerStatus {
  let s = statusByCwd.get(cwd);
  if (!s) {
    s = { appends: 0, failures: 0, projectionFailures: 0 };
    statusByCwd.set(cwd, s);
  }
  return s;
}

/** Observable authority health (R2: failures must never be silent). */
export function evidenceLedgerStatus(cwd: string): EvidenceLedgerStatus {
  const s = statusFor(cwd);
  return {
    ...s,
    ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
    ...(s.lastProjectionError !== undefined ? { lastProjectionError: s.lastProjectionError } : {}),
  };
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
  /**
   * R2.17 authority: append the evidence fact FIRST (the commit — throws on
   * failure; immutable evidence means an already-mirrored id is an idempotent
   * skip), then the JSONL projection (tolerated + counted).
   */
  async append(evidence: ExecutionEvidence): Promise<void> {
    const cwd = ledgerCwdFor(this.storeDir);
    const s = statusFor(cwd);
    // Append-only contract: EVERY physical append mirrors (duplicate
    // evidenceIds are legal — callers own deduplication), so the ledger
    // preserves line-level history too.
    appendFact(cwd, s, {
      eventType: "evidence.recorded",
      entityType: "executionEvidence",
      entityId: evidence.evidenceId,
      payload: { evidence },
      // intentId is optional on hand-built fixtures — never let it
      // produce a NULL correlation_id (NOT NULL column).
      correlationId: evidence.intentId ?? evidence.evidenceId,
      actor: { type: "system", id: "execution-evidence-store" },
      occurredAt: (evidence as { verifiedAt?: string }).verifiedAt ?? new Date().toISOString(),
      errorLabel: "evidence ledger",
    });

    try {
      this.ensureStoreDir();
      await this.store.appendRecord(evidence);
    } catch (err) {
      s.projectionFailures += 1;
      s.lastProjectionError = err instanceof Error ? err.message : String(err);
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
  /**
   * R2.17 authority read: latest ledger fact per evidence id, merged with
   * JSONL records that have no ledger facts (legacy). Ledger db errors count
   * and THROW — never masked by a file fallback.
   */
  async list(): Promise<ExecutionEvidence[]> {
    const cwd = ledgerCwdFor(this.storeDir);
    // ALL events (not latest-per-entity): append-only contract preserves
    // duplicate evidenceIds line-for-line, in ledger-seq order.
    let rows: ReturnType<typeof drainLedgerEvents>["events"];
    try {
      rows = drainLedgerEvents(cwd, new Set(["executionEvidence"])).events;
    } catch (err) {
      const s = statusFor(cwd);
      s.failures += 1;
      s.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }

    const ledgerIds = new Set(rows.map(r => r.entityId));
    const records: ExecutionEvidence[] = [];
    if (existsSync(this.filePath())) {
      for (const record of await this.readAll()) {
        if (ledgerIds.has(record.evidenceId)) continue; // covered below, in order
        records.push(record);
      }
    }
    for (const row of rows) {
      const payload = row.payload as { evidence?: ExecutionEvidence } | null;
      if (!payload?.evidence) {
        throw new Error(`evidence ledger event for ${row.entityId} missing evidence payload`);
      }
      records.push(payload.evidence);
    }
    return records;
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
