/**
 * P4.3-Sd1 — Audit concurrency stress test.
 *
 * Verifies that 50+ concurrent append operations on the same store
 * produce a contiguous sequence with no gaps, no duplicates, and
 * correctly linked hash chain.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditChainWriter } from "../../src/governance/security/audit/audit-chain-writer.js";
import type { AuditRecordV2 } from "../../src/governance/audit/audit-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWriter(auditDir: string): AuditChainWriter {
  // Test-scoped lock patience only (product defaults in audit-lock.ts untouched):
  // 50–100 same-process hammering appends serialize on the file lock, so the
  // tail waiters need a longer deadline and quicker retry cadence than the
  // 10s/50ms settings that time out under contention.
  return new AuditChainWriter({
    auditDir,
    lock: {
      staleRecovery: "auto",
      staleThresholdMs: 30_000,
      timeoutMs: 60_000,
      maxRetries: 200,
      initialBackoffMs: 10,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Audit concurrency", () => {
  // Workload-scaled timeout: 50 serialized fsync'd appends can exceed the 60s suite default under load.
  it("50 concurrent appends produce contiguous sequence with no gaps or duplicates", { timeout: 120_000 }, async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-conc-"));

    try {
      const writer = makeWriter(tmpDir);

      // Launch 50 concurrent append operations.
      const promises: Promise<AuditRecordV2>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          writer.append({
            action: "auth.success",
            timestamp: Date.now(),
            actor: `concurrent-${i}`,
            details: { index: i },
          }),
        );
      }

      const records = await Promise.all(promises);

      // Verify we got 50 records.
      assert.equal(records.length, 50);

      // Collect sequences.
      const seqs = records.map((r) => r.seq).sort((a, b) => a - b);

      // No gaps — should be [1, 2, 3, ..., 50].
      for (let i = 0; i < seqs.length; i++) {
        assert.equal(seqs[i], i + 1, `Expected seq ${i + 1}, got ${seqs[i]}. All seqs: ${JSON.stringify(seqs)}`);
      }

      // No duplicates.
      const uniqueSeqs = new Set(seqs);
      assert.equal(uniqueSeqs.size, 50);

      // Verify hash chain links.
      // Sort by seq to get chronological order.
      const sorted = [...records].sort((a, b) => a.seq - b.seq);

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        assert.equal(
          curr.prevHash,
          prev.recordHash,
          `Chain break at seq ${curr.seq}: prevHash ${curr.prevHash} != expected ${prev.recordHash}`,
        );
      }

      // First record should be genesis.
      const genesis = sorted[0];
      assert.equal(genesis.seq, 1);
      assert.equal(genesis.prevHash, null);

      // All records should be v2.
      for (const r of records) {
        assert.equal(r.version, 2);
        assert.ok(typeof r.recordHash === "string");
        assert.equal(r.recordHash.length, 64);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Workload-scaled timeout: 100 serialized fsync'd appends can exceed the 60s suite default under load.
  it("100 concurrent appends produce contiguous sequence", { timeout: 120_000 }, async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-conc-100-"));
    try {
      const writer = makeWriter(tmpDir);

      const promises: Promise<AuditRecordV2>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          writer.append({
            action: "session.create",
            timestamp: Date.now(),
            actor: `stress-${i}`,
            details: { index: i },
          }),
        );
      }

      const records = await Promise.all(promises);
      assert.equal(records.length, 100);

      const seqs = records.map((r) => r.seq).sort((a, b) => a - b);
      for (let i = 0; i < seqs.length; i++) {
        assert.equal(seqs[i], i + 1);
      }

      const uniqueSeqs = new Set(seqs);
      assert.equal(uniqueSeqs.size, 100);

      // Verify full chain links.
      const sorted = [...records].sort((a, b) => a.seq - b.seq);
      for (let i = 1; i < sorted.length; i++) {
        assert.equal(sorted[i].prevHash, sorted[i - 1].recordHash);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
