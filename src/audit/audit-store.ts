/**
 * audit-store.ts — Append-only JSONL audit store with streaming queries.
 *
 * Stores audit records at .alix/audit/audit.jsonl.
 * JSONL (newline-delimited JSON) is append-friendly and easy to tail.
 *
 * P4.3-Sd2: Queries now stream line-by-line instead of loading the entire
 * log into memory. Results are collected into a bounded ring buffer so
 * memory stays O(limit), not O(file size).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditRecord,
  AuditAction,
  AuditDetails,
  AuditHead,
  AuditRecordV2,
  ActivationResult,
} from "./audit-types.js";
import { isAuditRecordV2 } from "./audit-types.js";
import type { AuditEventStore } from "./audit-contract.js";
import { JsonlStore, streamJsonlLines } from "../storage/jsonl-store.js";
import { AuditChainWriter } from "../security/audit/audit-chain-writer.js";
import { verifyAuditLog, type VerificationResult } from "../security/audit/audit-verifier.js";

/** Input accepted by `AuditStore.append`. */
export interface AuditAppendInput {
  action: AuditAction;
  actor?: string;
  details: AuditDetails;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditQueryOptions {
  /** Maximum records to return (default 100, max 1000). */
  limit?: number;

  /** Filter by action type. */
  action?: AuditAction | string;

  /** Filter by graph ID in details. */
  graphId?: string;

  /** Filter by approval ID in details. */
  approvalId?: string;
}

export interface CorruptionNotice {
  /** Number of lines that could not be parsed. */
  malformedLines: number;
  /** The first few malformed line numbers (up to 5). */
  sampleLines: number[];
}

export interface AuditQueryResult {
  /** Audit records, newest-first. */
  records: AuditRecord[];
  /** Corruption status from streaming read. Present only if issues found. */
  corruption?: CorruptionNotice;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Streaming query helpers
// ---------------------------------------------------------------------------

/**
 * Stream the audit log file and collect matching records into a bounded
 * ring buffer of size `limit`. Returns results newest-first.
 *
 * Memory is O(limit), not O(file size) — only matching records are retained
 * (up to limit), and at most `limit` objects exist at any time.
 */
async function streamQuery(
  filePath: string,
  options: AuditQueryOptions,
): Promise<AuditQueryResult> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const actionFilter = options.action;
  const graphFilter = options.graphId;
  const approvalFilter = options.approvalId;
  const hasFilter = actionFilter !== undefined || graphFilter !== undefined || approvalFilter !== undefined;

  // Ring buffer for newest-first: when full, oldest entries are overwritten.
  const buffer: AuditRecord[] = [];
  let bufferPos = 0;
  let matchCount = 0;

  const malformedLines: number[] = [];

  // Streaming read (shared primitive — O(1) memory, physical line numbers).
  for await (const { line, lineNumber } of streamJsonlLines(filePath)) {

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Track corruption.
      if (malformedLines.length < 5) {
        malformedLines.push(lineNumber);
      }
      continue;
    }

    // Normalize v1 (legacy) and v2 (hash-chained) records into the query shape.
    let record: AuditRecord;
    if (isAuditRecordV2(parsed)) {
      record = {
        id: `audit_v2_${parsed.seq}`,
        action: parsed.action as AuditAction,
        timestamp: new Date(parsed.timestamp).toISOString(),
        actor: parsed.actor,
        details: (parsed.details ?? {}) as AuditDetails,
      };
    } else {
      // Validate shape — must have id, action, timestamp.
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.id !== "string" || typeof rec.action !== "string" || typeof rec.timestamp !== "string") {
        if (malformedLines.length < 5) {
          malformedLines.push(lineNumber);
        }
        continue;
      }
      record = parsed as AuditRecord;
    }

    // Apply filters.
    if (hasFilter) {
      if (actionFilter !== undefined && record.action !== actionFilter) continue;
      if (graphFilter !== undefined && record.details?.graphId !== graphFilter) continue;
      if (approvalFilter !== undefined && record.details?.approvalId !== approvalFilter) continue;
    }

    if (hasFilter && matchCount >= limit) {
      // For filtered queries, we could stop early. But we need newest-first,
      // and we don't know which are newest until we scan everything.
      // Fall through to ring buffer insert.
    }

    if (buffer.length < limit) {
      buffer.push(record);
    } else {
      // Ring buffer: overwrite oldest.
      buffer[bufferPos % limit] = record;
      bufferPos++;
    }
    matchCount++;
  }

  // Collect results.
  let records: AuditRecord[];
  if (matchCount <= limit) {
    records = buffer;
  } else {
    // Ring buffer: reconstruct in insertion order, then reverse.
    const ordered: AuditRecord[] = [];
    const actualCount = Math.min(matchCount, limit);
    for (let i = 0; i < actualCount; i++) {
      ordered.push(buffer[(bufferPos + i) % limit]);
    }
    records = ordered;
  }

  // Reverse for newest-first.
  records.reverse();

  const result: AuditQueryResult = { records };

  if (malformedLines.length > 0) {
    result.corruption = {
      malformedLines: malformedLines.length,
      sampleLines: malformedLines,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// AuditStore
// ---------------------------------------------------------------------------

export interface AuditStoreOptions {
  /** Override the audit directory (defaults to `<cwd>/.alix/audit`). */
  auditDir?: string;
}

export class AuditStore
  implements AuditEventStore<AuditAppendInput, AuditRecord | AuditRecordV2, AuditRecord> {
  private filePath: string;
  private auditDir: string;
  private store: JsonlStore;
  private chainWriter: AuditChainWriter | null = null;

  constructor(cwd: string, options: AuditStoreOptions = {}) {
    this.auditDir = options.auditDir ?? join(cwd, ".alix", "audit");
    this.filePath = join(this.auditDir, "audit.jsonl");
    this.store = new JsonlStore(this.filePath);
  }

  /** True once the v2 integrity chain has been activated (head sidecar present). */
  private integrityActive(): boolean {
    return existsSync(join(this.auditDir, "head.json"));
  }

  private chain(): AuditChainWriter {
    this.chainWriter ??= new AuditChainWriter({ auditDir: this.auditDir });
    return this.chainWriter;
  }

  /**
   * Append an audit record.
   *
   * Integrity mode (#713 step 2): once the chain is activated, the canonical
   * store appends through the hash chain (redacted, seq/prevHash/recordHash)
   * — one entry point owns both persistence and integrity. Before activation,
   * legacy v1 records are written.
   */
  async append(opts: AuditAppendInput): Promise<AuditRecord | AuditRecordV2> {
    if (this.integrityActive()) {
      return this.chain().append({
        action: opts.action,
        timestamp: Date.now(),
        actor: opts.actor,
        details: opts.details,
      });
    }

    const record: AuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action: opts.action,
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      details: opts.details,
    };
    await this.store.appendRecord(record);
    return record;
  }

  /** Read the integrity head sidecar (null when the chain is not active). */
  integrityHead(): AuditHead | null {
    return this.chain().readHead();
  }

  /** Seal the legacy segment and start the v2 hash chain (idempotent). */
  async activateIntegrity(): Promise<ActivationResult> {
    return this.chain().activateLegacy();
  }

  /**
   * Verify the audit log's hash chain. Honest by default: a legacy-only log
   * fails with `no_chain` rather than reporting a false OK.
   */
  async verifyIntegrity(): Promise<VerificationResult> {
    return verifyAuditLog({ auditDir: this.auditDir });
  }

  /** Read all audit records (newest first) — streaming implementation. */
  async list(limit = 100): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const result = await streamQuery(this.filePath, { limit });
    return result.records;
  }

  /**
   * Stream-based query with filtering and corruption reporting.
   * Returns records newest-first plus any corruption notices.
   */
  async query(options: AuditQueryOptions = {}): Promise<AuditQueryResult> {
    if (!existsSync(this.filePath)) return { records: [] };
    return streamQuery(this.filePath, options);
  }

  /** Filter by action. */
  async findByAction(action: AuditAction, limit = 50): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const result = await streamQuery(this.filePath, { action, limit });
    return result.records;
  }

  /** Filter by graph ID. */
  async findByGraph(graphId: string, limit = 50): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const result = await streamQuery(this.filePath, { graphId, limit });
    return result.records;
  }

  /** Filter by approval ID. */
  async findByApproval(approvalId: string, limit = 50): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const result = await streamQuery(this.filePath, { approvalId, limit });
    return result.records;
  }

  /** Expose the file path for other modules (e.g., chain writer). */
  get path(): string {
    return this.filePath;
  }
}
