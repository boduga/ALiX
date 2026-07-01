/**
 * P4.4a — Evidence Store: append-only JSONL store for trust evidence.
 *
 * Records deterministic fingerprints so the evidence chain is verifiable.
 * Reuses the AuditLock cross-process lock and canonical-json hashing from
 * P4.3-Sd.
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import {
  appendFile,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { acquire, release } from "../audit/audit-lock.js";
import { canonicalHash, canonicalStringify } from "../audit/canonical-json.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceRecord,
  type EvidenceQuery,
  type EvidenceQueryResult,
  type EvidenceStoreConfig,
  type EvidenceType,
  type CompactionResult,
  EVIDENCE_TYPES,
} from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_FILENAME = "evidence.jsonl";
const LOCK_FILENAME = "evidence.lock";
const DEFAULT_QUERY_LIMIT = 100;
const DEFAULT_MAX_SCAN = 100_000;
const FP_DOMAIN = "alix-evidence-v1:";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function evidenceFilePath(storeDir: string): string {
  return join(storeDir, EVIDENCE_FILENAME);
}

/**
 * Compute a deterministic fingerprint for an evidence record.
 * Covers type + timestamp + payload so re-recording the same evidence
 * at the same instant produces the same fingerprint (idempotent for
 * deterministic payloads).
 */
function computeFingerprint(
  type: EvidenceType,
  timestamp: string,
  payload: Record<string, unknown>,
): string {
  const canonical = canonicalStringify({ type, timestamp, payload });
  return canonicalHash(FP_DOMAIN + canonical);
}

// ---------------------------------------------------------------------------
// EvidenceStore
// ---------------------------------------------------------------------------

export class EvidenceStore {
  private readonly config: Required<EvidenceStoreConfig>;

  constructor(config: EvidenceStoreConfig) {
    this.config = {
      storeDir: config.storeDir,
      lockPath: config.lockPath ?? join(config.storeDir, LOCK_FILENAME),
      defaultQueryLimit: config.defaultQueryLimit ?? DEFAULT_QUERY_LIMIT,
      maxScanLines: config.maxScanLines ?? DEFAULT_MAX_SCAN,
    };
    this.ensureStoreDir();
  }

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  /**
   * Append a single evidence record to the store.
   * Acquires an exclusive lock, computes fingerprint, appends, releases.
   */
  async append(
    type: EvidenceType,
    payload: Record<string, unknown>,
  ): Promise<EvidenceRecord> {
    if (!EVIDENCE_TYPES.has(type)) {
      throw new Error(`Invalid evidence type: "${type}". Valid types: ${Array.from(EVIDENCE_TYPES).join(", ")}`);
    }
    const id = randomUUID();
    const timestamp = now();
    const fingerprint = computeFingerprint(type, timestamp, payload);

    const record: EvidenceRecord = {
      version: EVIDENCE_SCHEMA_VERSION,
      id,
      type,
      timestamp,
      fingerprint,
      payload,
    };

    const lockResult = await acquire(this.config.lockPath, { staleRecovery: "auto" });
    if (!lockResult.ok) {
      throw new Error(`Evidence store lock failed: ${lockResult.error}`);
    }
    try {
      const line = canonicalStringify(record) + "\n";
      await appendFile(evidenceFilePath(this.config.storeDir), line, "utf-8");
    } finally {
      release(lockResult);
    }

    return record;
  }

  /**
   * Append multiple records atomically (single lock acquisition, same timestamp).
   */
  async appendBatch(
    entries: Array<{ type: EvidenceType; payload: Record<string, unknown> }>,
  ): Promise<EvidenceRecord[]> {
    if (entries.length === 0) return [];
    for (const e of entries) {
      if (!EVIDENCE_TYPES.has(e.type)) {
        throw new Error(`Invalid evidence type: "${e.type}". Valid types: ${Array.from(EVIDENCE_TYPES).join(", ")}`);
      }
    }
    const timestamp = now();

    const lockResult = await acquire(this.config.lockPath, { staleRecovery: "auto" });
    if (!lockResult.ok) {
      throw new Error(`Evidence store lock failed: ${lockResult.error}`);
    }
    try {
      const records: EvidenceRecord[] = [];
      let buffer = "";
      for (const entry of entries) {
        const id = randomUUID();
        const fingerprint = computeFingerprint(entry.type, timestamp, entry.payload);
        const record: EvidenceRecord = {
          version: EVIDENCE_SCHEMA_VERSION,
          id,
          type: entry.type,
          timestamp,
          fingerprint,
          payload: entry.payload,
        };
        records.push(record);
        buffer += canonicalStringify(record) + "\n";
      }
      await appendFile(evidenceFilePath(this.config.storeDir), buffer, "utf-8");
      return records;
    } finally {
      release(lockResult);
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Query evidence records with optional filters.
   * Returns newest-first.
   */
  async query(query: EvidenceQuery = {}): Promise<EvidenceQueryResult> {
    const limit = query.limit ?? this.config.defaultQueryLimit;
    const filePath = evidenceFilePath(this.config.storeDir);

    if (!existsSync(filePath)) {
      return { records: [], total: 0, truncated: false };
    }

    const allRecords: EvidenceRecord[] = [];

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    let lineCount = 0;
    for await (const line of rl) {
      lineCount++;
      if (lineCount > this.config.maxScanLines) break;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed) as EvidenceRecord;
        if (this.matches(record, query)) {
          allRecords.push(record);
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    // Newest first
    allRecords.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const total = allRecords.length;
    const truncated = total > limit;
    const records = allRecords.slice(0, limit);

    return { records, total, truncated };
  }

  /**
   * Query a single record by its fingerprint.
   */
  async getByFingerprint(fingerprint: string): Promise<EvidenceRecord | null> {
    const result = await this.query({ fingerprint, limit: 1 });
    return result.records[0] ?? null;
  }

  // -----------------------------------------------------------------------
  // Compaction
  // -----------------------------------------------------------------------

  /**
   * Compact evidence records older than the given timestamp into summaries.
   *
   * Groups old records by type, writes one summary record per type, and
   * rewrites the store with recent + summary records. Preserves the
   * information that data existed and its time range.
   */
  async compact(olderThan: string): Promise<CompactionResult> {
    const filePath = evidenceFilePath(this.config.storeDir);
    if (!existsSync(filePath)) {
      return { recordsBefore: 0, recordsAfter: 0, summaryRecord: null };
    }

    const lockResult = await acquire(this.config.lockPath, { staleRecovery: "auto" });
    if (!lockResult.ok) {
      throw new Error(`Evidence store lock failed: ${lockResult.error}`);
    }
    try {
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim());
      const allRecords: EvidenceRecord[] = [];
      for (const line of lines) {
        try { allRecords.push(JSON.parse(line) as EvidenceRecord); } catch { continue; }
      }

      const recordsBefore = allRecords.length;
      const oldRecords = allRecords.filter((r) => r.timestamp < olderThan);
      const recentRecords = allRecords.filter((r) => r.timestamp >= olderThan);

      if (oldRecords.length === 0) {
        return { recordsBefore, recordsAfter: recentRecords.length, summaryRecord: null };
      }

      // Group old records by type
      const byType = new Map<string, EvidenceRecord[]>();
      for (const r of oldRecords) {
        const existing = byType.get(r.type) ?? [];
        existing.push(r);
        byType.set(r.type, existing);
      }

      // Produce summary records
      const now_ts = now();
      const summaries: EvidenceRecord[] = [];
      for (const [type, records] of byType) {
        const payload = {
          compactedType: type,
          recordCount: records.length,
          oldestTimestamp: records.reduce(
            (e, r) => (r.timestamp < e ? r.timestamp : e),
            records[0].timestamp,
          ),
          newestTimestamp: records.reduce(
            (l, r) => (r.timestamp > l ? r.timestamp : l),
            records[0].timestamp,
          ),
        };
        const id = randomUUID();
        const fingerprint = computeFingerprint("evidence_compaction", now_ts, payload);
        summaries.push({
          version: EVIDENCE_SCHEMA_VERSION,
          id,
          type: "evidence_compaction",
          timestamp: now_ts,
          fingerprint,
          payload,
        });
      }

      // Rewrite store: recent + summaries
      const newContent = [...recentRecords, ...summaries]
        .map((r) => canonicalStringify(r))
        .join("\n") + "\n";

      const tmpPath = filePath + "." + randomUUID() + ".tmp";
      await writeFile(tmpPath, newContent, "utf-8");
      await rename(tmpPath, filePath);

      return {
        recordsBefore,
        recordsAfter: recentRecords.length + summaries.length,
        summaryRecord: summaries[0],
      };
    } finally {
      release(lockResult);
    }
  }

  // -----------------------------------------------------------------------
  // Verification
  // -----------------------------------------------------------------------

  /**
   * Verify the fingerprint chain: every record's fingerprint must match
   * recomputation over its type + timestamp + payload.
   */
  async verify(): Promise<{ ok: boolean; failed: EvidenceRecord[]; total: number }> {
    const filePath = evidenceFilePath(this.config.storeDir);
    if (!existsSync(filePath)) {
      return { ok: true, failed: [], total: 0 };
    }

    const failed: EvidenceRecord[] = [];
    let total = 0;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      total++;

      try {
        const record = JSON.parse(trimmed) as EvidenceRecord;
        const expected = computeFingerprint(record.type, record.timestamp, record.payload);
        if (record.fingerprint !== expected) {
          failed.push(record);
        }
      } catch {
        // Malformed line — cannot parse, so we can't read its type or timestamp
        failed.push({
          version: EVIDENCE_SCHEMA_VERSION,
          id: "malformed",
          type: "evidence_compaction" as EvidenceType,
          timestamp: "",
          fingerprint: "",
          payload: { malformedLine: true },
        });
      }
    }

    return { ok: failed.length === 0, failed, total };
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /** Count records by type. */
  async stats(): Promise<{ byType: Record<string, number>; total: number }> {
    const result = await this.query({ limit: this.config.maxScanLines });
    const byType: Record<string, number> = {};
    for (const r of result.records) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
    }
    return { byType, total: result.total };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private matches(record: EvidenceRecord, query: EvidenceQuery): boolean {
    if (query.type !== undefined && record.type !== query.type) return false;
    if (query.fingerprint !== undefined && record.fingerprint !== query.fingerprint) return false;
    if (query.after !== undefined && record.timestamp <= query.after) return false;
    if (query.before !== undefined && record.timestamp >= query.before) return false;
    return true;
  }

  private ensureStoreDir(): void {
    const dir = this.config.storeDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
  }
}
