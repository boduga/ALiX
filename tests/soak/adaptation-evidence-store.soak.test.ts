/**
 * adaptation-evidence-store.soak.test.ts — EvidenceStore soak test.
 *
 * CI mode (default): 1000 events. Benchmark mode: 10000 events.
 * Measures append/query/verify latencies with p50/p95.
 *
 * Set ALIX_SOAK_LEVEL=bench to run in benchmark mode.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";

const SOAK_LEVEL = process.env.ALIX_SOAK_LEVEL || "ci";
const EVENT_COUNT = SOAK_LEVEL === "bench" ? 10000 : 1000;

describe(`EvidenceStore soak (${EVENT_COUNT} events, level=${SOAK_LEVEL})`, () => {
  let dir: string;
  let store: EvidenceStore;
  const latencies: number[] = [];
  const fingerprints: string[] = [];
  let memBefore: NodeJS.MemoryUsage;

  before(() => {
    memBefore = process.memoryUsage();
    dir = mkdtempSync(join(tmpdir(), "evidence-soak-"));
    store = new EvidenceStore({ storeDir: dir });
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const memAfter = process.memoryUsage();
    console.log(`\n📊 EvidenceStore soak results (${EVENT_COUNT} events):`);
    console.log(`   p50: ${p50.toFixed(2)}ms`);
    console.log(`   p95: ${p95.toFixed(2)}ms`);
    console.log(`   heapUsed delta: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  });

  it(`should append ${EVENT_COUNT} adaptation events`, async () => {
    for (let i = 0; i < EVENT_COUNT; i++) {
      const start = performance.now();
      const rec = await store.append("adaptation_proposed", {
        proposalId: `prop-soak-${i}`,
        action: "create_improvement_issue",
        target: { kind: "issue", title: `Soak ${i}` },
        sourceRecommendationType: "soak",
        sourceConfidence: 0.5,
      });
      latencies.push(performance.now() - start);
      if (rec) fingerprints.push(rec.fingerprint);
    }
  });

  it("should query by type", async () => {
    const result = await store.query({ type: "adaptation_proposed", limit: 100 });
    assert.ok(result.records.length > 0);
  });

  it("should get by fingerprint", async () => {
    if (fingerprints.length > 0) {
      const rec = await store.getByFingerprint(fingerprints[0]);
      assert.ok(rec);
    }
  });

  it("should run verify()", async () => {
    const start = performance.now();
    const result = await store.verify();
    const elapsed = performance.now() - start;
    console.log(`   verify() completed in ${elapsed.toFixed(2)}ms (${result.total} records)`);
    assert.ok(result.ok);
  });
});
