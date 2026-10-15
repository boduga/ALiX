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
 * 2. Reconcile the head sidecar against the persisted JSONL chain
 *    (`reconcileHead`): if the sidecar is missing, stale, or conflicting,
 *    VERIFY the hash chain before allocating a sequence; corrupt history
 *    fails closed.
 * 3. Determine next sequence (reconciledHead.seq + 1, or 1 for genesis)
 * 4. Determine prevHash from reconciledHead
 * 5. Redact `details` via the built-in redacting adapter
 * 6. Canonicalize the record body
 * 7. Hash: sha256(domainPrefix + canonicalBody + seq + prevHash)
 * 8. Append one JSONL line to the audit file
 * 9. fsync the append (durability)
 * 10. Atomically update the head sidecar (temp file + rename)
 * 11. Release the lock
 * 12. Return the complete v2 record
 *
 * ## Stale-head recovery
 *
 * A crash after step 9 (JSONL fsynced) but before step 10 (head written)
 * leaves a stale-but-valid sidecar. Trusting it would reallocate a committed
 * sequence. `reconcileHead` therefore treats the **persisted JSONL chain** as
 * authoritative: when the sidecar does not exactly match the persisted tip it
 * verifies the chain from genesis, advances a stale sidecar only when its
 * record is a verified ancestor of the tip, and fails closed on malformed,
 * gapped, duplicated, hash-broken, or conflicting history. It never truncates,
 * rewrites, or discards committed records.
 *
 * @module
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, openSync, closeSync, fsyncSync, statSync, readSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { canonicalStringify } from "../../../operations/utils/canonical-json.js";
import { acquire, type LockHandle, type LockOptions } from "./audit-lock.js";
import { verifyAuditLog } from "./audit-verifier.js";
import type { AuditRecordV2, AuditHead, ActivationResult, LegacyAuditRecord, AnyAuditAction } from "../../audit/audit-types.js";
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

/**
 * A fail-closed head-reconciliation outcome. Only this error class is reported
 * through `audit.recovery`; any other throw from reconciliation is a defect and
 * must not be mislabeled as a recovery failure.
 */
class AuditRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditRecoveryError";
  }
}

/** Build a fail-closed recovery error with the canonical prefix. */
function recoveryError(detail: string): AuditRecoveryError {
  return new AuditRecoveryError(`Audit chain recovery failed: ${detail}`);
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

/**
 * The canonical record body that a v2 hash is computed over. Kept in one place
 * so append, recovery validation, and any future verifier reuse the exact shape.
 */
function buildHashBody(
  action: string,
  details: unknown,
  timestamp: number,
  actor?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { action, details, timestamp };
  if (actor !== undefined) body.actor = actor;
  return body;
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
// Persisted-tip helpers (bounded tail reads)
// ---------------------------------------------------------------------------

/** Maximum bytes read from the file tail to locate the last record. */
const TAIL_READ_MAX_BYTES = 256 * 1024;

interface PersistedTip {
  /** Last non-empty physical line, or null when the file is missing/empty. */
  lastLine: string | null;
  /**
   * True when the tail read was truncated because the final line exceeds
   * `TAIL_READ_MAX_BYTES`. Callers must fail closed rather than treat the
   * partial line as the persisted tip.
   */
  truncated: boolean;
}

/**
 * Read the last non-empty line of a JSONL file without loading the whole file.
 * Bounded to `TAIL_READ_MAX_BYTES`. A final record line larger than the bound
 * sets `truncated` so callers fail closed rather than parse a partial record.
 */
function readPersistedTip(auditPath: string): PersistedTip {
  if (!existsSync(auditPath)) return { lastLine: null, truncated: false };
  const size = statSync(auditPath).size;
  if (size === 0) return { lastLine: null, truncated: false };

  const start = Math.max(0, size - TAIL_READ_MAX_BYTES);
  const length = size - start;
  const fd = openSync(auditPath, "r");
  let text: string;
  try {
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    text = buf.subarray(0, read).toString("utf-8");
  } finally {
    closeSync(fd);
  }

  const lines = text.split("\n");
  // When reading from mid-file the first element is a partial line. If that
  // window contains no newline at all, the final record exceeds the bound.
  let firstIsPartial = false;
  if (start > 0) {
    firstIsPartial = true;
    lines.shift();
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      return { lastLine: lines[i], truncated: false };
    }
  }
  // No complete non-empty line found in the window.
  return { lastLine: null, truncated: firstIsPartial };
}

type TipParse =
  | { kind: "v2"; record: AuditRecordV2 }
  | { kind: "legacy" }
  | { kind: "malformed" };

function parseTipLine(line: string): TipParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "malformed" };
  }
  if (isAuditRecordV2(parsed)) return { kind: "v2", record: parsed };
  if (isLegacyAuditRecord(parsed)) return { kind: "legacy" };
  return { kind: "malformed" };
}

// ---------------------------------------------------------------------------
// Chain Writer
// ---------------------------------------------------------------------------

/**
 * Out-of-band recovery telemetry. Head reconciliation restores the sidecar to
 * match evidence that is already committed to the JSONL chain; it is an
 * internal maintenance operation, not a new audit fact. These events are
 * therefore reported through an optional callback and are NEVER written into
 * the hash chain (no sequence is consumed, no JSONL is modified).
 *
 * A successful repair and a non-repair outcome are distinct events.
 */
export interface AuditSidecarRecoveredEvent {
  action: "audit.stale_sidecar_recovered";
  /** The stale sidecar's seq, or 0 when the sidecar was missing. */
  previousSeq: number;
  /** The verified persisted tip the sidecar was advanced to. */
  recoveredSeq: number;
  timestamp: string;
}

/**
 * Emitted when reconciliation does not repair the sidecar. Never asserts that a
 * repair happened. `outcome` distinguishes a fail-closed recovery verdict
 * (`"failed"`, a chain defect that reconciliation refused to resolve) from a
 * reconciliation defect (`"error"`, an unexpected throw such as EISDIR) — so the
 * telemetry channel never goes dark exactly when a genuine bug is hardest to
 * diagnose. Consumers discriminate on `action` *and* `outcome`.
 */
export interface AuditRecoveryFailureEvent {
  action: "audit.recovery";
  outcome: "failed" | "error";
  reason: string;
  timestamp: string;
}

export type AuditRecoveryEvent =
  | AuditSidecarRecoveredEvent
  | AuditRecoveryFailureEvent;

export interface AuditChainWriterConfig {
  /** Directory for the audit log, head sidecar, and lock file. */
  auditDir: string;

  /** Lock options forwarded to the lock module. */
  lock?: LockOptions;

  /**
   * Optional out-of-band recovery telemetry sink. Called only after a sidecar
   * repair succeeds, or when a recovery attempt fails closed. Throwing from
   * this callback NEVER affects audit-chain integrity or the append outcome.
   */
  onRecovery?: (event: AuditRecoveryEvent) => void;
}

export class AuditChainWriter {
  private auditDir: string;
  private lockPath: string;
  private lockOptions: LockOptions;
  private onRecovery?: (event: AuditRecoveryEvent) => void;
  /** Per-instance guard against recursive audit emission. */
  private auditGuard = false;

  constructor(config: AuditChainWriterConfig) {
    this.auditDir = config.auditDir;
    this.lockPath = join(config.auditDir, LOCK_FILENAME);
    this.lockOptions = config.lock ?? {};
    this.onRecovery = config.onRecovery;
  }

  /**
   * Emit out-of-band recovery telemetry. Never throws: a telemetry sink
   * failure must not affect chain integrity or the append outcome.
   */
  private emitRecovery(event: AuditRecoveryEvent): void {
    if (!this.onRecovery) return;
    try {
      this.onRecovery(event);
    } catch {
      // Telemetry is best-effort; swallow so recovery/append is unaffected.
    }
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

      // 2-3. Reconcile the head sidecar against the persisted chain. The
      // persisted JSONL chain is authoritative; a missing, stale, or
      // conflicting sidecar is verified before any sequence is allocated.
      const head = await this.reconcileHead();

      // 4. Determine next sequence.
      const seq = head !== null ? head.seq + 1 : 1;

      // 5. Determine prevHash.
      const prevHash = head !== null ? head.recordHash : null;

      // 6. Redact details.
      const redactedDetails = redactAuditDetails(record.details);

      // 7. Canonicalize body.
      const body = buildHashBody(record.action, redactedDetails, record.timestamp, record.actor);

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
  // Head reconciliation (crash recovery)
  // -----------------------------------------------------------------------

  /**
   * Reconcile the on-disk head sidecar against the persisted JSONL chain and
   * return the verified head to extend from.
   *
   * The persisted chain is authoritative:
   * - no chained records → genesis; a sidecar is unexpected and ignored;
   * - sidecar matches the persisted tip exactly → fast path (no full verify);
   * - otherwise the chain is verified from genesis under the caller's lock;
   *   a stale-but-valid sidecar that is a verified ancestor of the tip is
   *   advanced to the tip; a conflicting/unknown sidecar id is dropped.
   *
   * Any chain defect (malformed line, sequence gap, duplicate sequence, hash
   * mismatch, or a sidecar that does not appear at its stated seq) throws.
   * Recovery NEVER truncates, rewrites, or discards committed records.
   */
  private async reconcileHead(): Promise<AuditHead | null> {
    try {
      return await this.reconcileHeadInner();
    } catch (error) {
      // Fail-closed recovery: report the failure out-of-band without asserting
      // any repair. A genuine recovery verdict reports `failed`; any other
      // throw is a reconciliation defect and is reported as `error` so the
      // telemetry channel never goes silent on an unexpected failure.
      this.emitRecovery({
        action: "audit.recovery",
        outcome: error instanceof AuditRecoveryError ? "failed" : "error",
        reason: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async reconcileHeadInner(): Promise<AuditHead | null> {
    const sidecar = readHead(this.headPath);
    const tip = readPersistedTip(this.auditPath);

    // A final record larger than the bounded tail window cannot be parsed
    // safely — fail closed rather than misread a partial line.
    if (tip.truncated) {
      throw recoveryError(
        "the last audit record exceeds the bounded tail read window; refusing to allocate a sequence.",
      );
    }

    // Genesis: no v2 record persisted.
    if (tip.lastLine === null) {
      // A sidecar with no persisted record means the log was emptied or lost
      // after the chain was written — conflicting, not genesis. Fail closed.
      if (sidecar !== null) {
        throw recoveryError(
          "a head sidecar exists but the audit log has no records; refusing to allocate " +
            "a sequence over lost committed evidence.",
        );
      }
      return null;
    }

    const parsed = parseTipLine(tip.lastLine);

    if (parsed.kind === "legacy") {
      // A legacy tip is the normal pre-activation state only when the chain was
      // never activated. Once a sidecar records an activation, the persisted v2
      // chain must exist; a legacy tip then means the v2 records were lost.
      if (sidecar === null) return null;
      throw recoveryError(
        "activation was recorded but the audit log has no verified v2 chain (legacy " +
          "tail); refusing to allocate a sequence.",
      );
    }
    if (parsed.kind === "malformed") {
      throw recoveryError(
        "the last audit record is malformed; refusing to allocate a sequence and " +
          "refusing to rewrite committed evidence.",
      );
    }

    const tipRecord = parsed.record;

    // Fast path: a sidecar that exactly matches the persisted, hash-valid tip.
    if (
      sidecar !== null &&
      sidecar.seq === tipRecord.seq &&
      sidecar.recordHash === tipRecord.recordHash &&
      this.isRecordHashValid(tipRecord)
    ) {
      return sidecar;
    }

    // Otherwise verify the whole chain before trusting or advancing anything.
    // O(1): the verifier captures only the tip and the single record at the
    // sidecar's seq during its streaming pass — never the full record set.
    const verified = await verifyAuditLog({
      auditDir: this.auditDir,
      ...(sidecar !== null && sidecar.seq > 0 ? { requestedSeq: sidecar.seq } : {}),
    });
    const structural = verified.findings.filter((f) => f.type !== "head_mismatch");
    if (structural.length > 0) {
      throw recoveryError(
        `persisted chain is not verifiable (${structural
          .map((f) => f.type)
          .join(", ")}); refusing to allocate a sequence.`,
      );
    }

    const last = verified.tip;
    if (last === null) {
      // The persisted tip parsed as a v2 record, so a verified chain must exist.
      throw recoveryError(
        "persisted tip is a v2 record but the verified chain has no records; " +
          "refusing to allocate a sequence.",
      );
    }

    // The sidecar (if any) must be genesis or a record that the verified chain
    // actually contains at that seq with the same hash.
    const sidecarIsAncestor =
      sidecar === null ||
      (sidecar.seq === 0) ||
      (verified.requestedRecord !== null &&
        verified.requestedRecord.seq === sidecar.seq &&
        verified.requestedRecord.recordHash === sidecar.recordHash);

    if (!sidecarIsAncestor) {
      throw recoveryError(
        `head sidecar (seq ${sidecar?.seq ?? "none"}, hash ${
          sidecar?.recordHash ?? "none"
        }) is not a verified ancestor of the persisted tip (seq ${last.seq}); refusing to reconcile.`,
      );
    }

    const recovered: AuditHead = {
      seq: last.seq,
      recordHash: last.recordHash,
      prevHash: last.prevHash,
      // The verified tip carries its own timestamp; never synthesize one.
      timestamp: last.timestamp,
      updatedAt: new Date().toISOString(),
    };
    if (sidecar?.legacy) recovered.legacy = sidecar.legacy;

    // Heal the sidecar for future appends. Never touches the JSONL.
    writeHeadAtomic(this.headPath, recovered);

    // Out-of-band telemetry: the sidecar was repaired to match committed
    // evidence. No chained record is written and no sequence is consumed.
    this.emitRecovery({
      action: "audit.stale_sidecar_recovered",
      previousSeq: sidecar?.seq ?? 0,
      recoveredSeq: recovered.seq,
      timestamp: new Date().toISOString(),
    });

    return recovered;
  }

  /** Recompute and compare a single record's own hash. */
  private isRecordHashValid(record: AuditRecordV2): boolean {
    const body = buildHashBody(record.action, record.details, record.timestamp, record.actor);
    return computeRecordHash(body, record.seq, record.prevHash) === record.recordHash;
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

      // Check if any v2 records already exist in the log. `recordCount.v2`
      // counts every parseable v2 record (chain-valid or not), faithfully
      // matching the previous `readLastV2Record() !== null` guard.
      const preActivation = await verifyAuditLog({ auditDir: this.auditDir });
      if (preActivation.recordCount.v2 > 0) {
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
