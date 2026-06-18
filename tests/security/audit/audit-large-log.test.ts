/**
 * P4.3-Sd2 — Large Log Tests
 *
 * Verifies that the streaming verifier handles large audit logs without
 * unbounded memory growth and that queries return bounded results.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditChainWriter } from "../../../src/security/audit/audit-chain-writer.js";
import { verifyAuditLog } from "../../../src/security/audit/audit-verifier.js";
import { AuditStore } from "../../../src/audit/audit-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "audit-large-test-"));
}

function makeWriter(auditDir: string): AuditChainWriter {
  return new AuditChainWriter({ auditDir });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LargeLog", () => {
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
  // Large chain verification (v2)
  // -----------------------------------------------------------------------

  it("verifies a 1000-record v2 chain correctly", async () => {
    const COUNT = 1000;
    for (let i = 0; i < COUNT; i++) {
      await writer.append({
        action: "auth.success" as any,
        timestamp: 1000 + i,
        actor: "test",
        details: { index: i, data: "x".repeat(50) },
      });
    }

    const result = await verifyAuditLog({ auditDir: tmpDir });
    assert.ok(result.ok, `Expected ok but got ${result.findings.length} findings`);
    assert.equal(result.recordCount.v2, COUNT);
    assert.equal(result.findings.length, 0);
  });

  // -----------------------------------------------------------------------
  // Verification memory stays bounded
  // -----------------------------------------------------------------------

  it("memory stays bounded during verification of large log", async () => {
    const COUNT = 100;
    for (let i = 0; i < COUNT; i++) {
      await writer.append({
        action: "auth.success" as any,
        timestamp: 1000 + i,
        actor: "test",
        details: { index: i },
      });
    }

    // Measure memory before and after.
    const memBefore = process.memoryUsage().heapUsed;
    const result = await verifyAuditLog({ auditDir: tmpDir });
    const memAfter = process.memoryUsage().heapUsed;

    assert.ok(result.ok);
    // Memory growth should be modest (no loading entire file).
    const growth = memAfter - memBefore;
    assert.ok(
      growth < 50 * 1024 * 1024,
      `Memory growth ${growth} bytes exceeds bound`,
    );
  });

  // -----------------------------------------------------------------------
  // Query returns bounded results (v1 audit store)
  // -----------------------------------------------------------------------

  it("query returns bounded results for large log", async () => {
    // Use AuditStore to write v1 records.
    const store = new AuditStore(tmpDir);
    const COUNT = 100;
    for (let i = 0; i < COUNT; i++) {
      await store.append({
        action: i % 2 === 0 ? "graph.completed" : "graph.continued",
        actor: "test",
        details: { graphId: `graph-${i % 10}` },
      });
    }

    const records = await store.list(20);
    assert.ok(records.length <= 20);
    assert.ok(records.length > 0);

    // Query with filter.
    const filtered = await store.findByAction("graph.completed", 10);
    assert.ok(filtered.length <= 10);
    for (const r of filtered) {
      assert.equal(r.action, "graph.completed");
    }
  });

  // -----------------------------------------------------------------------
  // Query does not fail on malformed lines
  // -----------------------------------------------------------------------

  it("query reports corruption rather than failing on malformed lines", async () => {
    const store = new AuditStore(tmpDir);
    // Write v1 records.
    await store.append({
      action: "graph.completed",
      actor: "test",
      details: { graphId: "g1" },
    });

    // Manually append a malformed line.
    const { appendFile } = await import("node:fs/promises");
    const auditPath = store.path;
    await appendFile(auditPath, "this is a malformed line\n", "utf-8");

    await store.append({
      action: "graph.completed",
      actor: "test",
      details: { graphId: "g2" },
    });

    const result = await store.query({ limit: 100 });

    // Should return valid records.
    assert.ok(result.records.length >= 2, `Expected >= 2 records, got ${result.records.length}`);

    // Should report corruption.
    assert.ok(result.corruption !== undefined, "Expected corruption notice");
    assert.ok(result.corruption!.malformedLines > 0);
  });

  // -----------------------------------------------------------------------
  // findByGraph uses streaming and is bounded
  // -----------------------------------------------------------------------

  it("findBy methods use streaming and are bounded", async () => {
    const store = new AuditStore(tmpDir);
    for (let i = 0; i < 50; i++) {
      await store.append({
        action: "graph.completed",
        actor: "test",
        details: { graphId: `graph-${i % 5}`, nodeId: `node-${i}` },
      });
    }

    const byGraph = await store.findByGraph("graph-0", 10);
    assert.ok(byGraph.length <= 10);
    for (const r of byGraph) {
      assert.equal(r.details?.graphId, "graph-0");
    }
  });
});
