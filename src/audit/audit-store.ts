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

import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { AuditRecord, AuditAction, AuditDetails } from "./audit-types.js";

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
  let lineNumber = 0;

  // Streaming read.
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNumber++;

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

    // Validate shape — must have id, action, timestamp.
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.action !== "string" || typeof rec.timestamp !== "string") {
      if (malformedLines.length < 5) {
        malformedLines.push(lineNumber);
      }
      continue;
    }

    // Apply filters.
    if (hasFilter) {
      if (actionFilter !== undefined && rec.action !== actionFilter) continue;
      if (graphFilter !== undefined) {
        const details = rec.details as Record<string, unknown> | undefined;
        if (!details || details.graphId !== graphFilter) continue;
      }
      if (approvalFilter !== undefined) {
        const details = rec.details as Record<string, unknown> | undefined;
        if (!details || details.approvalId !== approvalFilter) continue;
      }
    }

    // Insert into ring buffer.
    const record = parsed as AuditRecord;

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

  rl.close();
  stream.destroy();

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

export class AuditStore {
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "audit", "audit.jsonl");
  }

  /** Ensure the directory exists. */
  private async ensureDir(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  /** Append an audit record. Returns the created record with generated ID. */
  async append(opts: {
    action: AuditAction;
    actor?: string;
    details: AuditDetails;
  }): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action: opts.action,
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      details: opts.details,
    };
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    return record;
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
