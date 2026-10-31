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
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import type { ApprovalRecord } from "../../src/governance/approvals/approval-types.js";
import { closeSharedLedger } from "../../src/runtime-state/storage/runtime-ledger.js";
import {
  runConcurrent,
  assertStressPasses,
  stressSuiteSummary,
} from "../../src/operations/testing/concurrency-harness.js";

const CONCURRENCY_LEVELS = [10, 50];

function createStore(): { cwd: string; store: ApprovalStore; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "appr-stress-"));
  const store = new ApprovalStore(cwd);
  return { cwd, store, cleanup: () => {
    closeSharedLedger(cwd);
    rmSync(cwd, { recursive: true, force: true });
  } };
}

// =========================================================================
// requestOrReusePending — atomic lookup+insert
// =========================================================================

for (const N of CONCURRENCY_LEVELS) {
  // These cases persist N operations; allow workload-scaled test time without
  // changing the store's cross-process lock or queue idle deadlines.
  const timeout = 30_000 + N * 500;
  test(`requestOrReusePending unique binding keys (N=${N})`, { timeout }, async () => {
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

  test(`requestOrReusePending same binding key (N=${N}) deduplicates`, { timeout }, async () => {
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

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      const all = store.list();
      const sameKey = all.filter(r => r.bindingKey === "bind-same");
      assert.equal(sameKey.length, 1, "all same-key requests must reuse one pending approval");
    } finally {
      cleanup();
    }
  });

  // Seed and resolve N durable grants before contending N claims; setup alone
  // performs 2N ledger transitions on slow qualification filesystems.
  test(`parallel consumeApproved (N=${N})`, { timeout: 120_000 }, async () => {
    const { store, cleanup } = createStore();
    try {
      await store.load();

      // Independent effects need distinct bindings; repeated grants for one
      // exact effect supersede each other and cannot all be consumed.
      const records: ApprovalRecord[] = [];
      for (let i = 0; i < N; i++) {
        records.push(await store.requestBound({
            reason: `consume-test-${i}`,
            capabilities: ["stress.test"],
            bindingKey: `consume-${i}`,
            requestFingerprint: `consume-${i}`,
            policyRevision: "stress-v1",
            riskLevel: "low",
        }));
      }

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

  test(`parallel resolve mixed approve/reject (N=${N})`, { timeout }, async () => {
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

  test(`parallel request() throughput (N=${N})`, { timeout }, async () => {
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
