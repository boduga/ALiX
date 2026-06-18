/**
 * P4.3-Sd1 — Audit Chain Writer
 *
 * Provides tamper-evident, hash-chained audit record appending with
 * cross-process concurrency control, built-in redaction, and a legacy
 * activation boundary.
 *
 * ## Transaction flow (per append)
 *
 * 1. Acquire cross-process lock
 * 2. Read / validate head sidecar file
 * 3. If sidecar missing or stale → confirm tail (read last record from JSONL)
 * 4. Determine next sequence (head.seq + 1, or 1 for genesis)
 * 5. Determine prevHash from head
 * 6. Redact `details` via the built-in redacting adapter
 * 7. Canonicalize the record body
 * 8. Hash: sha256(domainPrefix + canonicalBody + seq + prevHash)
 * 9. Append one JSONL line to the audit file
 * 10. fsync the append (durability)
 * 11. Atomically update the head sidecar (temp file + rename)
 * 12. Release the lock
 * 13. Return the complete v2 record
 *
 * @module
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, openSync, closeSync, fsyncSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { canonicalStringify } from "./canonical-json.js";
import { acquire, type LockHandle, type LockOptions } from "./audit-lock.js";
import type {
  AuditRecordV2,
  AuditRecordV2Input,
  AuditHead,
  ActivationResult,
  LegacyAuditRecord,
  AnyAuditAction,
} from "../../audit/audit-types.js";
import { isAuditRecordV2, isLegacyAuditRecord } from "../../audit/audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOMAIN_PREFIX = "alix-audit-v1:";
const HEAD_FILENAME = "head.json";
const AUDIT_FILENAME = "audit.jsonl";
const LOCK_FILENAME = "audit.lock";

// ---------------------------------------------------------------------------
// Sensitive key patterns for the redacting adapter
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /cookie/i,
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /hash/i,
  /digest/i,
  /signature/i,
  /address/i,
  /ip/i,
  /host/i,
  /origin/i,
  /referer/i,
  /user[_-]?agent/i,
  /x-[a-z-]*key/i,
  /authorization/i,
  /bearer/i,
];

const SENTINEL_REDACTED = "[REDACTED]";
const SENTINEL_REDACTION_FAILED = "[REDACTION_FAILED]";

function isAuditAction(action: string): boolean {
  return action.startsWith("audit.");
}

// ---------------------------------------------------------------------------
// Redacting adapter
// ---------------------------------------------------------------------------

/**
 * Redact audit `details` before canonicalization.
 *
 * Preserves structural integrity but replaces values under sensitive keys
 * with `[REDACTED]`. Returns `[REDACTED]` or `[REDACTION_FAILED]` sentinel
 * on catastrophic failure.
 *
 * Built into the chain writer — callers never need to pre-redact.
 */
function redactAuditDetails(details: unknown, _maxDepth: number = 20): unknown {
  return redactValue(details, _maxDepth);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function redactValue(value: unknown, maxDepth: number, depth: number = 0): unknown {
  if (depth > maxDepth) return SENTINEL_REDACTED;

  if (value === null || value === undefined) return value;

  const t = typeof value;

  if (t === "string" || t === "number" || t === "boolean") {
    return value;
  }

  if (t === "function" || t === "symbol" || t === "bigint") {
    return SENTINEL_REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, maxDepth, depth + 1));
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    try {
      for (const key of Object.keys(obj)) {
        const val = obj[key];

        // Entire key is sensitive → replace the whole subtree.
        if (isSensitiveKey(key)) {
          result[key] = SENTINEL_REDACTED;
          continue;
        }

        // Recurse into nested objects.
        if (val !== null && typeof val === "object") {
          result[key] = redactValue(val, maxDepth, depth + 1);
        } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          result[key] = val;
        } else if (val === null || val === undefined) {
          result[key] = val;
        } else {
          // Functions, symbols, bigints inside objects → strip.
          result[key] = SENTINEL_REDACTED;
        }
      }
    } catch {
      return SENTINEL_REDACTION_FAILED;
    }

    return result;
  }

  return SENTINEL_REDACTED;
}

// ---------------------------------------------------------------------------
// Head sidecar helpers
// ---------------------------------------------------------------------------

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

function readHead(headPath: string): AuditHead | null {
  try {
    if (!existsSync(headPath)) return null;
    const raw = readFileSync(headPath, "utf-8");
    const parsed = JSON.parse(raw) as AuditHead;
    // Basic validation.
    if (typeof parsed.seq !== "number" || typeof parsed.recordHash !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeHeadAtomic(headPath: string, head: AuditHead): void {
  const dir = dirname(headPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.head-${randomUUID()}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(head), { encoding: "utf-8", flag: "wx" });
  // fsync the temp file before rename for durability.
  const fd = openSync(tmpPath, "r+");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmpPath, headPath);
}

// ---------------------------------------------------------------------------
// Chain Writer
// ---------------------------------------------------------------------------

export interface AuditChainWriterConfig {
  /** Directory for the audit log, head sidecar, and lock file. */
  auditDir: string;

  /** Lock options forwarded to the lock module. */
  lock?: LockOptions;
}

export class AuditChainWriter {
  private auditDir: string;
  private lockPath: string;
  private lockOptions: LockOptions;
  private recording = false;
  /** Per-instance guard against recursive audit emission. */
  private auditGuard = false;

  constructor(config: AuditChainWriterConfig) {
    this.auditDir = config.auditDir;
    this.lockPath = join(config.auditDir, LOCK_FILENAME);
    this.lockOptions = config.lock ?? {};
  }

  // -----------------------------------------------------------------------
  // Paths
  // -----------------------------------------------------------------------

  private get auditPath(): string {
    return join(this.auditDir, AUDIT_FILENAME);
  }

  private get headPath(): string {
    return join(this.auditDir, HEAD_FILENAME);
  }

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  /**
   * Append a v2 audit record to the hash chain.
   *
   * The writer assigns `seq`, `prevHash`, and `recordHash`.
   * Details are redacted *before* canonicalization and hashing.
   *
   * @returns The complete v2 record as written to the log.
   */
  async append(record: Omit<AuditRecordV2, "version" | "seq" | "prevHash" | "recordHash">): Promise<AuditRecordV2> {
    let lockHandle: LockHandle | null = null;

    try {
      // 1. Acquire lock.
      const result = await acquire(this.lockPath, this.lockOptions);
      if (!result.ok) {
        throw new Error(`Failed to acquire audit lock: ${result.error} (${result.code})`);
      }
      lockHandle = result;

      // 2. Delegate to the core append logic (lock already held).
      return this.doAppend(record, lockHandle);
    } finally {
      // Ensure lock is released on any exit path.
      if (lockHandle !== null) {
        lockHandle.release();
      }
    }
  }

  /**
   * Core append logic — caller MUST hold the lock.
   *
   * @param _lockHandle — an already-acquired lock handle (shared, not released here).
   */
  private async doAppend(
    record: Omit<AuditRecordV2, "version" | "seq" | "prevHash" | "recordHash">,
    _lockHandle: LockHandle,
  ): Promise<AuditRecordV2> {
    const isAuditInternal = isAuditAction(record.action);

    try {
      // Guard against recursive audit emission (checked AFTER lock acquisition
      // so concurrent calls serialize rather than failing).
      if (!isAuditInternal) {
        if (this.auditGuard) {
          throw new Error("Recursive audit emission detected — refusing to create audit loop");
        }
        this.auditGuard = true;
      }

      // 2. Read / validate head sidecar.
      let head = readHead(this.headPath);

      // 3. If sidecar missing or stale → confirm tail from JSONL.
      if (head === null) {
        head = this.recoverHeadFromLog();
      }

      // 4. Determine next sequence.
      const seq = head !== null ? head.seq + 1 : 1;

      // 5. Determine prevHash.
      const prevHash = head !== null ? head.recordHash : null;

      // 6. Redact details.
      const redactedDetails = redactAuditDetails(record.details);

      // 7. Canonicalize body.
      const body: Record<string, unknown> = {
        action: record.action,
        details: redactedDetails,
        timestamp: record.timestamp,
      };
      if (record.actor !== undefined) {
        body.actor = record.actor;
      }

      // 8. Hash: domainPrefix + canonicalBody + seq + prevHash.
      const recordHash = computeRecordHash(body, seq, prevHash);

      // 9. Append JSONL line.
      const v2Record: AuditRecordV2 = {
        version: 2,
        seq,
        prevHash,
        recordHash,
        timestamp: record.timestamp,
        action: record.action,
        actor: record.actor,
        details: redactedDetails,
      };

      mkdirSync(dirname(this.auditPath), { recursive: true });
      const line = JSON.stringify(v2Record) + "\n";
      appendFileSync(this.auditPath, line, { encoding: "utf-8" });

      // 10. fsync for durability.
      const auditFd = openSync(this.auditPath, "r+");
      fsyncSync(auditFd);
      closeSync(auditFd);

      // 11. Atomically update head sidecar.
      const newHead: AuditHead = {
        seq,
        recordHash,
        prevHash,
        timestamp: record.timestamp,
        updatedAt: new Date().toISOString(),
      };
      // Preserve legacy segment on head if present.
      if (head?.legacy) {
        newHead.legacy = head.legacy;
      }

      writeHeadAtomic(this.headPath, newHead);

      return v2Record;
    } finally {
      // Clear guard on any exit path.
      if (!isAuditInternal) {
        this.auditGuard = false;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Head recovery
  // -----------------------------------------------------------------------

  /**
   * Reconstruct the head from the last valid v2 record in the audit log.
   * Returns `null` if no v2 records exist (genesis case).
   */
  private recoverHeadFromLog(): AuditHead | null {
    const lastV2 = this.readLastV2Record();
    if (lastV2 === null) return null;

    return {
      seq: lastV2.seq,
      recordHash: lastV2.recordHash,
      prevHash: lastV2.prevHash,
      timestamp: lastV2.timestamp,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Read the last v2 record from the JSONL file. */
  private readLastV2Record(): AuditRecordV2 | null {
    if (!existsSync(this.auditPath)) return null;

    const raw = readFileSync(this.auditPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    // Scan from the end for the first v2 record.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (isAuditRecordV2(parsed)) return parsed;
      } catch {
        // Skip malformed lines.
      }
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Legacy activation (Sd1.6)
  // -----------------------------------------------------------------------

  /**
   * Activate the v2 integrity chain on a legacy (v1) audit log.
   *
   * Operations:
   * 1. Read the exact legacy bytes from the audit file.
   * 2. Count legacy records.
   * 3. Compute the exact byte length of the legacy segment.
   * 4. Compute SHA-256 digest of the legacy segment.
   * 5. Append `audit.integrity_enabled` as the first v2 record.
   * 6. Mark the legacy segment in the head sidecar as unverified.
   * 7. Idempotent: skips if already activated.
   */
  async activateLegacy(): Promise<ActivationResult> {
    let lockHandle: LockHandle | null = null;

    try {
      // Acquire cross-process lock at the start to prevent TOCTOU races.
      const result = await acquire(this.lockPath, this.lockOptions);
      if (!result.ok) {
        throw new Error(`Failed to acquire audit lock: ${result.error} (${result.code})`);
      }
      lockHandle = result;

      // Idempotency checks are INSIDE the lock so two concurrent calls
      // cannot both pass the gate and produce duplicate activation records.
      const existingHead = readHead(this.headPath);
      if (existingHead?.legacy) {
        return { activated: false, reason: "Already activated" };
      }

      // Check if any v2 records already exist in the log.
      const lastV2 = this.readLastV2Record();
      if (lastV2 !== null) {
        return { activated: false, reason: "v2 records already exist in audit log" };
      }

      // Read legacy bytes.
      let legacyBytes: string;
      let legacyCount = 0;
      let legacyByteLength = 0;

      const auditPath = this.auditPath;
      if (existsSync(auditPath)) {
        legacyBytes = readFileSync(auditPath, "utf-8");
        legacyByteLength = statSync(auditPath).size;

        // Count legacy records.
        const lines = legacyBytes.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (isLegacyAuditRecord(parsed)) {
              legacyCount++;
            }
          } catch {
            // Skip malformed lines but count them as legacy.
            legacyCount++;
          }
        }
      } else {
        // No legacy file — nothing to activate.
        legacyBytes = "";
        legacyByteLength = 0;
        legacyCount = 0;
      }

      // Compute legacy digest.
      const digestHash = createHash("sha256");
      digestHash.update(legacyBytes, "utf8");
      const legacyDigest = digestHash.digest("hex");

      // Append activation record using doAppend (lock already held).
      // This avoids calling append() which would try to re-acquire the lock.
      const activationRecord = await this.doAppend({
        action: "audit.integrity_enabled" as AnyAuditAction,
        timestamp: Date.now(),
        actor: "system",
        details: {
          legacyCount,
          legacyBytes: legacyByteLength,
          legacyDigest,
        },
      }, lockHandle);

      // Update head with legacy segment info.
      const head = readHead(this.headPath);
      if (head) {
        head.legacy = {
          digest: legacyDigest,
          count: legacyCount,
          bytes: legacyByteLength,
          verified: false,
        };
        writeHeadAtomic(this.headPath, head);
      }

      return {
        activated: true,
        legacyCount,
        legacyBytes: legacyByteLength,
        legacyDigest,
        activationRecord,
      };
    } finally {
      // Release the lock on any exit path (success, early return, or error).
      if (lockHandle !== null) {
        lockHandle.release();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Public utilities
  // -----------------------------------------------------------------------

  /**
   * Read the current head sidecar.
   * Returns `null` if no head exists.
   */
  readHead(): AuditHead | null {
    return readHead(this.headPath);
  }

  /**
   * Read all audit records (both legacy and v2) from the log file.
   * Returns newest first.
   */
  list(limit = 100): (LegacyAuditRecord | AuditRecordV2)[] {
    if (!existsSync(this.auditPath)) return [];

    const raw = readFileSync(this.auditPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const records: (LegacyAuditRecord | AuditRecordV2)[] = [];

    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }

    return records.reverse().slice(0, limit);
  }
}
