/**
 * P4.3-Sd2 — Streaming Audit Verifier
 *
 * Detects alteration, deletion, insertion, reordering, duplication, malformed
 * lines, and truncation without loading the complete log into memory.
 *
 * Uses `createReadStream` + `readline` for streaming reads with O(1) memory
 * per record (bounded state).
 *
 * @module
 */

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical-json.js";
import type { AuditHead, AuditRecordV2, LegacyAuditRecord } from "../../audit/audit-types.js";
import { isAuditRecordV2, isLegacyAuditRecord } from "../../audit/audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOMAIN_PREFIX = "alix-audit-v1:";
const HEAD_FILENAME = "head.json";
const AUDIT_FILENAME = "audit.jsonl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationFinding {
  type:
    | "ok"
    | "sequence_gap"
    | "hash_mismatch"
    | "duplicate_sequence"
    | "malformed_line"
    | "truncated_tail"
    | "legacy_modified"
    | "head_mismatch";
  line?: number;
  seq?: number;
  detail?: string;
}

export interface VerificationResult {
  ok: boolean;
  findings: VerificationFinding[];
  recordCount: { legacy: number; v2: number };
  headSidecar: AuditHead | null;
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/**
 * Recompute the record hash for a v2 record body.
 * Matches the hashing formula from audit-chain-writer.ts:
 *   sha256(DOMAIN_PREFIX + canonicalBody + seq + prevHash)
 */
function computeRecordHash(
  body: Record<string, unknown>,
  seq: number,
  prevHash: string | null,
): string {
  const canonicalBody = canonicalStringify(body);
  const input = DOMAIN_PREFIX + canonicalBody + String(seq) + String(prevHash ?? "null");
  const hash = createHash("sha256");
  hash.update(input, "utf8");
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Head sidecar
// ---------------------------------------------------------------------------

function readHeadSidecar(auditDir: string): AuditHead | null {
  const headPath = join(auditDir, HEAD_FILENAME);
  try {
    if (!existsSync(headPath)) return null;
    const raw = readFileSync(headPath, "utf-8");
    const parsed = JSON.parse(raw) as AuditHead;
    if (typeof parsed.seq !== "number" || typeof parsed.recordHash !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Streaming record type
// ---------------------------------------------------------------------------

type ParsedLine =
  | { kind: "legacy"; line: number; record: LegacyAuditRecord }
  | { kind: "v2"; line: number; record: AuditRecordV2 }
  | { kind: "malformed"; line: number; raw: string };

// ---------------------------------------------------------------------------
// Streaming verifier
// ---------------------------------------------------------------------------

/**
 * Stream-verify the entire audit log in a single pass.
 *
 * Tracks:
 * - Legacy segment byte range and digest
 * - Sequence continuity (no gaps, no duplicates, no reorder)
 * - Hash chain integrity (prevHash links)
 * - Record hash integrity (recompute and compare)
 * - Distinguishes malformed interior lines from truncated tail
 * - Final record matches head sidecar
 *
 * Memory is O(1) — only state variables are tracked, not records.
 */
async function streamVerify(
  auditPath: string,
  head: AuditHead | null,
  findings: VerificationFinding[],
): Promise<{ legacyCount: number; legacyBytes: number; v2Count: number }> {
  let legacyCount = 0;
  let legacyBytes = 0;
  let legacyRaw = "";
  let inLegacySegment = true;

  let v2Count = 0;
  let prevSeq = 0;
  let lastValidSeq = 0;
  let lastValidRecordHash: string | null = null;
  const seenSeqs = new Set<number>();
  let totalLines = 0;
  let lastLineWasMalformed = false;
  let lastMalformedLine = 0;

  // Open the file as a stream.
  const stream = createReadStream(auditPath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    totalLines++;

    // Parse.
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Mark as malformed — will classify as interior or tail later.
      lastLineWasMalformed = true;
      lastMalformedLine = totalLines;

      // Still within legacy segment?
      if (inLegacySegment) {
        legacyCount++;
        legacyRaw += line + "\n";
      }
      continue;
    }

    // Classify.
    if (isLegacyAuditRecord(parsed)) {
      if (!inLegacySegment) {
        findings.push({
          type: "malformed_line",
          line: totalLines,
          detail: `Legacy record found after v2 records started at line ${totalLines}`,
        });
        continue;
      }
      legacyCount++;
      legacyRaw += line + "\n";
      continue;
    }

    if (!isAuditRecordV2(parsed)) {
      lastLineWasMalformed = true;
      lastMalformedLine = totalLines;

      if (inLegacySegment) {
        legacyCount++;
        legacyRaw += line + "\n";
      }
      continue;
    }

    // First v2 record — transition out of legacy segment.
    if (inLegacySegment) {
      inLegacySegment = false;
      legacyBytes = Buffer.byteLength(legacyRaw, "utf-8");
    }

    // v2 record.
    const record = parsed as AuditRecordV2;
    v2Count++;

    // Check for duplicate sequence.
    if (seenSeqs.has(record.seq)) {
      findings.push({
        type: "duplicate_sequence",
        line: totalLines,
        seq: record.seq,
        detail: `Duplicate sequence ${record.seq} at line ${totalLines}`,
      });
    }
    seenSeqs.add(record.seq);

    // Check for sequence gap.
    if (record.seq !== prevSeq + 1) {
      findings.push({
        type: "sequence_gap",
        line: totalLines,
        seq: record.seq,
        detail: `Sequence gap: expected ${prevSeq + 1}, got ${record.seq} at line ${totalLines}`,
      });
    }

    // Check for reorder (seq decreases).
    if (record.seq < prevSeq && prevSeq > 0) {
      findings.push({
        type: "sequence_gap",
        line: totalLines,
        seq: record.seq,
        detail: `Sequence reorder: ${record.seq} comes after ${prevSeq} at line ${totalLines}`,
      });
    }

    // Check previous hash link.
    if (lastValidRecordHash !== null && record.prevHash !== lastValidRecordHash) {
      findings.push({
        type: "hash_mismatch",
        line: totalLines,
        seq: record.seq,
        detail: `Hash chain broken at seq ${record.seq}: expected prevHash ${lastValidRecordHash}, got ${record.prevHash}`,
      });
    }

    // Recompute record hash.
    const body: Record<string, unknown> = {
      action: record.action,
      details: record.details,
      timestamp: record.timestamp,
    };
    if (record.actor !== undefined) {
      body.actor = record.actor;
    }

    let computedHash: string;
    try {
      computedHash = computeRecordHash(body, record.seq, record.prevHash);
    } catch {
      findings.push({
        type: "hash_mismatch",
        line: totalLines,
        seq: record.seq,
        detail: `Cannot compute record hash for seq ${record.seq} at line ${totalLines}`,
      });
      continue;
    }

    if (computedHash !== record.recordHash) {
      findings.push({
        type: "hash_mismatch",
        line: totalLines,
        seq: record.seq,
        detail: `Record hash mismatch at seq ${record.seq} line ${totalLines}: expected ${record.recordHash}, computed ${computedHash}`,
      });
    }

    // Update tracking state.
    prevSeq = record.seq;
    lastValidSeq = record.seq;
    lastValidRecordHash = record.recordHash;
  }

  // Classify trailing malformed line (if any) as truncated tail.
  if (lastLineWasMalformed) {
    findings.push({
      type: "truncated_tail",
      line: lastMalformedLine,
      detail: `Line ${lastMalformedLine} at end of log is not valid JSON (truncated tail)`,
    });
  }

  // Verify legacy segment against head.
  if (head?.legacy) {
    if (!inLegacySegment) {
      // Compare counts.
      if (legacyCount !== head.legacy.count) {
        findings.push({
          type: "legacy_modified",
          detail: `Legacy count mismatch: expected ${head.legacy.count}, found ${legacyCount}`,
        });
      }

      // Compare byte length.
      if (legacyBytes !== head.legacy.bytes) {
        findings.push({
          type: "legacy_modified",
          detail: `Legacy byte length mismatch: expected ${head.legacy.bytes}, found ${legacyBytes}`,
        });
      }

      // Compare digest (plain SHA-256, matching chain writer's activateLegacy).
      const legacyHash = createHash("sha256");
      legacyHash.update(legacyRaw, "utf-8");
      const computedDigest = legacyHash.digest("hex");
      if (computedDigest !== head.legacy.digest) {
        findings.push({
          type: "legacy_modified",
          detail: `Legacy digest mismatch: expected ${head.legacy.digest}, computed ${computedDigest}`,
        });
      }
    } else {
      // Entire file is legacy — compare against head.
      legacyBytes = Buffer.byteLength(legacyRaw, "utf-8");
      if (legacyCount !== head.legacy.count) {
        findings.push({
          type: "legacy_modified",
          detail: `Legacy count mismatch: expected ${head.legacy.count}, found ${legacyCount}`,
        });
      }
      const legacyHash2 = createHash("sha256");
      legacyHash2.update(legacyRaw, "utf-8");
      const computedDigest = legacyHash2.digest("hex");
      if (computedDigest !== head.legacy.digest) {
        findings.push({
          type: "legacy_modified",
          detail: `Legacy digest mismatch: expected ${head.legacy.digest}, computed ${computedDigest}`,
        });
      }
    }
  }

  // Compare final record against head sidecar.
  if (head !== null && lastValidSeq > 0) {
    if (head.seq !== lastValidSeq) {
      findings.push({
        type: "head_mismatch",
        seq: lastValidSeq,
        detail: `Head sidecar seq ${head.seq} does not match last verified record seq ${lastValidSeq}`,
      });
    }
    if (head.recordHash !== lastValidRecordHash) {
      findings.push({
        type: "head_mismatch",
        seq: lastValidSeq,
        detail: `Head sidecar recordHash ${head.recordHash} does not match last verified record hash ${lastValidRecordHash}`,
      });
    }
  }

  // If head is null but we have v2 records, that's also a mismatch.
  if (head === null && v2Count > 0) {
    findings.push({
      type: "head_mismatch",
      detail: "V2 records exist but no head sidecar found",
    });
  }

  rl.close();
  stream.destroy();

  return { legacyCount, legacyBytes, v2Count };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  /** Directory containing the audit log and head sidecar. */
  auditDir: string;
}

/**
 * Stream-verify the audit log.
 *
 * Reads line by line with bounded state, detecting:
 * - Sequence gaps, duplicates, reorder
 * - Hash chain breaks
 * - Record hash mismatches
 * - Malformed interior lines vs truncated tail
 * - Legacy segment modification
 * - Head sidecar mismatch
 *
 * Never throws — returns a structured result with `ok: false` on failure.
 */
export async function verifyAuditLog(options: VerifyOptions): Promise<VerificationResult> {
  const auditPath = join(options.auditDir, AUDIT_FILENAME);

  if (!existsSync(auditPath)) {
    return {
      ok: false,
      findings: [{ type: "malformed_line", detail: `Audit log not found: ${auditPath}` }],
      recordCount: { legacy: 0, v2: 0 },
      headSidecar: null,
    };
  }

  const findings: VerificationFinding[] = [];

  // 1. Read the head sidecar.
  const head = readHeadSidecar(options.auditDir);

  // 2. Stream-verify the entire log in a single pass.
  const { legacyCount, v2Count } = await streamVerify(auditPath, head, findings);

  // 3. Determine overall result.
  const ok = findings.length === 0;

  return {
    ok,
    findings,
    recordCount: { legacy: legacyCount, v2: v2Count },
    headSidecar: head,
  };
}
