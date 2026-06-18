/**
 * evidence-health.ts — Evidence health signals for Observability (P4.4d).
 *
 * Produces passive, side-effect-free health metrics from the evidence store
 * for consumption by the HealthChecker, PerformanceMonitor, and Alert Manager.
 *
 * @module
 */

import { EvidenceStore } from "./evidence-store.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_DIR = join(".alix", "security");
const STALE_WRITE_THRESHOLD_MS = 3600_000; // 1 hour without a write = stale
const STALE_VERIFICATION_THRESHOLD_MS = 86_400_000; // 24h without verification = stale

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceHealth {
  /** Overall evidence store health status. */
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  /** Whether the evidence store file exists and is readable. */
  storeAccessible: boolean;
  /** Whether the last fingerprint verification passed. */
  chainIntegrity: boolean | null;
  /** Total evidence record count. */
  recordCount: number;
  /** Breakdown by evidence type. */
  byType: Record<string, number>;
  /** ISO timestamp of the most recent evidence write. */
  lastWriteAt: string | null;
  /** ISO timestamp of the oldest evidence record. */
  oldestRecordAt: string | null;
  /** Milliseconds since the last evidence write. */
  lastWriteAgeMs: number | null;
  /** Whether evidence writes are recent enough. */
  writesRecent: boolean;
  /** Whether verification has been run recently. */
  verificationRecent: boolean | null;
  /** Human-readable summary of issues. */
  issues: string[];
}

// ---------------------------------------------------------------------------
// EvidenceHealthCollector
// ---------------------------------------------------------------------------

export class EvidenceHealthCollector {
  private readonly store: EvidenceStore;

  /**
   * @param storeDir - Evidence store directory. Defaults to `<cwd>/.alix/security`.
   */
  constructor(storeDir?: string) {
    const root = storeDir ?? join(process.cwd(), EVIDENCE_DIR);
    this.store = new EvidenceStore({ storeDir: root });
  }

  // -----------------------------------------------------------------------
  // Collect
  // -----------------------------------------------------------------------

  /**
   * Collect evidence health signals.
   * Passive, side-effect-free — never triggers verification or writes.
   */
  async collect(): Promise<EvidenceHealth> {
    const issues: string[] = [];

    // Try to access the store
    let storeAccessible = true;
    let recordCount = 0;
    let byType: Record<string, number> = {};
    let lastWriteAt: string | null = null;
    let oldestRecordAt: string | null = null;
    let chainIntegrity: boolean | null = null;

    try {
      // Collect stats and check integrity
      const stats = await this.store.stats();
      recordCount = stats.total;
      byType = stats.byType;

      // Find newest and oldest records
      const allRecords = await this.store.query({ limit: recordCount || 1 });
      if (allRecords.records.length > 0) {
        // Already sorted newest-first
        lastWriteAt = allRecords.records[0].timestamp;
        oldestRecordAt = allRecords.records[allRecords.records.length - 1].timestamp;
      }

      // Verify fingerprint integrity (reads, never writes)
      const verifyResult = await this.store.verify();
      chainIntegrity = verifyResult.ok;
      if (!verifyResult.ok) {
        issues.push(`${verifyResult.failed.length} of ${verifyResult.total} records have invalid fingerprints`);
      }
    } catch (err) {
      storeAccessible = false;
      issues.push(`Evidence store inaccessible: ${err}`);
    }

    // Compute derived signals
    const nowMs = Date.now();
    const lastWriteMs = lastWriteAt ? new Date(lastWriteAt).getTime() : null;
    const lastWriteAgeMs = lastWriteMs !== null ? nowMs - lastWriteMs : null;
    const writesRecent = lastWriteAgeMs !== null && lastWriteAgeMs < STALE_WRITE_THRESHOLD_MS;
    const verificationRecent = null; // Could track last verify timestamp in a future enhancement

    // Determine overall status
    let status: EvidenceHealth["status"];
    if (!storeAccessible) {
      status = "unknown";
    } else if (!chainIntegrity) {
      status = "unhealthy";
    } else if (!writesRecent && recordCount > 0) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    if (!writesRecent && recordCount > 0) {
      issues.push(`No evidence writes in ${Math.round((lastWriteAgeMs ?? 0) / 1000 / 60)} minutes`);
    }

    return {
      status,
      storeAccessible,
      chainIntegrity,
      recordCount,
      byType,
      lastWriteAt,
      oldestRecordAt,
      lastWriteAgeMs,
      writesRecent,
      verificationRecent,
      issues,
    };
  }
}

// ---------------------------------------------------------------------------
// Evidence health metric names (for Observability integration)
// ---------------------------------------------------------------------------

export const EVIDENCE_METRICS = {
  EVIDENCE_STORE_HEALTHY: "evidence_store_healthy",
  EVIDENCE_WRITE_FAILURES: "evidence_write_failures",
  EVIDENCE_VERIFICATION_FAILURES: "evidence_verification_failures",
  EVIDENCE_CHAIN_INTEGRITY: "evidence_chain_integrity",
  EVIDENCE_RECORD_COUNT: "evidence_record_count",
  EVIDENCE_COMPACTION_AGE: "evidence_compaction_age",
  EVIDENCE_LAST_WRITE_AGE: "evidence_last_write_age",
} as const;
