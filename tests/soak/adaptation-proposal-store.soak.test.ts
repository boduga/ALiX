/**
 * adaptation-proposal-store.soak.test.ts — ProposalStore soak test.
 *
 * CI mode (default): 100 proposals. Benchmark mode: 1000 proposals.
 * Measures write/list/filter/update latencies with p50/p95/avg.
 *
 * Set ALIX_SOAK_LEVEL=bench to run in benchmark mode.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";

const SOAK_LEVEL = process.env.ALIX_SOAK_LEVEL || "ci";
const PROPOSAL_COUNT = SOAK_LEVEL === "bench" ? 1000 : 100;

describe(`ProposalStore soak (${PROPOSAL_COUNT} proposals, level=${SOAK_LEVEL})`, () => {
  let dir: string;
  let store: ProposalStore;
  const latencies: number[] = [];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "proposal-soak-"));
    store = new ProposalStore(dir);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    const memBefore = process.memoryUsage();
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];
    const total = latencies.reduce((a, b) => a + b, 0);
    const avg = total / latencies.length;
    const memAfter = process.memoryUsage();
    console.log(`\n📊 ProposalStore soak results (${PROPOSAL_COUNT} proposals):`);
    console.log(`   p50: ${p50.toFixed(2)}ms`);
    console.log(`   p95: ${p95.toFixed(2)}ms`);
    console.log(`   max: ${max.toFixed(2)}ms`);
    console.log(`   avg: ${avg.toFixed(2)}ms`);
    console.log(`   total: ${total.toFixed(2)}ms`);
    console.log(`   throughput: ${(PROPOSAL_COUNT / (total / 1000)).toFixed(2)} props/sec`);
    console.log(`   heapUsed delta: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   rss delta: ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2)} MB`);
  });

  it(`should write ${PROPOSAL_COUNT} proposals`, async () => {
    for (let i = 0; i < PROPOSAL_COUNT; i++) {
      const start = performance.now();
      await store.save({
        id: `prop-soak-${String(i).padStart(4, "0")}`,
        createdAt: new Date().toISOString(),
        status: "pending",
        action: "create_improvement_issue",
        target: { kind: "issue", title: `Soak test ${i}` },
        payload: {},
        sourceRecommendationType: "soak_test",
        sourceConfidence: 0.5,
        evidenceFingerprints: [],
        reason: `Soak test proposal ${i}`,
      });
      latencies.push(performance.now() - start);
    }
  });

  it("should list all proposals", async () => {
    const start = performance.now();
    const all = await store.list();
    const elapsed = performance.now() - start;
    assert.equal(all.length, PROPOSAL_COUNT);
    console.log(`   list() returned ${all.length} proposals in ${elapsed.toFixed(2)}ms`);
  });

  it("should filter by status", async () => {
    const pending = await store.list("pending");
    assert.equal(pending.length, PROPOSAL_COUNT);
  });

  it("should update proposals in batch", async () => {
    const start = performance.now();
    for (let i = 0; i < Math.min(PROPOSAL_COUNT, 100); i++) {
      await store.update(`prop-soak-${String(i).padStart(4, "0")}`, { status: "approved" });
    }
    const elapsed = performance.now() - start;
    const count = Math.min(PROPOSAL_COUNT, 100);
    console.log(`   updated ${count} proposals in ${elapsed.toFixed(2)}ms (${(elapsed / count).toFixed(2)}ms/proposal)`);
  });
});
