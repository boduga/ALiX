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
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ExecutionEvidence } from "./contracts/execution-intent-contract.js";

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
  constructor(private readonly storeDir: string) {}

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

    const line = JSON.stringify(evidence) + "\n";
    await appendFile(this.filePath(), line, "utf-8");
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
    const raw = await readFile(this.filePath(), "utf-8");
    const records: ExecutionEvidence[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: ExecutionEvidence;
      try {
        parsed = JSON.parse(trimmed) as ExecutionEvidence;
      } catch {
        console.warn(
          `ExecutionEvidenceStore: skipping malformed line: ${trimmed.slice(0, 80)}...`,
        );
        continue;
      }

      // Validate persisted checksum
      if (!isValidChecksum(parsed)) {
        console.warn(
          `ExecutionEvidenceStore: skipping record with invalid checksum: ${parsed.evidenceId ?? "unknown"}`,
        );
        continue;
      }

      records.push(parsed);
    }

    return records;
  }
}

// ---------------------------------------------------------------------------
// Checksum helpers
// ---------------------------------------------------------------------------

/**
 * Compute the expected checksum for an ExecutionEvidence record.
 *
 * Uses SHA-256 over evidenceId + intentId + outcome + completedAt + summary
 * with a domain prefix to prevent hash type confusion.
 */
export function computeEvidenceChecksum(evidence: {
  evidenceId: string;
  intentId: string;
  outcome: string;
  completedAt: string;
  summary: string;
}): string {
  const hash = createHash("sha256");
  hash.update(CHECKSUM_DOMAIN);
  hash.update(evidence.evidenceId);
  hash.update("\0");
  hash.update(evidence.intentId);
  hash.update("\0");
  hash.update(evidence.outcome);
  hash.update("\0");
  hash.update(evidence.completedAt);
  hash.update("\0");
  hash.update(evidence.summary);
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
