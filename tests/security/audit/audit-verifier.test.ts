/**
 * P4.3-Sd2 — Audit Verifier Tests
 *
 * Covers: clean v2 chain, legacy+v2 mixed, modify record body,
 * modify prevHash, modify sequence, delete record, insert record,
 * reorder records, duplicate sequence, malformed interior JSON,
 * truncated tail, stale head sidecar, corrupt head sidecar,
 * legacy segment altered.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditChainWriter } from "../../../src/security/audit/audit-chain-writer.js";
import { verifyAuditLog } from "../../../src/security/audit/audit-verifier.js";
import type { AuditRecordV2 } from "../../../src/audit/audit-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "audit-verify-test-"));
}

function makeWriter(auditDir: string): AuditChainWriter {
  return new AuditChainWriter({ auditDir });
}

function makeRecord(
  action = "auth.success",
  timestamp = Date.now(),
): Parameters<AuditChainWriter["append"]>[0] {
  return {
    action: action as any,
    timestamp,
    actor: "test",
    details: { test: true, seq: timestamp },
  };
}

/** Build a clean chain of N v2 records and return them. */
async function buildChain(writer: AuditChainWriter, n: number): Promise<AuditRecordV2[]> {
  const records: AuditRecordV2[] = [];
  for (let i = 0; i < n; i++) {
    const r = await writer.append(makeRecord("auth.success", 1000 + i));
    records.push(r);
  }
  return records;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditVerifier", () => {
  let tmpDir: string;
  let writer: AuditChainWriter;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    writer = makeWriter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Clean v2 chain
  // -----------------------------------------------------------------------

  it("clean v2 chain passes verification", async () => {
    await buildChain(writer, 5);
    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(result.ok);
    assert.equal(result.findings.length, 0);
    assert.equal(result.recordCount.v2, 5);
    assert.equal(result.recordCount.legacy, 0);
  });

  it("single record chain passes", async () => {
    await writer.append(makeRecord());
    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(result.ok);
    assert.equal(result.findings.length, 0);
    assert.equal(result.recordCount.v2, 1);
  });

  // -----------------------------------------------------------------------
  // Sequence gap
  // -----------------------------------------------------------------------

  it("detects sequence gap", async () => {
    const records = await buildChain(writer, 3);
    // Modify the third record's seq to create a gap.
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    const lastLine = JSON.parse(lines[lines.length - 1]);
    lastLine.seq = 5; // gap: 2 -> 5
    lines[lines.length - 1] = JSON.stringify(lastLine);
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "sequence_gap"));
  });

  // -----------------------------------------------------------------------
  // Hash mismatch — modified record body
  // -----------------------------------------------------------------------

  it("detects modified record body", async () => {
    await buildChain(writer, 3);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    const midLine = JSON.parse(lines[1]); // second record
    midLine.details = { tampered: true };
    lines[1] = JSON.stringify(midLine);
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "hash_mismatch"));
  });

  // -----------------------------------------------------------------------
  // Modified prevHash
  // -----------------------------------------------------------------------

  it("detects modified prevHash", async () => {
    await buildChain(writer, 3);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    const midLine = JSON.parse(lines[1]); // second record
    midLine.prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
    lines[1] = JSON.stringify(midLine);
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "hash_mismatch"));
  });

  // -----------------------------------------------------------------------
  // Modified sequence
  // -----------------------------------------------------------------------

  it("detects modified sequence", async () => {
    await buildChain(writer, 3);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    const midLine = JSON.parse(lines[1]); // second record
    const origSeq = midLine.seq;
    midLine.seq = origSeq + 100;
    lines[1] = JSON.stringify(midLine);
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "sequence_gap"));
  });

  // -----------------------------------------------------------------------
  // Deleted record (gap)
  // -----------------------------------------------------------------------

  it("detects deleted record (gap)", async () => {
    await buildChain(writer, 3);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    // Remove the second line.
    lines.splice(1, 1);
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "sequence_gap"));
  });

  // -----------------------------------------------------------------------
  // Inserted record
  // -----------------------------------------------------------------------

  it("detects inserted record", async () => {
    const records = await buildChain(writer, 2);
    const auditPath = join(tmpDir, "audit.jsonl");
    // Insert a fake record between the two.
    const fakeRecord = {
      version: 2,
      seq: 99,
      prevHash: records[0].recordHash,
      recordHash: "0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: 9999,
      action: "auth.success",
      actor: "attacker",
      details: { injected: true },
    };
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    lines.splice(1, 0, JSON.stringify(fakeRecord));
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(
      result.findings.some((f) => f.type === "sequence_gap" || f.type === "hash_mismatch"),
    );
  });

  // -----------------------------------------------------------------------
  // Reordered records
  // -----------------------------------------------------------------------

  it("detects reordered records", async () => {
    await buildChain(writer, 3);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    // Swap second and third.
    const tmp = lines[1];
    lines[1] = lines[2];
    lines[2] = tmp;
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    // Reorder causes both sequence_gap and hash_mismatch.
    assert.ok(result.findings.length > 0);
  });

  // -----------------------------------------------------------------------
  // Duplicate sequence
  // -----------------------------------------------------------------------

  it("detects duplicate sequence", async () => {
    await buildChain(writer, 2);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    // Duplicate the first record.
    lines.splice(2, 0, lines[0]);
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "duplicate_sequence"));
  });

  // -----------------------------------------------------------------------
  // Malformed interior JSON
  // -----------------------------------------------------------------------

  it("detects interior malformed JSON", async () => {
    await buildChain(writer, 2);
    const auditPath = join(tmpDir, "audit.jsonl");
    const raw = readFileSync(auditPath, "utf-8");
    const lines = raw.trim().split("\n");
    // Insert malformed line in the middle.
    lines.splice(1, 0, "this is not valid json at all {{{");
    writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    // Interior malformed line is detected as malformed_line plus the sequence_gap/hash issues.
    assert.ok(result.findings.some((f) => f.type === "malformed_line" || f.type === "truncated_tail"));
  });

  // -----------------------------------------------------------------------
  // Truncated tail
  // -----------------------------------------------------------------------

  it("detects truncated tail", async () => {
    await buildChain(writer, 2);
    const auditPath = join(tmpDir, "audit.jsonl");
    // Append a partial line.
    const fd = await import("node:fs/promises").then((m) => m.appendFile(auditPath, "this is a partial line with no newline", "utf-8"));

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "truncated_tail"));
  });

  // -----------------------------------------------------------------------
  // Stale head sidecar
  // -----------------------------------------------------------------------

  it("detects stale head sidecar (head seq != last record seq)", async () => {
    await buildChain(writer, 3);
    // Manually modify head sidecar to be stale.
    const headPath = join(tmpDir, "head.json");
    const head = JSON.parse(readFileSync(headPath, "utf-8"));
    head.seq = 999;
    head.recordHash = "0000000000000000000000000000000000000000000000000000000000000000";
    writeFileSync(headPath, JSON.stringify(head), "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "head_mismatch"));
  });

  // -----------------------------------------------------------------------
  // Corrupt head sidecar
  // -----------------------------------------------------------------------

  it("detects corrupt head sidecar", async () => {
    await buildChain(writer, 3);
    // Write garbage to head sidecar.
    const headPath = join(tmpDir, "head.json");
    writeFileSync(headPath, "not valid json", "utf-8");

    const result = await verifyAuditLog({ auditDir: tmpDir });
    // Corrupt head sidecar is treated as null.
    assert.equal(result.headSidecar, null);
  });

  // -----------------------------------------------------------------------
  // Legacy + v2 mixed chain
  // -----------------------------------------------------------------------

  it("legacy + v2 mixed chain passes with legacy segment verification", async () => {
    // Write legacy records.
    const auditPath = join(tmpDir, "audit.jsonl");
    const legacyRecords = [
      { id: "l1", action: "policy.allowed", timestamp: "2025-01-01T00:00:00Z", details: {} },
      { id: "l2", action: "policy.denied", timestamp: "2025-01-02T00:00:00Z", details: { reason: "test" } },
    ];
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(auditPath, legacyRecords.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

    // Activate legacy.
    const result = await writer.activateLegacy();
    assert.ok(result.activated, `Activation failed: ${(result as any).reason}`);

    // Add v2 records.
    const r1 = await writer.append(makeRecord("auth.success", 2000));
    const r2 = await writer.append(makeRecord("auth.success", 2001));

    const vResult = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(vResult.ok, `Expected ok but got findings: ${JSON.stringify(vResult.findings)}`);
    assert.equal(vResult.recordCount.legacy, 2);
    assert.equal(vResult.recordCount.v2, 3); // activation + r1 + r2
  });

  // -----------------------------------------------------------------------
  // Legacy segment altered
  // -----------------------------------------------------------------------

  it("detects altered legacy segment", async () => {
    const auditPath = join(tmpDir, "audit.jsonl");
    const legacyRecords = [
      { id: "l1", action: "policy.allowed", timestamp: "2025-01-01T00:00:00Z", details: {} },
    ];
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(auditPath, legacyRecords.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

    const result = await writer.activateLegacy();
    assert.ok(result.activated);

    // Alter a legacy record.
    writeFileSync(auditPath, readFileSync(auditPath, "utf-8").replace("policy.allowed", "policy.denied"), "utf-8");

    const vResult = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(!vResult.ok);
    assert.ok(vResult.findings.some((f) => f.type === "legacy_modified"));
  });

  // -----------------------------------------------------------------------
  // No audit log file
  // -----------------------------------------------------------------------

  it("handles missing audit log", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "audit-verify-empty-"));
    try {
      const result = await verifyAuditLog({ auditDir: emptyDir });
      assert.ok(!result.ok);
      assert.ok(result.findings.some((f) => f.detail?.includes("not found")));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
