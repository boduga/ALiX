import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { CoordinationScheduler } from "../../src/kernel/coordination-scheduler.js";
import { CoordinationSchedulerService } from "../../src/daemon/coordination-scheduler-service.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";

describe("CoordinationSchedulerService", () => {
  let cwd: string;
  let store: CoordinationStore;
  let scheduler: CoordinationScheduler;
  let service: CoordinationSchedulerService;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "dmn-"));
    store = new CoordinationStore(cwd);
    const mockAuth = { evaluate: async () => ({ status: "allowed" as const }) };
    const mockRegistry = { acquireMany: async () => [{ acquired: true, record: { id: "lease-1" } }], release: async () => true, renew: async () => true };
    const mockExecutor = { execute: async () => ({ outcome: "success" as const, summary: "ok" }) };
    scheduler = new CoordinationScheduler(
      { cwd, daemonInstanceId: "test-daemon", configProvider: async () => ({ permissions: { sessionMode: "bypass" } }) as any, store: store as any, authorization: mockAuth as any, ownershipRegistry: mockRegistry as any, executor: mockExecutor as any },
      { maxConcurrency: 1 },
    );
    service = new CoordinationSchedulerService(scheduler, store);
  });

  afterEach(() => {
    service.stop();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("starts and stops without error", () => {
    service.start();
    assert.ok(true, "service started");
    service.stop();
    assert.ok(true, "service stopped");
  });

  it("does not overlap ticks", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    service.start();
    await new Promise(r => setTimeout(r, 50));
    service.stop();
    assert.ok(true, "no overlap crash");
  });

  function buildScheduler(executed: string[]) {
    const mockAuth = { evaluate: async () => ({ status: "allowed" as const }) };
    const mockRegistry = { acquireMany: async () => [{ acquired: true, record: { id: "lease-1" } }], release: async () => true, renew: async () => true };
    const mockExecutor = {
      execute: async (worker: { id: string }) => {
        executed.push(worker.id);
        return { outcome: "success" as const, summary: "ok" };
      },
    };
    return new CoordinationScheduler(
      { cwd, daemonInstanceId: "test-daemon", configProvider: async () => ({ permissions: { sessionMode: "bypass" } }) as any, store: store as any, authorization: mockAuth as any, ownershipRegistry: mockRegistry as any, executor: mockExecutor as any },
      { maxConcurrency: 1 },
    );
  }

  async function addRun(hostKind: "daemon" | "inspector", id: string): Promise<{ runId: string; workerId: string }> {
    const run = createCoordinationRun({ sessionId: id, rootGoal: "g", coordinatorAgentId: "alix" });
    run.hostKind = hostKind;
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w", taskLabel: "t", goalPrompt: "do",
      requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);
    return { runId: run.id, workerId: worker.id };
  }

  it("ticks only the configured hostKind", async () => {
    const executed: string[] = [];
    const scoped = new CoordinationSchedulerService(buildScheduler(executed), store, { hostKind: "daemon", pollIntervalMs: 10 });
    const daemon = await addRun("daemon", "sd");
    const inspector = await addRun("inspector", "si");

    scoped.start();
    await new Promise(r => setTimeout(r, 80));
    scoped.stop();

    assert.ok(executed.includes(daemon.workerId), "daemon worker dispatched");
    assert.ok(!executed.includes(inspector.workerId), "inspector worker untouched");
    await scoped.shutdown();
  });

  it("requestTick dispatches a run immediately", async () => {
    const executed: string[] = [];
    const scoped = new CoordinationSchedulerService(buildScheduler(executed), store, { hostKind: "daemon" });
    const { workerId } = await addRun("daemon", "sreq");

    scoped.requestTick((await store.list())[0].id);
    for (let i = 0; i < 50 && !executed.includes(workerId); i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(executed.includes(workerId), "requested run dispatched");
    await scoped.shutdown();
  });
});
