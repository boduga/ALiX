/**
 * coordination-store-stress.test.ts — Concurrency stress tests for CoordinationStore.
 *
 * Tests parallel worker updates, CAS revisions, run status changes,
 * and mixed read/write contention at 10/50/100 concurrency levels.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import {
  runConcurrent,
  assertStressPasses,
  stressSuiteSummary,
} from "../../src/testing/concurrency-harness.js";

const CONCURRENCY_LEVELS = [10, 50, 100];

// =========================================================================
// Fixtures
// =========================================================================

function createStore(): { cwd: string; store: CoordinationStore; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "coord-stress-"));
  const store = new CoordinationStore(cwd);
  return { cwd, store, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

async function createRun(store: CoordinationStore): Promise<string> {
  const run = createCoordinationRun({
    sessionId: "stress",
    rootGoal: "concurrency test",
    coordinatorAgentId: "alix",
  });
  await store.save(run);
  return run.id;
}

function makeWorker(runId: string, label: string) {
  return createWorkerAssignment({
    coordinationRunId: runId,
    agentId: `agent-${label}`,
    taskLabel: label,
    goalPrompt: `do ${label}`,
  });
}

// =========================================================================
// Tests
// =========================================================================

for (const N of CONCURRENCY_LEVELS) {
  test(`parallel worker completions (N=${N})`, async () => {
    const { store, cleanup, cwd } = createStore();
    try {
      const runId = await createRun(store);
      // Add N workers sequentially (per-run lock serializes)
      const workers = Array.from({ length: N }, (_, i) => makeWorker(runId, `w${i}`));
      for (const w of workers) {
        await store.addWorker(runId, w);
      }

      // Complete all workers in parallel
      const result = await runConcurrent(N, (i) =>
        store.patchWorker(runId, workers[i].id, {
          status: "completed",
          resultRef: `result-${i}.json`,
        }),
      );

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      // Verify every worker completed
      const run = await store.load(runId);
      assert.equal(run!.workers.length, N);
      for (const w of run!.workers) {
        assert.equal(w.status, "completed");
      }
    } finally {
      cleanup();
    }
  });

  test(`parallel worker failures (N=${N})`, async () => {
    const { store, cleanup } = createStore();
    try {
      const runId = await createRun(store);
      const workers = Array.from({ length: N }, (_, i) => makeWorker(runId, `f${i}`));
      for (const w of workers) {
        await store.addWorker(runId, w);
      }

      const result = await runConcurrent(N, (i) =>
        store.patchWorker(runId, workers[i].id, {
          status: "failed",
          error: `error-${i}`,
        }),
      );

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      const run = await store.load(runId);
      for (const w of run!.workers) {
        assert.equal(w.status, "failed");
      }
    } finally {
      cleanup();
    }
  });

  test(`CAS revision increments (N=${N})`, async () => {
    const { store, cleanup, cwd } = createStore();
    try {
      const runId = await createRun(store);
      const workers = Array.from({ length: N }, (_, i) => makeWorker(runId, `cas${i}`));
      for (const w of workers) {
        await store.addWorker(runId, w);
      }

      // Each worker operation uses updateRunWithRevisionCheck
      const result = await runConcurrent(N, async (i) => {
        const run = await store.load(runId);
        if (!run) throw new Error("Run not found");
        const worker = run.workers.find(w => w.id === workers[i]?.id);
        if (!worker) throw new Error(`Worker ${i} not found`);

        return store.updateRunWithRevisionCheck(runId, run.planRevision, (r) => {
          const target = r.workers.find(w => w.id === workers[i].id);
          if (target) {
            target.status = "completed";
            target.resultRef = `cas-result-${i}.json`;
          }
          // mutate in place, no return value expected
        });
      });

      // CAS failures are expected under contention — they should be retryable
      const run = await store.load(runId);
      assert.ok(run!.planRevision > 0, `planRevision should have incremented, got ${run!.planRevision}`);
      const completedCount = run!.workers.filter(w => w.status === "completed").length;
      assert.ok(completedCount > 0, `at least some workers should complete, got ${completedCount}`);
    } finally {
      cleanup();
    }
  });

  test(`mixed read/write contention (N=${N})`, async () => {
    const { store, cleanup } = createStore();
    try {
      const runId = await createRun(store);
      const workers = Array.from({ length: N }, (_, i) => makeWorker(runId, `rw${i}`));
      for (const w of workers) {
        await store.addWorker(runId, w);
      }

      const result = await runConcurrent(N, async (i) => {
        // Read then write
        const run = await store.load(runId);
        if (!run) throw new Error("not found");
        const worker = run.workers.find(w => w.id === workers[i]?.id);
        if (!worker) throw new Error(`worker ${i} not found`);

        return store.patchWorker(runId, workers[i].id, {
          status: "running",
        });
      });

      assertStressPasses(result);
      console.log(`  [N=${N}] ${stressSuiteSummary(result)}`);

      const run = await store.load(runId);
      const runningCount = run!.workers.filter(w => w.status === "running").length;
      assert.equal(runningCount, N, `all ${N} workers should be running, got ${runningCount}`);
    } finally {
      cleanup();
    }
  });
}
