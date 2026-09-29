/**
 * coordination-finalization.test.ts — C2: terminal aggregation actually happens,
 * exactly once.
 *
 * Before this change `maybeFinalizeRun()` was gated on a `completionService`
 * that no construction site injected, so a terminal run only gained an aggregate
 * when someone read its results. Cohort `t3d-2026-09-28-c` showed the
 * consequence: 7 runs closed status=completed, 3 carried an aggregate, 4 did
 * not, and all 7 parent sessions reported a completed terminal.
 *
 * These tests pin: the terminal transition finalizes; a second observation is a
 * no-op (no duplicate aggregate, no duplicate event, no outcome overwrite);
 * aggregation failure is recorded separately from execution; and the production
 * factory is the only way a scheduler gets built in `src/`.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import {
  CoordinationScheduler,
  createCoordinationScheduler,
} from "../../src/kernel/coordination-scheduler.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import { CoordinationAggregateStore } from "../../src/kernel/coordination-aggregate-store.js";
import { OwnershipRegistry } from "../../src/ownership/ownership-registry.js";
import { persistGraph } from "../../src/kernel/graph-planner.js";
import type { ExecutionAuthorization } from "../../src/runtime/execution-authorization.js";

function allowAllAuth(): ExecutionAuthorization {
  return { evaluate: async () => ({ status: "allowed" as const }) } as any;
}

function minimalConfig() {
  return {
    version: 1 as const,
    model: { provider: "test", name: "test" },
    permissions: {
      default: "allow" as const,
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: "bypass" as const,
    },
    context: {
      repoMap: false,
      repoMapMode: "lite" as const,
      maxRepoMapTokens: 1000,
      semanticSearch: false,
      includeGitStatus: false,
      pinnedFiles: [],
    },
    runtime: {
      provider: "process" as const,
      shell: "/bin/bash",
      commandTimeoutMs: 5000,
      envAllowlist: [],
    },
    ui: { enabled: false, host: "localhost", port: 0, transport: "sse" as const },
  };
}

async function waitUntil(cond: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!(await cond()) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * A run whose single worker is still pending, so a tick dispatches it and the
 * terminal transition (not a tick of an already-terminal run) drives
 * finalization — that is the path the guarantee lives on.
 */
async function pendingRun(store: CoordinationStore) {
  const run = createCoordinationRun({
    sessionId: "s1",
    rootGoal: "produce the report",
    coordinatorAgentId: "alix",
  });
  await store.save(run);
  const worker = createWorkerAssignment({
    coordinationRunId: run.id,
    agentId: "alix#1",
    taskLabel: "report",
    goalPrompt: "write it",
    ownershipScopes: [".tmp/out/report.md"],
    requiredCapabilities: ["task.do"],
    attempt: 0,
    maxAttempts: 3,
  });
  await store.addWorker(run.id, worker);
  return { runId: run.id, workerId: worker.id };
}

/** Records every coordination.* event a scheduler emits. */
function recordingEventLog() {
  const appended: Array<{ type: string; payload: unknown }> = [];
  return {
    appended,
    log: {
      append: async (event: { type: string; payload: unknown }) => {
        appended.push({ type: event.type, payload: event.payload });
      },
      readAll: async () => [],
    } as any,
  };
}

function schedulerFor(cwd: string, store: CoordinationStore, eventLog?: any) {
  return createCoordinationScheduler({
    cwd,
    daemonInstanceId: `test-${process.pid}`,
    configProvider: async () => minimalConfig() as any,
    store,
    authorization: allowAllAuth(),
    ownershipRegistry: new OwnershipRegistry(cwd),
    executor: { execute: async () => ({ outcome: "success" as const }) } as any,
    ...(eventLog ? { eventLog } : {}),
  });
}

describe("coordination terminal finalization", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-finalize-"));
    store = new CoordinationStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("finalizes a terminal transition and emits exactly one aggregate-completed event", async () => {
    const { runId } = await pendingRun(store);
    const recorder = recordingEventLog();
    const scheduler = schedulerFor(cwd, store, recorder.log);

    await scheduler.tick(runId);
    await waitUntil(async () => (await store.load(runId))?.aggregateResultRef !== undefined, 8_000);

    const run = await store.load(runId);
    assert.equal(run?.status, "completed", "the worker should have run to completion");
    assert.ok(run?.aggregateResultRef, "terminal run should carry an aggregate ref");
    assert.ok(run?.outcome, "terminal run should carry an aggregate outcome");
    assert.equal(
      recorder.appended.filter(e => e.type === "coordination.aggregate.completed").length,
      1,
    );

    const aggregate = await new CoordinationAggregateStore(cwd).load(runId);
    assert.ok(aggregate, "aggregate summary should be persisted");
  });

  it("does not duplicate the aggregate, the event, or overwrite the outcome on a second observation", async () => {
    const { runId } = await pendingRun(store);
    const recorder = recordingEventLog();
    const scheduler = schedulerFor(cwd, store, recorder.log);

    await scheduler.tick(runId);
    await waitUntil(async () => (await store.load(runId))?.aggregateResultRef !== undefined, 8_000);
    const first = await store.load(runId);

    // Second and third observations of the same terminal state. A concurrent
    // finalizer is simulated directly against the store below, where the
    // check-and-attach race actually happens.
    await scheduler.tick(runId);
    await scheduler.tick(runId);
    await new Promise((r) => setTimeout(r, 100));

    const second = await store.load(runId);
    assert.equal(second?.aggregateResultRef, first?.aggregateResultRef);
    assert.equal(second?.aggregateGeneratedAt, first?.aggregateGeneratedAt);
    assert.equal(second?.outcome, first?.outcome);
    assert.equal(
      recorder.appended.filter(e => e.type === "coordination.aggregate.completed").length,
      1,
      "aggregate-completed must be emitted exactly once",
    );
    assert.equal(readdirSync(join(cwd, ".alix", "coordination", "results", "runs")).length, 1);
  });

  it("treats a second finalize of the same source as already finalized", async () => {
    const { runId } = await pendingRun(store);
    const recorder = recordingEventLog();
    const scheduler = schedulerFor(cwd, store, recorder.log);
    await scheduler.tick(runId);
    await waitUntil(async () => (await store.load(runId))?.aggregateResultRef !== undefined, 8_000);

    const { CoordinationCompletionService } = await import("../../src/kernel/coordination-completion-service.js");
    const { ResultAggregator } = await import("../../src/kernel/coordination-result-aggregator.js");
    const { CoordinationResultStore } = await import("../../src/kernel/coordination-result-store.js");
    const service = new CoordinationCompletionService({
      coordinationStore: store,
      resultAggregator: new ResultAggregator(new CoordinationResultStore(cwd)),
      aggregateStore: new CoordinationAggregateStore(cwd),
      eventLog: recorder.log,
    });

    const before = await store.load(runId);
    const eventsBefore = recorder.appended.filter(e => e.type === "coordination.aggregate.completed").length;
    const second = await service.finalize(runId);
    const after = await store.load(runId);

    assert.equal(second.aggregateRef, before?.aggregateResultRef, "the existing aggregate is reused");
    assert.equal(after?.aggregateGeneratedAt, before?.aggregateGeneratedAt, "metadata is not overwritten");
    assert.equal(
      recorder.appended.filter(e => e.type === "coordination.aggregate.completed").length,
      eventsBefore,
      "re-finalizing the same source must not re-emit",
    );
  });

  it("finalizes exactly once when two finalizers race on the store boundary", async () => {
    const { runId } = await pendingRun(store);
    const recorder = recordingEventLog();
    const scheduler = schedulerFor(cwd, store, recorder.log);
    await scheduler.tick(runId);
    await waitUntil(async () => (await store.load(runId))?.aggregateResultRef !== undefined, 8_000);

    const run = await store.load(runId);
    // A *new* fingerprint: the scheduler already attached the run's own one, so
    // a same-fingerprint race would correctly no-op on both sides and prove
    // nothing. Here both finalizers are fresh — exactly one may win.
    const fingerprint = "race-fingerprint";
    const [a, b] = await Promise.all([
      store.attachAggregateIfUnfinalized(runId, {
        aggregateResultRef: "a.json",
        aggregateGeneratedAt: "2026-01-01T00:00:00.000Z",
        aggregateSourceFingerprint: fingerprint,
        outcome: "success",
      }),
      store.attachAggregateIfUnfinalized(runId, {
        aggregateResultRef: "b.json",
        aggregateGeneratedAt: "2026-01-01T00:00:01.000Z",
        aggregateSourceFingerprint: fingerprint,
        outcome: "failure",
      }),
    ]);
    // Exactly one attach wins; the loser observes the winner's metadata.
    assert.equal([a.attached, b.attached].filter(Boolean).length, 1);
    const stored = await store.load(runId);
    const winner = a.attached ? a : b;
    assert.equal(stored?.aggregateResultRef, winner.run?.aggregateResultRef);
    assert.equal(stored?.outcome, winner.run?.outcome);
    assert.notEqual(stored?.aggregateResultRef, run?.aggregateResultRef, "the fresh fingerprint replaced the stale one");
  });

  it("records aggregation failure separately and leaves execution status untouched", async () => {
    const { runId } = await pendingRun(store);
    const recorder = recordingEventLog();
    const scheduler = schedulerFor(cwd, store, recorder.log);
    await scheduler.tick(runId);
    await waitUntil(async () => (await store.load(runId))?.status === "completed", 8_000);
    // Drop the aggregate so the failing service is the one that finalizes.
    await store.updateRun(runId, (current) => {
      current.aggregateResultRef = undefined;
      current.aggregateGeneratedAt = undefined;
      current.aggregateSourceFingerprint = undefined;
      current.outcome = undefined;
    });
    const { CoordinationCompletionService } = await import("../../src/kernel/coordination-completion-service.js");
    const { ResultAggregator } = await import("../../src/kernel/coordination-result-aggregator.js");
    const { CoordinationResultStore } = await import("../../src/kernel/coordination-result-store.js");

    // A completion service whose aggregation throws.
    const failing = new CoordinationCompletionService({
      coordinationStore: store,
      resultAggregator: {
        aggregate: async () => {
          throw new Error("aggregate exploded");
        },
      } as unknown as InstanceType<typeof ResultAggregator>,
      aggregateStore: new CoordinationAggregateStore(cwd),
      eventLog: recorder.log,
    });
    void CoordinationResultStore;

    await assert.rejects(() => failing.finalize(runId), /aggregate exploded/);

    const run = await store.load(runId);
    assert.equal(run?.status, "completed", "execution status must not change on aggregation failure");
    assert.equal(run?.aggregateResultRef, undefined, "no aggregate ref is attached on failure");
    assert.ok(
      recorder.appended.some(e => e.type === "coordination.aggregate.failed"),
      "aggregation failure must be recorded as its own evidence",
    );
  });

  it("keeps the omission of the completion service explicit for test schedulers", async () => {
    const { runId } = await pendingRun(store);
    const scheduler = new CoordinationScheduler({
      cwd,
      daemonInstanceId: `test-${process.pid}`,
      configProvider: async () => minimalConfig() as any,
      store,
      authorization: allowAllAuth(),
      ownershipRegistry: new OwnershipRegistry(cwd),
      executor: { execute: async () => ({ outcome: "success" as const }) } as any,
    });

    await scheduler.tick(runId);
    // Wait for the run to actually reach its terminal state through execution;
    // the omitted service is what keeps aggregation from happening.
    await waitUntil(async () => (await store.load(runId))?.status === "completed", 8_000);
    await new Promise((r) => setTimeout(r, 100));

    const run = await store.load(runId);
    assert.equal(run?.aggregateResultRef, undefined, "a scheduler without the service does not finalize");
  });
});

describe("scheduler construction wiring", () => {
  it("constructs the scheduler class only inside the factory", () => {
    // A production site that calls `new CoordinationScheduler(...)` is a site
    // that will never finalize a terminal run. The factory is the only
    // permitted construction; tests may still build the class directly.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (path.endsWith("coordination-scheduler.ts")) continue; // the factory itself
        if (readFileSync(path, "utf8").includes("new CoordinationScheduler(")) offenders.push(path);
      }
    };
    walk("src");
    assert.deepEqual(offenders, []);
  });
});
