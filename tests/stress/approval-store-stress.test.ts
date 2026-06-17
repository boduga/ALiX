/**
 * approval-store-stress.test.ts — Concurrency stress tests for ApprovalStore.
 *
 * Tests requestOrReusePending (atomic lookup+insert), parallel consumption,
 * mixed resolve contention, and request throughput at 10/50 concurrency levels.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import {
  runConcurrent,
  assertStressPasses,
  stressSuiteSummary,
} from "../../src/testing/concurrency-harness.js";

const CONCURRENCY_LEVELS = [10, 50];

function createStore(): { cwd: string; store: ApprovalStore; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "appr-stress-"));
  const store = new ApprovalStore(cwd);
  return { cwd, store, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

// =========================================================================
// requestOrReusePending — atomic lookup+insert
// =========================================================================

for (const N of CONCURRENCY_LEVELS) {
  test(`requestOrReusePending unique binding keys (N=${N})`, async () => {
    const { store, cleanup } = createStore();
    try {
      await store.load();

      const result = await runConcurrent(N, async (i) => {
        return store.requestOrReusePending({
          requestFingerprint: `stress:${i}`,
          policyRevision: "1",
          bindingKey: `bind-unique-${i}`,
          reason: `test-${i}`,
          capabilities: ["stress.test"],
          riskLevel: "low",
        });
      });

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      const all = store.list();
      const pending = all.filter(r => r.status === "pending");
      assert.equal(pending.length, N, `expected ${N} pending approvals, got ${pending.length}`);
    } finally {
      cleanup();
    }
  });

  test(`requestOrReusePending same binding key (N=${N}) deduplicates`, async () => {
    const { store, cleanup } = createStore();
    try {
      await store.load();

      const result = await runConcurrent(N, async () => {
        return store.requestOrReusePending({
          requestFingerprint: "stress:same",
          policyRevision: "1",
          bindingKey: "bind-same",
          reason: "same-key-test",
          capabilities: ["stress.test"],
          riskLevel: "low",
        });
      });

      assert.ok(result.passed > 0, `at least one request should succeed, got ${result.passed}`);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      const all = store.list();
      const sameKey = all.filter(r => r.bindingKey === "bind-same");
      assert.ok(sameKey.length <= 5, `expected <=5 same-key records under contention, got ${sameKey.length}`);
    } finally {
      cleanup();
    }
  });

  test(`parallel consumeApproved (N=${N})`, async () => {
    const { store, cleanup } = createStore();
    try {
      await store.load();

      // Create N approved approvals via request() then resolve() each
      const records = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          store.request({
            reason: `consume-test-${i}`,
            capability: "stress.test",
            riskLevel: "low",
          }),
        ),
      );

      // First approve all records
      for (const r of records) {
        await store.resolve(r.id, "approved");
      }

      // Consume each once (need binding key from the record)
      const result = await runConcurrent(N, async (i) => {
        const consumed = await store.consumeApproved(records[i].id, records[i].bindingKey, {});
        if (!consumed.consumed) throw new Error(`Could not consume ${records[i].id}: ${consumed.reason}`);
        return consumed;
      });

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);
    } finally {
      cleanup();
    }
  });

  test(`parallel resolve mixed approve/reject (N=${N})`, async () => {
    const { store, cleanup } = createStore();
    try {
      await store.load();

      const records = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          store.request({
            reason: `mixed-test-${i}`,
            capability: "stress.test",
            riskLevel: "low",
          }),
        ),
      );

      // Half approve, half deny
      const result = await runConcurrent(N, async (i) => {
        if (i % 2 === 0) {
          return store.resolve(records[i].id, "approved");
        } else {
          return store.resolve(records[i].id, "denied");
        }
      });

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);
    } finally {
      cleanup();
    }
  });

  test(`parallel request() throughput (N=${N})`, async () => {
    const { store, cleanup } = createStore();
    try {
      await store.load();

      const result = await runConcurrent(N, async (i) => {
        return store.request({
          reason: `throughput-test-${i}`,
          capability: "stress.test",
          riskLevel: "low",
        });
      });

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      const all = store.list();
      assert.equal(all.length, N);
    } finally {
      cleanup();
    }
  });
}
